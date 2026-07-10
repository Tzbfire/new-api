package service

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"image"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

var imageStudioTemporaryStorage = struct {
	sync.Mutex
	reserved int64
}{}

func CreateImageStudioResponseSpool(reserveBytes int64) (*os.File, func(), error) {
	if reserveBytes <= 0 {
		return nil, nil, fmt.Errorf("invalid image studio temporary storage reservation")
	}
	root, err := imageStudioAssetRoot()
	if err != nil {
		return nil, nil, err
	}
	if err := os.MkdirAll(root, 0o750); err != nil {
		return nil, nil, fmt.Errorf("create image studio storage root: %w", err)
	}
	imageStudioTemporaryStorage.Lock()
	usage := common.GetDiskSpaceInfoForPath(root)
	minFreeGB := common.GetEnvOrDefault("IMAGE_STUDIO_MIN_FREE_GB", 2)
	if usage.Total == 0 || minFreeGB < 0 || int64(minFreeGB) > (1<<63-1)/(1<<30) {
		imageStudioTemporaryStorage.Unlock()
		return nil, nil, fmt.Errorf("read image studio temporary disk capacity")
	}
	minFreeBytes := uint64(minFreeGB) * (1 << 30)
	reserved := imageStudioTemporaryStorage.reserved
	if reserved < 0 || uint64(reserved) > usage.Free || uint64(reserveBytes) > usage.Free-uint64(reserved) || minFreeBytes > usage.Free-uint64(reserved)-uint64(reserveBytes) {
		imageStudioTemporaryStorage.Unlock()
		return nil, nil, fmt.Errorf("image studio temporary disk space is below the safety threshold")
	}
	imageStudioTemporaryStorage.reserved += reserveBytes
	imageStudioTemporaryStorage.Unlock()

	var releaseOnce sync.Once
	release := func() {
		releaseOnce.Do(func() {
			imageStudioTemporaryStorage.Lock()
			imageStudioTemporaryStorage.reserved -= reserveBytes
			imageStudioTemporaryStorage.Unlock()
		})
	}
	file, err := os.CreateTemp(root, ".image-studio-response-*.json")
	if err != nil {
		release()
		return nil, nil, fmt.Errorf("create image studio response spool: %w", err)
	}
	return file, release, nil
}

func cleanupImageStudioTemporaryFiles(cutoff time.Time, limit int) (int, error) {
	root, err := imageStudioAssetRoot()
	if err != nil {
		return 0, err
	}
	entries, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	removed := 0
	for _, entry := range entries {
		if limit > 0 && removed >= limit {
			break
		}
		name := entry.Name()
		if entry.IsDir() {
			if name == ".jobs" {
				n, err := cleanupImageStudioJobFiles(filepath.Join(root, name), cutoff, limit-removed)
				removed += n
				if err != nil {
					return removed, err
				}
			}
			continue
		}
		if !strings.HasPrefix(name, ".image-studio-stage-") && !strings.HasPrefix(name, ".image-studio-response-") {
			continue
		}
		info, err := entry.Info()
		if err != nil || !info.ModTime().Before(cutoff) {
			continue
		}
		if err := os.Remove(filepath.Join(root, name)); err != nil && !os.IsNotExist(err) {
			return removed, err
		}
		removed++
	}
	return removed, nil
}

func cleanupImageStudioJobFiles(dir string, cutoff time.Time, limit int) (int, error) {
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	removed := 0
	for _, entry := range entries {
		if limit > 0 && removed >= limit {
			break
		}
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil || !info.ModTime().Before(cutoff) {
			continue
		}
		if err := os.Remove(filepath.Join(dir, entry.Name())); err != nil && !os.IsNotExist(err) {
			return removed, err
		}
		removed++
	}
	return removed, nil
}

// StagedImageStudioAsset keeps decoded image bytes on disk until the complete
// upstream JSON response has been validated. Publish makes the asset visible
// through the same pending ledger used by the in-memory compatibility path.
type StagedImageStudioAsset struct {
	asset     *ImageStudioAsset
	tempPath  string
	root      string
	userID    int
	taskID    string
	index     int
	recordID  int64
	published bool
}

