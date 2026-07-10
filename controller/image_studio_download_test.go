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

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
	taskIDs := make([]string, maxImageStudioBatchDownloadTasks+1)
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
