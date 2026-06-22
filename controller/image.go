package controller

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"
	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

func GetImage(c *gin.Context) {

}

const imageStudioTaskPlatform = constant.TaskPlatformImageStudio
const imageStudioMaxTaskCount = 100
const imageStudioTaskConcurrency = 10

type imageStudioTaskPayload struct {
	Request  imageStudioRequestMeta `json:"request,omitempty"`
	Response any                    `json:"response,omitempty"`
	Usage    *dto.Usage             `json:"usage,omitempty"`
}

type imageStudioRequestMeta struct {
	Model      string `json:"model,omitempty"`
	Prompt     string `json:"prompt,omitempty"`
	Size       string `json:"size,omitempty"`
	N          uint   `json:"n,omitempty"`
	Mode       string `json:"mode,omitempty"`
	Group      string `json:"group,omitempty"`
	RequestID  string `json:"request_id,omitempty"`
	BatchID    string `json:"batch_id,omitempty"`
	BatchIndex int    `json:"batch_index,omitempty"`
	BatchSize  int    `json:"batch_size,omitempty"`
}

func CreateImageStudioTask(c *gin.Context) {
	if c.GetBool("use_access_token") {
		common.ApiErrorMsg(c, "暂不支持使用 access token")
		return
	}

	request, err := helper.GetAndValidateRequest(c, types.RelayFormatOpenAIImage)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	imageReq, ok := request.(*dto.ImageRequest)
	if !ok {
		common.ApiErrorMsg(c, "invalid image request")
		return
	}

	userId := c.GetInt("id")
	userCache, err := model.GetUserCache(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	userCache.WriteContext(c)

	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatOpenAIImage, request, nil)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	tempToken := &model.Token{
		UserId: userId,
		Name:   fmt.Sprintf("image-studio-%s", relayInfo.UsingGroup),
		Group:  relayInfo.UsingGroup,
	}
	_ = middleware.SetupContextForToken(c, tempToken)
	relayInfo.InitChannelMeta(c)

	bodyStorage, err := common.GetBodyStorage(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	bodyBytes, err := bodyStorage.Bytes()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	contentType := c.Request.Header.Get("Content-Type")
	requestId := c.GetString(common.RequestIdKey)

	imageN := uint(1)
	if imageReq.N != nil && *imageReq.N > 0 {
		imageN = *imageReq.N
	}
	if imageN > imageStudioMaxTaskCount {
		common.ApiErrorMsg(c, fmt.Sprintf("生成数量不能超过 %d", imageStudioMaxTaskCount))
		return
	}

	taskBodies, err := buildImageStudioTaskBodies(c, contentType, bodyBytes, int(imageN))
	if err != nil {
		common.ApiError(c, err)
		return
	}

	now := time.Now().Unix()
	batchID := ""
	if imageN > 1 {
		batchID = "batch_" + common.GetUUID()
	}
	taskDtos := make([]*dto.TaskDto, 0, len(taskBodies))
	snapshots := make([]imageStudioContext, 0, len(taskBodies))
	insertedTasks := make([]*model.Task, 0, len(taskBodies))
	for index, taskBody := range taskBodies {
		taskRequestID := imageStudioChildRequestID(requestId, index, len(taskBodies))
		task := model.InitTask(imageStudioTaskPlatform, relayInfo)
		task.CreatedAt = now
		task.UpdatedAt = now
		task.SubmitTime = now
		task.Status = model.TaskStatusQueued
		task.Progress = "0%"
		task.Action = imageStudioAction(relayInfo.RelayMode)
		task.Properties.Input = imageReq.Prompt
		task.SetData(imageStudioTaskPayload{
			Request: imageStudioRequestMeta{
				Model:      imageReq.Model,
				Prompt:     imageReq.Prompt,
				Size:       imageReq.Size,
				N:          1,
				Mode:       imageStudioMode(relayInfo.RelayMode),
				Group:      relayInfo.UsingGroup,
				RequestID:  taskRequestID,
				BatchID:    batchID,
				BatchIndex: index + 1,
				BatchSize:  int(imageN),
			},
		})
		if insertErr := task.Insert(); insertErr != nil {
			for _, insertedTask := range insertedTasks {
				failImageStudioTask(insertedTask, "批量任务提交未完成: "+insertErr.Error())
			}
			common.ApiError(c, insertErr)
			return
		}
		service.PublishImageStudioTaskEvent(task)
		insertedTasks = append(insertedTasks, task)
		taskDtos = append(taskDtos, relay.TaskModel2Dto(task))

		snapshot := captureImageStudioContext(c, task.TaskID, taskRequestID, taskBody.ContentType, taskBody.Body)
		snapshots = append(snapshots, snapshot)
	}

	if len(taskDtos) == 1 {
		common.ApiSuccess(c, taskDtos[0])
	} else {
		common.ApiSuccess(c, gin.H{
			"batch_id": batchID,
			"tasks":    taskDtos,
		})
	}

	dispatchImageStudioTasks(snapshots)
}

func dispatchImageStudioTasks(snapshots []imageStudioContext) {
	if len(snapshots) == 0 {
		return
	}
	if len(snapshots) == 1 {
		snapshot := snapshots[0]
		gopool.Go(func() {
			runImageStudioTask(snapshot)
		})
		return
	}

	gopool.Go(func() {
		workerCount := len(snapshots)
		if workerCount > imageStudioTaskConcurrency {
			workerCount = imageStudioTaskConcurrency
		}
		queue := make(chan imageStudioContext)
		var wg sync.WaitGroup
		wg.Add(workerCount)
		for i := 0; i < workerCount; i++ {
			gopool.Go(func() {
				defer wg.Done()
				for snapshot := range queue {
					runImageStudioTask(snapshot)
				}
			})
		}
		for _, snapshot := range snapshots {
			queue <- snapshot
		}
		close(queue)
		wg.Wait()
	})
}

type imageStudioTaskBody struct {
	Body        []byte
	ContentType string
}

func imageStudioChildRequestID(parentRequestID string, index, total int) string {
	if total <= 1 {
		return parentRequestID
	}
	if parentRequestID == "" {
		parentRequestID = common.GetTimeString() + common.GetRandomString(8)
	}
	return fmt.Sprintf("%s-%02d", parentRequestID, index+1)
}

func buildImageStudioTaskBodies(c *gin.Context, contentType string, body []byte, count int) ([]imageStudioTaskBody, error) {
	if count <= 1 {
		return []imageStudioTaskBody{{Body: append([]byte(nil), body...), ContentType: contentType}}, nil
	}
	if strings.Contains(contentType, gin.MIMEMultipartPOSTForm) {
		return buildImageStudioMultipartBodies(c, count)
	}
	if strings.Contains(contentType, gin.MIMEPOSTForm) {
		return buildImageStudioFormBodies(body, contentType, count)
	}
	return buildImageStudioJSONBodies(body, contentType, count)
}

func buildImageStudioJSONBodies(body []byte, contentType string, count int) ([]imageStudioTaskBody, error) {
	var payload map[string]any
	if err := common.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	payload["n"] = 1
	setImageStudioURLResponseFormat(payload)
	nextBody, err := common.Marshal(payload)
	if err != nil {
		return nil, err
	}
	bodies := make([]imageStudioTaskBody, 0, count)
	for i := 0; i < count; i++ {
		bodies = append(bodies, imageStudioTaskBody{Body: append([]byte(nil), nextBody...), ContentType: contentType})
	}
	return bodies, nil
}

func buildImageStudioFormBodies(body []byte, contentType string, count int) ([]imageStudioTaskBody, error) {
	values, err := url.ParseQuery(string(body))
	if err != nil {
		return nil, err
	}
	values.Set("n", "1")
	values.Set("response_format", "url")
	nextBody := []byte(values.Encode())
	bodies := make([]imageStudioTaskBody, 0, count)
	for i := 0; i < count; i++ {
		bodies = append(bodies, imageStudioTaskBody{Body: append([]byte(nil), nextBody...), ContentType: contentType})
	}
	return bodies, nil
}

func buildImageStudioMultipartBodies(c *gin.Context, count int) ([]imageStudioTaskBody, error) {
	form, err := common.ParseMultipartFormReusable(c)
	if err != nil {
		return nil, err
	}
	defer form.RemoveAll()

	bodies := make([]imageStudioTaskBody, 0, count)
	for i := 0; i < count; i++ {
		body, contentType, err := buildImageStudioMultipartBody(form)
		if err != nil {
			return nil, err
		}
		bodies = append(bodies, imageStudioTaskBody{Body: body, ContentType: contentType})
	}
	return bodies, nil
}

func buildImageStudioMultipartBody(form *multipart.Form) ([]byte, string, error) {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	for key, values := range form.Value {
		if key == "n" || key == "response_format" {
			continue
		}
		for _, value := range values {
			if err := writer.WriteField(key, value); err != nil {
				_ = writer.Close()
				return nil, "", err
			}
		}
	}
	if err := writer.WriteField("n", "1"); err != nil {
		_ = writer.Close()
		return nil, "", err
	}
	if err := writer.WriteField("response_format", "url"); err != nil {
		_ = writer.Close()
		return nil, "", err
	}
	for key, files := range form.File {
		for _, fileHeader := range files {
			if err := copyImageStudioMultipartFile(writer, key, fileHeader); err != nil {
				_ = writer.Close()
				return nil, "", err
			}
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}
	return buf.Bytes(), writer.FormDataContentType(), nil
}

func setImageStudioURLResponseFormat(payload map[string]any) {
	payload["response_format"] = "url"
}

func copyImageStudioMultipartFile(writer *multipart.Writer, field string, fileHeader *multipart.FileHeader) error {
	file, err := fileHeader.Open()
	if err != nil {
		return err
	}
	defer file.Close()

	part, err := writer.CreateFormFile(field, fileHeader.Filename)
	if err != nil {
		return err
	}
	_, err = io.Copy(part, file)
	return err
}

func imageStudioAction(relayMode int) string {
	if relayMode == relayconstant.RelayModeImagesEdits {
		return constant.TaskActionImageEdit
	}
	return constant.TaskActionImageGeneration
}

func imageStudioMode(relayMode int) string {
	if relayMode == relayconstant.RelayModeImagesEdits {
		return "i2i"
	}
	return "t2i"
}

type imageStudioContext struct {
	TaskID      string
	RequestID   string
	Method      string
	Path        string
	RawQuery    string
	Header      http.Header
	Body        []byte
	ContentType string
	ClientIP    string
	Keys        map[string]any
}

func captureImageStudioContext(c *gin.Context, taskID, requestID, contentType string, body []byte) imageStudioContext {
	keys := make(map[string]any, len(c.Keys))
	for k, v := range c.Keys {
		keys[k] = v
	}
	return imageStudioContext{
		TaskID:      taskID,
		RequestID:   requestID,
		Method:      c.Request.Method,
		Path:        strings.Replace(c.Request.URL.Path, "/pg/image-studio/", "/pg/images/", 1),
		RawQuery:    c.Request.URL.RawQuery,
		Header:      c.Request.Header.Clone(),
		Body:        append([]byte(nil), body...),
		ContentType: contentType,
		ClientIP:    c.ClientIP(),
		Keys:        keys,
	}
}

func (s imageStudioContext) ginContext() (*gin.Context, *httptest.ResponseRecorder, error) {
	target := s.Path
	if s.RawQuery != "" {
		target += "?" + s.RawQuery
	}
	req, err := http.NewRequestWithContext(context.Background(), s.Method, target, bytes.NewReader(s.Body))
	if err != nil {
		return nil, nil, err
	}
	req.Header = s.Header.Clone()
	if s.ContentType != "" {
		req.Header.Set("Content-Type", s.ContentType)
	}
	if s.ClientIP != "" && req.Header.Get("X-Forwarded-For") == "" && req.Header.Get("X-Real-IP") == "" {
		req.RemoteAddr = s.ClientIP + ":0"
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = req
	c.Params = nil
	c.Keys = make(map[string]any, len(s.Keys)+2)
	for k, v := range s.Keys {
		c.Keys[k] = v
	}
	c.Set(common.RequestIdKey, s.RequestID)
	storage, err := common.CreateBodyStorage(s.Body)
	if err != nil {
		return nil, nil, err
	}
	c.Set(common.KeyBodyStorage, storage)
	return c, recorder, nil
}

func runImageStudioTask(snapshot imageStudioContext) {
	defer func() {
		if r := recover(); r != nil {
			reason := fmt.Sprintf("后台任务异常: %v", r)
			logger.LogError(context.Background(), fmt.Sprintf("image studio task %s panic: %s\n%s", snapshot.TaskID, reason, string(debug.Stack())))
			if task, exist, err := model.GetByOnlyTaskId(snapshot.TaskID); err == nil && exist {
				service.BackfillTaskBillingFromConsumeLog(context.Background(), task, snapshot.RequestID)
				if failImageStudioTask(task, reason) && task.Quota > 0 {
					service.RefundTaskQuota(context.Background(), task, task.FailReason)
				}
			}
		}
	}()

	task, exist, err := model.GetByOnlyTaskId(snapshot.TaskID)
	if err != nil {
		logger.LogError(context.Background(), fmt.Sprintf("image studio get task %s failed: %s", snapshot.TaskID, err.Error()))
		return
	}
	if !exist {
		return
	}

	c, recorder, err := snapshot.ginContext()
	if err != nil {
		failImageStudioTask(task, "初始化任务上下文失败: "+err.Error())
		return
	}
	defer common.CleanupBodyStorage(c)

	task.Status = model.TaskStatusInProgress
	task.Progress = "10%"
	task.StartTime = time.Now().Unix()
	if won, err := task.UpdateWithStatus(model.TaskStatusQueued); err != nil {
		logger.LogError(context.Background(), fmt.Sprintf("image studio start task %s update failed: %s", task.TaskID, err.Error()))
		return
	} else if !won {
		return
	}
	service.PublishImageStudioTaskEvent(task)

	payload, usage, quota, relayErr := executeImageStudioRelay(c, recorder)
	if relayErr != nil {
		service.BackfillTaskBillingFromConsumeLog(context.Background(), task, snapshot.RequestID)
		if failImageStudioTask(task, relayErr.Error()) && task.Quota > 0 {
			service.RefundTaskQuota(context.Background(), task, task.FailReason)
		}
		return
	}
	if payload == nil {
		service.BackfillTaskBillingFromConsumeLog(context.Background(), task, snapshot.RequestID)
		if failImageStudioTask(task, "上游未返回图片") && task.Quota > 0 {
			service.RefundTaskQuota(context.Background(), task, task.FailReason)
		}
		return
	}

	task.Status = model.TaskStatusSuccess
	task.Progress = "100%"
	task.Quota = quota
	task.FinishTime = time.Now().Unix()
	task.FailReason = ""
	task.UpdatedAt = task.FinishTime
	var previous imageStudioTaskPayload
	_ = common.Unmarshal(task.Data, &previous)
	task.SetData(imageStudioTaskPayload{
		Request:  previous.Request,
		Response: payload,
		Usage:    usage,
	})
	if won, updateErr := task.UpdateWithStatus(model.TaskStatusInProgress); updateErr != nil {
		logger.LogError(context.Background(), fmt.Sprintf("image studio update task %s failed: %s", task.TaskID, updateErr.Error()))
	} else if !won {
		refundImageStudioChargeAfterLostFinalUpdate(snapshot.TaskID, snapshot.RequestID, quota)
	} else {
		service.PublishImageStudioTaskEvent(task)
	}
}

func refundImageStudioChargeAfterLostFinalUpdate(taskId string, requestId string, quota int) {
	if quota <= 0 {
		return
	}
	task, exist, err := model.GetByOnlyTaskId(taskId)
	if err != nil {
		logger.LogError(context.Background(), fmt.Sprintf("image studio reload task %s after lost update failed: %s", taskId, err.Error()))
		return
	}
	if !exist || task.Status != model.TaskStatusFailure || task.Quota > 0 {
		return
	}
	service.BackfillTaskBillingFromConsumeLog(context.Background(), task, requestId)
	if task.Quota <= 0 {
		task.Quota = quota
	}
	task.UpdatedAt = time.Now().Unix()
	if _, err := task.UpdateExisting(); err != nil {
		logger.LogError(context.Background(), fmt.Sprintf("image studio backfill failed task %s quota failed: %s", task.TaskID, err.Error()))
		return
	}
	service.RefundTaskQuota(context.Background(), task, "AI 画室任务已进入失败终态，取消迟到的生图扣费")
	service.PublishImageStudioTaskEvent(task)
}

func executeImageStudioRelay(c *gin.Context, recorder *httptest.ResponseRecorder) (any, *dto.Usage, int, error) {
	Relay(c, types.RelayFormatOpenAIImage)

	statusCode := recorder.Code
	if statusCode == 0 {
		statusCode = http.StatusOK
	}
	responseBytes := recorder.Body.Bytes()
	if statusCode < http.StatusOK || statusCode >= http.StatusMultipleChoices {
		return nil, nil, 0, parseImageStudioRelayError(statusCode, responseBytes)
	}

	payload, usage, err := parseImageStudioResponse(responseBytes)
	if err != nil {
		return nil, nil, 0, err
	}
	return payload, usage, imageStudioQuotaFromLog(c), nil
}

func parseImageStudioRelayError(statusCode int, data []byte) error {
	var response struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
		Message string `json:"message"`
	}
	if len(data) > 0 {
		if err := common.Unmarshal(data, &response); err == nil {
			if response.Error != nil && strings.TrimSpace(response.Error.Message) != "" {
				return fmt.Errorf("图片生成失败（HTTP %d）: %s", statusCode, strings.TrimSpace(response.Error.Message))
			}
			if strings.TrimSpace(response.Message) != "" {
				return fmt.Errorf("图片生成失败（HTTP %d）: %s", statusCode, strings.TrimSpace(response.Message))
			}
		}
	}
	return fmt.Errorf("图片生成失败（HTTP %d）", statusCode)
}

func imageStudioQuotaFromLog(c *gin.Context) int {
	requestId := c.GetString(common.RequestIdKey)
	userId := c.GetInt("id")
	if requestId == "" || userId == 0 {
		return 0
	}
	logs, _, err := model.GetUserLogs(userId, model.LogTypeConsume, 0, 0, "", "", 0, 1, "", requestId, "")
	if err != nil {
		logger.LogError(c, fmt.Sprintf("image studio query consume log %s failed: %s", requestId, err.Error()))
		return 0
	}
	if len(logs) == 0 {
		return 0
	}
	return logs[0].Quota
}

func parseImageStudioResponse(data []byte) (any, *dto.Usage, error) {
	if len(data) == 0 {
		return nil, nil, errors.New("empty image response")
	}
	var envelope struct {
		Data  any        `json:"data"`
		Usage *dto.Usage `json:"usage"`
	}
	if err := common.Unmarshal(data, &envelope); err != nil {
		return nil, nil, err
	}
	if envelope.Data == nil {
		return nil, nil, errors.New("image response has no data")
	}
	var payload any
	if err := common.Unmarshal(data, &payload); err != nil {
		return nil, nil, err
	}
	removeImageStudioStoredBase64(payload)
	return payload, envelope.Usage, nil
}

func removeImageStudioStoredBase64(value any) bool {
	switch typed := value.(type) {
	case map[string]any:
		changed := false
		if _, ok := typed["b64_json"]; ok {
			delete(typed, "b64_json")
			changed = true
		}
		for _, child := range typed {
			if removeImageStudioStoredBase64(child) {
				changed = true
			}
		}
		return changed
	case []any:
		changed := false
		for _, child := range typed {
			if removeImageStudioStoredBase64(child) {
				changed = true
			}
		}
		return changed
	default:
		return false
	}
}

func failImageStudioTask(task *model.Task, reason string) bool {
	if task.Status == model.TaskStatusFailure || task.Status == model.TaskStatusSuccess {
		return false
	}
	oldStatus := task.Status
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "生成失败，后台任务未返回错误详情"
	}
	task.Status = model.TaskStatusFailure
	task.Progress = "100%"
	task.FailReason = reason
	task.FinishTime = time.Now().Unix()
	task.UpdatedAt = task.FinishTime
	won, err := task.UpdateWithStatus(oldStatus)
	if err != nil {
		logger.LogError(context.Background(), fmt.Sprintf("image studio fail task %s update failed: %s", task.TaskID, err.Error()))
		return false
	}
	if won {
		service.PublishImageStudioTaskEvent(task)
	}
	return won
}
