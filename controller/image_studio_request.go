package controller

import (
	"bytes"
	"fmt"
	"io"
	"mime/multipart"
	"net/url"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/constant"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

type imageStudioTaskBody struct {
	Body        []byte
	ContentType string
}

// imageStudioRequestedCount reads Studio's product-level count independently
// from the upstream image API's n field. New clients send count; legacy clients
// may still send n. Missing count defaults to 1, while an explicit zero is
// rejected instead of silently becoming one.
func imageStudioRequestedCount(c *gin.Context, contentType string, body []byte, legacyN *uint) (uint, error) {
	var raw string
	switch {
	case strings.Contains(contentType, gin.MIMEMultipartPOSTForm):
		if c != nil && c.Request != nil {
			raw = strings.TrimSpace(c.Request.PostForm.Get("count"))
		}
	case strings.Contains(contentType, gin.MIMEPOSTForm):
		values, err := url.ParseQuery(string(body))
		if err != nil {
			return 0, err
		}
		raw = strings.TrimSpace(values.Get("count"))
	default:
		var payload map[string]any
		if len(body) > 0 && common.Unmarshal(body, &payload) == nil {
			if value, exists := payload["count"]; exists {
				switch typed := value.(type) {
				case float64:
					if typed != float64(int64(typed)) {
						return 0, fmt.Errorf("count must be an integer")
					}
					raw = strconv.FormatInt(int64(typed), 10)
				case string:
					raw = strings.TrimSpace(typed)
				default:
					return 0, fmt.Errorf("count must be an integer")
				}
			}
		}
	}
	if raw == "" {
		if legacyN != nil {
			if *legacyN == 0 {
				return 0, fmt.Errorf("count must be between 1 and %d", constant.ImageStudioMaxBatchSize)
			}
			if *legacyN > 0 {
				return *legacyN, nil
			}
		}
		return 1, nil
	}
	count, err := strconv.ParseUint(raw, 10, 32)
	if err != nil || count < 1 || count > constant.ImageStudioMaxBatchSize {
		return 0, fmt.Errorf("count must be between 1 and %d", constant.ImageStudioMaxBatchSize)
	}
	return uint(count), nil
}

func buildImageStudioTaskBodies(c *gin.Context, contentType string, body []byte, count int) ([]imageStudioTaskBody, error) {
	switch {
	case strings.Contains(contentType, gin.MIMEMultipartPOSTForm):
		return buildImageStudioMultipartBodies(c, count)
	case strings.Contains(contentType, gin.MIMEPOSTForm):
		return buildImageStudioFormBodies(body, contentType, count)
	default:
		return buildImageStudioJSONBodies(body, contentType, count)
	}
}

func buildImageStudioJSONBodies(body []byte, contentType string, count int) ([]imageStudioTaskBody, error) {
	var payload map[string]any
	if err := common.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	payload["n"] = 1
	payload["response_format"] = "b64_json"
	delete(payload, "group")
	delete(payload, "count")
	nextBody, err := common.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return duplicateImageStudioBodies(nextBody, contentType, count), nil
}

func buildImageStudioFormBodies(body []byte, contentType string, count int) ([]imageStudioTaskBody, error) {
	values, err := url.ParseQuery(string(body))
	if err != nil {
		return nil, err
	}
	values.Set("n", "1")
	values.Set("response_format", "b64_json")
	values.Del("group")
	values.Del("count")
	return duplicateImageStudioBodies([]byte(values.Encode()), contentType, count), nil
}

func duplicateImageStudioBodies(body []byte, contentType string, count int) []imageStudioTaskBody {
	bodies := make([]imageStudioTaskBody, 0, count)
	for index := 0; index < count; index++ {
		bodies = append(bodies, imageStudioTaskBody{Body: body, ContentType: contentType})
	}
	return bodies
}

func buildImageStudioMultipartBodies(c *gin.Context, count int) ([]imageStudioTaskBody, error) {
	form, err := common.ParseMultipartFormReusable(c)
	if err != nil {
		return nil, err
	}
	defer form.RemoveAll()
	body, contentType, err := buildImageStudioMultipartBody(form)
	if err != nil {
		return nil, err
	}
	return duplicateImageStudioBodies(body, contentType, count), nil
}

func buildImageStudioMultipartBody(form *multipart.Form) ([]byte, string, error) {
	var buffer bytes.Buffer
	writer := multipart.NewWriter(&buffer)
	for key, values := range form.Value {
		if key == "n" || key == "response_format" || key == "group" || key == "count" {
			continue
		}
		for _, value := range values {
			if err := writer.WriteField(key, value); err != nil {
				_ = writer.Close()
				return nil, "", err
			}
		}
	}
	if err := writer.WriteField("n", "1"); err != nil {
		_ = writer.Close()
		return nil, "", err
	}
	if err := writer.WriteField("response_format", "b64_json"); err != nil {
		_ = writer.Close()
		return nil, "", err
	}
	for key, files := range form.File {
		for _, fileHeader := range files {
			file, err := fileHeader.Open()
			if err != nil {
				_ = writer.Close()
				return nil, "", err
			}
			part, err := writer.CreateFormFile(key, fileHeader.Filename)
			if err == nil {
				_, err = io.Copy(part, file)
			}
			_ = file.Close()
			if err != nil {
				_ = writer.Close()
				return nil, "", err
			}
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}
	return buffer.Bytes(), writer.FormDataContentType(), nil
}
