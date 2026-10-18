package model

import (
	"errors"
	"strings"
	"time"

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
func ApplyTaskRefundTarget(taskID string, userID int, subscriptionID int, targetQuota int) (int, error) {
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
		_ = InvalidateUserCache(userID)
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
