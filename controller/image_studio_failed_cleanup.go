package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const imageStudioFailedCleanupChunkSize = 200

func DeleteImageStudioLibraryFailures(c *gin.Context) {
	userID := c.GetInt("id")
	deleted, affectedBatches, err := deleteImageStudioFailedTasks(func() ([]*model.Task, error) {
		return model.ListUserImageStudioTasksByStatusBeforeID(userID, model.TaskStatusFailure, 0, imageStudioFailedCleanupChunkSize)
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := removeEmptyImageStudioBatches(userID, affectedBatches); err != nil {
		common.ApiError(c, err)
		return
	}
	summary, err := model.GetUserImageStudioLibrarySummary(userID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"deleted": deleted, "summary": summary})
}

func DeleteImageStudioBatchFailures(c *gin.Context) {
	userID := c.GetInt("id")
	batchID := c.Param("batch_id")
	batch, exists, err := model.GetImageStudioBatch(userID, batchID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !exists || batch == nil {
		imageStudioContentError(c, http.StatusNotFound, "image studio batch not found")
		return
	}
	deleted, affectedBatches, err := deleteImageStudioFailedTasks(func() ([]*model.Task, error) {
		return model.ListImageStudioBatchTasksByStatus(userID, batchID, model.TaskStatusFailure, imageStudioFailedCleanupChunkSize)
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := removeEmptyImageStudioBatches(userID, affectedBatches); err != nil {
		common.ApiError(c, err)
		return
	}
	if _, exists, err := model.GetImageStudioBatchByID(batch.ID); err != nil {
		common.ApiError(c, err)
		return
	} else if !exists {
		common.ApiSuccess(c, gin.H{"deleted": deleted, "batch_deleted": true})
		return
	}
	summary, _, err := model.GetImageStudioBatchSummary(userID, batchID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"deleted": deleted, "batch_deleted": false, "summary": summary})
}

func deleteImageStudioFailedTasks(fetch func() ([]*model.Task, error)) (int, map[int64]struct{}, error) {
	deleted := 0
	affectedBatches := make(map[int64]struct{})
	for {
		tasks, err := fetch()
		if err != nil {
			return deleted, affectedBatches, err
		}
		if len(tasks) == 0 {
			return deleted, affectedBatches, nil
		}
		taskDBIDs := make([]int64, 0, len(tasks))
		for _, task := range tasks {
			if task != nil && task.ID > 0 {
				taskDBIDs = append(taskDBIDs, task.ID)
			}
		}
		batchIDs, err := model.ListImageStudioBatchIDsForTasks(taskDBIDs)
		if err != nil {
			return deleted, affectedBatches, err
		}
		for _, batchID := range batchIDs {
			affectedBatches[batchID] = struct{}{}
		}

		for _, task := range tasks {
			if task == nil {
				continue
			}
			var payload any
			if len(task.Data) > 0 {
				_ = common.Unmarshal(task.Data, &payload)
			}
			removed, err := service.DeleteImageStudioTaskWithAssets(task, collectImageStudioStorageKeys(payload, nil))
			if err != nil {
				return deleted, affectedBatches, err
			}
			if removed {
				deleted++
			}
		}
	}
}

func removeEmptyImageStudioBatches(userID int, candidates map[int64]struct{}) error {
	if len(candidates) == 0 {
		return nil
	}
	batchIDs := make([]int64, 0, len(candidates))
	for batchID := range candidates {
		batchIDs = append(batchIDs, batchID)
	}
	batches, err := model.ListEmptyImageStudioBatchesByIDs(userID, batchIDs)
	if err != nil {
		return err
	}
	for _, batch := range batches {
		if batch == nil {
			continue
		}
		service.RemoveImageStudioJobBody(batch.BodyKey)
		if err := model.DeleteImageStudioBatch(batch.ID); err != nil {
			return err
		}
	}
	return nil
}
