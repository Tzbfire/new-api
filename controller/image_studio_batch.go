package controller

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func ListImageStudioBatches(c *gin.Context) {
	userID := c.GetInt("id")
	if err := service.EnsureUserImageStudioBatches(userID); err != nil {
		common.ApiError(c, err)
		return
	}
	page := 1
	if parsed, err := strconv.Atoi(c.Query("p")); err == nil && parsed > 0 {
		page = parsed
	}
	pageSize := 20
	if parsed, err := strconv.Atoi(c.Query("page_size")); err == nil && parsed > 0 && parsed <= 100 {
		pageSize = parsed
	}
	items, total, err := model.ListUserImageStudioBatches(userID, (page-1)*pageSize, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}

func GetImageStudioBatch(c *gin.Context) {
	summary, exists, err := model.GetImageStudioBatchSummary(c.GetInt("id"), c.Param("batch_id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !exists || summary == nil {
		imageStudioContentError(c, http.StatusNotFound, "image studio batch not found")
		return
	}
	common.ApiSuccess(c, summary)
}

func ListImageStudioBatchTasks(c *gin.Context) {
	page := 1
	if parsed, err := strconv.Atoi(c.Query("p")); err == nil && parsed > 0 {
		page = parsed
	}
	pageSize := imageStudioTaskPageSize
	if parsed, err := strconv.Atoi(c.Query("page_size")); err == nil && parsed > 0 && parsed <= 100 {
		pageSize = parsed
	}
	filter, valid := normalizeImageStudioTaskFilter(c.Query("status"))
	if !valid {
		imageStudioContentError(c, http.StatusBadRequest, "invalid image studio task status filter")
		return
	}
	tasks, total, err := model.ListImageStudioBatchTasks(c.GetInt("id"), c.Param("batch_id"), filter, (page-1)*pageSize, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if tasks == nil && total == 0 {
		if _, exists, lookupErr := model.GetImageStudioBatch(c.GetInt("id"), c.Param("batch_id")); lookupErr != nil {
			common.ApiError(c, lookupErr)
			return
		} else if !exists {
			imageStudioContentError(c, http.StatusNotFound, "image studio batch not found")
			return
		}
	}
	common.ApiSuccess(c, gin.H{
		"items": tasksToDto(tasks, false), "total": total, "page": page, "page_size": pageSize,
	})
}

var errImageStudioBatchRunning = errors.New("running image studio batch cannot be deleted")

func deleteImageStudioBatchData(userID int, batch *model.ImageStudioBatch) (int, error) {
	if batch == nil {
		return 0, nil
	}
	tasks, err := model.ListImageStudioBatchTasksAll(userID, batch.BatchID)
	if err != nil {
		return 0, err
	}
	for _, task := range tasks {
		if task != nil && task.Status != model.TaskStatusSuccess && task.Status != model.TaskStatusFailure {
			return 0, errImageStudioBatchRunning
		}
	}
	deleted := 0
	for _, task := range tasks {
		if task == nil {
			continue
		}
		var payload any
		if len(task.Data) > 0 {
			_ = common.Unmarshal(task.Data, &payload)
		}
		removed, deleteErr := service.DeleteImageStudioTaskWithAssets(task, collectImageStudioStorageKeys(payload, nil))
		if deleteErr != nil {
			return deleted, deleteErr
		}
		if removed {
			deleted++
		}
	}
	service.RemoveImageStudioJobBody(batch.BodyKey)
	if err := model.DeleteImageStudioBatch(batch.ID); err != nil {
		return deleted, err
	}
	return deleted, nil
}

func DeleteImageStudioBatch(c *gin.Context) {
	userID := c.GetInt("id")
	batchID := strings.TrimSpace(c.Param("batch_id"))
	batch, exists, err := model.GetImageStudioBatch(userID, batchID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !exists || batch == nil {
		imageStudioContentError(c, http.StatusNotFound, "image studio batch not found")
		return
	}
	deleted, err := deleteImageStudioBatchData(userID, batch)
	if errors.Is(err, errImageStudioBatchRunning) {
		imageStudioContentError(c, http.StatusConflict, err.Error())
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"deleted": deleted})
}

// DownloadImageStudioBatch streams every currently-ready image in a batch when
// whole-scope downloads are enabled. It opens at most one image file while each
// ZIP entry is copied, so large batches do not consume one file descriptor per
// image. Failed tasks are represented in failures.csv.
func DownloadImageStudioBatch(c *gin.Context) {
	if !imageStudioDownloadAllEnabled() {
		imageStudioContentError(c, http.StatusForbidden, "image studio download-all is disabled")
		return
	}
	userID := c.GetInt("id")
	batchID := strings.TrimSpace(c.Param("batch_id"))
	batch, exists, err := model.GetImageStudioBatch(userID, batchID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !exists || batch == nil {
		imageStudioContentError(c, http.StatusNotFound, "image studio batch not found")
		return
	}
	tasks, err := model.ListImageStudioBatchTasksAll(userID, batchID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(tasks) == 0 {
		imageStudioContentError(c, http.StatusConflict, "image studio batch has no tasks")
		return
	}
	taskIDs := make([]string, 0, len(tasks))
	for _, task := range tasks {
		if task != nil {
			taskIDs = append(taskIDs, task.TaskID)
		}
	}
	assets, err := model.GetImageStudioAssetsByTaskIDs(taskIDs)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	assetsByTask := make(map[string]*model.ImageStudioAsset, len(assets))
	for _, asset := range assets {
		if asset != nil && asset.UserID == userID && asset.ImageIndex == 1 && asset.Status == model.ImageStudioAssetStatusReady {
			assetsByTask[asset.TaskID] = asset
		}
	}

	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="ai-studio-%s.zip"`, batchID))
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Accel-Buffering", "no")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Status(http.StatusOK)
	archive := zip.NewWriter(c.Writer)
	defer archive.Close()

	failures := strings.Builder{}
	failures.WriteString("index,task_id,reason\n")
	successCount := 0
	failureCount := 0
	for index, task := range tasks {
		if task == nil {
			continue
		}
		asset := assetsByTask[task.TaskID]
		if task.Status != model.TaskStatusSuccess || asset == nil {
			if task.Status == model.TaskStatusFailure {
				failureCount++
				reason := strings.ReplaceAll(strings.ReplaceAll(task.FailReason, "\"", "\"\""), "\n", " ")
				failures.WriteString(fmt.Sprintf("%d,%s,\"%s\"\n", index+1, task.TaskID, reason))
			}
			continue
		}
		if err := service.ValidateImageStudioAssetOwnership(asset.StorageKey, userID, task.TaskID); err != nil {
			continue
		}
		file, info, err := service.OpenImageStudioAsset(asset.StorageKey, asset.SizeBytes)
		if err != nil {
			continue
		}
		header := &zip.FileHeader{
			Name:   fmt.Sprintf("%04d%s", index+1, imageStudioMimeExtension(asset.MimeType)),
			Method: zip.Store,
		}
		header.SetModTime(info.ModTime())
		entry, createErr := archive.CreateHeader(header)
		if createErr != nil {
			_ = file.Close()
			return
		}
		_, copyErr := io.Copy(entry, file)
		_ = file.Close()
		if copyErr != nil {
			return
		}
		successCount++
	}

	manifest, _ := common.Marshal(gin.H{
		"batch_id":   batchID,
		"requested":  batch.TotalCount,
		"success":    successCount,
		"failed":     failureCount,
		"model":      batch.Model,
		"created_at": batch.CreatedAt,
	})
	if entry, err := archive.Create("manifest.json"); err == nil {
		_, _ = entry.Write(manifest)
	}
	if failureCount > 0 {
		if entry, err := archive.Create("failures.csv"); err == nil {
			_, _ = io.WriteString(entry, failures.String())
		}
	}
}
