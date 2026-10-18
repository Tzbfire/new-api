package service

import (
	"context"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/bytedance/gopkg/util/gopool"
)

const (
	imageStudioAssetCleanupInterval = time.Hour
	imageStudioPendingGracePeriod   = 10 * time.Minute
	imageStudioCleanupBudget        = 30 * time.Second
	imageStudioCleanupBatchSize     = 100
)

type ImageStudioAsset struct {
	StorageKey string `json:"storage_key"`
	MimeType   string `json:"mime_type"`
	SizeBytes  int64  `json:"size_bytes"`
	SHA256     string `json:"sha256"`
}

var (
	imageStudioAssetCleanupOnce    sync.Once
	imageStudioAssetCleanupRunning atomic.Bool
)

func ensureImageStudioStorageCapacity(root string, asset *ImageStudioAsset) error {
	maxStorageGB := common.GetEnvOrDefault("IMAGE_STUDIO_MAX_STORAGE_GB", 20)
	if maxStorageGB > 0 {
		if int64(maxStorageGB) > math.MaxInt64/(1<<30) {
			return fmt.Errorf("image studio storage quota is invalid")
		}
		storedBytes, err := model.ImageStudioStoredBytesExcluding(asset.StorageKey)
		if err != nil {
			return fmt.Errorf("read image studio storage usage: %w", err)
		}
		maxBytes := int64(maxStorageGB) * (1 << 30)
		if storedBytes > maxBytes-asset.SizeBytes {
			return fmt.Errorf("image studio storage quota exceeded")
		}
	}
	minFreeGB := common.GetEnvOrDefault("IMAGE_STUDIO_MIN_FREE_GB", 2)
	if minFreeGB <= 0 {
		return nil
	}
	if int64(minFreeGB) > math.MaxInt64/(1<<30) {
		return fmt.Errorf("image studio minimum free space is invalid")
	}
	usage := common.GetDiskSpaceInfoForPath(root)
	if usage.Total == 0 {
		return fmt.Errorf("read image studio disk space: unavailable")
	}
	minFreeBytes := uint64(minFreeGB) * (1 << 30)
	if usage.Free < minFreeBytes || asset.SizeBytes > 0 && uint64(asset.SizeBytes) > usage.Free-minFreeBytes {
		return fmt.Errorf("image studio disk free space is below the safety threshold")
	}
	return nil
}

func OpenImageStudioAsset(storageKey string, expectedSize int64) (*os.File, os.FileInfo, error) {
	root, err := imageStudioAssetRoot()
	if err != nil {
		return nil, nil, err
	}
	fullPath, err := imageStudioAssetPath(root, storageKey)
	if err != nil {
		return nil, nil, err
	}
	pathInfo, err := os.Lstat(fullPath)
	if err != nil {
		return nil, nil, err
	}
	if pathInfo.Mode()&os.ModeSymlink != 0 || !pathInfo.Mode().IsRegular() {
		return nil, nil, fmt.Errorf("stored image studio asset is not a regular file")
	}
	file, err := os.Open(fullPath)
	if err != nil {
		return nil, nil, err
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, nil, err
	}
	maxBytes := ImageStudioMaxAssetBytes()
	if !info.Mode().IsRegular() || info.Size() <= 0 || maxBytes <= 0 || info.Size() > maxBytes || expectedSize > 0 && info.Size() != expectedSize {
		_ = file.Close()
		return nil, nil, fmt.Errorf("stored image studio asset metadata mismatch")
	}
	return file, info, nil
}

func ReadImageStudioAsset(storageKey string) ([]byte, string, error) {
	file, _, err := OpenImageStudioAsset(storageKey, 0)
	if err != nil {
		return nil, "", err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, ImageStudioMaxAssetBytes()+1))
	if err != nil {
		return nil, "", err
	}
	if int64(len(data)) > ImageStudioMaxAssetBytes() {
		return nil, "", fmt.Errorf("stored image studio asset exceeds maximum size")
	}
	mimeType := strings.ToLower(strings.TrimSpace(strings.Split(http.DetectContentType(data), ";")[0]))
	if _, ok := imageStudioAssetExtension(mimeType); !ok {
		return nil, "", fmt.Errorf("unsupported stored image studio asset content type: %s", mimeType)
	}
	config, _, err := decodeImageConfig(data)
	if err != nil || config.Width <= 0 || config.Height <= 0 {
		return nil, "", fmt.Errorf("stored image studio asset header cannot be decoded")
	}
	if err := validateImageStudioAssetDimensions(config.Width, config.Height); err != nil {
		return nil, "", err
	}
	return data, mimeType, nil
}

