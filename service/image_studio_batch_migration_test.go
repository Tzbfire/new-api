package service

import (
	"fmt"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEnsureUserImageStudioBatchesBackfillsLegacyBatchBeyondThirtyTasks(t *testing.T) {
	truncate(t)
	const userID = 44001
	const batchID = "batch_legacy_large_75"
	now := time.Now().Unix()
	for index := 1; index <= 75; index++ {
		status := model.TaskStatus(model.TaskStatusSuccess)
		if index > 70 {
			status = model.TaskStatus(model.TaskStatusFailure)
		}
		task := &model.Task{
			TaskID:     fmt.Sprintf("legacy-large-%03d", index),
			UserId:     userID,
			Platform:   constant.TaskPlatformImageStudio,
			Status:     status,
			Action:     constant.TaskActionImageGeneration,
			CreatedAt:  now,
			UpdatedAt:  now,
			SubmitTime: now,
			Progress:   "100%",
		}
		task.SetData(map[string]any{"request": map[string]any{
			"batch_id":    batchID,
			"batch_index": index,
			"batch_size":  75,
			"mode":        "generation",
			"group":       "default",
			"model":       "gpt-image-1",
			"prompt":      "legacy bulk",
		}})
		require.NoError(t, task.Insert())
	}

	require.NoError(t, EnsureUserImageStudioBatches(userID))
	// Idempotency matters because the list API calls the migration on every load.
	require.NoError(t, EnsureUserImageStudioBatches(userID))

	batches, total, err := model.ListUserImageStudioBatches(userID, 0, 20)
	require.NoError(t, err)
	require.EqualValues(t, 1, total)
	require.Len(t, batches, 1)
	assert.Equal(t, batchID, batches[0].BatchID)
	assert.Equal(t, 75, batches[0].TotalCount)
	assert.Equal(t, 70, batches[0].SuccessCount)
	assert.Equal(t, 5, batches[0].FailureCount)
	assert.Equal(t, 75, batches[0].FinishedCount)
	assert.Equal(t, model.ImageStudioBatchStatusPartialFailure, batches[0].Status)

	firstPage, taskTotal, err := model.ListImageStudioBatchTasks(userID, batchID, "all", 0, 60)
	require.NoError(t, err)
	assert.EqualValues(t, 75, taskTotal)
	assert.Len(t, firstPage, 60)
	secondPage, _, err := model.ListImageStudioBatchTasks(userID, batchID, "all", 60, 60)
	require.NoError(t, err)
	assert.Len(t, secondPage, 15)
}
