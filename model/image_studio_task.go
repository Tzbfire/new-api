package model

import (
	"strings"
	"time"

	"github.com/QuantumNous/new-api/constant"
	"gorm.io/gorm"
)

// ClaimNextImageStudioTask atomically moves one durable QUEUED studio job to
// IN_PROGRESS. Empty queues use Find (not First) so idle polls stay quiet.
func ClaimNextImageStudioTask() (*Task, error) {
	var claimed *Task
	err := DB.Transaction(func(tx *gorm.DB) error {
		var tasks []Task
		if err := lockForUpdate(tx).
			Where("platform = ? AND status = ?", constant.TaskPlatformImageStudio, TaskStatusQueued).
			Order("submit_time, id").
			Limit(1).
			Find(&tasks).Error; err != nil {
			return err
		}
		if len(tasks) == 0 {
			return nil
		}
		task := tasks[0]
		now := time.Now().Unix()
		result := tx.Model(&Task{}).
			Where("id = ? AND status = ?", task.ID, TaskStatusQueued).
			Updates(map[string]any{
				"status":     TaskStatusInProgress,
				"progress":   "10%",
				"start_time": now,
				"updated_at": now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		task.Status = TaskStatusInProgress
		task.Progress = "10%"
		task.StartTime = now
		task.UpdatedAt = now
		claimed = &task
		return nil
	})
	return claimed, err
}

// ListInProgressImageStudioTasks returns active studio jobs for orphan reclaim.
func ListInProgressImageStudioTasks(limit int) ([]*Task, error) {
	if limit <= 0 {
		limit = 100
	}
	var tasks []*Task
	err := DB.Where("platform = ? AND status = ?", constant.TaskPlatformImageStudio, TaskStatusInProgress).
		Order("start_time, id").
		Limit(limit).
		Find(&tasks).Error
	return tasks, err
}

// RequeueImageStudioTask moves an IN_PROGRESS studio job back to QUEUED so a
// live worker can claim it after process restart.
func RequeueImageStudioTask(taskID string) (bool, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return false, nil
	}
	now := time.Now().Unix()
	result := DB.Model(&Task{}).
		Where("task_id = ? AND platform = ? AND status = ?", taskID, constant.TaskPlatformImageStudio, TaskStatusInProgress).
		Updates(map[string]any{
			"status":      TaskStatusQueued,
			"progress":    "0%",
			"start_time":  0,
			"updated_at":  now,
			"fail_reason": "",
		})
	return result.RowsAffected > 0, result.Error
}
