package controller

import (
	"archive/zip"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// The default Studio page loads at most 30 tasks. Keeping the archive boundary
// aligned with that page makes "Download all" truthful without unbounded file
// descriptor usage while the ZIP sources are validated before streaming.
const maxImageStudioBatchDownloadTasks = 30

func sanitizeImageStudioTaskDtoWithAssets(task *model.Task, taskDto *dto.TaskDto, assets []*model.ImageStudioAsset) {
	if task == nil || taskDto == nil || task.Platform != imageStudioTaskPlatform || len(taskDto.Data) == 0 {
		return
	}
	assetsByIndex := make(map[int]*model.ImageStudioAsset, len(assets))
	for _, asset := range assets {
		if asset != nil && asset.TaskID == task.TaskID {
			assetsByIndex[asset.ImageIndex] = asset
		}
	}
	var payload any
	if err := common.Unmarshal(taskDto.Data, &payload); err != nil {
		return
	}
	imageIndex := 1
	if !sanitizeImageStudioTaskPayload(task, payload, &imageIndex, assetsByIndex) {
		return
	}
	data, err := common.Marshal(payload)
	if err == nil {
		taskDto.Data = json.RawMessage(data)
	}
}

func sanitizeImageStudioTaskPayload(task *model.Task, value any, imageIndex *int, assets map[int]*model.ImageStudioAsset) bool {
	switch typed := value.(type) {
	case map[string]any:
		changed := false
		if data, ok := typed["data"].([]any); ok {
			for _, child := range data {
				image, ok := child.(map[string]any)
				if !ok || !isImageStudioImageMap(image) {
					continue
				}
				asset := assets[*imageIndex]
				assetStatus := model.ImageStudioAssetStatus("")
				if asset != nil {
					assetStatus = asset.Status
					image["asset_status"] = string(asset.Status)
					image["mime_type"] = asset.MimeType
					image["size_bytes"] = asset.SizeBytes
					image["sha256"] = asset.SHA256
					changed = true
				}
				now := time.Now()
				if assetStatus == model.ImageStudioAssetStatusReady && asset.ExpiresAt > 0 && asset.ExpiresAt <= now.Unix() {
					assetStatus = model.ImageStudioAssetStatusExpired
					image["asset_status"] = string(assetStatus)
				}
				hasLegacyContent := strings.TrimSpace(imageStudioString(image["storage_key"])) != "" || imageStudioBase64Value(image) != ""
				if assetStatus == model.ImageStudioAssetStatusReady {
					image["url"], image["download_url"] = service.ImageStudioAssetURL(asset.ID, now)
					changed = true
				} else if asset == nil && hasLegacyContent {
					contentURL := fmt.Sprintf("/api/task/image-studio/%s/images/%d/content", task.TaskID, *imageIndex)
					image["url"] = contentURL
					image["download_url"] = contentURL + "?download=1"
					changed = true
				} else if asset != nil {
					delete(image, "url")
					delete(image, "download_url")
				}
				for _, key := range imageStudioBase64Keys {
					if _, exists := image[key]; exists {
						delete(image, key)
						changed = true
					}
				}
				if _, exists := image["upstream_url"]; exists {
					delete(image, "upstream_url")
					changed = true
				}
				if _, exists := image["storage_key"]; exists {
					delete(image, "storage_key")
					changed = true
				}
				*imageIndex = *imageIndex + 1
			}
		}
		for key, child := range typed {
			if key != "data" && sanitizeImageStudioTaskPayload(task, child, imageIndex, assets) {
				changed = true
			}
		}
		return changed
	case []any:
		changed := false
		for _, child := range typed {
			if sanitizeImageStudioTaskPayload(task, child, imageIndex, assets) {
				changed = true
			}
		}
		return changed
	default:
		return false
	}
}

func GetImageStudioTaskImage(c *gin.Context) {
	index, err := strconv.Atoi(c.Param("index"))
	if err != nil || index <= 0 {
		imageStudioContentError(c, http.StatusBadRequest, "invalid image index")
		return
	}
	task, exists, err := model.GetByTaskId(c.GetInt("id"), strings.TrimSpace(c.Param("task_id")))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !exists || task == nil || task.Platform != imageStudioTaskPlatform {
		imageStudioContentError(c, http.StatusNotFound, "task not found")
		return
	}
	if task.Status != model.TaskStatusSuccess {
		imageStudioContentError(c, http.StatusConflict, "task is not completed")
		return
	}
	asset, assetExists, err := model.GetImageStudioAsset(task.UserId, task.TaskID, index)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if assetExists {
		switch asset.Status {
		case model.ImageStudioAssetStatusExpired, model.ImageStudioAssetStatusDeleting, model.ImageStudioAssetStatusDiscarding:
			imageStudioContentError(c, http.StatusGone, "image asset is no longer available")
			return
		case model.ImageStudioAssetStatusPending:
			imageStudioContentError(c, http.StatusConflict, "image asset is still being published")
			return
		case model.ImageStudioAssetStatusReady:
		default:
			imageStudioContentError(c, http.StatusNotFound, "image content not found")
			return
		}
		if err := service.ValidateImageStudioAssetOwnership(asset.StorageKey, task.UserId, task.TaskID); err != nil {
			logger.LogWarn(c.Request.Context(), fmt.Sprintf("reject image studio asset task=%s index=%d: %s", task.TaskID, index, err.Error()))
			imageStudioContentError(c, http.StatusNotFound, "image content not found")
			return
		}
		file, info, openErr := service.OpenImageStudioAsset(asset.StorageKey, asset.SizeBytes)
		if openErr != nil {
			logger.LogWarn(c.Request.Context(), fmt.Sprintf("read image studio asset task=%s index=%d: %s", task.TaskID, index, openErr.Error()))
			imageStudioContentError(c, http.StatusNotFound, "image content not found")
			return
		}
		defer file.Close()
		etag := `"` + asset.SHA256 + `"`
		c.Header("ETag", etag)
		c.Header("Cache-Control", "private, max-age=31536000, immutable")
		c.Header("Content-Security-Policy", "default-src 'none'")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Content-Type", asset.MimeType)
		if c.Query("download") == "1" {
			c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="image-%s-%d%s"`, task.TaskID, index, imageStudioMimeExtension(asset.MimeType)))
		}
		if c.GetHeader("If-None-Match") == etag {
			c.Status(http.StatusNotModified)
			return
		}
		http.ServeContent(c.Writer, c.Request, "", info.ModTime(), file)
		return
	}

	image, found := findImageStudioImage(task.Data, index)
	if !found {
		imageStudioContentError(c, http.StatusNotFound, "image not found")
		return
	}
	storageKey := strings.TrimSpace(imageStudioString(image["storage_key"]))
	var data []byte
	var mimeType string
	if storageKey != "" {
		if err := service.ValidateImageStudioAssetOwnership(storageKey, task.UserId, task.TaskID); err != nil {
			imageStudioContentError(c, http.StatusNotFound, "image content not found")
			return
		}
		data, mimeType, err = service.ReadImageStudioAsset(storageKey)
	} else {
		data, mimeType, err = decodeLegacyImageStudioContent(image)
	}
	if err != nil {
		logger.LogWarn(c.Request.Context(), fmt.Sprintf("read legacy image studio asset task=%s index=%d: %s", task.TaskID, index, err.Error()))
		imageStudioContentError(c, http.StatusNotFound, "image content not found")
		return
	}
	c.Header("Cache-Control", "private, max-age=3600")
	c.Header("Content-Security-Policy", "default-src 'none'")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, mimeType, data)
}

// DownloadImageStudioTaskImages streams a ZIP directly from local image files.
// It intentionally pre-opens and validates every asset before sending headers,
// so an unavailable image never produces a truncated archive response.
func DownloadImageStudioTaskImages(c *gin.Context) {
	rawTaskIDs := strings.Split(c.Query("task_ids"), ",")
	taskIDs := make([]string, 0, len(rawTaskIDs))
	seen := make(map[string]struct{}, len(rawTaskIDs))
	for _, taskID := range rawTaskIDs {
		taskID = strings.TrimSpace(taskID)
		if taskID == "" {
			continue
		}
		if _, exists := seen[taskID]; exists {
			continue
		}
		seen[taskID] = struct{}{}
		taskIDs = append(taskIDs, taskID)
	}
	if len(taskIDs) == 0 || len(taskIDs) > maxImageStudioBatchDownloadTasks {
		imageStudioContentError(c, http.StatusBadRequest, "task_ids must contain between 1 and 30 tasks")
		return
	}

	queryIDs := make([]any, 0, len(taskIDs))
	for _, taskID := range taskIDs {
		queryIDs = append(queryIDs, taskID)
	}
	tasks, err := model.GetByTaskIds(c.GetInt("id"), queryIDs)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(tasks) != len(taskIDs) {
		imageStudioContentError(c, http.StatusNotFound, "one or more tasks were not found")
		return
	}
	tasksByID := make(map[string]*model.Task, len(tasks))
	for _, task := range tasks {
		if task == nil || task.Platform != imageStudioTaskPlatform || task.Status != model.TaskStatusSuccess {
			imageStudioContentError(c, http.StatusConflict, "all tasks must be completed image studio tasks")
			return
		}
		tasksByID[task.TaskID] = task
	}

	assets, err := model.GetImageStudioAssetsByTaskIDs(taskIDs)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	assetsByTask := make(map[string]*model.ImageStudioAsset, len(assets))
	for _, asset := range assets {
		if asset != nil && asset.ImageIndex == 1 {
			assetsByTask[asset.TaskID] = asset
		}
	}
	type zipSource struct {
		file     io.ReadSeekCloser
		fileInfo interface {
			ModTime() time.Time
		}
		name string
	}
	sources := make([]zipSource, 0, len(taskIDs))
	defer func() {
		for _, source := range sources {
			_ = source.file.Close()
		}
	}()
	for index, taskID := range taskIDs {
		task := tasksByID[taskID]
		asset := assetsByTask[taskID]
		if task == nil || asset == nil || asset.Status != model.ImageStudioAssetStatusReady {
			imageStudioContentError(c, http.StatusGone, "one or more images are no longer available")
			return
		}
		if err := service.ValidateImageStudioAssetOwnership(asset.StorageKey, task.UserId, task.TaskID); err != nil {
			imageStudioContentError(c, http.StatusNotFound, "image content not found")
			return
		}
		file, info, err := service.OpenImageStudioAsset(asset.StorageKey, asset.SizeBytes)
		if err != nil {
			logger.LogWarn(c.Request.Context(), fmt.Sprintf("batch download image studio asset task=%s: %s", task.TaskID, err.Error()))
			imageStudioContentError(c, http.StatusNotFound, "image content not found")
			return
		}
		sources = append(sources, zipSource{
			file:     file,
			fileInfo: info,
			name:     fmt.Sprintf("image-%02d%s", index+1, imageStudioMimeExtension(asset.MimeType)),
		})
	}

	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", `attachment; filename="ai-studio-images.zip"`)
	c.Header("Cache-Control", "private, no-store")
	c.Header("Content-Security-Policy", "default-src 'none'")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Status(http.StatusOK)
	archive := zip.NewWriter(c.Writer)
	for _, source := range sources {
		header := &zip.FileHeader{Name: source.name, Method: zip.Store}
		header.SetModTime(source.fileInfo.ModTime())
		entry, err := archive.CreateHeader(header)
		if err != nil {
			logger.LogError(c.Request.Context(), "create image studio ZIP entry: "+err.Error())
			_ = archive.Close()
			return
		}
		if _, err := io.Copy(entry, source.file); err != nil {
			logger.LogError(c.Request.Context(), "stream image studio ZIP entry: "+err.Error())
			_ = archive.Close()
			return
		}
	}
	if err := archive.Close(); err != nil {
		logger.LogError(c.Request.Context(), "finalize image studio ZIP: "+err.Error())
	}
}

func findImageStudioImage(data json.RawMessage, index int) (map[string]any, bool) {
	if index <= 0 || len(data) == 0 {
		return nil, false
	}
	var payload any
	if err := common.Unmarshal(data, &payload); err != nil {
		return nil, false
	}
	images := collectImageStudioImages(payload, nil)
	if index > len(images) {
		return nil, false
	}
	return images[index-1], true
}

func collectImageStudioImages(value any, images []map[string]any) []map[string]any {
	switch typed := value.(type) {
	case map[string]any:
		if data, ok := typed["data"].([]any); ok {
			for _, child := range data {
				if image, ok := child.(map[string]any); ok && isImageStudioImageMap(image) {
					images = append(images, image)
				}
			}
		}
		for key, child := range typed {
			if key != "data" {
				images = collectImageStudioImages(child, images)
			}
		}
	case []any:
		for _, child := range typed {
			images = collectImageStudioImages(child, images)
		}
	}
	return images
}

func isImageStudioImageMap(value map[string]any) bool {
	return strings.TrimSpace(imageStudioString(value["storage_key"])) != "" ||
		imageStudioBase64Value(value) != "" ||
		strings.TrimSpace(imageStudioString(value["url"])) != ""
}

var imageStudioBase64Keys = []string{"b64_json", "b64", "base64", "b64_image", "image_base64"}

func imageStudioBase64Value(image map[string]any) string {
	for _, key := range imageStudioBase64Keys {
		if value := strings.TrimSpace(imageStudioString(image[key])); value != "" {
			return value
		}
	}
	return ""
}

func imageStudioMimeExtension(mimeType string) string {
	switch mimeType {
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	default:
		return ".png"
	}
}

func imageStudioString(value any) string {
	text, _ := value.(string)
	return text
}

func imageStudioImageMimeType(image map[string]any) string {
	for _, key := range []string{"mime_type", "mimeType", "content_type", "contentType"} {
		if value := strings.TrimSpace(imageStudioString(image[key])); value != "" {
			return value
		}
	}
	return "image/png"
}

func normalizeImageStudioBase64(value string, mimeType string) (string, string) {
	if !strings.HasPrefix(value, "data:") {
		return mimeType, stripImageStudioBase64Whitespace(value)
	}
	parts := strings.SplitN(value, ",", 2)
	if len(parts) != 2 {
		return mimeType, stripImageStudioBase64Whitespace(value)
	}
	header := strings.TrimPrefix(parts[0], "data:")
	if semi := strings.Index(header, ";"); semi >= 0 {
		header = header[:semi]
	}
	if strings.HasPrefix(header, "image/") {
		mimeType = header
	}
	return mimeType, stripImageStudioBase64Whitespace(parts[1])
}

func stripImageStudioBase64Whitespace(value string) string {
	return strings.NewReplacer("\r", "", "\n", "", "\t", "", " ", "").Replace(value)
}

func decodeImageStudioBase64(value string) ([]byte, error) {
	if data, err := base64.StdEncoding.DecodeString(value); err == nil {
		return data, nil
	}
	if data, err := base64.RawStdEncoding.DecodeString(value); err == nil {
		return data, nil
	}
	if data, err := base64.URLEncoding.DecodeString(value); err == nil {
		return data, nil
	}
	return base64.RawURLEncoding.DecodeString(value)
}

func decodeLegacyImageStudioContent(image map[string]any) ([]byte, string, error) {
	encoded := strings.TrimSpace(imageStudioString(image["b64_json"]))
	if encoded == "" {
		return nil, "", fmt.Errorf("legacy image content is empty")
	}
	_, encoded = normalizeImageStudioBase64(encoded, imageStudioImageMimeType(image))
	maxBytes := service.ImageStudioMaxAssetBytes()
	maxEncodedBytes := ((maxBytes + 2) / 3 * 4) + 8
	if maxBytes <= 0 || int64(len(encoded)) > maxEncodedBytes {
		return nil, "", fmt.Errorf("legacy image content exceeds maximum size")
	}
	data, err := decodeImageStudioBase64(encoded)
	if err != nil {
		return nil, "", err
	}
	if int64(len(data)) > maxBytes {
		return nil, "", fmt.Errorf("legacy image content exceeds maximum size")
	}
	mimeType := strings.ToLower(strings.TrimSpace(strings.Split(http.DetectContentType(data), ";")[0]))
	switch mimeType {
	case "image/png", "image/jpeg", "image/webp", "image/gif", "image/avif":
		return data, mimeType, nil
	default:
		return nil, "", fmt.Errorf("unsupported legacy image content type: %s", mimeType)
	}
}

func imageStudioContentError(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{"error": gin.H{"message": message, "type": "invalid_request_error"}})
}

func cleanupImageStudioTaskAssets(ctx context.Context, task *model.Task) {
	if task == nil || len(task.Data) == 0 {
		return
	}
	var payload any
	if err := common.Unmarshal(task.Data, &payload); err != nil {
		return
	}
	cleanupImageStudioPayloadAssets(ctx, task, payload)
}

func cleanupImageStudioPayloadAssets(ctx context.Context, task *model.Task, payload any) {
	if task == nil {
		return
	}
	service.DiscardImageStudioTaskAssets(ctx, task.UserId, task.TaskID, collectImageStudioStorageKeys(payload, nil))
}

func collectImageStudioStorageKeys(value any, keys []string) []string {
	switch typed := value.(type) {
	case map[string]any:
		if storageKey := strings.TrimSpace(imageStudioString(typed["storage_key"])); storageKey != "" {
			keys = append(keys, storageKey)
		}
		for _, child := range typed {
			keys = collectImageStudioStorageKeys(child, keys)
		}
	case []any:
		for _, child := range typed {
			keys = collectImageStudioStorageKeys(child, keys)
		}
	}
	return keys
}
