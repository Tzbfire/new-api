package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/bytedance/gopkg/util/gopool"
)

const imageStudioLegacyMigrationBatchSize = 100

type legacyImageStudioAssetIdentity struct {
	taskID     string
	imageIndex int
}

var imageStudioLegacyMigrationOnce sync.Once

// StartImageStudioLegacyAssetMigration upgrades successful legacy task payloads
// in the background. Existing content URLs remain readable while this runs, so
// startup is never delayed by historical images.
func StartImageStudioLegacyAssetMigration() {
	imageStudioLegacyMigrationOnce.Do(func() {
		gopool.Go(func() {
			migrated, err := RunImageStudioLegacyAssetMigration(context.Background())
			if err != nil {
				logger.LogError(context.Background(), "migrate legacy image studio assets: "+err.Error())
				return
			}
			if migrated > 0 {
				common.SysLog(fmt.Sprintf("migrated %d legacy image studio assets", migrated))
			}
		})
	})
}

func RunImageStudioLegacyAssetMigration(ctx context.Context) (int, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	migrated := 0
	var afterID int64
	for {
		tasks, err := model.GetSuccessfulImageStudioTasks(afterID, imageStudioLegacyMigrationBatchSize)
		if err != nil {
			return migrated, err
		}
		if len(tasks) == 0 {
			return migrated, nil
		}
		taskIDs := make([]string, 0, len(tasks))
		for _, task := range tasks {
			taskIDs = append(taskIDs, task.TaskID)
		}
		assets, err := model.GetImageStudioAssetsByTaskIDs(taskIDs)
		if err != nil {
			return migrated, err
		}
		existing := make(map[legacyImageStudioAssetIdentity]struct{}, len(assets))
		for _, asset := range assets {
			existing[legacyImageStudioAssetIdentity{taskID: asset.TaskID, imageIndex: asset.ImageIndex}] = struct{}{}
		}
		for _, task := range tasks {
			afterID = task.ID
			count, err := migrateLegacyImageStudioTaskAssets(ctx, task, existing)
			if err != nil {
				logger.LogWarn(ctx, fmt.Sprintf("migrate legacy image studio task %s: %s", task.TaskID, err.Error()))
				continue
			}
			migrated += count
		}
		if len(tasks) < imageStudioLegacyMigrationBatchSize {
			return migrated, nil
		}
	}
}

func migrateLegacyImageStudioTaskAssets(ctx context.Context, task *model.Task, existing map[legacyImageStudioAssetIdentity]struct{}) (int, error) {
	if task == nil || len(task.Data) == 0 {
		return 0, nil
	}
	var payload any
	if err := common.Unmarshal(task.Data, &payload); err != nil {
		return 0, err
	}
	images := collectLegacyImageStudioImages(payload, nil)
	migrated := 0
	for index, image := range images {
		imageIndex := index + 1
		identity := legacyImageStudioAssetIdentity{taskID: task.TaskID, imageIndex: imageIndex}
		if _, exists := existing[identity]; exists {
			continue
		}

		storageKey, _ := image["storage_key"].(string)
		storageKey = strings.TrimSpace(storageKey)
		if storageKey != "" {
			if err := backfillStoredImageStudioAsset(task, imageIndex, storageKey); err != nil {
				return migrated, err
			}
			existing[identity] = struct{}{}
			migrated++
			continue
		}

		var staged *StagedImageStudioAsset
		if encoded := legacyImageStudioBase64(image); encoded != "" {
			data, err := decodeLegacyImageStudioBase64(encoded)
			if err != nil {
				return migrated, err
			}
			staged, err = StageImageStudioAsset(task.UserId, task.TaskID, imageIndex, bytes.NewReader(data))
			if err != nil {
				return migrated, err
			}
			for _, key := range legacyImageStudioBase64Keys {
				delete(image, key)
			}
		} else if upstreamURL, _ := image["url"].(string); strings.TrimSpace(upstreamURL) != "" {
			var err error
			staged, err = stageLegacyImageStudioURL(ctx, task, imageIndex, upstreamURL)
			if err != nil {
				return migrated, err
			}
			image["upstream_url"] = strings.TrimSpace(upstreamURL)
			delete(image, "url")
		} else {
			continue
		}
		if err := finalizeLegacyImageStudioAsset(task, payload, image, imageIndex, staged); err != nil {
			return migrated, err
		}
		existing[identity] = struct{}{}
		migrated++
	}
	return migrated, nil
}

