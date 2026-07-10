package service

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestImageStudioSignedAssetURLIsCookieFreeAndTimeBound(t *testing.T) {
	previousSecret := common.CryptoSecret
	common.CryptoSecret = "image-studio-url-test-secret"
	common.OptionMapRWMutex.Lock()
	previousBaseURL, baseURLExisted := common.OptionMap["ImageStudioBaseURL"]
	common.OptionMap["ImageStudioBaseURL"] = "https://img.example.com/"
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.CryptoSecret = previousSecret
		common.OptionMapRWMutex.Lock()
		if baseURLExisted {
			common.OptionMap["ImageStudioBaseURL"] = previousBaseURL
		} else {
			delete(common.OptionMap, "ImageStudioBaseURL")
		}
		common.OptionMapRWMutex.Unlock()
	})

	now := time.Date(2026, time.July, 11, 8, 30, 0, 0, time.UTC)
	contentURL, downloadURL := ImageStudioAssetURL(42, now)
	assert.True(t, strings.HasPrefix(contentURL, "https://img.example.com/api/image-studio/assets/42/"))
	assert.Equal(t, contentURL+"/download", downloadURL)
	stableURL, _ := ImageStudioAssetURL(42, now.Add(3*time.Hour))
	assert.Equal(t, contentURL, stableURL)

	parsed, err := url.Parse(contentURL)
	require.NoError(t, err)
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	require.Len(t, parts, 6)
	expiresAt, err := strconv.ParseInt(parts[4], 10, 64)
	require.NoError(t, err)
	assert.True(t, ValidateImageStudioAssetURL(42, expiresAt, parts[5], now))
	assert.False(t, ValidateImageStudioAssetURL(43, expiresAt, parts[5], now))
	assert.False(t, ValidateImageStudioAssetURL(42, expiresAt, parts[5]+"0", now))
	assert.False(t, ValidateImageStudioAssetURL(42, expiresAt, parts[5], time.Unix(expiresAt, 0)))
}

func TestNormalizeImageStudioBaseURL(t *testing.T) {
	for _, test := range []struct {
		name       string
		value      string
		expected   string
		shouldFail bool
	}{
		{name: "empty", value: "", expected: ""},
		{name: "https", value: " https://img.example.com/ ", expected: "https://img.example.com"},
		{name: "localhost", value: "http://localhost:8080", expected: "http://localhost:8080"},
		{name: "loopback ipv4", value: "http://127.0.0.1:8080", expected: "http://127.0.0.1:8080"},
		{name: "remote http", value: "http://img.example.com", shouldFail: true},
		{name: "path", value: "https://img.example.com/files", shouldFail: true},
		{name: "query", value: "https://img.example.com?token=secret", shouldFail: true},
		{name: "credentials", value: "https://user:pass@img.example.com", shouldFail: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			actual, err := NormalizeImageStudioBaseURL(test.value)
			if test.shouldFail {
				assert.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, test.expected, actual)
		})
	}
}

func tinyImageStudioPNG(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	picture := image.NewRGBA(image.Rect(0, 0, 2, 2))
	picture.Set(0, 0, color.RGBA{R: 20, G: 80, B: 200, A: 255})
	require.NoError(t, png.Encode(&buffer, picture))
	return buffer.Bytes()
}

func publishTestImageStudioAsset(t *testing.T, userID int, taskID string, data []byte) (*ImageStudioAsset, *model.ImageStudioAsset) {
	t.Helper()
	staged, err := StageImageStudioAsset(userID, taskID, 1, bytes.NewReader(data))
	require.NoError(t, err)
	t.Cleanup(staged.Discard)
	asset, err := staged.Publish()
	require.NoError(t, err)
	record, exists, err := model.GetImageStudioAsset(userID, taskID, 1)
	require.NoError(t, err)
	require.True(t, exists)
	return asset, record
}

func TestImageStudioAssetExpiryUsesRuntimeRetentionSetting(t *testing.T) {
	common.OptionMapRWMutex.Lock()
	previous, existed := common.OptionMap["ImageStudioRetentionDays"]
	common.OptionMap["ImageStudioRetentionDays"] = "30"
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		if existed {
			common.OptionMap["ImageStudioRetentionDays"] = previous
		} else {
			delete(common.OptionMap, "ImageStudioRetentionDays")
		}
		common.OptionMapRWMutex.Unlock()
	})

	now := time.Unix(1_700_000_000, 0)
	assert.Equal(t, 30, ImageStudioRetentionDays())
	assert.Equal(t, now.Add(30*24*time.Hour).Unix(), ImageStudioAssetExpiresAt(now))

	common.OptionMapRWMutex.Lock()
	common.OptionMap["ImageStudioRetentionDays"] = "0"
	common.OptionMapRWMutex.Unlock()
	assert.Zero(t, ImageStudioAssetExpiresAt(now))
}

