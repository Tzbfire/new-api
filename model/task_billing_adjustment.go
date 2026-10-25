package model

import (
	"errors"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const TaskBillingAdjustmentRefund = "refund"

// TaskBillingAdjustment is the primary-database idempotency ledger for task
// balance changes. The composite unique index is supported by SQLite, MySQL,
// and PostgreSQL and makes concurrent timeout/worker refunds single-winner.
type TaskBillingAdjustment struct {
	ID             int64  `json:"id" gorm:"primaryKey"`
	TaskID         string `json:"task_id" gorm:"type:varchar(191);uniqueIndex:idx_task_billing_adjustment,priority:1"`
	Kind           string `json:"kind" gorm:"type:varchar(32);uniqueIndex:idx_task_billing_adjustment,priority:2"`
	UserID         int    `json:"user_id" gorm:"index"`
	SubscriptionID int    `json:"subscription_id" gorm:"index"`
	Quota          int    `json:"quota"`
	CreatedAt      int64  `json:"created_at" gorm:"index"`
}

// ApplyTaskRefundTarget atomically moves the task's total refund to targetQuota.
// It supports both positive corrections and charge-backs when a late final
// settlement differs from an earlier timeout estimate.
func ApplyTaskRefundTarget(taskID string, userID int, subscriptionID int, targetQuota int, billingMeta ...QuotaBucketChargeMeta) (int, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" || userID <= 0 || targetQuota < 0 {
		return 0, errors.New("invalid task refund")
	}
	appliedDelta := 0
	err := DB.Transaction(func(tx *gorm.DB) error {
		adjustment := &TaskBillingAdjustment{
			TaskID:         taskID,
			Kind:           TaskBillingAdjustmentRefund,
			UserID:         userID,
			SubscriptionID: subscriptionID,
			Quota:          0,
			CreatedAt:      time.Now().Unix(),
		}
		result := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "task_id"}, {Name: "kind"}},
			DoNothing: true,
		}).Create(adjustment)
		if result.Error != nil {
			return result.Error
		}
		if err := lockForUpdate(tx).
			Where("task_id = ? AND kind = ?", taskID, TaskBillingAdjustmentRefund).
			First(adjustment).Error; err != nil {
			return err
		}
		if adjustment.UserID != userID || adjustment.SubscriptionID != subscriptionID {
			return errors.New("task refund billing identity mismatch")
		}
		appliedDelta = targetQuota - adjustment.Quota
		if appliedDelta == 0 {
			return nil
		}

		if adjustment.SubscriptionID > 0 {
			var subscription UserSubscription
			if err := lockForUpdate(tx).Where("id = ? AND user_id = ?", adjustment.SubscriptionID, userID).First(&subscription).Error; err != nil {
				return err
			}
			subscription.AmountUsed -= int64(appliedDelta)
			if subscription.AmountUsed < 0 {
				subscription.AmountUsed = 0
			}
			if subscription.AmountTotal > 0 && subscription.AmountUsed > subscription.AmountTotal {
				return errors.New("subscription refund adjustment exceeds total")
			}
			if err := tx.Save(&subscription).Error; err != nil {
				return err
			}
		} else if IsQuotaBucketBillingEnabled() {
			meta := QuotaBucketChargeMeta{RequestID: taskID, BillingGroup: QuotaBucketBillingGroupDefault}
			if len(billingMeta) > 0 {
				meta = billingMeta[0]
			}
			if meta.RequestID == "" {
				meta.RequestID = taskID
			}
			if err := adjustTaskQuotaBucketsTx(tx, userID, meta, -appliedDelta); err != nil {
				return err
			}
		} else {
			result = tx.Model(&User{}).Where("id = ?", userID).Update("quota", gorm.Expr("quota + ?", appliedDelta))
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return gorm.ErrRecordNotFound
			}
		}
		return tx.Model(adjustment).Updates(map[string]any{
			"quota":           targetQuota,
			"subscription_id": subscriptionID,
		}).Error
	})
	if err != nil {
		return 0, err
	}
	if appliedDelta != 0 && subscriptionID == 0 {
		if err := cacheIncrUserQuota(userID, int64(appliedDelta)); err != nil {
			common.SysError("failed to sync studio refund quota cache: " + err.Error())
		}
	}
	return appliedDelta, nil
}

