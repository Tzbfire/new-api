package service

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// EnsureImageStudioStorageReady verifies the studio storage root is writable.
// Called at worker start and before staging so misconfiguration fails fast.
func EnsureImageStudioStorageReady() error {
	root, err := imageStudioAssetRoot()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(root, ".jobs"), 0o750); err != nil {
		return fmt.Errorf("image studio storage is not writable: %w", err)
	}
	probe := filepath.Join(root, ".jobs", ".write-probe")
	if err := os.WriteFile(probe, []byte("ok"), 0o640); err != nil {
		return fmt.Errorf("image studio storage is not writable: %w", err)
	}
	_ = os.Remove(probe)
	return nil
}

// StageImageStudioJobBody persists the rebuilt per-image request body so a
// QUEUED task remains executable after process restart.
func StageImageStudioJobBody(taskID string, contentType string, body []byte) (string, error) {
	if err := EnsureImageStudioStorageReady(); err != nil {
		return "", err
	}
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return "", fmt.Errorf("image studio job task id is required")
	}
	root, err := imageStudioAssetRoot()
	if err != nil {
		return "", err
	}
	key := filepath.ToSlash(filepath.Join(".jobs", safeImageStudioAssetSegment(taskID)))
	bodyPath := filepath.Join(root, filepath.FromSlash(key)+".body")
	metaPath := filepath.Join(root, filepath.FromSlash(key)+".meta")
	if err := os.MkdirAll(filepath.Dir(bodyPath), 0o750); err != nil {
		return "", fmt.Errorf("create image studio job dir: %w", err)
	}
	if err := os.WriteFile(bodyPath, body, 0o640); err != nil {
		return "", fmt.Errorf("write image studio job body: %w", err)
	}
	if err := os.WriteFile(metaPath, []byte(strings.TrimSpace(contentType)), 0o640); err != nil {
		_ = os.Remove(bodyPath)
		return "", fmt.Errorf("write image studio job meta: %w", err)
	}
	return key, nil
}

// LoadImageStudioJobBody reads a staged studio request body.
func LoadImageStudioJobBody(key string) (contentType string, body []byte, err error) {
	root, err := imageStudioAssetRoot()
	if err != nil {
		return "", nil, err
	}
	key = strings.TrimSpace(key)
	if key == "" || strings.Contains(key, "..") {
		return "", nil, fmt.Errorf("invalid image studio job key")
	}
	body, err = os.ReadFile(filepath.Join(root, key+".body"))
	if err != nil {
		return "", nil, err
	}
	meta, err := os.ReadFile(filepath.Join(root, key+".meta"))
	if err != nil {
		return "", nil, err
	}
	return string(meta), body, nil
}

// RemoveImageStudioJobBody deletes staged request bytes. Missing files are OK.
func RemoveImageStudioJobBody(key string) {
	key = strings.TrimSpace(key)
	if key == "" || strings.Contains(key, "..") {
		return
	}
	root, err := imageStudioAssetRoot()
	if err != nil {
		return
	}
	_ = os.Remove(filepath.Join(root, key+".body"))
	_ = os.Remove(filepath.Join(root, key+".meta"))
}
