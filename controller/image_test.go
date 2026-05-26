package controller

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestBuildImageStudioJSONBodiesSplitsNToSingleImageRequests(t *testing.T) {
	body := []byte(`{"model":"gpt-image-2","prompt":"draw","n":3,"size":"1024x1024"}`)

	bodies, err := buildImageStudioTaskBodies(nil, "application/json", body, 3)
	if err != nil {
		t.Fatalf("build bodies failed: %v", err)
	}
	if len(bodies) != 3 {
		t.Fatalf("expected 3 bodies, got %d", len(bodies))
	}

	for _, item := range bodies {
		var payload map[string]any
		if err := common.Unmarshal(item.Body, &payload); err != nil {
			t.Fatalf("unmarshal split body failed: %v", err)
		}
		if payload["n"] != float64(1) {
			t.Fatalf("expected n=1, got %#v", payload["n"])
		}
		if payload["prompt"] != "draw" {
			t.Fatalf("prompt changed: %#v", payload["prompt"])
		}
	}
}

func TestBuildImageStudioFormBodiesSplitsNToSingleImageRequests(t *testing.T) {
	form := url.Values{}
	form.Set("model", "gpt-image-2")
	form.Set("prompt", "draw")
	form.Set("n", "4")

	bodies, err := buildImageStudioTaskBodies(nil, "application/x-www-form-urlencoded", []byte(form.Encode()), 4)
	if err != nil {
		t.Fatalf("build bodies failed: %v", err)
	}
	if len(bodies) != 4 {
		t.Fatalf("expected 4 bodies, got %d", len(bodies))
	}

	for _, item := range bodies {
		values, err := url.ParseQuery(string(item.Body))
		if err != nil {
			t.Fatalf("parse split body failed: %v", err)
		}
		if got := values.Get("n"); got != "1" {
			t.Fatalf("expected n=1, got %q", got)
		}
		if got := values.Get("prompt"); got != "draw" {
			t.Fatalf("prompt changed: %q", got)
		}
	}
}