func GetTimedOutImageStudioTasks(cutoffUnix int64, limit int) []*Task {
	if limit <= 0 {
		return nil
	}
	var tasks []*Task
	// Only IN_PROGRESS is recovered by timeout. QUEUED jobs are durable and
	// reclaimed by workers after restart instead of being force-failed.
	err := DB.Where("platform = ?", constant.TaskPlatformImageStudio).
		Where("status = ?", TaskStatusInProgress).
		Where("progress != ?", "100%").
		Where("start_time > 0 AND start_time < ?", cutoffUnix).
		Order("submit_time").
		Limit(limit).
		Find(&tasks).Error
	if err != nil {
		return nil
	}
	return tasks
}

func GetUnrefundedFailedImageStudioTasks(limit int) []*Task {
	if limit <= 0 {
		return nil
	}
	var tasks []*Task
	matchingLedger := DB.Model(&TaskBillingAdjustment{}).
		Select("1").
		Where("task_billing_adjustments.task_id = tasks.task_id").
		Where("task_billing_adjustments.kind = ?", TaskBillingAdjustmentRefund).
		Where("task_billing_adjustments.quota = tasks.quota")
	anyLedger := DB.Model(&TaskBillingAdjustment{}).
		Select("1").
		Where("task_billing_adjustments.task_id = tasks.task_id").
		Where("task_billing_adjustments.kind = ?", TaskBillingAdjustmentRefund)
	err := DB.Model(&Task{}).
		Where("platform = ? AND status = ?", constant.TaskPlatformImageStudio, TaskStatusFailure).
		Where("quota > 0 OR EXISTS (?)", anyLedger).
		Where("NOT EXISTS (?)", matchingLedger).
		Order("updated_at").
		Limit(limit).
		Find(&tasks).Error
	if err != nil {
		return nil
	}
	return tasks
}

// GetTaskRefundQuota returns the durable refund target already applied for a task.
func GetTaskRefundQuota(taskID string) int {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return 0
	}
	var adjustment TaskBillingAdjustment
	err := DB.Where("task_id = ? AND kind = ?", taskID, TaskBillingAdjustmentRefund).First(&adjustment).Error
	if err != nil {
		return 0
	}
	if adjustment.Quota < 0 {
		return 0
	}
	return adjustment.Quota
}

// ImageStudioDisplayQuota is the user-visible charge for studio tasks.
// Failed tasks show net charge after durable refunds so a refunded failure is 0.
func ImageStudioDisplayQuota(task *Task) int {
	if task == nil {
		return 0
	}
	quota := task.Quota
	if quota < 0 {
		return 0
	}
	if task.Status == TaskStatusFailure {
		refunded := GetTaskRefundQuota(task.TaskID)
		if refunded >= quota {
			return 0
		}
		if refunded > 0 {
			return quota - refunded
		}
	}
	return quota
}

const TaskBillingAdjustmentSettlement = "settlement"

