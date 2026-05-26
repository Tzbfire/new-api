package controller

import (
	"crypto/hmac"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

const imageStudioContentURLTTL = 24 * time.Hour

func sanitizeImageStudioTaskDto(c *gin.Context, task *model.Task, taskDto *dto.TaskDto) {
	if c == nil || task == nil || taskDto == nil || task.Platform != imageStudioTaskPlatform || len(taskDto.Data) == 0 {
		return
	}

	var payload any
	if err := common.Unmarshal(taskDto.Data, &payload); err != nil {
		return
	}

	imageIndex := 1
	if !sanitizeImageStudioTaskPayload(c, task, payload, &imageIndex) {
		return
	}

	data, err := common.Marshal(payload)
	if err != nil {
		return
	}
	taskDto.Data = json.RawMessage(data)
}

func sanitizeImageStudioTaskPayload(c *gin.Context, task *model.Task, value any, imageIndex *int) bool {
	switch typed := value.(type) {
	case map[string]any:
		changed := false
		if isImageStudioImageMap(typed) {
			if _, ok := typed["b64_json"]; ok {
				delete(typed, "b64_json")
				if strings.TrimSpace(asString(typed["url"])) == "" {
					typed["url"] = imageStudioTaskImageURL(c, task, *imageIndex)
				}
				changed = true
			}
			*imageIndex = *imageIndex + 1
		}
		for _, child := range typed {
			if sanitizeImageStudioTaskPayload(c, task, child, imageIndex) {
				changed = true
			}
		}
		return changed
	case []any:
		changed := false
		for _, child := range typed {
			if sanitizeImageStudioTaskPayload(c, task, child, imageIndex) {
				changed = true
			}
		}
		return changed
	default:
		return false
	}
}

func GetImageStudioTaskImage(c *gin.Context) {
	taskID := strings.TrimSpace(c.Param("task_id"))
	if taskID == "" {
		imageStudioContentError(c, http.StatusBadRequest, "task_id is required")
		return
	}

	index, err := strconv.Atoi(c.Param("index"))
	if err != nil || index <= 0 {
		imageStudioContentError(c, http.StatusBadRequest, "invalid image index")
		return
	}

	userID, ok := verifyImageStudioTaskImageURL(c, taskID, index)
	if !ok {
		imageStudioContentError(c, http.StatusUnauthorized, "invalid or expired image url")
		return
	}

	task, exists, err := model.GetByTaskId(userID, taskID)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("image studio query task %s failed: %s", taskID, err.Error()))
		imageStudioContentError(c, http.StatusInternalServerError, "failed to query task")
		return
	}
	if !exists || task == nil || task.Platform != imageStudioTaskPlatform {
		imageStudioContentError(c, http.StatusNotFound, "task not found")
		return
	}
	if task.Status != model.TaskStatusSuccess {
		imageStudioContentError(c, http.StatusBadRequest, "task is not completed")
		return
	}

	image, found := findImageStudioImage(task.Data, index)
	if !found {
		imageStudioContentError(c, http.StatusNotFound, "image not found")
		return
	}

	b64 := strings.TrimSpace(asString(image["b64_json"]))
	if b64 == "" {
		imageStudioContentError(c, http.StatusNotFound, "image content not found")
		return
	}

	mimeType, rawB64 := normalizeImageStudioBase64(b64, imageStudioImageMimeType(image))
	imageBytes, err := decodeImageStudioBase64(rawB64)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("image studio decode task %s image %d failed: %s", taskID, index, err.Error()))
		imageStudioContentError(c, http.StatusBadGateway, "failed to decode image")
		return
	}
	if mimeType == "" {
		mimeType = http.DetectContentType(imageBytes)
		if !strings.HasPrefix(mimeType, "image/") {
			mimeType = "image/png"
		}
	}

	c.Header("Cache-Control", "private, max-age=86400")
	c.Data(http.StatusOK, mimeType, imageBytes)
}