func TestBuildImageStudioMultipartBodiesSplitsNAndKeepsFiles(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	_ = writer.WriteField("model", "gpt-image-2")
	_ = writer.WriteField("prompt", "draw")
	_ = writer.WriteField("n", "2")
	part, err := writer.CreateFormFile("image", "ref.png")
	if err != nil {
		t.Fatalf("create form file failed: %v", err)
	}
	if _, err := part.Write([]byte("image-bytes")); err != nil {
		t.Fatalf("write form file failed: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close writer failed: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/pg/image-studio/edits", bytes.NewReader(buf.Bytes()))
	req.Header.Set("Content-Type", writer.FormDataContentType())
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = req

	storage, err := common.CreateBodyStorage(buf.Bytes())
	if err != nil {
		t.Fatalf("create body storage failed: %v", err)
	}
	c.Set(common.KeyBodyStorage, storage)

	bodies, err := buildImageStudioTaskBodies(c, writer.FormDataContentType(), buf.Bytes(), 2)
	if err != nil {
		t.Fatalf("build bodies failed: %v", err)
	}
	if len(bodies) != 2 {
		t.Fatalf("expected 2 bodies, got %d", len(bodies))
	}

	for _, item := range bodies {
		if !strings.Contains(item.ContentType, "multipart/form-data") {
			t.Fatalf("expected multipart content type, got %q", item.ContentType)
		}
		req := httptest.NewRequest(http.MethodPost, "/split", bytes.NewReader(item.Body))
		req.Header.Set("Content-Type", item.ContentType)
		if err := req.ParseMultipartForm(32 << 20); err != nil {
			t.Fatalf("parse split multipart failed: %v", err)
		}
		if got := req.MultipartForm.Value["n"]; len(got) != 1 || got[0] != "1" {
			t.Fatalf("expected n=1, got %#v", got)
		}
		files := req.MultipartForm.File["image"]
		if len(files) != 1 {
			t.Fatalf("expected one image file, got %d", len(files))
		}
		file, err := files[0].Open()
		if err != nil {
			t.Fatalf("open split file failed: %v", err)
		}
		out := new(bytes.Buffer)
		if _, err := out.ReadFrom(file); err != nil {
			_ = file.Close()
			t.Fatalf("read split file failed: %v", err)
		}
		_ = file.Close()
		if out.String() != "image-bytes" {
			t.Fatalf("file content changed: %q", out.String())
		}
	}
}

func TestSanitizeImageStudioTaskDtoReplacesBase64WithStableURL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "https://example.test/api/task/self", nil)

	task := &model.Task{
		TaskID:   "task_img",
		UserId:   123,
		Platform: constant.TaskPlatformImageStudio,
	}
	task.SetData(imageStudioTaskPayload{
		Response: map[string]any{
			"data": []any{
				map[string]any{"b64_json": base64.StdEncoding.EncodeToString([]byte("image-one"))},
				map[string]any{"b64_json": base64.StdEncoding.EncodeToString([]byte("image-two"))},
			},
		},
	})
	taskDto := relayTaskDto(task)

	sanitizeImageStudioTaskDto(c, task, taskDto)

	var payload map[string]any
	if err := common.Unmarshal(taskDto.Data, &payload); err != nil {
		t.Fatalf("unmarshal sanitized data failed: %v", err)
	}
	images := payload["response"].(map[string]any)["data"].([]any)
	first := images[0].(map[string]any)
	second := images[1].(map[string]any)
	if _, ok := first["b64_json"]; ok {
		t.Fatal("expected first image b64_json to be removed")
	}
	if _, ok := second["b64_json"]; ok {
		t.Fatal("expected second image b64_json to be removed")
	}
	if got := first["url"].(string); !strings.Contains(got, "/api/task/image-studio/task_img/images/1/content") {
		t.Fatalf("unexpected first image url: %s", got)
	}
	if got := second["url"].(string); !strings.Contains(got, "/api/task/image-studio/task_img/images/2/content") {
		t.Fatalf("unexpected second image url: %s", got)
	}
	if first["url"] == second["url"] {
		t.Fatal("expected per-image URLs to be distinct")
	}
}

func TestFindImageStudioImageKeepsStoredBase64Available(t *testing.T) {
	task := &model.Task{}
	raw := base64.StdEncoding.EncodeToString([]byte("image"))
	task.SetData(imageStudioTaskPayload{
		Response: map[string]any{
			"data": []any{
				map[string]any{"b64_json": raw},
			},
		},
	})

	image, found := findImageStudioImage(task.Data, 1)
	if !found {
		t.Fatal("expected image to be found")
	}
	if got := image["b64_json"]; got != raw {
		t.Fatalf("expected stored base64 to remain available, got %#v", got)
	}
}

func TestVerifyImageStudioTaskImageURLRejectsExpiredSignature(t *testing.T) {
	gin.SetMode(gin.TestMode)
	expires := time.Now().Add(-time.Minute).Unix()
	query := url.Values{}
	query.Set("user_id", "123")
	query.Set("expires", strconv.FormatInt(expires, 10))
	query.Set("signature", imageStudioTaskImageSignature(123, "task_img", 1, expires))

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/content?"+query.Encode(), nil)

	if _, ok := verifyImageStudioTaskImageURL(c, "task_img", 1); ok {
		t.Fatal("expected expired signed URL to be rejected")
	}
}

