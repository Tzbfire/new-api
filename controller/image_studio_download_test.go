package controller

import (
	"archive/zip"
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
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