func imageStudioAssetExtension(mimeType string) (string, bool) {
	switch mimeType {
	case "image/png":
		return "png", true
	case "image/jpeg":
		return "jpg", true
	case "image/webp":
		return "webp", true
	default:
		return "", false
	}
}

func validateImageStudioAssetDimensions(width int, height int) error {
	maxDimension := common.GetEnvOrDefault("IMAGE_STUDIO_MAX_DIMENSION", 16384)
	maxPixels := int64(common.GetEnvOrDefault("IMAGE_STUDIO_MAX_PIXELS", 40_000_000))
	if width <= 0 || height <= 0 || maxDimension <= 0 || width > maxDimension || height > maxDimension || maxPixels <= 0 || int64(width) > maxPixels/int64(height) {
		return fmt.Errorf("image studio asset dimensions exceed maximum")
	}
	return nil
}

func RemoveImageStudioAsset(storageKey string) error {
	if strings.TrimSpace(storageKey) == "" {
		return nil
	}
	root, err := imageStudioAssetRoot()
	if err != nil {
		return err
	}
	fullPath, err := imageStudioAssetPath(root, storageKey)
	if err != nil {
		return err
	}
	if err := os.Remove(fullPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	removeEmptyImageStudioAssetDirs(root, filepath.Dir(fullPath))
	return nil
}

func DiscardImageStudioTaskAssets(ctx context.Context, userID int, taskID string, legacyStorageKeys []string) {
	if userID <= 0 || strings.TrimSpace(taskID) == "" {
		return
	}
	_ = model.TransitionImageStudioTaskAssets(taskID, []model.ImageStudioAssetStatus{
		model.ImageStudioAssetStatusPending,
		model.ImageStudioAssetStatusReady,
	}, model.ImageStudioAssetStatusDiscarding)
	assets, err := model.GetImageStudioAssetsByTaskIDs([]string{taskID})
	removedKeys := make(map[string]struct{}, len(assets))
	if err == nil {
		for _, asset := range assets {
			if asset.Status != model.ImageStudioAssetStatusDiscarding {
				continue
			}
			storageKey := strings.TrimSpace(asset.StorageKey)
			if storageKey != "" {
				removedKeys[storageKey] = struct{}{}
				if removeErr := RemoveImageStudioAsset(storageKey); removeErr != nil {
					logger.LogWarn(ctx, fmt.Sprintf("remove image studio asset %s: %s", storageKey, removeErr.Error()))
					continue
				}
			}
			if deleteErr := model.DeleteImageStudioAssetRecord(asset.ID); deleteErr != nil {
				logger.LogWarn(ctx, fmt.Sprintf("delete image studio asset %d: %s", asset.ID, deleteErr.Error()))
			}
		}
	}
	for _, storageKey := range legacyStorageKeys {
		storageKey = strings.TrimSpace(storageKey)
		if storageKey == "" {
			continue
		}
		if _, exists := removedKeys[storageKey]; exists {
			continue
		}
		if err := ValidateImageStudioAssetOwnership(storageKey, userID, taskID); err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("skip foreign image studio asset %s: %s", storageKey, err.Error()))
			continue
		}
		if removeErr := RemoveImageStudioAsset(storageKey); removeErr != nil {
			logger.LogWarn(ctx, fmt.Sprintf("remove image studio asset %s: %s", storageKey, removeErr.Error()))
		}
	}
}

