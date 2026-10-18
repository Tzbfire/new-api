package controller

import (
	"archive/zip"
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

const imageStudioTaskPageSize = 60

func normalizeImageStudioTaskFilter(raw string) (string, bool) {
	filter := strings.TrimSpace(raw)
	if filter == "" {
		filter = "all"
	}
	switch filter {
	case "all", "active", "completed", "failed":
		return filter, true
	default:
		return "", false
	}
}

func ListImageStudioLibraryTasks(c *gin.Context) {
	userID := c.GetInt("id")
	if err := service.EnsureUserImageStudioBatches(userID); err != nil {
		common.ApiError(c, err)
		return
	}
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
	tasks, total, err := model.ListUserImageStudioLibraryTasks(userID, filter, (page-1)*pageSize, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	summary, err := model.GetUserImageStudioLibrarySummary(userID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"items":     tasksToDto(tasks, false),
		"total":     total,
		"page":      page,
		"page_size": pageSize,
		"summary":   summary,
	})
}

// DownloadImageStudioLibrary streams all currently-ready Studio images owned by
// the user. Tasks are fetched in bounded chunks and each asset file is closed
// before the next one is opened, so library size does not translate into an
// equal number of open files or task rows kept in memory.
func DownloadImageStudioLibrary(c *gin.Context) {
	if !imageStudioDownloadAllEnabled() {
		imageStudioContentError(c, http.StatusForbidden, "image studio download-all is disabled")
		return
	}
	userID := c.GetInt("id")
	if err := service.EnsureUserImageStudioBatches(userID); err != nil {
		common.ApiError(c, err)
		return
	}
	summary, err := model.GetUserImageStudioLibrarySummary(userID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if summary.SuccessCount == 0 {
		imageStudioContentError(c, http.StatusConflict, "image studio library has no downloadable images")
		return
	}

	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", `attachment; filename="ai-studio-all.zip"`)
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Accel-Buffering", "no")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Status(http.StatusOK)
	archive := zip.NewWriter(c.Writer)
	defer archive.Close()

	const chunkSize = 200
	var beforeID int64
	written := 0
	for {
		tasks, err := model.ListUserImageStudioTasksByStatusBeforeID(userID, model.TaskStatusSuccess, beforeID, chunkSize)
		if err != nil {
			return
		}
		if len(tasks) == 0 {
			break
		}
		taskIDs := make([]string, 0, len(tasks))
		for _, task := range tasks {
			if task != nil {
				taskIDs = append(taskIDs, task.TaskID)
			}
		}
		assets, err := model.GetImageStudioAssetsByTaskIDs(taskIDs)
		if err != nil {
			return
		}
		assetsByTask := make(map[string]*model.ImageStudioAsset, len(assets))
		for _, asset := range assets {
			if asset != nil && asset.UserID == userID && asset.ImageIndex == 1 && asset.Status == model.ImageStudioAssetStatusReady {
				assetsByTask[asset.TaskID] = asset
			}
		}
		for _, task := range tasks {
			if task == nil {
				continue
			}
			asset := assetsByTask[task.TaskID]
			if asset == nil {
				continue
			}
			if err := service.ValidateImageStudioAssetOwnership(asset.StorageKey, userID, task.TaskID); err != nil {
				continue
			}
			file, info, err := service.OpenImageStudioAsset(asset.StorageKey, asset.SizeBytes)
			if err != nil {
				continue
			}
			written++
			header := &zip.FileHeader{
				Name:   fmt.Sprintf("%06d%s", written, imageStudioMimeExtension(asset.MimeType)),
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
		}
		beforeID = tasks[len(tasks)-1].ID
		if len(tasks) < chunkSize {
			break
		}
	}

	manifest, _ := common.Marshal(gin.H{
		"scope":    "all",
		"total":    summary.TotalCount,
		"success":  summary.SuccessCount,
		"failed":   summary.FailureCount,
		"exported": written,
	})
	if entry, err := archive.Create("manifest.json"); err == nil {
		_, _ = entry.Write(manifest)
	}
}

// DeleteImageStudioLibrary clears the whole Studio library only when no task is
// running. This keeps batch accounting stable: a partially-finished running
// batch is never hollowed out underneath the worker.
func DeleteImageStudioLibrary(c *gin.Context) {
	userID := c.GetInt("id")
	if err := service.EnsureUserImageStudioBatches(userID); err != nil {
		common.ApiError(c, err)
		return
	}
	summary, err := model.GetUserImageStudioLibrarySummary(userID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if summary.TotalCount == 0 {
		common.ApiSuccess(c, gin.H{"deleted": 0, "batches": 0})
		return
	}
	if summary.FinishedCount != summary.TotalCount {
		imageStudioContentError(c, http.StatusConflict, "running image studio tasks must finish before clearing the whole library")
		return
	}
	batches, err := model.ListAllUserImageStudioBatches(userID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	deletedTasks := 0
	deletedBatches := 0
	for _, batch := range batches {
		if batch == nil {
			continue
		}
		deleted, deleteErr := deleteImageStudioBatchData(userID, batch)
		if deleteErr != nil {
			common.ApiError(c, deleteErr)
			return
		}
		deletedTasks += deleted
		deletedBatches++
	}
	common.ApiSuccess(c, gin.H{"deleted": deletedTasks, "batches": deletedBatches})
}
