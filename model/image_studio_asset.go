package model

import (
	"errors"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/constant"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type ImageStudioAssetStatus string

const (
	ImageStudioAssetStatusPending    ImageStudioAssetStatus = "pending"
	ImageStudioAssetStatusReady      ImageStudioAssetStatus = "ready"
	ImageStudioAssetStatusDiscarding ImageStudioAssetStatus = "discarding"
	ImageStudioAssetStatusDeleting   ImageStudioAssetStatus = "deleting"
	ImageStudioAssetStatusExpired    ImageStudioAssetStatus = "expired"
)

// ImageStudioAsset is the durable ledger for locally stored Studio images.
// Image bytes live on the configured filesystem; this row makes every write,
// expiry, and deletion recoverable after a process restart.
type ImageStudioAsset struct {
	ID         int64                  `json:"id" gorm:"primaryKey"`
	UserID     int                    `json:"user_id" gorm:"index;not null"`
	TaskID     string                 `json:"task_id" gorm:"type:varchar(128);uniqueIndex:idx_image_studio_task_image;index;not null"`
	ImageIndex int                    `json:"image_index" gorm:"uniqueIndex:idx_image_studio_task_image;not null"`
	StorageKey string                 `json:"-" gorm:"type:varchar(512);not null"`
	MimeType   string                 `json:"mime_type" gorm:"type:varchar(64);not null"`
	SizeBytes  int64                  `json:"size_bytes" gorm:"not null"`
	SHA256     string                 `json:"sha256" gorm:"type:varchar(64);not null"`
	Status     ImageStudioAssetStatus `json:"status" gorm:"type:varchar(20);index;not null"`
	CreatedAt  int64                  `json:"created_at" gorm:"index;not null"`
	UpdatedAt  int64                  `json:"updated_at" gorm:"not null"`
	ExpiresAt  int64                  `json:"expires_at" gorm:"index;not null"`
}

func CreatePendingImageStudioAsset(asset *ImageStudioAsset) error {
	if asset == nil || asset.UserID <= 0 || strings.TrimSpace(asset.TaskID) == "" || asset.ImageIndex <= 0 {
		return errors.New("invalid image studio asset")
	}
	now := time.Now().Unix()
	asset.Status = ImageStudioAssetStatusPending
	asset.CreatedAt = now
	asset.UpdatedAt = now
	return DB.Create(asset).Error
}

func CreateReadyImageStudioAsset(asset *ImageStudioAsset) error {
	if asset == nil || asset.UserID <= 0 || strings.TrimSpace(asset.TaskID) == "" || asset.ImageIndex <= 0 || strings.TrimSpace(asset.StorageKey) == "" {
		return errors.New("invalid image studio asset")
	}
	now := time.Now().Unix()
	asset.Status = ImageStudioAssetStatusReady
	asset.CreatedAt = now
	asset.UpdatedAt = now
	return DB.Clauses(clause.OnConflict{DoNothing: true}).Create(asset).Error
}

func GetImageStudioAsset(userID int, taskID string, imageIndex int) (*ImageStudioAsset, bool, error) {
	if userID <= 0 || strings.TrimSpace(taskID) == "" || imageIndex <= 0 {
		return nil, false, nil
	}
	var asset ImageStudioAsset
	err := DB.Where("user_id = ? AND task_id = ? AND image_index = ?", userID, taskID, imageIndex).First(&asset).Error
	exists, err := RecordExist(err)
	if err != nil || !exists {
		return nil, exists, err
	}
	return &asset, true, nil
}

func GetImageStudioAssetByID(id int64) (*ImageStudioAsset, bool, error) {
	if id <= 0 {
		return nil, false, nil
	}
	var asset ImageStudioAsset
	err := DB.Where("id = ?", id).First(&asset).Error
	exists, err := RecordExist(err)
	if err != nil || !exists {
		return nil, exists, err
	}
	return &asset, true, nil
}

func GetImageStudioAssetsByTaskIDs(taskIDs []string) ([]*ImageStudioAsset, error) {
	if len(taskIDs) == 0 {
		return nil, nil
	}
	var assets []*ImageStudioAsset
	err := DB.Where("task_id IN ?", taskIDs).Order("task_id, image_index").Find(&assets).Error
	return assets, err
}

func GetImageStudioAssetsByStatus(status ImageStudioAssetStatus, limit int) ([]*ImageStudioAsset, error) {
	if limit <= 0 {
		limit = 100
	}
	var assets []*ImageStudioAsset
	query := DB.Where("status = ?", status)
	if status == ImageStudioAssetStatusExpired {
		query = query.Where("storage_key <> ?", "")
	}
	err := query.Order("id").Limit(limit).Find(&assets).Error
	return assets, err
}

func GetStalePendingImageStudioAssets(cutoff int64, limit int) ([]*ImageStudioAsset, error) {
	if limit <= 0 {
		limit = 100
	}
	var assets []*ImageStudioAsset
	err := DB.Where("status = ? AND updated_at <= ?", ImageStudioAssetStatusPending, cutoff).
		Order("id").Limit(limit).Find(&assets).Error
	return assets, err
}

func MarkExpiredImageStudioAssets(now int64, limit int) (int64, error) {
	if limit <= 0 {
		limit = 100
	}
	var ids []int64
	if err := DB.Model(&ImageStudioAsset{}).
		Where("status = ? AND expires_at > 0 AND expires_at <= ?", ImageStudioAssetStatusReady, now).
		Order("id").Limit(limit).Pluck("id", &ids).Error; err != nil || len(ids) == 0 {
		return 0, err
	}
	result := DB.Model(&ImageStudioAsset{}).Where("id IN ? AND status = ?", ids, ImageStudioAssetStatusReady).
		Updates(map[string]any{"status": ImageStudioAssetStatusExpired, "updated_at": now})
	return result.RowsAffected, result.Error
}

func ImageStudioStoredBytesExcluding(storageKey string) (int64, error) {
	var total int64
	err := DB.Model(&ImageStudioAsset{}).
		Where("storage_key <> ? AND storage_key <> ?", "", strings.TrimSpace(storageKey)).
		Select("COALESCE(SUM(size_bytes), 0)").
		Scan(&total).Error
	return total, err
}

func TransitionImageStudioTaskAssets(taskID string, from []ImageStudioAssetStatus, to ImageStudioAssetStatus) error {
	if strings.TrimSpace(taskID) == "" || len(from) == 0 {
		return nil
	}
	return DB.Model(&ImageStudioAsset{}).
		Where("task_id = ? AND status IN ?", strings.TrimSpace(taskID), from).
		Updates(map[string]any{"status": to, "updated_at": time.Now().Unix()}).Error
}

func DeleteImageStudioAssetRecord(id int64) error {
	return DB.Delete(&ImageStudioAsset{}, id).Error
}

func MarkExpiredImageStudioAssetFileRemoved(id int64) error {
	return DB.Model(&ImageStudioAsset{}).
		Where("id = ? AND status = ?", id, ImageStudioAssetStatusExpired).
		Updates(map[string]any{"storage_key": "", "updated_at": time.Now().Unix()}).Error
}

func FinalizeLegacyImageStudioAsset(task *Task, assetID int64, data []byte) error {
	if task == nil || task.ID <= 0 || assetID <= 0 || len(data) == 0 {
		return errors.New("invalid legacy image studio asset")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&ImageStudioAsset{}).
			Where("id = ? AND user_id = ? AND task_id = ? AND status = ?", assetID, task.UserId, task.TaskID, ImageStudioAssetStatusPending).
			Updates(map[string]any{"status": ImageStudioAssetStatusReady, "updated_at": time.Now().Unix()})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("legacy image studio asset is not pending")
		}
		result = tx.Model(&Task{}).
			Where("id = ? AND user_id = ? AND task_id = ? AND platform = ? AND status = ?", task.ID, task.UserId, task.TaskID, constant.TaskPlatformImageStudio, TaskStatusSuccess).
			Update("data", data)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("legacy image studio task is no longer available")
		}
		return nil
	})
}