func DeleteImageStudioTaskWithAssets(task *model.Task, legacyStorageKeys []string) (bool, error) {
	if task == nil || task.UserId <= 0 || strings.TrimSpace(task.TaskID) == "" {
		return false, fmt.Errorf("invalid image studio task")
	}
	if task.Platform != constant.TaskPlatformImageStudio || task.Status != model.TaskStatusSuccess && task.Status != model.TaskStatusFailure {
		return false, fmt.Errorf("image studio task is not terminal")
	}
	if err := model.TransitionImageStudioTaskAssets(task.TaskID, []model.ImageStudioAssetStatus{
		model.ImageStudioAssetStatusPending,
		model.ImageStudioAssetStatusReady,
		model.ImageStudioAssetStatusExpired,
		model.ImageStudioAssetStatusDiscarding,
	}, model.ImageStudioAssetStatusDeleting); err != nil {
		return false, err
	}
	assets, err := model.GetImageStudioAssetsByTaskIDs([]string{task.TaskID})
	if err != nil {
		return false, err
	}
	storageKeys := make(map[string]struct{}, len(assets)+len(legacyStorageKeys))
	for _, asset := range assets {
		if storageKey := strings.TrimSpace(asset.StorageKey); storageKey != "" {
			storageKeys[storageKey] = struct{}{}
		}
	}
	for _, storageKey := range legacyStorageKeys {
		if storageKey = strings.TrimSpace(storageKey); storageKey != "" {
			storageKeys[storageKey] = struct{}{}
		}
	}
	if err := removeImageStudioStorageKeys(task.UserId, task.TaskID, storageKeys); err != nil {
		return false, err
	}
	return model.DeleteUserImageStudioTaskWithAssets(task.UserId, task.TaskID)
}

func removeImageStudioStorageKeys(userID int, taskID string, storageKeys map[string]struct{}) error {
	for storageKey := range storageKeys {
		if err := ValidateImageStudioAssetOwnership(storageKey, userID, taskID); err != nil {
			return err
		}
		if err := RemoveImageStudioAsset(storageKey); err != nil {
			return err
		}
	}
	return nil
}

func ValidateImageStudioAssetOwnership(storageKey string, userID int, taskID string) error {
	if userID <= 0 || strings.TrimSpace(taskID) == "" {
		return fmt.Errorf("invalid image studio asset owner")
	}
	cleanKey := filepath.ToSlash(filepath.Clean(filepath.FromSlash(strings.TrimSpace(storageKey))))
	expectedPrefix := fmt.Sprintf("user_%d/%s/", userID, safeImageStudioAssetSegment(taskID))
	if !strings.HasPrefix(cleanKey, expectedPrefix) || strings.TrimPrefix(cleanKey, expectedPrefix) == "" {
		return fmt.Errorf("image studio asset does not belong to task")
	}
	return nil
}

func ImageStudioMaxAssetBytes() int64 {
	return int64(common.GetEnvOrDefault("IMAGE_STUDIO_MAX_IMAGE_MB", 64)) * 1024 * 1024
}

func ImageStudioRetentionDays() int {
	common.OptionMapRWMutex.RLock()
	raw, configured := common.OptionMap["ImageStudioRetentionDays"]
	common.OptionMapRWMutex.RUnlock()
	if configured {
		retentionDays, err := strconv.Atoi(strings.TrimSpace(raw))
		if err == nil && retentionDays >= constant.ImageStudioMinRetentionDays && retentionDays <= constant.ImageStudioMaxRetentionDays {
			return retentionDays
		}
	}
	legacyRetentionDays := common.GetEnvOrDefault("IMAGE_STUDIO_RETENTION_DAYS", constant.ImageStudioDefaultRetentionDays)
	if legacyRetentionDays < constant.ImageStudioMinRetentionDays || legacyRetentionDays > constant.ImageStudioMaxRetentionDays {
		return constant.ImageStudioDefaultRetentionDays
	}
	return legacyRetentionDays
}

func ImageStudioAssetExpiresAt(now time.Time) int64 {
	retentionDays := ImageStudioRetentionDays()
	if retentionDays <= 0 {
		return 0
	}
	return now.Add(time.Duration(retentionDays) * 24 * time.Hour).Unix()
}

func imageStudioAssetRoot() (string, error) {
	configured := strings.TrimSpace(common.GetEnvOrDefaultString("IMAGE_STUDIO_STORAGE_PATH", "data/image-studio"))
	if configured == "" {
		return "", fmt.Errorf("image studio storage path is empty")
	}
	root, err := filepath.Abs(configured)
	if err != nil {
		return "", err
	}
	root = filepath.Clean(root)
	root, err = resolveImageStudioAssetRoot(root)
	if err != nil {
		return "", err
	}
	workingDirectory, _ := os.Getwd()
	if root == filepath.VolumeName(root)+string(os.PathSeparator) || root == filepath.Clean(workingDirectory) {
		return "", fmt.Errorf("image studio storage path must be a dedicated subdirectory")
	}
	return root, nil
}

