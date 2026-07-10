package middleware

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func CORS() gin.HandlerFunc {
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowCredentials = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"*"}
	return cors.New(config)
}

func PublicAssetCORS() gin.HandlerFunc {
	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowCredentials = false
	config.AllowMethods = []string{"GET", "HEAD", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Range", "If-None-Match"}
	config.ExposeHeaders = []string{"Content-Length", "Content-Range", "ETag"}
	return cors.New(config)
}

func Version() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-New-Api-Version", common.Version)
		c.Next()
	}
}
