package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
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

// 结算额和检查点共享事务；重复恢复只读取最终结果，不重复退费或补扣。
func TestImageStudioPluginSettlementAtomicAndReplayable(t *testing.T) {
	for _, tc := range []struct {
		name         string
		held, target int
		subscription bool
	}{
		{"wallet_refund", 200, 100, false}, {"wallet_charge", 100, 200, false},
		{"wallet_zero_hold", 0, 200, false}, {"subscription_refund", 200, 100, true},
		{"subscription_charge", 100, 200, true}, {"subscription_zero_hold", 0, 200, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			truncateTables(t)
			user := createReserveTestUser(t, 1000-tc.held)
			task := &Task{TaskID: "plugin-atomic-" + tc.name, Platform: constant.TaskPlatformImageStudio, UserId: user.Id, Group: "default", Quota: tc.held, Status: TaskStatusInProgress}
			if tc.subscription {
				sub := &UserSubscription{UserId: user.Id, AmountTotal: 1000, AmountUsed: int64(tc.held), Status: "active", EndTime: common.GetTimestamp() + 3600}
				require.NoError(t, DB.Create(sub).Error)
				task.PrivateData.BillingSource = "subscription"
				task.PrivateData.SubscriptionId = sub.Id
			}
			require.NoError(t, DB.Create(task).Error)
			checkpoint := []byte(`{"plugin":{"settled":true}}`)
			require.NoError(t, SettleImageStudioPluginTask(task, tc.target, checkpoint, true))
			// 模拟重启后的读取，不复用进程内 BillingSession。
			var restored Task
			require.NoError(t, DB.First(&restored, task.ID).Error)
			require.NoError(t, SettleImageStudioPluginTask(&restored, tc.target, checkpoint, true))
			assert.Equal(t, tc.target, restored.Quota)
			assert.JSONEq(t, string(checkpoint), string(restored.Data))
			require.Error(t, SettleImageStudioPluginTask(&restored, tc.target+1, checkpoint, true))
			if tc.subscription {
				var sub UserSubscription
				require.NoError(t, DB.First(&sub, task.PrivateData.SubscriptionId).Error)
				assert.EqualValues(t, tc.target, sub.AmountUsed)
				assert.Equal(t, 1000-tc.held, getUserQuotaFromDB(t, user.Id))
			} else {
				assert.Equal(t, 1000-tc.target, getUserQuotaFromDB(t, user.Id))
			}
			// 结算后保存图片失败仍可退回最终金额；重复退款不改变余额。
			restored.Status = TaskStatusFailure
			require.NoError(t, DB.Model(&restored).Update("status", TaskStatusFailure).Error)
			delta, err := ApplyTaskRefundTarget(restored.TaskID, user.Id, restored.PrivateData.SubscriptionId, restored.Quota)
			require.NoError(t, err)
			assert.Equal(t, tc.target, delta)
			delta, err = ApplyTaskRefundTarget(restored.TaskID, user.Id, restored.PrivateData.SubscriptionId, restored.Quota)
			require.NoError(t, err)
			assert.Zero(t, delta)
			require.Error(t, SettleImageStudioPluginTask(&restored, tc.target, checkpoint, true))
			if tc.subscription {
				var sub UserSubscription
				require.NoError(t, DB.First(&sub, restored.PrivateData.SubscriptionId).Error)
				assert.Zero(t, sub.AmountUsed)
			} else {
				assert.Equal(t, 1000, getUserQuotaFromDB(t, user.Id))
			}
		})
	}
}