func stageLegacyImageStudioURL(ctx context.Context, task *model.Task, imageIndex int, upstreamURL string) (*StagedImageStudioAsset, error) {
	requestContext, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(requestContext, http.MethodGet, strings.TrimSpace(upstreamURL), nil)
	if err != nil {
		return nil, err
	}
	client := GetSSRFProtectedHTTPClient()
	if client == nil {
		return nil, fmt.Errorf("image studio HTTP client is unavailable")
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("legacy image URL returned HTTP %d", response.StatusCode)
	}
	if response.ContentLength > ImageStudioMaxAssetBytes() {
		return nil, fmt.Errorf("legacy image URL exceeds maximum size")
	}
	return StageImageStudioAsset(task.UserId, task.TaskID, imageIndex, response.Body)
}

func finalizeLegacyImageStudioAsset(task *model.Task, payload any, image map[string]any, imageIndex int, staged *StagedImageStudioAsset) error {
	asset, err := staged.Publish()
	if err != nil {
		staged.Discard()
		return err
	}
	if staged.recordID <= 0 {
		return fmt.Errorf("published legacy image asset is missing")
	}
	image["storage_key"] = asset.StorageKey
	image["mime_type"] = asset.MimeType
	image["size_bytes"] = asset.SizeBytes
	image["sha256"] = asset.SHA256
	updatedData, err := common.Marshal(payload)
	if err != nil {
		return err
	}
	if err := model.FinalizeLegacyImageStudioAsset(task, staged.recordID, updatedData); err != nil {
		return err
	}
	task.Data = updatedData
	return nil
}

func backfillStoredImageStudioAsset(task *model.Task, imageIndex int, storageKey string) error {
	if err := ValidateImageStudioAssetOwnership(storageKey, task.UserId, task.TaskID); err != nil {
		return err
	}
	data, mimeType, err := ReadImageStudioAsset(storageKey)
	if err != nil {
		return err
	}
	hash := sha256.Sum256(data)
	return model.CreateReadyImageStudioAsset(&model.ImageStudioAsset{
		UserID:     task.UserId,
		TaskID:     task.TaskID,
		ImageIndex: imageIndex,
		StorageKey: storageKey,
		MimeType:   mimeType,
		SizeBytes:  int64(len(data)),
		SHA256:     hex.EncodeToString(hash[:]),
		ExpiresAt:  ImageStudioAssetExpiresAt(time.Now()),
	})
}

func collectLegacyImageStudioImages(value any, images []map[string]any) []map[string]any {
	switch typed := value.(type) {
	case map[string]any:
		if data, ok := typed["data"].([]any); ok {
			for _, child := range data {
				if image, ok := child.(map[string]any); ok && legacyImageStudioImage(image) {
					images = append(images, image)
				}
			}
		}
		for key, child := range typed {
			if key != "data" {
				images = collectLegacyImageStudioImages(child, images)
			}
		}
	case []any:
		for _, child := range typed {
			images = collectLegacyImageStudioImages(child, images)
		}
	}
	return images
}

func legacyImageStudioImage(image map[string]any) bool {
	storageKey, _ := image["storage_key"].(string)
	url, _ := image["url"].(string)
	return strings.TrimSpace(storageKey) != "" || legacyImageStudioBase64(image) != "" || strings.TrimSpace(url) != ""
}

var legacyImageStudioBase64Keys = []string{"b64_json", "b64", "base64", "b64_image", "image_base64"}

func legacyImageStudioBase64(image map[string]any) string {
	for _, key := range legacyImageStudioBase64Keys {
		value, _ := image[key].(string)
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func decodeLegacyImageStudioBase64(value string) ([]byte, error) {
	if strings.HasPrefix(value, "data:") {
		parts := strings.SplitN(value, ",", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("invalid legacy image data URL")
		}
		value = parts[1]
	}
	value = strings.NewReplacer("\r", "", "\n", "", "\t", "", " ", "").Replace(value)
	maxBytes := ImageStudioMaxAssetBytes()
	maxEncodedBytes := ((maxBytes + 2) / 3 * 4) + 8
	if maxBytes <= 0 || int64(len(value)) > maxEncodedBytes {
		return nil, fmt.Errorf("legacy image content exceeds maximum size")
	}
	for _, encoding := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		data, err := encoding.DecodeString(value)
		if err == nil {
			if int64(len(data)) > maxBytes {
				return nil, fmt.Errorf("legacy image content exceeds maximum size")
			}
			return data, nil
		}
	}
	return nil, fmt.Errorf("invalid legacy image base64")
}
