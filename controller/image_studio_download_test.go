package controller

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setImageStudioDownloadAllForTest(t *testing.T, enabled bool) {
	t.Helper()
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	previous, existed := common.OptionMap["ImageStudioDownloadAllEnabled"]
	common.OptionMap["ImageStudioDownloadAllEnabled"] = fmt.Sprintf("%t", enabled)
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		if existed {
			common.OptionMap["ImageStudioDownloadAllEnabled"] = previous
		} else {
			delete(common.OptionMap, "ImageStudioDownloadAllEnabled")
		}
		common.OptionMapRWMutex.Unlock()
	})
}

func createDownloadableImageStudioTask(t *testing.T, userID int, taskID string, pixel color.RGBA) []byte {
	t.Helper()
	canvas := image.NewRGBA(image.Rect(0, 0, 2, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 2; x++ {
			canvas.SetRGBA(x, y, pixel)
		}
	}
	var data bytes.Buffer
	require.NoError(t, png.Encode(&data, canvas))
	task := &model.Task{
		TaskID:   taskID,
		UserId:   userID,
		Platform: constant.TaskPlatformImageStudio,
		Status:   model.TaskStatusSuccess,
	}
	require.NoError(t, model.DB.Create(task).Error)
	publishReadyImageStudioTestAsset(t, userID, taskID, data.Bytes())
	return data.Bytes()
}

func TestDownloadImageStudioTaskImagesStreamsOwnedBatchAsZip(t *testing.T) {
	setupImageStudioAssetDB(t)
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", t.TempDir())
	first := createDownloadableImageStudioTask(t, 17, "zip-task-1", color.RGBA{R: 255, A: 255})
	second := createDownloadableImageStudioTask(t, 17, "zip-task-2", color.RGBA{B: 255, A: 255})

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/task/image-studio/download?task_ids=zip-task-1,zip-task-2", nil)
	context.Set("id", 17)
	DownloadImageStudioTaskImages(context)

	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "application/zip", recorder.Header().Get("Content-Type"))
	assert.Equal(t, "no", recorder.Header().Get("X-Accel-Buffering"))
	reader, err := zip.NewReader(bytes.NewReader(recorder.Body.Bytes()), int64(recorder.Body.Len()))
	require.NoError(t, err)
	require.Len(t, reader.File, 2)
	for index, expected := range [][]byte{first, second} {
		file, err := reader.File[index].Open()
		require.NoError(t, err)
		actual, err := io.ReadAll(file)
		require.NoError(t, err)
		require.NoError(t, file.Close())
		assert.Equal(t, expected, actual)
	}
}

func TestDownloadImageStudioDownloadAllEndpointsAreDisabledByDefault(t *testing.T) {
	setImageStudioDownloadAllForTest(t, false)

	for _, test := range []struct {
		name string
		run  func(*gin.Context)
		url  string
	}{
		{name: "library", run: DownloadImageStudioLibrary, url: "/api/image-studio/library/download"},
		{name: "batch", run: DownloadImageStudioBatch, url: "/api/image-studio/batches/batch-disabled/download"},
	} {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			context.Request = httptest.NewRequest(http.MethodGet, test.url, nil)
			context.Set("id", 1)
			test.run(context)
			assert.Equal(t, http.StatusForbidden, recorder.Code)
		})
	}
}