func resolveImageStudioAssetRoot(root string) (string, error) {
	current := root
	missing := make([]string, 0, 4)
	for {
		_, err := os.Lstat(current)
		if err == nil {
			break
		}
		if !os.IsNotExist(err) {
			return "", err
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", fmt.Errorf("cannot resolve image studio storage root")
		}
		missing = append(missing, filepath.Base(current))
		current = parent
	}
	realRoot, err := filepath.EvalSymlinks(current)
	if err != nil {
		return "", err
	}
	for index := len(missing) - 1; index >= 0; index-- {
		realRoot = filepath.Join(realRoot, missing[index])
	}
	return filepath.Clean(realRoot), nil
}

func imageStudioAssetPath(root string, storageKey string) (string, error) {
	key := filepath.Clean(filepath.FromSlash(strings.TrimSpace(storageKey)))
	if key == "." || key == "" || filepath.IsAbs(key) || strings.HasPrefix(key, "..") {
		return "", fmt.Errorf("invalid image studio asset key")
	}
	fullPath := filepath.Join(root, key)
	relative, err := filepath.Rel(root, fullPath)
	if err != nil || relative == "." || filepath.IsAbs(relative) || strings.HasPrefix(relative, "..") {
		return "", fmt.Errorf("invalid image studio asset path")
	}
	return fullPath, nil
}

func safeImageStudioAssetSegment(value string) string {
	var builder strings.Builder
	for _, character := range strings.TrimSpace(value) {
		if character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' || character >= '0' && character <= '9' || character == '-' || character == '_' || character == '.' {
			builder.WriteRune(character)
		} else {
			builder.WriteByte('_')
		}
	}
	segment := strings.Trim(builder.String(), "._-")
	if segment == "" {
		return "unknown"
	}
	if len(segment) > 120 {
		return segment[:120]
	}
	return segment
}

func removeEmptyImageStudioAssetDirs(root string, directory string) {
	root = filepath.Clean(root)
	directory = filepath.Clean(directory)
	for directory != root && strings.HasPrefix(directory, root+string(os.PathSeparator)) {
		if err := os.Remove(directory); err != nil {
			return
		}
		directory = filepath.Dir(directory)
	}
}

func StartImageStudioAssetCleanupTask() {
	imageStudioAssetCleanupOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			RunImageStudioAssetCleanupOnce(context.Background())
			ticker := time.NewTicker(imageStudioAssetCleanupInterval)
			defer ticker.Stop()
			for range ticker.C {
				RunImageStudioAssetCleanupOnce(context.Background())
			}
		})
	})
}

func RunImageStudioAssetCleanupOnce(ctx context.Context) {
	if !imageStudioAssetCleanupRunning.CompareAndSwap(false, true) {
		return
	}
	defer imageStudioAssetCleanupRunning.Store(false)
	if ctx == nil {
		ctx = context.Background()
	}
	deadline := time.Now().Add(imageStudioCleanupBudget)
	taskTimeoutMinutes := ImageStudioTaskTimeoutMinutes()
	temporaryCutoff := time.Now().Add(-time.Duration(taskTimeoutMinutes+10) * time.Minute)
	if _, err := cleanupImageStudioTemporaryFiles(temporaryCutoff, imageStudioCleanupBatchSize); err != nil {
		logger.LogWarn(ctx, "image studio cleanup temporary files: "+err.Error())
	}
	for time.Now().Before(deadline) {
		count, err := model.MarkExpiredImageStudioAssets(time.Now().Unix(), imageStudioCleanupBatchSize)
		if err != nil {
			logger.LogWarn(ctx, "image studio cleanup mark expired: "+err.Error())
			break
		}
		if count < imageStudioCleanupBatchSize {
			break
		}
	}
	staleCutoff := time.Now().Add(-imageStudioPendingGracePeriod).Unix()
	for time.Now().Before(deadline) {
		assets, err := model.GetStalePendingImageStudioAssets(staleCutoff, imageStudioCleanupBatchSize)
		if err != nil {
			logger.LogWarn(ctx, "image studio cleanup list pending: "+err.Error())
			break
		}
		if len(assets) == 0 || removeImageStudioAssetRows(ctx, assets, true) == 0 {
			break
		}
	}
	for _, status := range []model.ImageStudioAssetStatus{model.ImageStudioAssetStatusDiscarding, model.ImageStudioAssetStatusExpired} {
		for time.Now().Before(deadline) {
			assets, err := model.GetImageStudioAssetsByStatus(status, imageStudioCleanupBatchSize)
			if err != nil {
				logger.LogWarn(ctx, "image studio cleanup list "+string(status)+": "+err.Error())
				break
			}
			if len(assets) == 0 || removeImageStudioAssetRows(ctx, assets, status == model.ImageStudioAssetStatusDiscarding) == 0 {
				break
			}
		}
	}
	for time.Now().Before(deadline) {
		assets, err := model.GetImageStudioAssetsByStatus(model.ImageStudioAssetStatusDeleting, imageStudioCleanupBatchSize)
		if err != nil {
			logger.LogWarn(ctx, "image studio cleanup list deleting: "+err.Error())
			break
		}
		if len(assets) == 0 || cleanupDeletingImageStudioAssets(ctx, assets) == 0 {
			break
		}
	}
}

