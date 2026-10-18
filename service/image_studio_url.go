package service

import (
	"crypto/hmac"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const (
	imageStudioURLSignatureVersion = "v1"
	imageStudioURLBucketSize       = 6 * time.Hour
	imageStudioURLLifetime         = 24 * time.Hour
)

func ImageStudioBaseURL() string {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap["ImageStudioBaseURL"]
	common.OptionMapRWMutex.RUnlock()
	normalized, err := NormalizeImageStudioBaseURL(raw)
	if err != nil {
		return ""
	}
	return normalized
}

func NormalizeImageStudioBaseURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	parsed, err := url.ParseRequestURI(raw)
	if err != nil || !parsed.IsAbs() || parsed.Host == "" || parsed.Hostname() == "" {
		return "", errors.New("base URL must be an absolute URL")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != "" && parsed.Path != "/" {
		return "", errors.New("base URL must not contain credentials, a path, query, or fragment")
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "https" && !(scheme == "http" && isImageStudioLoopbackHost(parsed.Hostname())) {
		return "", errors.New("base URL must use HTTPS; HTTP is allowed only for localhost")
	}
	return scheme + "://" + parsed.Host, nil
}

func ImageStudioAssetURL(assetID int64, now time.Time) (string, string) {
	if assetID <= 0 {
		return "", ""
	}
	expiresAt := now.UTC().Truncate(imageStudioURLBucketSize).Add(imageStudioURLLifetime).Unix()
	signature := common.GenerateHMAC(imageStudioURLSignaturePayload(assetID, expiresAt))
	path := fmt.Sprintf("/api/image-studio/assets/%d/%d/%s", assetID, expiresAt, signature)
	baseURL := ImageStudioBaseURL()
	return baseURL + path, baseURL + path + "/download"
}

func ValidateImageStudioAssetURL(assetID int64, expiresAt int64, signature string, now time.Time) bool {
	if assetID <= 0 || expiresAt <= now.Unix() || strings.TrimSpace(signature) == "" {
		return false
	}
	expected := common.GenerateHMAC(imageStudioURLSignaturePayload(assetID, expiresAt))
	return hmac.Equal([]byte(expected), []byte(signature))
}

func imageStudioURLSignaturePayload(assetID int64, expiresAt int64) string {
	return strings.Join([]string{
		"image-studio",
		imageStudioURLSignatureVersion,
		strconv.FormatInt(assetID, 10),
		strconv.FormatInt(expiresAt, 10),
	}, ":")
}

func isImageStudioLoopbackHost(host string) bool {
	if strings.EqualFold(strings.TrimSuffix(host, "."), "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