func TestDownloadImageStudioBatchStreamsMoreThanOnePageLimit(t *testing.T) {
	setupImageStudioAssetDB(t)
	setImageStudioDownloadAllForTest(t, true)
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", t.TempDir())
	batch := &model.ImageStudioBatch{
		BatchID: "batch-large-download", UserID: 21, Mode: "generation", Group: "default",
		Model: "gpt-image-1", Prompt: "bulk", TotalCount: maxImageStudioPageDownloadTasks + 1,
		Priority: 10, Status: model.ImageStudioBatchStatusCompleted,
		BodyKey: ".jobs/batch-large-download", RelayPath: "/v1/images/generations",
	}
	require.NoError(t, model.CreateImageStudioBatch(batch))
	for index := 0; index < batch.TotalCount; index++ {
		taskID := fmt.Sprintf("batch-large-task-%02d", index+1)
		createDownloadableImageStudioTask(t, batch.UserID, taskID, color.RGBA{R: uint8(index), A: 255})
		task, exists, err := model.GetByTaskId(batch.UserID, taskID)
		require.NoError(t, err)
		require.True(t, exists)
		require.NoError(t, model.CreateImageStudioBatchItem(&model.ImageStudioBatchItem{
			BatchDBID: batch.ID, TaskDBID: task.ID, BatchIndex: index + 1,
		}))
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/image-studio/batches/batch-large-download/download", nil)
	context.Params = gin.Params{{Key: "batch_id", Value: batch.BatchID}}
	context.Set("id", batch.UserID)
	DownloadImageStudioBatch(context)

	require.Equal(t, http.StatusOK, recorder.Code)
	reader, err := zip.NewReader(bytes.NewReader(recorder.Body.Bytes()), int64(recorder.Body.Len()))
	require.NoError(t, err)
	// More than one 60-item page + manifest.json. This proves the opt-in
	// download-all endpoint is not constrained by the current-page ZIP cap.
	require.Len(t, reader.File, batch.TotalCount+1)
	assert.Equal(t, "manifest.json", reader.File[len(reader.File)-1].Name)
}

func TestDownloadImageStudioLibraryStreamsAcrossChunks(t *testing.T) {
	setupImageStudioAssetDB(t)
	setImageStudioDownloadAllForTest(t, true)
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", t.TempDir())
	const total = 205
	for index := 0; index < total; index++ {
		createDownloadableImageStudioTask(
			t,
			22,
			fmt.Sprintf("library-task-%02d", index+1),
			color.RGBA{G: uint8(index), A: 255},
		)
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/image-studio/library/download", nil)
	context.Set("id", 22)
	DownloadImageStudioLibrary(context)

	require.Equal(t, http.StatusOK, recorder.Code)
	reader, err := zip.NewReader(bytes.NewReader(recorder.Body.Bytes()), int64(recorder.Body.Len()))
	require.NoError(t, err)
	require.Len(t, reader.File, total+1)
	assert.Equal(t, "manifest.json", reader.File[len(reader.File)-1].Name)
}

func TestDownloadImageStudioTaskImagesRejectsUnownedTaskBeforeStreaming(t *testing.T) {
	setupImageStudioAssetDB(t)
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", t.TempDir())
	createDownloadableImageStudioTask(t, 18, "private-zip-task", color.RGBA{G: 255, A: 255})

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/task/image-studio/download?task_ids=private-zip-task", nil)
	context.Set("id", 19)
	DownloadImageStudioTaskImages(context)

	assert.Equal(t, http.StatusNotFound, recorder.Code)
	assert.NotEqual(t, "application/zip", recorder.Header().Get("Content-Type"))
}

func TestDownloadImageStudioTaskImagesRejectsMoreThanOnePage(t *testing.T) {
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	taskIDs := make([]string, maxImageStudioPageDownloadTasks+1)
	for index := range taskIDs {
		taskIDs[index] = fmt.Sprintf("zip-task-%d", index)
	}
	context.Request = httptest.NewRequest(
		http.MethodGet,
		"/api/task/image-studio/download?task_ids="+strings.Join(taskIDs, ","),
		nil,
	)
	DownloadImageStudioTaskImages(context)

	assert.Equal(t, http.StatusBadRequest, recorder.Code)
}

func TestImageStudioDownloadTicketPreservesStreamAndRejectsScopeChanges(t *testing.T) {
	setupImageStudioAssetDB(t)
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", t.TempDir())
	previousSecret := common.CryptoSecret
	common.CryptoSecret = "studio-download-ticket-test-secret"
	t.Cleanup(func() { common.CryptoSecret = previousSecret })
	require.NoError(t, model.DB.AutoMigrate(&model.User{}))
	users := []model.User{{Id: 61, Username: "ticket-owner", AffCode: "ticket-owner", Status: common.UserStatusEnabled}, {Id: 62, Username: "ticket-other", AffCode: "ticket-other", Status: common.UserStatusEnabled}}
	require.NoError(t, model.DB.Create(&users).Error)
	expected := createDownloadableImageStudioTask(t, 61, "ticket-task", color.RGBA{R: 255, A: 255})

	issue := func(userID int, body string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPost, "/api/image-studio/download-ticket", strings.NewReader(body))
		c.Set("id", userID)
		CreateImageStudioDownloadTicket(c)
		return recorder
	}
	issued := issue(61, `{"scope":"tasks","task_ids":["ticket-task"],"user_id":62}`)
	require.Equal(t, http.StatusOK, issued.Code, issued.Body.String())
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			URL       string `json:"url"`
			ExpiresAt int64  `json:"expires_at"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(issued.Body.Bytes(), &response))
	require.True(t, response.Success)
	assert.InDelta(t, time.Now().Add(imageStudioDownloadTicketTTL).Unix(), response.Data.ExpiresAt, 2)
	download := func(target string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodGet, target, nil)
		DownloadImageStudioWithTicket(c)
		return recorder
	}
	archiveResponse := download(response.Data.URL)
	require.Equal(t, http.StatusOK, archiveResponse.Code, archiveResponse.Body.String())
	assert.Equal(t, "no", archiveResponse.Header().Get("X-Accel-Buffering"))
	archive, err := zip.NewReader(bytes.NewReader(archiveResponse.Body.Bytes()), int64(archiveResponse.Body.Len()))
	require.NoError(t, err)
	require.Len(t, archive.File, 1)
	file, err := archive.File[0].Open()
	require.NoError(t, err)
	actual, err := io.ReadAll(file)
	require.NoError(t, err)
	require.NoError(t, file.Close())
	assert.Equal(t, expected, actual)

	assert.Equal(t, http.StatusNotFound, issue(62, `{"scope":"tasks","task_ids":["ticket-task"]}`).Code)
	assert.Equal(t, http.StatusBadRequest, issue(61, `{"scope":"tasks","task_ids":["ticket-task","ticket-task"]}`).Code)
	assert.Equal(t, http.StatusUnauthorized, issue(0, `{"scope":"tasks","task_ids":["ticket-task"]}`).Code)
	taskIDs := make([]string, maxImageStudioPageDownloadTasks+1)
	for index := range taskIDs {
		taskIDs[index] = fmt.Sprintf("ticket-task-%d", index)
	}
	oversized, err := common.Marshal(imageStudioDownloadTicket{Scope: "tasks", TaskIDs: taskIDs})
	require.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, issue(61, string(oversized)).Code)

	setImageStudioDownloadAllForTest(t, false)
	assert.Equal(t, http.StatusForbidden, issue(61, `{"scope":"library"}`).Code)

	for _, target := range []string{response.Data.URL + "&user_id=62", response.Data.URL + "&task_ids=other", response.Data.URL + "tamper"} {
		assert.Equal(t, http.StatusForbidden, download(target).Code)
	}
	for _, ticket := range []imageStudioDownloadTicket{
		{UserID: 61, Scope: "tasks", TaskIDs: []string{"ticket-task"}, ExpiresAt: time.Now().Add(-time.Second).Unix()},
		{UserID: 62, Scope: "tasks", TaskIDs: []string{"ticket-task"}, ExpiresAt: time.Now().Add(time.Minute).Unix()},
		{UserID: 61, Scope: "library", ExpiresAt: time.Now().Add(time.Minute).Unix()},
	} {
		target, err := imageStudioDownloadTicketURL(ticket)
		require.NoError(t, err)
		assert.NotEqual(t, http.StatusOK, download(target).Code)
	}
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", 61).Update("status", common.UserStatusDisabled).Error)
	assert.Equal(t, http.StatusForbidden, download(response.Data.URL).Code)
}

func TestLegacyImageStudioPreviewUsesScopedDownloadTicket(t *testing.T) {
	setupImageStudioAssetDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.User{}))
	require.NoError(t, model.DB.Create(&model.User{Id: 71, Username: "legacy-ticket-user", Status: common.UserStatusEnabled}).Error)
	var data bytes.Buffer
	require.NoError(t, png.Encode(&data, image.NewRGBA(image.Rect(0, 0, 2, 2))))
	task := &model.Task{TaskID: "legacy-ticket-image", UserId: 71, Platform: constant.TaskPlatformImageStudio, Status: model.TaskStatusSuccess}
	task.Data = json.RawMessage(`{"data":[{"b64_json":"` + base64.StdEncoding.EncodeToString(data.Bytes()) + `"}]}`)
	require.NoError(t, model.DB.Create(task).Error)
	taskDTO := &dto.TaskDto{Data: task.Data}
	sanitizeImageStudioTaskDtoWithAssets(task, taskDTO, nil)
	var payload struct {
		Data []struct {
			URL         string `json:"url"`
			DownloadURL string `json:"download_url"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(taskDTO.Data, &payload))
	require.Len(t, payload.Data, 1)
	for _, target := range []string{payload.Data[0].URL, payload.Data[0].DownloadURL} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodGet, target, nil)
		DownloadImageStudioWithTicket(c)
		require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
		assert.Equal(t, data.Bytes(), recorder.Body.Bytes())
		assert.Equal(t, "private, no-store", recorder.Header().Get("Cache-Control"))
		if target == payload.Data[0].DownloadURL {
			assert.Contains(t, recorder.Header().Get("Content-Disposition"), "attachment;")
		} else {
			assert.Empty(t, recorder.Header().Get("Content-Disposition"))
		}
	}
}