func TestImageStudioAssetStorageRoundTrip(t *testing.T) {
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", t.TempDir())
	t.Setenv("IMAGE_STUDIO_MAX_IMAGE_MB", "1")
	data := tinyImageStudioPNG(t)
	asset, _ := publishTestImageStudioAsset(t, 123, "task/../safe", data)
	assert.NotEmpty(t, asset.StorageKey)
	assert.Equal(t, "image/png", asset.MimeType)
	assert.EqualValues(t, len(data), asset.SizeBytes)
	require.NoError(t, ValidateImageStudioAssetOwnership(asset.StorageKey, 123, "task/../safe"))
	require.Error(t, ValidateImageStudioAssetOwnership(asset.StorageKey, 124, "task/../safe"))
	require.Error(t, ValidateImageStudioAssetOwnership(asset.StorageKey, 123, "other-task"))

	stored, mimeType, err := ReadImageStudioAsset(asset.StorageKey)
	require.NoError(t, err)
	assert.Equal(t, data, stored)
	assert.Equal(t, "image/png", mimeType)

	require.NoError(t, RemoveImageStudioAsset(asset.StorageKey))
	_, _, err = ReadImageStudioAsset(asset.StorageKey)
	assert.True(t, os.IsNotExist(err))
}

func TestDiscardImageStudioTaskAssetsRemovesLedgerAndPayloadKeyOnce(t *testing.T) {
	truncate(t)
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", t.TempDir())
	data := tinyImageStudioPNG(t)
	asset, _ := publishTestImageStudioAsset(t, 124, "task-discard", data)

	DiscardImageStudioTaskAssets(t.Context(), 124, "task-discard", []string{asset.StorageKey})

	_, _, err := OpenImageStudioAsset(asset.StorageKey, asset.SizeBytes)
	assert.True(t, os.IsNotExist(err))
	_, exists, err := model.GetImageStudioAsset(124, "task-discard", 1)
	require.NoError(t, err)
	assert.False(t, exists)
}

func TestDeleteImageStudioTaskWithAssetsOwnsCompleteDeletionWorkflow(t *testing.T) {
	truncate(t)
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", t.TempDir())
	data := tinyImageStudioPNG(t)
	asset, _ := publishTestImageStudioAsset(t, 125, "task-delete", data)
	require.NoError(t, model.TransitionImageStudioTaskAssets("task-delete", []model.ImageStudioAssetStatus{model.ImageStudioAssetStatusPending}, model.ImageStudioAssetStatusReady))
	task := &model.Task{
		TaskID:   "task-delete",
		UserId:   125,
		Platform: constant.TaskPlatformImageStudio,
		Status:   model.TaskStatusSuccess,
	}
	require.NoError(t, model.DB.Create(task).Error)

	deleted, err := DeleteImageStudioTaskWithAssets(task, []string{asset.StorageKey})
	require.NoError(t, err)
	assert.True(t, deleted)
	_, _, err = OpenImageStudioAsset(asset.StorageKey, asset.SizeBytes)
	assert.True(t, os.IsNotExist(err))
	_, exists, err := model.GetByOnlyTaskId(task.TaskID)
	require.NoError(t, err)
	assert.False(t, exists)
	_, exists, err = model.GetImageStudioAsset(125, task.TaskID, 1)
	require.NoError(t, err)
	assert.False(t, exists)
}

func TestImageStudioAssetPathRejectsTraversal(t *testing.T) {
	root := t.TempDir()
	for _, storageKey := range []string{"../escape.png", "/tmp/escape.png", "."} {
		_, err := imageStudioAssetPath(root, storageKey)
		assert.Error(t, err, storageKey)
	}
	path, err := imageStudioAssetPath(root, "user_1/task/001.png")
	require.NoError(t, err)
	assert.NotEqual(t, root, filepath.Dir(path))
}

func TestImageStudioAssetStorageRejectsSVGAndOversizedContent(t *testing.T) {
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", t.TempDir())
	t.Setenv("IMAGE_STUDIO_MAX_IMAGE_MB", "1")
	_, err := StageImageStudioAsset(1, "task-svg", 1, strings.NewReader(`<svg xmlns="http://www.w3.org/2000/svg"/>`))
	require.ErrorContains(t, err, "unsupported")

	_, err = StageImageStudioAsset(1, "task-large", 1, bytes.NewReader(make([]byte, 1024*1024+1)))
	require.ErrorContains(t, err, "exceeds")
}