func StageImageStudioAsset(userID int, taskID string, index int, source io.Reader) (*StagedImageStudioAsset, error) {
	if userID <= 0 || strings.TrimSpace(taskID) == "" || index <= 0 || source == nil {
		return nil, fmt.Errorf("invalid image studio asset identity")
	}
	root, err := imageStudioAssetRoot()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0o750); err != nil {
		return nil, fmt.Errorf("create image studio storage root: %w", err)
	}
	temporary, err := os.CreateTemp(root, ".image-studio-stage-*.tmp")
	if err != nil {
		return nil, fmt.Errorf("create image studio staged asset: %w", err)
	}
	tempPath := temporary.Name()
	cleanup := true
	defer func() {
		_ = temporary.Close()
		if cleanup {
			_ = os.Remove(tempPath)
		}
	}()

	maxBytes := ImageStudioMaxAssetBytes()
	if maxBytes <= 0 {
		return nil, fmt.Errorf("image studio asset size limit is invalid")
	}
	hash := sha256.New()
	written, err := io.Copy(io.MultiWriter(temporary, hash), io.LimitReader(source, maxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("decode image studio asset: %w", err)
	}
	if written == 0 {
		return nil, fmt.Errorf("image studio asset is empty")
	}
	if written > maxBytes {
		return nil, fmt.Errorf("image studio asset exceeds maximum size")
	}
	if err := temporary.Sync(); err != nil {
		return nil, fmt.Errorf("sync image studio staged asset: %w", err)
	}
	if _, err := temporary.Seek(0, io.SeekStart); err != nil {
		return nil, fmt.Errorf("rewind image studio staged asset: %w", err)
	}
	header := make([]byte, 512)
	headerSize, err := io.ReadFull(temporary, header)
	if err != nil && err != io.ErrUnexpectedEOF {
		return nil, fmt.Errorf("read image studio asset header: %w", err)
	}
	header = header[:headerSize]
	mimeType := strings.ToLower(strings.TrimSpace(strings.Split(http.DetectContentType(header), ";")[0]))
	extension, allowed := imageStudioAssetExtension(mimeType)
	if !allowed {
		return nil, fmt.Errorf("unsupported image studio asset content type: %s", mimeType)
	}
	if _, err := temporary.Seek(0, io.SeekStart); err != nil {
		return nil, fmt.Errorf("rewind image studio staged asset: %w", err)
	}
	config, _, err := image.DecodeConfig(bufio.NewReader(temporary))
	if err != nil || config.Width <= 0 || config.Height <= 0 {
		return nil, fmt.Errorf("invalid image studio asset: image header cannot be decoded")
	}
	if err := validateImageStudioAssetDimensions(config.Width, config.Height); err != nil {
		return nil, err
	}

	shaHex := hex.EncodeToString(hash.Sum(nil))
	storageKey := strings.Join([]string{
		fmt.Sprintf("user_%d", userID),
		safeImageStudioAssetSegment(taskID),
		fmt.Sprintf("%03d-%s.%s", index, shaHex[:16], extension),
	}, "/")
	cleanup = false
	return &StagedImageStudioAsset{
		asset:    &ImageStudioAsset{StorageKey: storageKey, MimeType: mimeType, SizeBytes: written, SHA256: shaHex},
		tempPath: tempPath,
		root:     root,
		userID:   userID,
		taskID:   taskID,
		index:    index,
	}, nil
}

func (staged *StagedImageStudioAsset) Publish() (*ImageStudioAsset, error) {
	if staged == nil || staged.asset == nil || staged.tempPath == "" || staged.published {
		return nil, fmt.Errorf("invalid image studio staged asset")
	}
	assetRecord := &model.ImageStudioAsset{
		UserID:     staged.userID,
		TaskID:     staged.taskID,
		ImageIndex: staged.index,
		StorageKey: staged.asset.StorageKey,
		MimeType:   staged.asset.MimeType,
		SizeBytes:  staged.asset.SizeBytes,
		SHA256:     staged.asset.SHA256,
		ExpiresAt:  ImageStudioAssetExpiresAt(time.Now()),
	}
	if err := model.CreatePendingImageStudioAsset(assetRecord); err != nil {
		return nil, fmt.Errorf("create image asset record: %w", err)
	}
	removeRecord := true
	defer func() {
		if removeRecord {
			_ = model.DeleteImageStudioAssetRecord(assetRecord.ID)
		}
	}()
	if err := ensureImageStudioStorageCapacity(staged.root, staged.asset); err != nil {
		return nil, err
	}
	fullPath, err := imageStudioAssetPath(staged.root, staged.asset.StorageKey)
	if err != nil {
		return nil, err
	}
	directory := filepath.Dir(fullPath)
	if err := os.MkdirAll(directory, 0o750); err != nil {
		return nil, fmt.Errorf("create image studio asset directory: %w", err)
	}
	if err := os.Rename(staged.tempPath, fullPath); err != nil {
		return nil, fmt.Errorf("finalize image studio asset: %w", err)
	}
	if directoryHandle, openErr := os.Open(directory); openErr == nil {
		syncErr := directoryHandle.Sync()
		_ = directoryHandle.Close()
		if syncErr != nil {
			_ = os.Remove(fullPath)
			return nil, fmt.Errorf("sync image studio asset directory: %w", syncErr)
		}
	}
	staged.published = true
	staged.recordID = assetRecord.ID
	staged.tempPath = ""
	removeRecord = false
	return staged.asset, nil
}

func (staged *StagedImageStudioAsset) Discard() {
	if staged == nil || staged.tempPath == "" {
		return
	}
	_ = os.Remove(staged.tempPath)
	staged.tempPath = ""
}