func TestImageStudioDownloadTicketDoesNotEnterAccessLogs(t *testing.T) {
	previousWriter := gin.DefaultWriter
	var log bytes.Buffer
	gin.DefaultWriter = &log
	t.Cleanup(func() { gin.DefaultWriter = previousWriter })
	router := gin.New()
	middleware.SetUpLogger(router)
	router.GET("/api/image-studio/download", func(c *gin.Context) { c.Status(http.StatusForbidden) })
	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/image-studio/download?ticket=sensitive-download-capability", nil))
	assert.Contains(t, log.String(), "/api/image-studio/download")
	assert.NotContains(t, log.String(), "sensitive-download-capability")
	assert.NotContains(t, log.String(), "ticket=")
}

func TestPendingImageStudioDTOHidesPrivatePluginCheckpoint(t *testing.T) {
	setupImageStudioAssetDB(t)
	task := &model.Task{TaskID: "pending-private-plugin", UserId: 81, Platform: constant.TaskPlatformImageStudio, Status: model.TaskStatusInProgress}
	task.Data = json.RawMessage(`{"request":{"model":"test-image"},"plugin":{"key":"vendor","upstream_task_id":"private-provider-id","data":{"secret":"private-provider-response"}}}`)
	require.NoError(t, model.DB.Create(task).Error)
	taskDTO := &dto.TaskDto{Data: task.Data}
	sanitizeImageStudioTaskDtoWithAssets(task, taskDTO, nil)
	assert.JSONEq(t, `{"request":{"model":"test-image"}}`, string(taskDTO.Data))
	assert.Contains(t, string(task.Data), "private-provider-id")
	var stored model.Task
	require.NoError(t, model.DB.First(&stored, task.ID).Error)
	assert.JSONEq(t, string(task.Data), string(stored.Data))
}
