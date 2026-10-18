package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const (
	imageStudioBrowserCacheSeconds = int64(300)
	imageStudioEdgeCacheSeconds    = int64(900)
)

// GetPublicImageStudioAsset serves a single capability URL. Authentication is
// carried by the expiring HMAC signature, so native image and CDN requests do
// not need dashboard cookies or API headers.
func GetPublicImageStudioAsset(c *gin.Context) {
	// Always attach CORS/CORP headers on this handler (including errors).
	// gin-contrib/cors only emits ACAO when Origin is present; CDN edge caches
	// often revalidate or serve the first no-Origin response, which then breaks
	// <img crossorigin="anonymous"> and credential-less fetch from other entry domains.
	applyImageStudioPublicAssetHeaders(c)

	assetID, assetIDErr := strconv.ParseInt(c.Param("asset_id"), 10, 64)
	expiresAt, expiresErr := strconv.ParseInt(c.Param("expires"), 10, 64)
	now := time.Now()
	if assetIDErr != nil || expiresErr != nil || !service.ValidateImageStudioAssetURL(assetID, expiresAt, c.Param("signature"), now) {
		imageStudioContentError(c, http.StatusNotFound, "image content not found")
		return
	}

	asset, exists, err := model.GetImageStudioAssetByID(assetID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !exists || asset == nil || asset.Status != model.ImageStudioAssetStatusReady || asset.ExpiresAt > 0 && asset.ExpiresAt <= now.Unix() {
		imageStudioContentError(c, http.StatusNotFound, "image content not found")
		return
	}
	if err := service.ValidateImageStudioAssetOwnership(asset.StorageKey, asset.UserID, asset.TaskID); err != nil {
		logger.LogWarn(c.Request.Context(), fmt.Sprintf("reject signed image studio asset id=%d: %s", asset.ID, err.Error()))
		imageStudioContentError(c, http.StatusNotFound, "image content not found")
		return
	}
	file, info, err := service.OpenImageStudioAsset(asset.StorageKey, asset.SizeBytes)
	if err != nil {
		logger.LogWarn(c.Request.Context(), fmt.Sprintf("read signed image studio asset id=%d: %s", asset.ID, err.Error()))
		imageStudioContentError(c, http.StatusNotFound, "image content not found")
		return
	}
	defer file.Close()

	remaining := expiresAt - now.Unix()
	if asset.ExpiresAt > 0 && asset.ExpiresAt-now.Unix() < remaining {
		remaining = asset.ExpiresAt - now.Unix()
	}
	edgeTTL := min(remaining, imageStudioEdgeCacheSeconds)
	browserTTL := min(edgeTTL, imageStudioBrowserCacheSeconds)
	c.Header("Cache-Control", fmt.Sprintf("public, max-age=%d, s-maxage=%d, must-revalidate", browserTTL, edgeTTL))
	c.Header("Content-Security-Policy", "default-src 'none'")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Type", asset.MimeType)
	c.Header("ETag", `"`+asset.SHA256+`"`)
	if strings.HasSuffix(c.Request.URL.Path, "/download") {
		c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="image-%d%s"`, asset.ID, imageStudioMimeExtension(asset.MimeType)))
	}
	if c.GetHeader("If-None-Match") == `"`+asset.SHA256+`"` {
		c.Status(http.StatusNotModified)
		return
	}
	http.ServeContent(c.Writer, c.Request, "", info.ModTime(), file)
}

// applyImageStudioPublicAssetHeaders makes signed image URLs safe to load from any
// site entry (domestic CDN page + Cloudflare image host, etc.). Headers are
// intentional on every response so edge caches never store a CORS-less body.
func applyImageStudioPublicAssetHeaders(c *gin.Context) {
	c.Header("Access-Control-Allow-Origin", "*")
	c.Header("Access-Control-Expose-Headers", "Content-Length, Content-Range, ETag")
	c.Header("Cross-Origin-Resource-Policy", "cross-origin")
	c.Header("Referrer-Policy", "no-referrer")
}
