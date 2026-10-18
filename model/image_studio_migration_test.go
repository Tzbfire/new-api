package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestImageStudioRefundLedgerMigrationBaselinesLegacyFailures(t *testing.T) {
	truncateTables(t)
	user := &User{Id: 9951, Username: "legacy_studio_user", Quota: 1000, Status: common.UserStatusEnabled}
	require.NoError(t, DB.Create(user).Error)
	task := &Task{
		TaskID:   "task_legacy_already_refunded",
		Platform: constant.TaskPlatformImageStudio,
		UserId:   user.Id,
		Quota:    400,
		Status:   TaskStatusFailure,
		Progress: "100%",
	}
	require.NoError(t, DB.Create(task).Error)

	require.NoError(t, migrateImageStudioRefundLedger())
	require.NoError(t, migrateImageStudioRefundLedger())

	var storedUser User
	require.NoError(t, DB.First(&storedUser, user.Id).Error)
	assert.Equal(t, 1000, storedUser.Quota)
	var adjustment TaskBillingAdjustment
	require.NoError(t, DB.Where("task_id = ? AND kind = ?", task.TaskID, TaskBillingAdjustmentRefund).First(&adjustment).Error)
	assert.Equal(t, task.Quota, adjustment.Quota)
	var count int64
	require.NoError(t, DB.Model(&TaskBillingAdjustment{}).Where("task_id = ?", task.TaskID).Count(&count).Error)
	assert.EqualValues(t, 1, count)
	var marker Option
	require.NoError(t, DB.Where("key = ?", "MigrationImageStudioRefundLedgerV1").First(&marker).Error)
	assert.Equal(t, "done", marker.Value)
}
