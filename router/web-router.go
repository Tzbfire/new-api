package router

import (
	"embed"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
)

// WebAssets holds the embedded dashboard frontend assets.
type WebAssets struct {
	BuildFS   embed.FS
	IndexPage []byte
}

func SetWebRouter(router *gin.Engine, assets WebAssets, pluginDispatcher gin.HandlerFunc) {
	frontendFS := common.EmbedFolder(assets.BuildFS, "web/dist")
	compress := gzip.Gzip(gzip.DefaultCompression)

	router.NoRoute(
		pluginDispatcher,
		middleware.RouteTag("web"),
		func(c *gin.Context) {
			// ServeFrontendFiles sends build files already compressed.
			if !frontendFS.Exists("/", c.Request.URL.Path) {
				compress(c)
			}
		},
		middleware.AccessTokenAudit(),
		middleware.GlobalWebRateLimit(frontendFS),
		serveConsumerFrontend(assets.IndexPage),
		func(c *gin.Context) {
			file, err := frontendFS.Open(c.Request.URL.Path)
			if err != nil {
				return
			}
			defer file.Close()
			info, err := file.Stat()
			if err == nil && info.IsDir() {
				c.AbortWithStatus(http.StatusNotFound)
			}
		},
		middleware.Cache(),
		middleware.ServeFrontendFiles(frontendFS),
		serveRetainedLegacyAssets,
		func(c *gin.Context) { controller.RelayNotFound(c) },
	)
}
