package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

type deleteImageStudioTasksRequest struct {
	TaskIDs []string `json:"task_ids"`
}

const maxDeleteImageStudioTasks = 100

func GetAllTask(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)

	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	// 解析其他查询参数
	queryParams := model.SyncTaskQueryParams{
		Platform:       constant.TaskPlatform(c.Query("platform")),
		TaskID:         c.Query("task_id"),
		Status:         c.Query("status"),
		Action:         c.Query("action"),
		StartTimestamp: startTimestamp,
		EndTimestamp:   endTimestamp,
		ChannelID:      c.Query("channel_id"),
	}

	items := model.TaskGetAllTasks(pageInfo.GetStartIdx(), pageInfo.GetPageSize(), queryParams)
	total := model.TaskCountAllTasks(queryParams)
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(tasksToDto(items, true))
	common.ApiSuccess(c, pageInfo)
}

func GetUserTask(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)

	userId := c.GetInt("id")

	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)

	queryParams := model.SyncTaskQueryParams{
		Platform:       constant.TaskPlatform(c.Query("platform")),
		TaskID:         c.Query("task_id"),
		Status:         c.Query("status"),
		Action:         c.Query("action"),
		StartTimestamp: startTimestamp,
		EndTimestamp:   endTimestamp,
	}

	items := model.TaskGetAllUserTask(userId, pageInfo.GetStartIdx(), pageInfo.GetPageSize(), queryParams)
	total := model.TaskCountAllUserTask(userId, queryParams)
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(tasksToDto(items, false))
	common.ApiSuccess(c, pageInfo)
}

func DeleteUserImageStudioTasks(c *gin.Context) {
	var request deleteImageStudioTasksRequest
	if err := c.ShouldBindJSON(&request); err != nil || len(request.TaskIDs) == 0 {
		common.ApiErrorMsg(c, "task_ids 不能为空")
		return
	}
	cleanTaskIDs := make([]string, 0, len(request.TaskIDs))
	seenTaskIDs := make(map[string]struct{}, len(request.TaskIDs))
	for _, taskID := range request.TaskIDs {
		taskID = strings.TrimSpace(taskID)
		if taskID == "" {
			continue
		}
		if _, exists := seenTaskIDs[taskID]; exists {
			continue
		}
		seenTaskIDs[taskID] = struct{}{}
		cleanTaskIDs = append(cleanTaskIDs, taskID)
	}
	if len(cleanTaskIDs) == 0 || len(cleanTaskIDs) > maxDeleteImageStudioTasks {
		common.ApiErrorMsg(c, "每次只能删除 1 到 100 个任务")
		return
	}
	taskIDs := make([]any, 0, len(cleanTaskIDs))
	for _, taskID := range cleanTaskIDs {
		taskIDs = append(taskIDs, taskID)
	}
	tasks, err := model.GetByTaskIds(c.GetInt("id"), taskIDs)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	for _, task := range tasks {
		if task.Platform == constant.TaskPlatformImageStudio && task.Status != model.TaskStatusSuccess && task.Status != model.TaskStatusFailure {
			c.JSON(http.StatusConflict, gin.H{"success": false, "message": "运行中的画室任务不能删除"})
			return
		}
	}
	var deleted int64
	for _, task := range tasks {
		if task.Platform != constant.TaskPlatformImageStudio {
			continue
		}
		var payload any
		if len(task.Data) > 0 {
			_ = common.Unmarshal(task.Data, &payload)
		}
		wasDeleted, deleteErr := service.DeleteImageStudioTaskWithAssets(task, collectImageStudioStorageKeys(payload, nil))
		if deleteErr != nil {
			common.ApiError(c, deleteErr)
			return
		}
		if wasDeleted {
			deleted++
		}
	}
	common.ApiSuccess(c, gin.H{"deleted": deleted})
}

func tasksToDto(tasks []*model.Task, fillUser bool) []*dto.TaskDto {
	var userIdMap map[int]*model.UserBase
	if fillUser {
		userIdMap = make(map[int]*model.UserBase)
		userIds := types.NewSet[int]()
		for _, task := range tasks {
			userIds.Add(task.UserId)
		}
		for _, userId := range userIds.Items() {
			cacheUser, err := model.GetUserCache(userId)
			if err == nil {
				userIdMap[userId] = cacheUser
			}
		}
	}
	taskIDs := make([]string, 0, len(tasks))
	for _, task := range tasks {
		if task.Platform == constant.TaskPlatformImageStudio {
			taskIDs = append(taskIDs, task.TaskID)
		}
	}
	assetsByTask := make(map[string][]*model.ImageStudioAsset)
	if assets, err := model.GetImageStudioAssetsByTaskIDs(taskIDs); err == nil {
		for _, asset := range assets {
			assetsByTask[asset.TaskID] = append(assetsByTask[asset.TaskID], asset)
		}
	}
	result := make([]*dto.TaskDto, len(tasks))
	for i, task := range tasks {
		if fillUser {
			if user, ok := userIdMap[task.UserId]; ok {
				task.Username = user.Username
			}
		}
		result[i] = relay.TaskModel2Dto(task)
		if task.Platform == constant.TaskPlatformImageStudio {
			result[i].Quota = model.ImageStudioDisplayQuota(task)
		}
		sanitizeImageStudioTaskDtoWithAssets(task, result[i], assetsByTask[task.TaskID])
	}
	return result
}
