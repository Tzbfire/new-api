package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestListImageStudioLibraryTasksPaginatesAllCreationsBeyondThirty(t *testing.T) {
	setupImageStudioAssetDB(t)
	const userID = 31
	const total = 125
	for index := 0; index < total; index++ {
		task := &model.Task{
			TaskID:     fmt.Sprintf("library-list-task-%03d", index+1),
			UserId:     userID,
			Platform:   constant.TaskPlatformImageStudio,
			Status:     model.TaskStatusSuccess,
			CreatedAt:  int64(index + 1),
			SubmitTime: int64(index + 1),
			Progress:   "100%",
		}
		require.NoError(t, task.Insert())
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/image-studio/library/tasks?p=2&page_size=100", nil)
	context.Set("id", userID)
	ListImageStudioLibraryTasks(context)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Items    []map[string]any                `json:"items"`
			Total    int                             `json:"total"`
			Page     int                             `json:"page"`
			PageSize int                             `json:"page_size"`
			Summary  model.ImageStudioLibrarySummary `json:"summary"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.True(t, response.Success)
	assert.Equal(t, total, response.Data.Total)
	assert.Equal(t, 2, response.Data.Page)
	assert.Equal(t, 100, response.Data.PageSize)
	assert.Len(t, response.Data.Items, 25)
	assert.Equal(t, total, response.Data.Summary.TotalCount)
	assert.Equal(t, total, response.Data.Summary.SuccessCount)
}

func TestListImageStudioLibraryTasksFiltersBeforePagination(t *testing.T) {
	setupImageStudioAssetDB(t)
	const userID = 35
	for index := 0; index < 65; index++ {
		task := &model.Task{
			TaskID: fmt.Sprintf("library-filter-failed-%03d", index+1), UserId: userID,
			Platform: constant.TaskPlatformImageStudio, Status: model.TaskStatusFailure,
			CreatedAt: int64(index + 1), SubmitTime: int64(index + 1), Progress: "100%",
		}
		require.NoError(t, task.Insert())
	}
	for index := 0; index < 3; index++ {
		task := &model.Task{
			TaskID: fmt.Sprintf("library-filter-success-%03d", index+1), UserId: userID,
			Platform: constant.TaskPlatformImageStudio, Status: model.TaskStatusSuccess,
			CreatedAt: int64(100 + index), SubmitTime: int64(100 + index), Progress: "100%",
		}
		require.NoError(t, task.Insert())
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/image-studio/library/tasks?p=2&page_size=60&status=failed", nil)
	context.Set("id", userID)
	ListImageStudioLibraryTasks(context)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Items    []map[string]any                `json:"items"`
			Total    int                             `json:"total"`
			Page     int                             `json:"page"`
			PageSize int                             `json:"page_size"`
			Summary  model.ImageStudioLibrarySummary `json:"summary"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.True(t, response.Success)
	assert.Equal(t, 65, response.Data.Total)
	assert.Equal(t, 2, response.Data.Page)
	assert.Equal(t, 60, response.Data.PageSize)
	assert.Len(t, response.Data.Items, 5)
	assert.Equal(t, 68, response.Data.Summary.TotalCount)
	assert.Equal(t, 65, response.Data.Summary.FailureCount)
	assert.Equal(t, 3, response.Data.Summary.SuccessCount)
}

func TestListImageStudioBatchTasksFiltersBeforePagination(t *testing.T) {
	setupImageStudioAssetDB(t)
	const userID = 36
	batch := &model.ImageStudioBatch{
		BatchID: "batch-filter-pagination", UserID: userID, Mode: "generation", Group: "default",
		Model: "gpt-image-1", TotalCount: 65, Priority: 10,
		Status: model.ImageStudioBatchStatusPartialFailure, RelayPath: "/v1/images/generations",
	}
	require.NoError(t, model.CreateImageStudioBatch(batch))
	for index := 0; index < 65; index++ {
		status := model.TaskStatus(model.TaskStatusFailure)
		if index >= 63 {
			status = model.TaskStatusSuccess
		}
		task := &model.Task{
			TaskID: fmt.Sprintf("batch-filter-task-%03d", index+1), UserId: userID,
			Platform: constant.TaskPlatformImageStudio, Status: status,
			CreatedAt: int64(index + 1), SubmitTime: int64(index + 1), Progress: "100%",
		}
		require.NoError(t, task.Insert())
		require.NoError(t, model.CreateImageStudioBatchItem(&model.ImageStudioBatchItem{
			BatchDBID: batch.ID, TaskDBID: task.ID, BatchIndex: index + 1,
		}))
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/image-studio/batches/batch-filter-pagination/tasks?p=2&page_size=60&status=failed", nil)
	context.Params = gin.Params{{Key: "batch_id", Value: batch.BatchID}}
	context.Set("id", userID)
	ListImageStudioBatchTasks(context)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Items    []map[string]any `json:"items"`
			Total    int              `json:"total"`
			Page     int              `json:"page"`
			PageSize int              `json:"page_size"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.True(t, response.Success)
	assert.Equal(t, 63, response.Data.Total)
	assert.Equal(t, 2, response.Data.Page)
	assert.Equal(t, 60, response.Data.PageSize)
	assert.Len(t, response.Data.Items, 3)
}

func TestDeleteImageStudioLibraryRefusesWhileAnyTaskIsRunning(t *testing.T) {
	setupImageStudioAssetDB(t)
	const userID = 32
	for index, status := range []model.TaskStatus{model.TaskStatusSuccess, model.TaskStatusInProgress} {
		task := &model.Task{
			TaskID:     fmt.Sprintf("library-clear-task-%d", index+1),
			UserId:     userID,
			Platform:   constant.TaskPlatformImageStudio,
			Status:     status,
			CreatedAt:  int64(index + 1),
			SubmitTime: int64(index + 1),
		}
		require.NoError(t, task.Insert())
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodDelete, "/api/image-studio/library", nil)
	context.Set("id", userID)
	DeleteImageStudioLibrary(context)

	assert.Equal(t, http.StatusConflict, recorder.Code)
	var count int64
	require.NoError(t, model.DB.Model(&model.Task{}).Where("user_id = ?", userID).Count(&count).Error)
	assert.EqualValues(t, 2, count)
}

func TestDeleteImageStudioLibraryFailuresOnlyDeletesFailures(t *testing.T) {
	setupImageStudioAssetDB(t)
	const userID = 33
	statuses := []model.TaskStatus{
		model.TaskStatusFailure,
		model.TaskStatusSuccess,
		model.TaskStatusInProgress,
		model.TaskStatusFailure,
	}
	for index, status := range statuses {
		task := &model.Task{
			TaskID:     fmt.Sprintf("library-failed-cleanup-%d", index+1),
			UserId:     userID,
			Platform:   constant.TaskPlatformImageStudio,
			Status:     status,
			CreatedAt:  int64(index + 1),
			SubmitTime: int64(index + 1),
		}
		require.NoError(t, task.Insert())
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodDelete, "/api/image-studio/library/failed", nil)
	context.Set("id", userID)
	DeleteImageStudioLibraryFailures(context)

	require.Equal(t, http.StatusOK, recorder.Code)
	var failed int64
	require.NoError(t, model.DB.Model(&model.Task{}).
		Where("user_id = ? AND status = ?", userID, model.TaskStatusFailure).Count(&failed).Error)
	assert.Zero(t, failed)
	var remaining int64
	require.NoError(t, model.DB.Model(&model.Task{}).Where("user_id = ?", userID).Count(&remaining).Error)
	assert.EqualValues(t, 2, remaining)
}

func TestDeleteImageStudioBatchFailuresIsScopedAndPreservesBatchHistory(t *testing.T) {
	setupImageStudioAssetDB(t)
	const userID = 34
	batch := &model.ImageStudioBatch{
		BatchID: "batch-failed-cleanup", UserID: userID, Mode: "generation", Group: "default",
		Model: "gpt-image-1", TotalCount: 3, Priority: 10,
		Status: model.ImageStudioBatchStatusPartialFailure, RelayPath: "/v1/images/generations",
	}
	require.NoError(t, model.CreateImageStudioBatch(batch))
	for index, status := range []model.TaskStatus{model.TaskStatusFailure, model.TaskStatusSuccess, model.TaskStatusFailure} {
		task := &model.Task{
			TaskID:     fmt.Sprintf("batch-failed-cleanup-%d", index+1),
			UserId:     userID,
			Platform:   constant.TaskPlatformImageStudio,
			Status:     status,
			CreatedAt:  int64(index + 1),
			SubmitTime: int64(index + 1),
		}
		require.NoError(t, task.Insert())
		require.NoError(t, model.CreateImageStudioBatchItem(&model.ImageStudioBatchItem{
			BatchDBID: batch.ID, TaskDBID: task.ID, BatchIndex: index + 1,
		}))
	}
	otherBatch := &model.ImageStudioBatch{
		BatchID: "batch-other-failure", UserID: userID, Mode: "generation", Group: "default",
		Model: "gpt-image-1", TotalCount: 1, Priority: 10,
		Status: model.ImageStudioBatchStatusFailed, RelayPath: "/v1/images/generations",
	}
	require.NoError(t, model.CreateImageStudioBatch(otherBatch))
	otherTask := &model.Task{
		TaskID: "batch-other-failure-task", UserId: userID,
		Platform: constant.TaskPlatformImageStudio, Status: model.TaskStatusFailure,
	}
	require.NoError(t, otherTask.Insert())
	require.NoError(t, model.CreateImageStudioBatchItem(&model.ImageStudioBatchItem{
		BatchDBID: otherBatch.ID, TaskDBID: otherTask.ID, BatchIndex: 1,
	}))

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodDelete, "/api/image-studio/batches/batch-failed-cleanup/failed", nil)
	context.Params = gin.Params{{Key: "batch_id", Value: batch.BatchID}}
	context.Set("id", userID)
	DeleteImageStudioBatchFailures(context)

	require.Equal(t, http.StatusOK, recorder.Code)
	summary, exists, err := model.GetImageStudioBatchSummary(userID, batch.BatchID)
	require.NoError(t, err)
	require.True(t, exists)
	assert.Equal(t, 0, summary.FailureCount)
	assert.Equal(t, 1, summary.SuccessCount)
	assert.Equal(t, 2, summary.DeletedCount)
	assert.Equal(t, 3, summary.FinishedCount)
	assert.Equal(t, model.ImageStudioBatchStatusPartialFailure, summary.Status)
	_, exists, err = model.GetByTaskId(userID, otherTask.TaskID)
	require.NoError(t, err)
	assert.True(t, exists)
}
