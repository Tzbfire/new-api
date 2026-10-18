package model

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFinalizeImageStudioTaskPublishesTaskAndAssetAtomically(t *testing.T) {
	truncateTables(t)
	now := time.Now().Unix()
	task := &Task{
		CreatedAt: now,
		UpdatedAt: now,
		TaskID:    "task_asset_finalize",
		Platform:  constant.TaskPlatformImageStudio,
		UserId:    42,
		Status:    TaskStatusInProgress,
		Data:      json.RawMessage(`{"request":{"prompt":"cat"}}`),
	}
	require.NoError(t, task.Insert())
	asset := &ImageStudioAsset{
		UserID:     task.UserId,
		TaskID:     task.TaskID,
		ImageIndex: 1,
		StorageKey: "user_42/task_asset_finalize/001.png",
		MimeType:   "image/png",
		SizeBytes:  10,
		SHA256:     "1234",
	}
	require.NoError(t, CreatePendingImageStudioAsset(asset))

	task.Status = TaskStatusSuccess
	task.Progress = "100%"
	task.Data = json.RawMessage(`{"response":{"data":[{"storage_key":"user_42/task_asset_finalize/001.png"}]}}`)
	won, err := FinalizeImageStudioTask(task)
	require.NoError(t, err)
	assert.True(t, won)

	var storedTask Task
	require.NoError(t, DB.First(&storedTask, task.ID).Error)
	assert.EqualValues(t, TaskStatusSuccess, storedTask.Status)
	var storedAsset ImageStudioAsset
	require.NoError(t, DB.First(&storedAsset, asset.ID).Error)
	assert.Equal(t, ImageStudioAssetStatusReady, storedAsset.Status)
}

func TestFinalizeImageStudioTaskRollsBackSuccessWithoutAsset(t *testing.T) {
	truncateTables(t)
	task := &Task{
		TaskID:   "task_asset_missing",
		Platform: constant.TaskPlatformImageStudio,
		UserId:   42,
		Status:   TaskStatusInProgress,
		Data:     json.RawMessage(`{}`),
	}
	require.NoError(t, task.Insert())
	task.Status = TaskStatusSuccess

	won, err := FinalizeImageStudioTask(task)
	require.ErrorContains(t, err, "exactly one asset")
	assert.False(t, won)

	var stored Task
	require.NoError(t, DB.First(&stored, task.ID).Error)
	assert.EqualValues(t, TaskStatusInProgress, stored.Status)
}