func TestGetImageStudioTaskImageReturnsStoredBase64Content(t *testing.T) {
	db := setupImageStudioControllerTestDB(t)
	raw := base64.StdEncoding.EncodeToString([]byte("image-content"))
	task := &model.Task{
		TaskID:   "task_content",
		UserId:   123,
		Platform: constant.TaskPlatformImageStudio,
		Status:   model.TaskStatusSuccess,
	}
	task.SetData(imageStudioTaskPayload{
		Response: map[string]any{
			"data": []any{
				map[string]any{
					"b64_json":  raw,
					"mime_type": "image/png",
				},
			},
		},
	})
	if err := db.Create(task).Error; err != nil {
		t.Fatalf("failed to create task: %v", err)
	}

	expires := time.Now().Add(time.Hour).Unix()
	query := url.Values{}
	query.Set("user_id", "123")
	query.Set("expires", strconv.FormatInt(expires, 10))
	query.Set("signature", imageStudioTaskImageSignature(123, "task_content", 1, expires))

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/content?"+query.Encode(), nil)
	c.Params = gin.Params{
		{Key: "task_id", Value: "task_content"},
		{Key: "index", Value: "1"},
	}

	GetImageStudioTaskImage(c)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("Content-Type"); got != "image/png" {
		t.Fatalf("expected image/png, got %q", got)
	}
	if got := recorder.Body.String(); got != "image-content" {
		t.Fatalf("unexpected image content: %q", got)
	}
}

func TestDeleteUserImageStudioTasksDeletesOnlyOwnedImageStudioTasks(t *testing.T) {
	db := setupImageStudioControllerTestDB(t)
	tasks := []*model.Task{
		{TaskID: "task_owned", UserId: 123, Platform: constant.TaskPlatformImageStudio},
		{TaskID: "task_other_user", UserId: 456, Platform: constant.TaskPlatformImageStudio},
		{TaskID: "task_other_platform", UserId: 123, Platform: constant.TaskPlatformSuno},
	}
	for _, task := range tasks {
		if err := db.Create(task).Error; err != nil {
			t.Fatalf("failed to create task %s: %v", task.TaskID, err)
		}
	}

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	body := bytes.NewReader([]byte(`{"task_ids":["task_owned","task_other_user","task_other_platform"]}`))
	c.Request = httptest.NewRequest(http.MethodDelete, "/api/task/self/image-studio", body)
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("id", 123)

	DeleteUserImageStudioTasks(c)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if _, exists, err := model.GetByOnlyTaskId("task_owned"); err != nil || exists {
		t.Fatalf("expected owned image studio task to be deleted, exists=%v err=%v", exists, err)
	}
	if _, exists, err := model.GetByOnlyTaskId("task_other_user"); err != nil || !exists {
		t.Fatalf("expected other user task to remain, exists=%v err=%v", exists, err)
	}
	if _, exists, err := model.GetByOnlyTaskId("task_other_platform"); err != nil || !exists {
		t.Fatalf("expected other platform task to remain, exists=%v err=%v", exists, err)
	}
}

func TestUpdateExistingDoesNotReinsertDeletedTask(t *testing.T) {
	db := setupImageStudioControllerTestDB(t)
	task := &model.Task{
		TaskID:   "task_deleted",
		UserId:   123,
		Platform: constant.TaskPlatformImageStudio,
		Status:   model.TaskStatusQueued,
	}
	if err := db.Create(task).Error; err != nil {
		t.Fatalf("failed to create task: %v", err)
	}
	if err := db.Delete(task).Error; err != nil {
		t.Fatalf("failed to delete task: %v", err)
	}

	task.Status = model.TaskStatusSuccess
	rows, err := task.UpdateExisting()
	if err != nil {
		t.Fatalf("update existing failed: %v", err)
	}
	if rows != 0 {
		t.Fatalf("expected zero updated rows, got %d", rows)
	}
	if _, exists, err := model.GetByOnlyTaskId("task_deleted"); err != nil || exists {
		t.Fatalf("expected task to remain deleted, exists=%v err=%v", exists, err)
	}
}

func setupImageStudioControllerTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	gin.SetMode(gin.TestMode)
	common.UsingSQLite = true
	common.UsingMySQL = false
	common.UsingPostgreSQL = false
	common.RedisEnabled = false

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite db: %v", err)
	}
	model.DB = db
	model.LOG_DB = db

	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatalf("failed to migrate task table: %v", err)
	}

	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})

	return db
}

func relayTaskDto(task *model.Task) *dto.TaskDto {
	return &dto.TaskDto{
		TaskID:   task.TaskID,
		Platform: string(task.Platform),
		UserId:   task.UserId,
		Data:     task.Data,
	}
}
