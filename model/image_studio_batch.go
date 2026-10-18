package model

import (
	"errors"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/constant"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type ImageStudioBatchStatus string

const (
	ImageStudioBatchStatusSubmitting     ImageStudioBatchStatus = "submitting"
	ImageStudioBatchStatusQueued         ImageStudioBatchStatus = "queued"
	ImageStudioBatchStatusRunning        ImageStudioBatchStatus = "running"
	ImageStudioBatchStatusCompleted      ImageStudioBatchStatus = "completed"
	ImageStudioBatchStatusPartialFailure ImageStudioBatchStatus = "partial_failure"
	ImageStudioBatchStatusFailed         ImageStudioBatchStatus = "failed"
)

// ImageStudioBatch is the user-visible durable unit for one Studio submission.
// One batch owns many one-image Task rows. The request body is stored once and
// shared read-only by all child tasks so large edit batches do not duplicate
// multipart reference images hundreds of times.
type ImageStudioBatch struct {
	ID          int64                  `json:"-" gorm:"primaryKey"`
	BatchID     string                 `json:"batch_id" gorm:"type:varchar(128);uniqueIndex;not null"`
	UserID      int                    `json:"-" gorm:"index;not null"`
	Mode        string                 `json:"mode" gorm:"type:varchar(20);not null"`
	Group       string                 `json:"group" gorm:"type:varchar(50);not null"`
	Model       string                 `json:"model" gorm:"type:varchar(191);not null"`
	Prompt      string                 `json:"prompt" gorm:"type:text"`
	Size        string                 `json:"size" gorm:"type:varchar(64)"`
	Quality     string                 `json:"quality" gorm:"type:varchar(64)"`
	TotalCount  int                    `json:"total_count" gorm:"not null"`
	Priority    int                    `json:"-" gorm:"index;not null"`
	Status      ImageStudioBatchStatus `json:"status" gorm:"type:varchar(24);index;not null"`
	BodyKey     string                 `json:"-" gorm:"type:varchar(512);not null"`
	ContentType string                 `json:"-" gorm:"type:varchar(255)"`
	RelayPath   string                 `json:"-" gorm:"type:varchar(255);not null"`
	CreatedAt   int64                  `json:"created_at" gorm:"index;not null"`
	UpdatedAt   int64                  `json:"updated_at" gorm:"not null"`
}

// ImageStudioBatchItem gives batch membership a relational identity instead of
// hiding it only inside Task.Data JSON. TaskDBID is unique: one generated image
// can belong to exactly one Studio batch.
type ImageStudioBatchItem struct {
	ID         int64 `json:"-" gorm:"primaryKey"`
	BatchDBID  int64 `json:"-" gorm:"uniqueIndex:idx_image_studio_batch_index,priority:1;index;not null"`
	TaskDBID   int64 `json:"-" gorm:"uniqueIndex;index;not null"`
	BatchIndex int   `json:"batch_index" gorm:"uniqueIndex:idx_image_studio_batch_index,priority:2;not null"`
}

type ImageStudioLibrarySummary struct {
	TotalCount    int `json:"total_count"`
	QueuedCount   int `json:"queued_count"`
	ActiveCount   int `json:"active_count"`
	SuccessCount  int `json:"success_count"`
	FailureCount  int `json:"failure_count"`
	FinishedCount int `json:"finished_count"`
}

type ImageStudioBatchSummary struct {
	BatchID       string                 `json:"batch_id"`
	Mode          string                 `json:"mode"`
	Group         string                 `json:"group"`
	Model         string                 `json:"model"`
	Prompt        string                 `json:"prompt"`
	Size          string                 `json:"size"`
	Quality       string                 `json:"quality"`
	TotalCount    int                    `json:"total_count"`
	QueuedCount   int                    `json:"queued_count"`
	ActiveCount   int                    `json:"active_count"`
	SuccessCount  int                    `json:"success_count"`
	FailureCount  int                    `json:"failure_count"`
	DeletedCount  int                    `json:"deleted_count"`
	FinishedCount int                    `json:"finished_count"`
	Progress      int                    `json:"progress"`
	Status        ImageStudioBatchStatus `json:"status"`
	CreatedAt     int64                  `json:"created_at"`
	UpdatedAt     int64                  `json:"updated_at"`
}

func CreateImageStudioBatch(batch *ImageStudioBatch) error {
	if batch == nil || batch.UserID <= 0 || strings.TrimSpace(batch.BatchID) == "" || batch.TotalCount <= 0 {
		return errors.New("invalid image studio batch")
	}
	now := time.Now().Unix()
	if batch.CreatedAt == 0 {
		batch.CreatedAt = now
	}
	batch.UpdatedAt = now
	if batch.Status == "" {
		batch.Status = ImageStudioBatchStatusQueued
	}
	return DB.Create(batch).Error
}

func transitionImageStudioBatchStatus(batchDBID int64, from, to ImageStudioBatchStatus) error {
	if batchDBID <= 0 {
		return errors.New("invalid image studio batch id")
	}
	result := DB.Model(&ImageStudioBatch{}).
		Where("id = ? AND status = ?", batchDBID, from).
		Updates(map[string]any{
			"status":     to,
			"updated_at": time.Now().Unix(),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("image studio batch status transition lost")
	}
	return nil
}

func ActivateImageStudioBatch(batchDBID int64) error {
	return transitionImageStudioBatchStatus(batchDBID, ImageStudioBatchStatusSubmitting, ImageStudioBatchStatusQueued)
}

func FailSubmittingImageStudioBatch(batchDBID int64) error {
	return transitionImageStudioBatchStatus(batchDBID, ImageStudioBatchStatusSubmitting, ImageStudioBatchStatusFailed)
}

func ListStaleSubmittingImageStudioBatches(cutoff int64, limit int) ([]*ImageStudioBatch, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	var batches []*ImageStudioBatch
	err := DB.Where("status = ? AND created_at < ?", ImageStudioBatchStatusSubmitting, cutoff).
		Order("created_at, id").
		Limit(limit).
		Find(&batches).Error
	return batches, err
}

func CreateImageStudioBatchItem(item *ImageStudioBatchItem) error {
	if item == nil || item.BatchDBID <= 0 || item.TaskDBID <= 0 || item.BatchIndex <= 0 {
		return errors.New("invalid image studio batch item")
	}
	return DB.Create(item).Error
}

func EnsureImageStudioBatchItem(item *ImageStudioBatchItem) error {
	if item == nil || item.BatchDBID <= 0 || item.TaskDBID <= 0 || item.BatchIndex <= 0 {
		return errors.New("invalid image studio batch item")
	}
	return DB.Clauses(clause.OnConflict{DoNothing: true}).Create(item).Error
}

func ListUserImageStudioTasksWithoutBatch(userID int, afterID int64, limit int) ([]*Task, error) {
	if userID <= 0 {
		return nil, nil
	}
	if limit <= 0 || limit > 1000 {
		limit = 500
	}
	var tasks []*Task
	err := DB.Table("tasks").Select("tasks.*").
		Joins("LEFT JOIN image_studio_batch_items AS items ON items.task_db_id = tasks.id").
		Where("tasks.user_id = ? AND tasks.platform = ? AND tasks.id > ? AND items.id IS NULL", userID, constant.TaskPlatformImageStudio, afterID).
		Order("tasks.id ASC").Limit(limit).Find(&tasks).Error
	return tasks, err
}

func ExpandImageStudioBatchTotal(batchID int64, totalCount int) error {
	if batchID <= 0 || totalCount <= 0 {
		return nil
	}
	return DB.Model(&ImageStudioBatch{}).
		Where("id = ? AND total_count < ?", batchID, totalCount).
		Updates(map[string]any{"total_count": totalCount, "updated_at": time.Now().Unix()}).Error
}

func GetImageStudioBatch(userID int, batchID string) (*ImageStudioBatch, bool, error) {
	if userID <= 0 || strings.TrimSpace(batchID) == "" {
		return nil, false, nil
	}
	var batch ImageStudioBatch
	err := DB.Where("user_id = ? AND batch_id = ?", userID, strings.TrimSpace(batchID)).First(&batch).Error
	exists, err := RecordExist(err)
	if err != nil || !exists {
		return nil, exists, err
	}
	return &batch, true, nil
}

func GetImageStudioBatchByID(id int64) (*ImageStudioBatch, bool, error) {
	if id <= 0 {
		return nil, false, nil
	}
	var batch ImageStudioBatch
	err := DB.Where("id = ?", id).First(&batch).Error
	exists, err := RecordExist(err)
	if err != nil || !exists {
		return nil, exists, err
	}
	return &batch, true, nil
}

func GetUserImageStudioLibrarySummary(userID int) (*ImageStudioLibrarySummary, error) {
	summary := &ImageStudioLibrarySummary{}
	if userID <= 0 {
		return summary, nil
	}
	type statusCount struct {
		Status TaskStatus
		Count  int
	}
	var counts []statusCount
	if err := DB.Model(&Task{}).
		Select("status, COUNT(*) AS count").
		Where("user_id = ? AND platform = ?", userID, constant.TaskPlatformImageStudio).
		Group("status").Scan(&counts).Error; err != nil {
		return nil, err
	}
	for _, item := range counts {
		summary.TotalCount += item.Count
		switch item.Status {
		case TaskStatusQueued, TaskStatusNotStart, TaskStatusSubmitted:
			summary.QueuedCount += item.Count
		case TaskStatusInProgress:
			summary.ActiveCount += item.Count
		case TaskStatusSuccess:
			summary.SuccessCount += item.Count
		case TaskStatusFailure:
			summary.FailureCount += item.Count
		default:
			summary.ActiveCount += item.Count
		}
	}
	summary.FinishedCount = summary.SuccessCount + summary.FailureCount
	return summary, nil
}

func applyImageStudioTaskFilter(query *gorm.DB, filter string) *gorm.DB {
	switch strings.TrimSpace(filter) {
	case "active":
		return query.Where("status NOT IN ?", []TaskStatus{TaskStatusSuccess, TaskStatusFailure})
	case "completed":
		return query.Where("status = ?", TaskStatusSuccess)
	case "failed":
		return query.Where("status = ?", TaskStatusFailure)
	default:
		return query
	}
}

func ListUserImageStudioLibraryTasks(userID int, filter string, offset, limit int) ([]*Task, int64, error) {
	if userID <= 0 {
		return nil, 0, nil
	}
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 || limit > 100 {
		limit = 60
	}
	base := DB.Model(&Task{}).Where("user_id = ? AND platform = ?", userID, constant.TaskPlatformImageStudio)
	base = applyImageStudioTaskFilter(base, filter)
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var tasks []*Task
	query := DB.Where("user_id = ? AND platform = ?", userID, constant.TaskPlatformImageStudio)
	query = applyImageStudioTaskFilter(query, filter)
	if err := query.Omit("channel_id").Order("id DESC").Limit(limit).Offset(offset).Find(&tasks).Error; err != nil {
		return nil, 0, err
	}
	return tasks, total, nil
}

func ListUserImageStudioTasksByStatusBeforeID(userID int, status TaskStatus, beforeID int64, limit int) ([]*Task, error) {
	if userID <= 0 {
		return nil, nil
	}
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	query := DB.Where("user_id = ? AND platform = ? AND status = ?", userID, constant.TaskPlatformImageStudio, status)
	if beforeID > 0 {
		query = query.Where("id < ?", beforeID)
	}
	var tasks []*Task
	err := query.Order("id DESC").Limit(limit).Find(&tasks).Error
	return tasks, err
}

func ListAllUserImageStudioBatches(userID int) ([]*ImageStudioBatch, error) {
	if userID <= 0 {
		return nil, nil
	}
	var batches []*ImageStudioBatch
	err := DB.Where("user_id = ?", userID).Order("id ASC").Find(&batches).Error
	return batches, err
}

func ListEmptyImageStudioBatchesByIDs(userID int, batchIDs []int64) ([]*ImageStudioBatch, error) {
	if userID <= 0 || len(batchIDs) == 0 {
		return nil, nil
	}
	var batches []*ImageStudioBatch
	err := DB.Table("image_studio_batches AS batches").
		Select("batches.*").
		Joins("LEFT JOIN image_studio_batch_items AS items ON items.batch_db_id = batches.id").
		Where("batches.user_id = ? AND batches.id IN ?", userID, batchIDs).
		Group("batches.id").
		Having("COUNT(items.id) = 0").
		Order("batches.id ASC").
		Find(&batches).Error
	return batches, err
}

func ListImageStudioBatchIDsForTasks(taskDBIDs []int64) ([]int64, error) {
	if len(taskDBIDs) == 0 {
		return nil, nil
	}
	var batchIDs []int64
	err := DB.Model(&ImageStudioBatchItem{}).
		Where("task_db_id IN ?", taskDBIDs).
		Distinct("batch_db_id").
		Pluck("batch_db_id", &batchIDs).Error
	return batchIDs, err
}

func ListUserImageStudioBatches(userID, offset, limit int) ([]*ImageStudioBatchSummary, int64, error) {
	if userID <= 0 {
		return nil, 0, nil
	}
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	var total int64
	if err := DB.Model(&ImageStudioBatch{}).Where("user_id = ?", userID).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var batches []*ImageStudioBatch
	if err := DB.Where("user_id = ?", userID).Order("id DESC").Limit(limit).Offset(offset).Find(&batches).Error; err != nil {
		return nil, 0, err
	}
	summaries := make([]*ImageStudioBatchSummary, 0, len(batches))
	for _, batch := range batches {
		summary, err := imageStudioBatchSummary(batch)
		if err != nil {
			return nil, 0, err
		}
		summaries = append(summaries, summary)
	}
	return summaries, total, nil
}

func GetImageStudioBatchSummary(userID int, batchID string) (*ImageStudioBatchSummary, bool, error) {
	batch, exists, err := GetImageStudioBatch(userID, batchID)
	if err != nil || !exists {
		return nil, exists, err
	}
	summary, err := imageStudioBatchSummary(batch)
	return summary, err == nil, err
}

func imageStudioBatchSummary(batch *ImageStudioBatch) (*ImageStudioBatchSummary, error) {
	if batch == nil || batch.ID <= 0 {
		return nil, errors.New("invalid image studio batch")
	}
	type statusCount struct {
		Status TaskStatus
		Count  int
	}
	var counts []statusCount
	if err := DB.Table("image_studio_batch_items AS items").
		Select("tasks.status AS status, COUNT(*) AS count").
		Joins("JOIN tasks ON tasks.id = items.task_db_id").
		Where("items.batch_db_id = ?", batch.ID).
		Group("tasks.status").
		Scan(&counts).Error; err != nil {
		return nil, err
	}
	summary := &ImageStudioBatchSummary{
		BatchID: batch.BatchID, Mode: batch.Mode, Group: batch.Group, Model: batch.Model,
		Prompt: batch.Prompt, Size: batch.Size, Quality: batch.Quality, TotalCount: batch.TotalCount,
		Status: batch.Status, CreatedAt: batch.CreatedAt, UpdatedAt: batch.UpdatedAt,
	}
	for _, item := range counts {
		switch item.Status {
		case TaskStatusQueued, TaskStatusNotStart, TaskStatusSubmitted:
			summary.QueuedCount += item.Count
		case TaskStatusInProgress:
			summary.ActiveCount += item.Count
		case TaskStatusSuccess:
			summary.SuccessCount += item.Count
		case TaskStatusFailure:
			summary.FailureCount += item.Count
		default:
			summary.ActiveCount += item.Count
		}
	}
	joinedCount := summary.QueuedCount + summary.ActiveCount + summary.SuccessCount + summary.FailureCount
	if batch.Status != ImageStudioBatchStatusSubmitting && joinedCount < summary.TotalCount {
		// User cleanup removes terminal child rows but the batch keeps its original
		// requested size. Track those rows separately so clearing failed tasks makes
		// failure_count drop to zero without making durable progress regress. During
		// submit, missing children are not deletions: they simply are not inserted yet.
		summary.DeletedCount = summary.TotalCount - joinedCount
	}
	summary.FinishedCount = summary.SuccessCount + summary.FailureCount + summary.DeletedCount
	if summary.TotalCount > 0 {
		summary.Progress = summary.FinishedCount * 100 / summary.TotalCount
		if summary.Progress > 100 {
			summary.Progress = 100
		}
	}
	if batch.Status == ImageStudioBatchStatusSubmitting {
		summary.Status = ImageStudioBatchStatusQueued
		return summary, nil
	}
	summary.Status = deriveImageStudioBatchStatus(summary)
	if summary.DeletedCount > 0 && (batch.Status == ImageStudioBatchStatusCompleted || batch.Status == ImageStudioBatchStatusFailed || batch.Status == ImageStudioBatchStatusPartialFailure) {
		// Cleanup should not rewrite a terminal batch's historical generation
		// outcome. Deleted rows may have been either successes or failures.
		summary.Status = batch.Status
	}
	return summary, nil
}

func deriveImageStudioBatchStatus(summary *ImageStudioBatchSummary) ImageStudioBatchStatus {
	if summary == nil {
		return ImageStudioBatchStatusQueued
	}
	if summary.FinishedCount >= summary.TotalCount && summary.TotalCount > 0 {
		switch {
		case summary.SuccessCount == summary.TotalCount:
			return ImageStudioBatchStatusCompleted
		case summary.FailureCount == summary.TotalCount:
			return ImageStudioBatchStatusFailed
		default:
			return ImageStudioBatchStatusPartialFailure
		}
	}
	if summary.ActiveCount > 0 || summary.FinishedCount > 0 {
		return ImageStudioBatchStatusRunning
	}
	return ImageStudioBatchStatusQueued
}

func RefreshImageStudioBatch(batchDBID int64) (*ImageStudioBatchSummary, error) {
	batch, exists, err := GetImageStudioBatchByID(batchDBID)
	if err != nil || !exists {
		return nil, err
	}
	summary, err := imageStudioBatchSummary(batch)
	if err != nil {
		return nil, err
	}
	if batch.Status == ImageStudioBatchStatusSubmitting {
		// Public summaries intentionally expose an in-flight submit as queued, but
		// only ActivateImageStudioBatch may open the worker claim gate.
		return summary, nil
	}
	if summary.Status != batch.Status {
		now := time.Now().Unix()
		if err := DB.Model(&ImageStudioBatch{}).Where("id = ?", batch.ID).
			Updates(map[string]any{"status": summary.Status, "updated_at": now}).Error; err != nil {
			return nil, err
		}
		summary.UpdatedAt = now
	}
	return summary, nil
}

func GetImageStudioBatchForTask(taskDBID int64) (*ImageStudioBatch, bool, error) {
	if taskDBID <= 0 {
		return nil, false, nil
	}
	var batch ImageStudioBatch
	err := DB.Table("image_studio_batches AS batches").
		Select("batches.*").
		Joins("JOIN image_studio_batch_items AS items ON items.batch_db_id = batches.id").
		Where("items.task_db_id = ?", taskDBID).
		First(&batch).Error
	exists, err := RecordExist(err)
	if err != nil || !exists {
		return nil, exists, err
	}
	return &batch, true, nil
}

func ListImageStudioBatchTasks(userID int, batchID, filter string, offset, limit int) ([]*Task, int64, error) {
	batch, exists, err := GetImageStudioBatch(userID, batchID)
	if err != nil || !exists {
		return nil, 0, err
	}
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 || limit > 100 {
		limit = 60
	}
	var total int64
	base := DB.Table("tasks").
		Joins("JOIN image_studio_batch_items AS items ON items.task_db_id = tasks.id").
		Where("items.batch_db_id = ?", batch.ID)
	base = applyImageStudioTaskFilter(base, filter)
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var tasks []*Task
	query := DB.Table("tasks").
		Select("tasks.*").
		Joins("JOIN image_studio_batch_items AS items ON items.task_db_id = tasks.id").
		Where("items.batch_db_id = ?", batch.ID)
	query = applyImageStudioTaskFilter(query, filter)
	if err := query.Order("items.batch_index ASC").Limit(limit).Offset(offset).Find(&tasks).Error; err != nil {
		return nil, 0, err
	}
	return tasks, total, nil
}

func ListImageStudioBatchTasksAll(userID int, batchID string) ([]*Task, error) {
	batch, exists, err := GetImageStudioBatch(userID, batchID)
	if err != nil || !exists {
		return nil, err
	}
	var tasks []*Task
	err = DB.Table("tasks").Select("tasks.*").
		Joins("JOIN image_studio_batch_items AS items ON items.task_db_id = tasks.id").
		Where("items.batch_db_id = ?", batch.ID).
		Order("items.batch_index ASC").Find(&tasks).Error
	return tasks, err
}

func ListImageStudioBatchTasksByStatus(userID int, batchID string, status TaskStatus, limit int) ([]*Task, error) {
	batch, exists, err := GetImageStudioBatch(userID, batchID)
	if err != nil || !exists {
		return nil, err
	}
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	var tasks []*Task
	err = DB.Table("tasks").Select("tasks.*").
		Joins("JOIN image_studio_batch_items AS items ON items.task_db_id = tasks.id").
		Where("items.batch_db_id = ? AND tasks.status = ?", batch.ID, status).
		Order("items.batch_index ASC").Limit(limit).Find(&tasks).Error
	return tasks, err
}

func ImageStudioBatchBodyKeyInUse(bodyKey string) (bool, error) {
	bodyKey = strings.TrimSpace(bodyKey)
	if bodyKey == "" {
		return false, nil
	}
	var count int64
	err := DB.Table("image_studio_batches AS batches").
		Joins("LEFT JOIN image_studio_batch_items AS items ON items.batch_db_id = batches.id").
		Joins("LEFT JOIN tasks ON tasks.id = items.task_db_id").
		Where("batches.body_key = ?", bodyKey).
		Where("batches.status = ? OR tasks.status NOT IN ?", ImageStudioBatchStatusSubmitting, []TaskStatus{TaskStatusSuccess, TaskStatusFailure}).
		Distinct("batches.id").
		Count(&count).Error
	return count > 0, err
}

func DeleteImageStudioBatch(batchDBID int64) error {
	if batchDBID <= 0 {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("batch_db_id = ?", batchDBID).Delete(&ImageStudioBatchItem{}).Error; err != nil {
			return err
		}
		return tx.Delete(&ImageStudioBatch{}, batchDBID).Error
	})
}