func TestImageStudioAssetCleanupPreservesExpiredLedger(t *testing.T) {
	truncate(t)
	root := t.TempDir()
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", root)
	data := tinyImageStudioPNG(t)
	stored, asset := publishTestImageStudioAsset(t, 77, "task-expired", data)
	require.NoError(t, model.DB.Model(asset).Updates(map[string]any{
		"status":     model.ImageStudioAssetStatusExpired,
		"created_at": time.Now().Add(-time.Hour).Unix(),
		"updated_at": time.Now().Unix(),
	}).Error)

	RunImageStudioAssetCleanupOnce(t.Context())

	_, _, err := OpenImageStudioAsset(stored.StorageKey, stored.SizeBytes)
	assert.True(t, os.IsNotExist(err))
	var reloaded model.ImageStudioAsset
	require.NoError(t, model.DB.First(&reloaded, asset.ID).Error)
	assert.Equal(t, model.ImageStudioAssetStatusExpired, reloaded.Status)
	assert.Empty(t, reloaded.StorageKey)
}

func TestImageStudioAssetStorageRejectsGlobalQuotaOverflow(t *testing.T) {
	truncate(t)
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", t.TempDir())
	t.Setenv("IMAGE_STUDIO_MAX_STORAGE_GB", "1")
	t.Setenv("IMAGE_STUDIO_MIN_FREE_GB", "0")
	require.NoError(t, model.DB.Create(&model.ImageStudioAsset{
		UserID:     1,
		TaskID:     "task-existing-capacity",
		ImageIndex: 1,
		StorageKey: "user_1/task-existing-capacity/001.png",
		MimeType:   "image/png",
		SizeBytes:  1 << 30,
		SHA256:     "existing",
		Status:     model.ImageStudioAssetStatusReady,
	}).Error)
	data := tinyImageStudioPNG(t)
	staged, err := StageImageStudioAsset(2, "task-over-capacity", 1, bytes.NewReader(data))
	require.NoError(t, err)
	t.Cleanup(staged.Discard)

	_, err = staged.Publish()
	require.ErrorContains(t, err, "storage quota exceeded")
}

func TestImageStudioAssetCleanupDrainsMoreThanOneBatch(t *testing.T) {
	truncate(t)
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", t.TempDir())
	for index := 0; index < imageStudioCleanupBatchSize+25; index++ {
		require.NoError(t, model.DB.Create(&model.ImageStudioAsset{
			UserID:     9,
			TaskID:     fmt.Sprintf("task-expired-%d", index),
			ImageIndex: 1,
			StorageKey: fmt.Sprintf("user_9/task-expired-%d/001.png", index),
			MimeType:   "image/png",
			SizeBytes:  10,
			SHA256:     fmt.Sprintf("hash-%d", index),
			Status:     model.ImageStudioAssetStatusExpired,
		}).Error)
	}

	RunImageStudioAssetCleanupOnce(t.Context())

	var remaining int64
	require.NoError(t, model.DB.Model(&model.ImageStudioAsset{}).Where("storage_key <> ?", "").Count(&remaining).Error)
	assert.Zero(t, remaining)
}

func TestImageStudioResponseSpoolUsesManagedStorageAndReleasesReservation(t *testing.T) {
	root := t.TempDir()
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", root)
	t.Setenv("IMAGE_STUDIO_MIN_FREE_GB", "0")
	imageStudioTemporaryStorage.Lock()
	previousReserved := imageStudioTemporaryStorage.reserved
	imageStudioTemporaryStorage.reserved = 0
	imageStudioTemporaryStorage.Unlock()
	t.Cleanup(func() {
		imageStudioTemporaryStorage.Lock()
		imageStudioTemporaryStorage.reserved = previousReserved
		imageStudioTemporaryStorage.Unlock()
	})

	file, release, err := CreateImageStudioResponseSpool(1024)
	require.NoError(t, err)
	resolvedRoot, err := filepath.EvalSymlinks(root)
	require.NoError(t, err)
	resolvedDirectory, err := filepath.EvalSymlinks(filepath.Dir(file.Name()))
	require.NoError(t, err)
	assert.Equal(t, resolvedRoot, resolvedDirectory)
	imageStudioTemporaryStorage.Lock()
	assert.EqualValues(t, 1024, imageStudioTemporaryStorage.reserved)
	imageStudioTemporaryStorage.Unlock()
	require.NoError(t, file.Close())
	require.NoError(t, os.Remove(file.Name()))
	release()
	imageStudioTemporaryStorage.Lock()
	assert.Zero(t, imageStudioTemporaryStorage.reserved)
	imageStudioTemporaryStorage.Unlock()
}

func TestImageStudioCleanupRemovesOrphanTemporaryFiles(t *testing.T) {
	root := t.TempDir()
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", root)
	path := filepath.Join(root, ".image-studio-stage-orphan.tmp")
	require.NoError(t, os.WriteFile(path, []byte("orphan"), 0o600))
	old := time.Now().Add(-time.Hour)
	require.NoError(t, os.Chtimes(path, old, old))

	removed, err := cleanupImageStudioTemporaryFiles(time.Now().Add(-10*time.Minute), 10)
	require.NoError(t, err)
	assert.Equal(t, 1, removed)
	_, err = os.Stat(path)
	assert.True(t, os.IsNotExist(err))
}
