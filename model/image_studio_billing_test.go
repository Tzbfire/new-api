package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestImageStudioDisplayQuotaHidesFullyRefundedFailure(t *testing.T) {
	truncateTables(t)
	user := &User{Id: 0, Username: "studio_display", Password: "x", Quota: 1000, Status: 1}
	require.NoError(t, DB.Create(user).Error)

	task := &Task{
		TaskID:   "task_display_refund",
		Platform: constant.TaskPlatformImageStudio,
		UserId:   user.Id,
		Quota:    100,
		Status:   TaskStatusFailure,
	}
	require.NoError(t, DB.Create(task).Error)
	assert.Equal(t, 100, ImageStudioDisplayQuota(task))
	assert.Equal(t, 100, ImageStudioDisplayQuota(&Task{Status: TaskStatusSuccess, Quota: 100, TaskID: task.TaskID}))

	applied, err := ApplyTaskRefundTarget(task.TaskID, task.UserId, 0, 100)
	require.NoError(t, err)
	assert.Equal(t, 100, applied)
	assert.Equal(t, 0, ImageStudioDisplayQuota(task))
	assert.Equal(t, 1100, mustUserQuota(t, user.Id))
}

func mustUserQuota(t *testing.T, userID int) int {
	t.Helper()
	var quota int
	require.NoError(t, DB.Model(&User{}).Where("id = ?", userID).Select("quota").Scan(&quota).Error)
	return quota
}

func TestRequeueImageStudioTaskReturnsToQueued(t *testing.T) {
	truncateTables(t)
	now := time.Now().Unix()
	task := &Task{
		CreatedAt:  now,
		UpdatedAt:  now,
		SubmitTime: now,
		StartTime:  now,
		TaskID:     "task_requeue_orphan",
		Platform:   constant.TaskPlatformImageStudio,
		UserId:     1,
		Status:     TaskStatusInProgress,
		Progress:   "10%",
	}
	require.NoError(t, DB.Create(task).Error)

	won, err := RequeueImageStudioTask(task.TaskID)
	require.NoError(t, err)
	assert.True(t, won)

	var stored Task
	require.NoError(t, DB.Where("task_id = ?", task.TaskID).First(&stored).Error)
	assert.EqualValues(t, TaskStatusQueued, stored.Status)
	assert.Equal(t, "0%", stored.Progress)
	assert.Zero(t, stored.StartTime)
}