// SettleImageStudioPluginTask 在同一事务内调整资金、保存插件检查点；任务行即预留余额的权威状态。
func SettleImageStudioPluginTask(task *Task, targetQuota int, checkpoint []byte, final bool) error {
	if task == nil || task.ID <= 0 || task.UserId <= 0 || targetQuota < 0 || targetQuota > common.MaxQuota {
		return errors.New("invalid image studio settlement")
	}
	// 缓存水合在事务外，避免单连接 SQLite 在锁任务后等待自身连接。
	if common.RedisEnabled {
		_, _ = GetUserCache(task.UserId)
	}
	var stored Task
	var delta, cacheReserved int
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).Where("id = ? AND user_id = ? AND platform = ?", task.ID, task.UserId, constant.TaskPlatformImageStudio).First(&stored).Error; err != nil {
			return err
		}
		if stored.Status != TaskStatusInProgress {
			return errors.New("image studio task is no longer running")
		}
		var refunded int64
		if err := tx.Model(&TaskBillingAdjustment{}).Where("task_id = ? AND kind = ? AND quota > 0", stored.TaskID, TaskBillingAdjustmentRefund).Count(&refunded).Error; err != nil {
			return err
		}
		if refunded > 0 {
			return errors.New("image studio task has already been refunded")
		}
		var settled TaskBillingAdjustment
		found := tx.Where("task_id = ? AND kind = ?", stored.TaskID, TaskBillingAdjustmentSettlement).Limit(1).Find(&settled)
		if found.Error != nil {
			return found.Error
		}
		if found.RowsAffected > 0 {
			if !final || settled.Quota != targetQuota {
				return errors.New("image studio task is already settled")
			}
			return nil
		}
		if stored.Quota < 0 || stored.Quota > common.MaxQuota {
			return errors.New("invalid persisted image studio quota")
		}
		delta = targetQuota - stored.Quota
		subscriptionID := 0
		if stored.PrivateData.BillingSource == "subscription" {
			subscriptionID = stored.PrivateData.SubscriptionId
			if subscriptionID <= 0 {
				return errors.New("image studio subscription is missing")
			}
		}
		if delta != 0 {
			if subscriptionID > 0 {
				var subscription UserSubscription
				if err := lockForUpdate(tx).Where("id = ? AND user_id = ?", subscriptionID, stored.UserId).First(&subscription).Error; err != nil {
					return err
				}
				if delta > 0 && (subscription.Status != "active" || subscription.EndTime <= common.GetTimestamp() || !IsSubscriptionGroupAllowed(subscription.AllowedTokenGroups, stored.Group)) {
					return errors.New("image studio subscription is no longer available")
				}
				if err := postConsumeUserSubscriptionDeltaTx(tx, subscriptionID, int64(delta)); err != nil {
					return err
				}
			} else {
				if delta > 0 {
					var subscriptions []UserSubscription
					if err := tx.Where("user_id = ? AND status = ? AND end_time > ? AND allow_wallet_overflow = ?", stored.UserId, "active", common.GetTimestamp(), false).Find(&subscriptions).Error; err != nil {
						return err
					}
					for _, subscription := range subscriptions {
						if IsSubscriptionGroupAllowed(subscription.AllowedTokenGroups, stored.Group) {
							return errors.New("wallet billing is disabled for this subscription group")
						}
					}
					if common.RedisEnabled {
						result, err := cacheTryReserveUserQuota(stored.UserId, int64(delta))
						if err != nil {
							return err
						}
						if result == cacheQuotaInsufficient {
							return ErrInsufficientUserQuota
						}
						if result == cacheQuotaMiss {
							return errors.New("image studio quota cache is unavailable")
						}
						if result == cacheQuotaOK {
							cacheReserved = delta
						}
					}
				}
				query := tx.Model(&User{}).Where("id = ?", stored.UserId)
				if delta > 0 {
					query = query.Where("quota >= ?", delta)
				}
				updated := query.Update("quota", gorm.Expr("quota - ?", delta))
				if updated.Error != nil {
					return updated.Error
				}
				if updated.RowsAffected != 1 {
					return ErrInsufficientUserQuota
				}
			}
		}
		if final {
			if err := tx.Create(&TaskBillingAdjustment{TaskID: stored.TaskID, Kind: TaskBillingAdjustmentSettlement, UserID: stored.UserId, SubscriptionID: subscriptionID, Quota: targetQuota, CreatedAt: common.GetTimestamp()}).Error; err != nil {
				return err
			}
		}
		stored.Quota = targetQuota
		stored.Properties = task.Properties
		stored.PrivateData.BillingContext = task.PrivateData.BillingContext
		stored.Data = append(stored.Data[:0:0], checkpoint...)
		stored.UpdatedAt = common.GetTimestamp()
		return tx.Model(&Task{}).Where("id = ? AND status = ?", stored.ID, TaskStatusInProgress).Updates(map[string]any{"quota": stored.Quota, "data": stored.Data, "properties": stored.Properties, "private_data": stored.PrivateData, "updated_at": stored.UpdatedAt}).Error
	})
	if err != nil {
		if cacheReserved > 0 {
			if _, cacheErr := cacheApplyUserQuotaDelta(task.UserId, int64(cacheReserved)); cacheErr != nil {
				common.SysError("failed to compensate studio settlement cache: " + cacheErr.Error())
			}
		}
		return err
	}
	if delta < 0 && stored.PrivateData.BillingSource != "subscription" {
		if err := cacheIncrUserQuota(stored.UserId, -int64(delta)); err != nil {
			common.SysError("failed to sync studio settlement refund cache: " + err.Error())
		}
	}
	*task = stored
	return nil
}