func TestImageStudioPluginSettlementRollsBackWithCheckpoint(t *testing.T) {
	for _, subscription := range []bool{false, true} {
		t.Run(map[bool]string{false: "wallet", true: "subscription"}[subscription], func(t *testing.T) {
			truncateTables(t)
			user := createReserveTestUser(t, 800)
			task := &Task{TaskID: "plugin-checkpoint-rollback", Platform: constant.TaskPlatformImageStudio, UserId: user.Id, Quota: 200, Status: TaskStatusInProgress}
			if subscription {
				sub := &UserSubscription{UserId: user.Id, AmountTotal: 1000, AmountUsed: 200, Status: "active", EndTime: common.GetTimestamp() + 3600}
				require.NoError(t, DB.Create(sub).Error)
				task.PrivateData.BillingSource = "subscription"
				task.PrivateData.SubscriptionId = sub.Id
			}
			require.NoError(t, DB.Create(task).Error)
			require.NoError(t, DB.Exec("CREATE TRIGGER studio_settlement_abort BEFORE UPDATE OF data ON tasks BEGIN SELECT RAISE(ABORT, 'checkpoint failure'); END").Error)
			t.Cleanup(func() { require.NoError(t, DB.Exec("DROP TRIGGER IF EXISTS studio_settlement_abort").Error) })
			require.Error(t, SettleImageStudioPluginTask(task, 100, []byte(`{"plugin":{"settled":true}}`), true))
			assert.Equal(t, 800, getUserQuotaFromDB(t, user.Id))
			var stored Task
			require.NoError(t, DB.First(&stored, task.ID).Error)
			assert.Equal(t, 200, stored.Quota)
			var count int64
			require.NoError(t, DB.Model(&TaskBillingAdjustment{}).Where("kind = ?", TaskBillingAdjustmentSettlement).Count(&count).Error)
			assert.Zero(t, count)
			if subscription {
				var sub UserSubscription
				require.NoError(t, DB.First(&sub, task.PrivateData.SubscriptionId).Error)
				assert.EqualValues(t, 200, sub.AmountUsed)
			}
		})
	}
}

func TestImageStudioPluginReservationRejectsDebtAndRefundedTask(t *testing.T) {
	truncateTables(t)
	user := createReserveTestUser(t, 50)
	task := &Task{TaskID: "plugin-reserve-bounds", Platform: constant.TaskPlatformImageStudio, UserId: user.Id, Quota: 100, Status: TaskStatusInProgress}
	require.NoError(t, DB.Create(task).Error)
	checkpoint := []byte(`{"plugin":{"settled":false}}`)
	require.ErrorIs(t, SettleImageStudioPluginTask(task, 151, checkpoint, false), ErrInsufficientUserQuota)
	assert.Equal(t, 50, getUserQuotaFromDB(t, user.Id))
	require.NoError(t, SettleImageStudioPluginTask(task, 150, checkpoint, false))
	assert.Zero(t, getUserQuotaFromDB(t, user.Id))
	require.NoError(t, SettleImageStudioPluginTask(task, 150, checkpoint, false))
	assert.Zero(t, getUserQuotaFromDB(t, user.Id))
	_, err := ApplyTaskRefundTarget(task.TaskID, user.Id, 0, 150)
	require.NoError(t, err)
	require.ErrorContains(t, SettleImageStudioPluginTask(task, 160, checkpoint, false), "refunded")
	assert.Equal(t, 150, getUserQuotaFromDB(t, user.Id))
}

func TestImageStudioPluginReservationSharesPendingCacheBalance(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	useUserCacheMiniRedis(t)
	common.BatchUpdateEnabled = true
	user := createReserveTestUser(t, 100)
	reserved, err := TryReserveUserQuota(user.Id, 60)
	require.NoError(t, err)
	require.True(t, reserved)
	task := &Task{TaskID: "plugin-shared-cache", Platform: constant.TaskPlatformImageStudio, UserId: user.Id, Status: TaskStatusInProgress}
	require.NoError(t, DB.Create(task).Error)
	checkpoint := []byte(`{"plugin":{"settled":false}}`)
	require.ErrorIs(t, SettleImageStudioPluginTask(task, 41, checkpoint, false), ErrInsufficientUserQuota)
	require.NoError(t, SettleImageStudioPluginTask(task, 40, checkpoint, false))
	assert.Equal(t, 60, getUserQuotaFromDB(t, user.Id))
	cached, err := GetUserCache(user.Id)
	require.NoError(t, err)
	assert.Zero(t, cached.Quota)
	require.NoError(t, SettleImageStudioPluginTask(task, 20, []byte(`{"plugin":{"settled":true}}`), true))
	cached, err = GetUserCache(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 20, cached.Quota)
	batchUpdate()
	assert.Equal(t, 20, getUserQuotaFromDB(t, user.Id))
}