func imageStudioTaskImageURL(c *gin.Context, task *model.Task, index int) string {
	expires := time.Now().Add(imageStudioContentURLTTL).Truncate(time.Hour).Unix()
	query := url.Values{}
	query.Set("user_id", strconv.Itoa(task.UserId))
	query.Set("expires", strconv.FormatInt(expires, 10))
	query.Set("signature", imageStudioTaskImageSignature(task.UserId, task.TaskID, index, expires))

	path := fmt.Sprintf("/api/task/image-studio/%s/images/%d/content", url.PathEscape(task.TaskID), index)
	return imageStudioRequestBaseURL(c) + path + "?" + query.Encode()
}

func imageStudioTaskImageSignature(userID int, taskID string, index int, expires int64) string {
	return common.GenerateHMAC(fmt.Sprintf("image_studio_image:%d:%s:%d:%d", userID, taskID, index, expires))
}

func verifyImageStudioTaskImageURL(c *gin.Context, taskID string, index int) (int, bool) {
	userID, err := strconv.Atoi(c.Query("user_id"))
	if err != nil || userID <= 0 {
		return 0, false
	}
	expires, err := strconv.ParseInt(c.Query("expires"), 10, 64)
	if err != nil || expires < time.Now().Unix() {
		return 0, false
	}
	signature := strings.TrimSpace(c.Query("signature"))
	expected := imageStudioTaskImageSignature(userID, taskID, index, expires)
	if signature == "" || !hmac.Equal([]byte(signature), []byte(expected)) {
		return 0, false
	}
	return userID, true
}

func imageStudioRequestBaseURL(c *gin.Context) string {
	scheme := "http"
	if c.Request != nil && c.Request.TLS != nil {
		scheme = "https"
	}
	if proto := strings.TrimSpace(c.GetHeader("X-Forwarded-Proto")); proto != "" {
		scheme = strings.ToLower(strings.Split(proto, ",")[0])
	}
	host := ""
	if c.Request != nil {
		host = c.Request.Host
	}
	if forwardedHost := strings.TrimSpace(c.GetHeader("X-Forwarded-Host")); forwardedHost != "" {
		host = strings.Split(forwardedHost, ",")[0]
	}
	return fmt.Sprintf("%s://%s", scheme, host)
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
		if isImageStudioImageMap(typed) {
			images = append(images, typed)
			return images
		}
		for _, child := range typed {
			images = collectImageStudioImages(child, images)
		}
	case []any:
		for _, child := range typed {
			images = collectImageStudioImages(child, images)
		}
	}
	return images
}

func isImageStudioImageMap(value map[string]any) bool {
	if strings.TrimSpace(asString(value["b64_json"])) != "" {
		return true
	}
	if strings.TrimSpace(asString(value["url"])) != "" {
		return true
	}
	return false
}

func imageStudioImageMimeType(image map[string]any) string {
	for _, key := range []string{"mime_type", "mimeType", "content_type", "contentType"} {
		if value := strings.TrimSpace(asString(image[key])); value != "" {
			return value
		}
	}
	return "image/png"
}

func normalizeImageStudioBase64(value string, mimeType string) (string, string) {
	if !strings.HasPrefix(value, "data:") {
		return mimeType, stripBase64Whitespace(value)
	}
	parts := strings.SplitN(value, ",", 2)
	if len(parts) != 2 {
		return mimeType, stripBase64Whitespace(value)
	}
	header := strings.TrimPrefix(parts[0], "data:")
	if semi := strings.Index(header, ";"); semi >= 0 {
		header = header[:semi]
	}
	if strings.HasPrefix(header, "image/") {
		mimeType = header
	}
	return mimeType, stripBase64Whitespace(parts[1])
}

func stripBase64Whitespace(value string) string {
	replacer := strings.NewReplacer("\r", "", "\n", "", "\t", "", " ", "")
	return replacer.Replace(value)
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

func imageStudioContentError(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{
		"error": gin.H{
			"message": message,
			"type":    "invalid_request_error",
		},
	})
}

func asString(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}