func GetSuccessfulImageStudioTasks(afterID int64, limit int) ([]*Task, error) {
	if limit <= 0 {
		limit = 100
	}
	var tasks []*Task
	err := DB.Where("id > ? AND platform = ? AND status = ?", afterID, constant.TaskPlatformImageStudio, TaskStatusSuccess).
		Order("id").Limit(limit).Find(&tasks).Error
	return tasks, err
}

// FinalizeImageStudioTask atomically publishes the task and every local asset.
// Readers can therefore never observe SUCCESS while its asset is still pending.
func FinalizeImageStudioTask(task *Task) (bool, error) {
	if task == nil || task.ID <= 0 {
		return false, errors.New("invalid image studio task")
	}
	won := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(task).Where("status = ?", TaskStatusInProgress).Select("*").Updates(task)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		assets := tx.Model(&ImageStudioAsset{}).
			Where("task_id = ? AND user_id = ? AND status = ?", task.TaskID, task.UserId, ImageStudioAssetStatusPending).
			Updates(map[string]any{"status": ImageStudioAssetStatusReady, "updated_at": task.UpdatedAt})
		if assets.Error != nil {
			return assets.Error
		}
		if assets.RowsAffected != 1 {
			return errors.New("image studio task must publish exactly one asset")
		}
		won = true
		return nil
	})
	return won, err
}

func DeleteUserImageStudioTaskWithAssets(userID int, taskID string) (bool, error) {
	deleted := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Where(
			"user_id = ? AND task_id = ? AND platform = ? AND status IN ?",
			userID,
			strings.TrimSpace(taskID),
			constant.TaskPlatformImageStudio,
			[]TaskStatus{TaskStatusSuccess, TaskStatusFailure},
		).Delete(&Task{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		if err := tx.Where("user_id = ? AND task_id = ?", userID, strings.TrimSpace(taskID)).Delete(&ImageStudioAsset{}).Error; err != nil {
			return err
		}
		deleted = true
		return nil
	})
	return deleted, err
}
