package service

import (
	"context"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestImageStudioRecoveryRefundIsLogIndependentAndIdempotent(t *testing.T) {
	truncate(t)
	const userID = 906
	const chargedQuota = 450
	seedUser(t, userID, 1000)
	task := makeTask(userID, 0, chargedQuota, 0, BillingSourceWallet, 0)
	task.TaskID = "task_image_studio_recovery"
	task.Platform = constant.TaskPlatformImageStudio
	task.Status = model.TaskStatusFailure
	task.Progress = "100%"
	task.SubmitTime = time.Now().Add(-2 * time.Hour).Unix()
	task.FailReason = "storage failed"
	require.NoError(t, model.DB.Create(task).Error)

	previousLogConsumeEnabled := common.LogConsumeEnabled
	common.LogConsumeEnabled = false
	t.Cleanup(func() { common.LogConsumeEnabled = previousLogConsumeEnabled })
	RunImageStudioRecoveryOnce(context.Background())
	RunImageStudioRecoveryOnce(context.Background())

	assert.Equal(t, 1000+chargedQuota, getUserQuota(t, userID))
	var ledgerCount int64
	require.NoError(t, model.DB.Model(&model.TaskBillingAdjustment{}).
		Where("task_id = ? AND kind = ?", task.TaskID, model.TaskBillingAdjustmentRefund).
		Count(&ledgerCount).Error)
	assert.Equal(t, int64(1), ledgerCount)
}

func TestImageStudioRefundTargetReconcilesLateSettlement(t *testing.T) {
	truncate(t)
	const userID = 907
	seedUser(t, userID, 1000)
	task := makeTask(userID, 0, 400, 0, BillingSourceWallet, 0)
	task.TaskID = "task_image_studio_late_settlement"
	task.Platform = constant.TaskPlatformImageStudio

	applied, err := RefundImageStudioTaskQuotaOnce(context.Background(), task, "timeout estimate")
	require.NoError(t, err)
	assert.True(t, applied)
	assert.Equal(t, 1400, getUserQuota(t, userID))

	// A late settlement can be lower than the pre-consume estimate. Moving the
	// durable target down charges back only the over-refunded difference.
	task.Quota = 150
	applied, err = RefundImageStudioTaskQuotaOnce(context.Background(), task, "late final quota")
	require.NoError(t, err)
	assert.True(t, applied)
	assert.Equal(t, 1150, getUserQuota(t, userID))

	task.Quota = 600
	applied, err = RefundImageStudioTaskQuotaOnce(context.Background(), task, "late corrected quota")
	require.NoError(t, err)
	assert.True(t, applied)
	assert.Equal(t, 1600, getUserQuota(t, userID))
}

func TestImageStudioRecoveryRetriesZeroRefundTarget(t *testing.T) {
	truncate(t)
	const userID = 908
	seedUser(t, userID, 1000)
	task := makeTask(userID, 0, 400, 0, BillingSourceWallet, 0)
	task.TaskID = "task_image_studio_zero_refund_target"
	task.Platform = constant.TaskPlatformImageStudio
	task.Status = model.TaskStatusFailure
	task.Progress = "100%"
	task.SubmitTime = time.Now().Add(-2 * time.Hour).Unix()
	require.NoError(t, model.DB.Create(task).Error)

	applied, err := RefundImageStudioTaskQuotaOnce(context.Background(), task, "timeout estimate")
	require.NoError(t, err)
	assert.True(t, applied)
	assert.Equal(t, 1400, getUserQuota(t, userID))

	require.NoError(t, model.DB.Model(&model.Task{}).
		Where("id = ?", task.ID).
		Update("quota", 0).Error)
	RunImageStudioRecoveryOnce(context.Background())

	assert.Equal(t, 1000, getUserQuota(t, userID))
	var adjustment model.TaskBillingAdjustment
	require.NoError(t, model.DB.Where("task_id = ? AND kind = ?", task.TaskID, model.TaskBillingAdjustmentRefund).
		First(&adjustment).Error)
	assert.Zero(t, adjustment.Quota)
}

func TestRecoverStaleSubmittingImageStudioBatchActivatesCompleteBatch(t *testing.T) {
	truncate(t)
	const userID = 910
	batch := &model.ImageStudioBatch{
		BatchID: "batch_recover_complete_submit", UserID: userID, Mode: "generation", Group: "default",
		Model: "gpt-image-1", TotalCount: 1, Priority: 100,
		Status: model.ImageStudioBatchStatusSubmitting, RelayPath: "/v1/images/generations",
		CreatedAt: time.Now().Add(-time.Hour).Unix(),
	}
	require.NoError(t, model.CreateImageStudioBatch(batch))
	task := makeTask(userID, 0, 0, 0, BillingSourceWallet, 0)
	task.TaskID = "task_recover_complete_submit"
	task.Platform = constant.TaskPlatformImageStudio
	task.Status = model.TaskStatusQueued
	task.Progress = "0%"
	task.SubmitTime = batch.CreatedAt
	require.NoError(t, model.DB.Create(task).Error)
	require.NoError(t, model.CreateImageStudioBatchItem(&model.ImageStudioBatchItem{
		BatchDBID: batch.ID, TaskDBID: task.ID, BatchIndex: 1,
	}))

	RecoverStaleSubmittingImageStudioBatches(context.Background(), time.Now().Unix())

	storedBatch, exists, err := model.GetImageStudioBatch(userID, batch.BatchID)
	require.NoError(t, err)
	require.True(t, exists)
	assert.Equal(t, model.ImageStudioBatchStatusQueued, storedBatch.Status)
	storedTask, exists, err := model.GetByTaskId(userID, task.TaskID)
	require.NoError(t, err)
	require.True(t, exists)
	assert.EqualValues(t, model.TaskStatusQueued, storedTask.Status)
}

func TestRecoverStaleSubmittingImageStudioBatchFailsPartialBatchAndRefunds(t *testing.T) {
	truncate(t)
	const userID = 911
	const heldQuota = 200
	seedUser(t, userID, 800)
	batch := &model.ImageStudioBatch{
		BatchID: "batch_recover_partial_submit", UserID: userID, Mode: "generation", Group: "default",
		Model: "gpt-image-1", TotalCount: 2, Priority: 100,
		Status: model.ImageStudioBatchStatusSubmitting, RelayPath: "/v1/images/generations",
		CreatedAt: time.Now().Add(-time.Hour).Unix(),
	}
	require.NoError(t, model.CreateImageStudioBatch(batch))
	task := makeTask(userID, 0, heldQuota, 0, BillingSourceWallet, 0)
	task.TaskID = "task_recover_partial_submit"
	task.Platform = constant.TaskPlatformImageStudio
	task.Status = model.TaskStatusQueued
	task.Progress = "0%"
	task.SubmitTime = batch.CreatedAt
	require.NoError(t, model.DB.Create(task).Error)
	require.NoError(t, model.CreateImageStudioBatchItem(&model.ImageStudioBatchItem{
		BatchDBID: batch.ID, TaskDBID: task.ID, BatchIndex: 1,
	}))

	RecoverStaleSubmittingImageStudioBatches(context.Background(), time.Now().Unix())

	storedBatch, exists, err := model.GetImageStudioBatch(userID, batch.BatchID)
	require.NoError(t, err)
	require.True(t, exists)
	assert.Equal(t, model.ImageStudioBatchStatusFailed, storedBatch.Status)
	storedTask, exists, err := model.GetByTaskId(userID, task.TaskID)
	require.NoError(t, err)
	require.True(t, exists)
	assert.EqualValues(t, model.TaskStatusFailure, storedTask.Status)
	assert.Equal(t, "100%", storedTask.Progress)
	assert.Equal(t, 1000, getUserQuota(t, userID))
}

func TestImageStudioRecoveryUsesConfiguredRuntimeTimeout(t *testing.T) {
	truncate(t)
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	previous, existed := common.OptionMap["ImageStudioTaskTimeoutMinutes"]
	common.OptionMap["ImageStudioTaskTimeoutMinutes"] = "5"
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		if existed {
			common.OptionMap["ImageStudioTaskTimeoutMinutes"] = previous
		} else {
			delete(common.OptionMap, "ImageStudioTaskTimeoutMinutes")
		}
		common.OptionMapRWMutex.Unlock()
	})

	const userID = 909
	seedUser(t, userID, 1000)
	task := makeTask(userID, 0, 0, 0, BillingSourceWallet, 0)
	task.TaskID = "task_image_studio_configured_timeout"
	task.Platform = constant.TaskPlatformImageStudio
	task.Status = model.TaskStatusInProgress
	task.Progress = "10%"
	task.SubmitTime = time.Now().Unix()
	task.StartTime = time.Now().Add(-6 * time.Minute).Unix()
	require.NoError(t, model.DB.Create(task).Error)

	RunImageStudioRecoveryOnce(context.Background())

	var recovered model.Task
	require.NoError(t, model.DB.Where("task_id = ?", task.TaskID).First(&recovered).Error)
	assert.EqualValues(t, model.TaskStatusFailure, recovered.Status)
	assert.Equal(t, "100%", recovered.Progress)
	assert.Contains(t, recovered.FailReason, "5分钟")
}
