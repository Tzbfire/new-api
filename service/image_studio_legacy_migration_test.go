package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type legacyImageRoundTripper func(*http.Request) (*http.Response, error)

func (roundTrip legacyImageRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	return roundTrip(request)
}

func TestLegacyImageStudioAssetMigrationBackfillsStoredAndBase64Images(t *testing.T) {
	truncate(t)
	root := t.TempDir()
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", root)
	t.Setenv("IMAGE_STUDIO_MIN_FREE_GB", "0")
	image := tinyImageStudioPNG(t)
	fetchSetting := system_setting.GetFetchSetting()
	previousSSRF := fetchSetting.EnableSSRFProtection
	previousHTTPClient := httpClient
	previousProtectedClient := ssrfProtectedHTTPClient
	fetchSetting.EnableSSRFProtection = false
	httpClient = &http.Client{Transport: legacyImageRoundTripper(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode:    http.StatusOK,
			ContentLength: int64(len(image)),
			Body:          io.NopCloser(bytes.NewReader(image)),
			Header:        make(http.Header),
		}, nil
	})}
	t.Cleanup(func() {
		fetchSetting.EnableSSRFProtection = previousSSRF
		httpClient = previousHTTPClient
		ssrfProtectedHTTPClient = previousProtectedClient
	})

	legacyKey := "user_9961/task_legacy_stored/001.png"
	legacyPath := filepath.Join(root, filepath.FromSlash(legacyKey))
	require.NoError(t, os.MkdirAll(filepath.Dir(legacyPath), 0o750))
	require.NoError(t, os.WriteFile(legacyPath, image, 0o640))
	tasks := []*model.Task{
		{
			TaskID:   "task_legacy_stored",
			Platform: constant.TaskPlatformImageStudio,
			UserId:   9961,
			Status:   model.TaskStatusSuccess,
			Progress: "100%",
		},
		{
			TaskID:   "task_legacy_base64",
			Platform: constant.TaskPlatformImageStudio,
			UserId:   9962,
			Status:   model.TaskStatusSuccess,
			Progress: "100%",
		},
		{
			TaskID:   "task_legacy_url",
			Platform: constant.TaskPlatformImageStudio,
			UserId:   9963,
			Status:   model.TaskStatusSuccess,
			Progress: "100%",
		},
	}
	tasks[0].SetData(map[string]any{"data": []any{map[string]any{"storage_key": legacyKey}}})
	tasks[1].SetData(map[string]any{"data": []any{map[string]any{"b64_json": base64.StdEncoding.EncodeToString(image)}}})
	tasks[2].SetData(map[string]any{"data": []any{map[string]any{"url": "https://images.example.com/image.png"}}})
	for _, task := range tasks {
		require.NoError(t, task.Insert())
	}

	migrated, err := RunImageStudioLegacyAssetMigration(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 3, migrated)

	for _, task := range tasks {
		asset, exists, err := model.GetImageStudioAsset(task.UserId, task.TaskID, 1)
		require.NoError(t, err)
		require.True(t, exists)
		assert.Equal(t, model.ImageStudioAssetStatusReady, asset.Status)
		stored, _, err := ReadImageStudioAsset(asset.StorageKey)
		require.NoError(t, err)
		assert.Equal(t, image, stored)
	}
	var migratedTask model.Task
	require.NoError(t, model.DB.Where("task_id = ?", tasks[1].TaskID).First(&migratedTask).Error)
	assert.NotContains(t, string(migratedTask.Data), "b64_json")
	assert.Contains(t, string(migratedTask.Data), "storage_key")
	migratedTask = model.Task{}
	require.NoError(t, model.DB.Where("task_id = ?", tasks[2].TaskID).First(&migratedTask).Error)
	assert.NotContains(t, string(migratedTask.Data), `"url"`)
	assert.Contains(t, string(migratedTask.Data), "upstream_url")

	migrated, err = RunImageStudioLegacyAssetMigration(context.Background())
	require.NoError(t, err)
	assert.Zero(t, migrated)
}
