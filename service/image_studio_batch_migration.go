package service

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
)

type legacyImageStudioBatchRequest struct {
	Model      string `json:"model"`
	Prompt     string `json:"prompt"`
	Size       string `json:"size"`
	Quality    string `json:"quality"`
	Mode       string `json:"mode"`
	Group      string `json:"group"`
	BatchID    string `json:"batch_id"`
	BatchIndex int    `json:"batch_index"`
	BatchSize  int    `json:"batch_size"`
}

type legacyImageStudioBatchPayload struct {
	Request legacyImageStudioBatchRequest `json:"request"`
}

// EnsureUserImageStudioBatches backfills historical Studio tasks into the
// first-class batch tables. It is intentionally metadata-only: existing image
// assets and task payloads are not copied or rewritten. Calling it repeatedly
// is safe and lets upgraded deployments immediately escape the old 30-task
// fallback without requiring an offline migration window.
func EnsureUserImageStudioBatches(userID int) error {
	if userID <= 0 {
		return nil
	}
	var afterID int64
	for {
		tasks, err := model.ListUserImageStudioTasksWithoutBatch(userID, afterID, 500)
		if err != nil {
			return err
		}
		if len(tasks) == 0 {
			return nil
		}
		for _, task := range tasks {
			if task == nil {
				continue
			}
			afterID = task.ID
			if err := ensureLegacyImageStudioTaskBatch(task); err != nil {
				return err
			}
		}
		if len(tasks) < 500 {
			return nil
		}
	}
}

func ensureLegacyImageStudioTaskBatch(task *model.Task) error {
	var payload legacyImageStudioBatchPayload
	if len(task.Data) > 0 {
		_ = common.Unmarshal(task.Data, &payload)
	}
	request := payload.Request
	batchID := strings.TrimSpace(request.BatchID)
	if batchID == "" {
		batchID = legacyImageStudioBatchID(task.UserId, task.TaskID)
	}
	batchIndex := request.BatchIndex
	if batchIndex <= 0 {
		batchIndex = 1
	}
	batchSize := request.BatchSize
	if batchSize <= 0 {
		batchSize = 1
	}
	mode := strings.TrimSpace(request.Mode)
	if mode == "" {
		if task.Action == constant.TaskActionImageEdit {
			mode = "edit"
		} else {
			mode = "generation"
		}
	}
	relayPath := strings.TrimSpace(task.PrivateData.StudioRelayPath)
	if relayPath == "" {
		if mode == "edit" {
			relayPath = "/v1/images/edits"
		} else {
			relayPath = "/v1/images/generations"
		}
	}
	priority := 10
	if batchSize <= constant.ImageStudioInteractiveBatchLimit {
		priority = 100
	}
	createdAt := task.CreatedAt
	if createdAt <= 0 {
		createdAt = task.SubmitTime
	}
	if createdAt <= 0 {
		createdAt = task.UpdatedAt
	}

	batch, exists, err := model.GetImageStudioBatch(task.UserId, batchID)
	if err != nil {
		return err
	}
	if !exists {
		batch = &model.ImageStudioBatch{
			BatchID:     batchID,
			UserID:      task.UserId,
			Mode:        mode,
			Group:       firstNonEmpty(request.Group, task.Group),
			Model:       firstNonEmpty(request.Model, task.Properties.OriginModelName),
			Prompt:      firstNonEmpty(request.Prompt, task.Properties.Input),
			Size:        request.Size,
			Quality:     request.Quality,
			TotalCount:  batchSize,
			Priority:    priority,
			Status:      model.ImageStudioBatchStatusQueued,
			BodyKey:     strings.TrimSpace(task.PrivateData.StudioBodyKey),
			ContentType: strings.TrimSpace(task.PrivateData.StudioContentType),
			RelayPath:   relayPath,
			CreatedAt:   createdAt,
		}
		if createErr := model.CreateImageStudioBatch(batch); createErr != nil {
			// Another request may have created the same batch concurrently.
			batch, exists, err = model.GetImageStudioBatch(task.UserId, batchID)
			if err != nil {
				return err
			}
			if !exists {
				return fmt.Errorf("create image studio legacy batch %s: %w", batchID, createErr)
			}
		}
	} else if batchSize > batch.TotalCount {
		if err := model.ExpandImageStudioBatchTotal(batch.ID, batchSize); err != nil {
			return err
		}
	}
	return model.EnsureImageStudioBatchItem(&model.ImageStudioBatchItem{
		BatchDBID:  batch.ID,
		TaskDBID:   task.ID,
		BatchIndex: batchIndex,
	})
}

func legacyImageStudioBatchID(userID int, taskID string) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%d:%s", userID, taskID)))
	return "legacy_" + hex.EncodeToString(sum[:12])
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}