func removeImageStudioAssetRows(ctx context.Context, assets []*model.ImageStudioAsset, deleteRecord bool) int {
	removed := 0
	for _, asset := range assets {
		if err := RemoveImageStudioAsset(asset.StorageKey); err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("image studio cleanup remove %s: %s", asset.StorageKey, err.Error()))
			continue
		}
		if deleteRecord {
			if err := model.DeleteImageStudioAssetRecord(asset.ID); err != nil {
				logger.LogWarn(ctx, fmt.Sprintf("image studio cleanup delete asset %d: %s", asset.ID, err.Error()))
				continue
			}
		} else if asset.Status == model.ImageStudioAssetStatusExpired {
			if err := model.MarkExpiredImageStudioAssetFileRemoved(asset.ID); err != nil {
				logger.LogWarn(ctx, fmt.Sprintf("image studio cleanup finalize expired asset %d: %s", asset.ID, err.Error()))
				continue
			}
		}
		removed++
	}
	return removed
}

func cleanupDeletingImageStudioAssets(ctx context.Context, batch []*model.ImageStudioAsset) int {
	taskIDs := make([]string, 0, len(batch))
	seen := make(map[string]struct{}, len(batch))
	for _, asset := range batch {
		if _, exists := seen[asset.TaskID]; exists {
			continue
		}
		seen[asset.TaskID] = struct{}{}
		taskIDs = append(taskIDs, asset.TaskID)
	}
	assets, err := model.GetImageStudioAssetsByTaskIDs(taskIDs)
	if err != nil {
		logger.LogWarn(ctx, "image studio cleanup expand deleting tasks: "+err.Error())
		return 0
	}
	byTask := make(map[string][]*model.ImageStudioAsset, len(taskIDs))
	for _, asset := range assets {
		byTask[asset.TaskID] = append(byTask[asset.TaskID], asset)
	}
	removed := 0
	for taskID, taskAssets := range byTask {
		storageKeys := make(map[string]struct{}, len(taskAssets))
		for _, asset := range taskAssets {
			if storageKey := strings.TrimSpace(asset.StorageKey); storageKey != "" {
				storageKeys[storageKey] = struct{}{}
			}
		}
		if err := removeImageStudioStorageKeys(taskAssets[0].UserID, taskID, storageKeys); err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("image studio cleanup remove task %s assets: %s", taskID, err.Error()))
			continue
		}
		allRemoved := true
		deleted, deleteErr := model.DeleteUserImageStudioTaskWithAssets(taskAssets[0].UserID, taskID)
		if deleteErr != nil {
			logger.LogWarn(ctx, fmt.Sprintf("image studio cleanup delete task %s: %s", taskID, deleteErr.Error()))
			continue
		}
		if !deleted {
			for _, asset := range taskAssets {
				if err := model.DeleteImageStudioAssetRecord(asset.ID); err != nil {
					logger.LogWarn(ctx, fmt.Sprintf("image studio cleanup delete asset %d: %s", asset.ID, err.Error()))
					allRemoved = false
				}
			}
		}
		if allRemoved {
			removed += len(taskAssets)
		}
	}
	return removed
}
