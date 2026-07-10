package controller

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

type imageStudioTaskBody struct {
	Body        []byte
	ContentType string
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
		if key == "n" || key == "response_format" || key == "group" {
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
