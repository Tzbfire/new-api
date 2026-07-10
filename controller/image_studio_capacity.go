package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const (
	imageStudioDefaultConcurrency = constant.ImageStudioDefaultBatchConcurrency
	imageStudioMaxBatchBodySize   = 64 * 1024 * 1024
	imageStudioGlobalConcurrency  = constant.ImageStudioMaxBatchConcurrency
)

func imageStudioMaxResponseBytes() int64 {
	return ((service.ImageStudioMaxAssetBytes() + 2) / 3 * 4) + 1024*1024
}

func imageStudioBatchConcurrency() int {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap["ImageStudioBatchConcurrency"]
	common.OptionMapRWMutex.RUnlock()
	concurrency, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		concurrency = imageStudioDefaultConcurrency
	}
	if concurrency < 1 {
		return 1
	}
	if concurrency > imageStudioGlobalConcurrency {
		return imageStudioGlobalConcurrency
	}
	return concurrency
}

// ImageStudioRequestBudget only bounds the inbound request body. Durable jobs
// store rebuilt bodies on disk, so process-local memory accounting is no longer
// part of the queue design.
func ImageStudioRequestBudget() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.ContentLength > imageStudioMaxBatchBodySize {
			c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, gin.H{"error": gin.H{"message": "批量图片请求体过大，请减少图片数量或上传文件大小", "type": "invalid_request_error"}})
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, imageStudioMaxBatchBodySize)
		c.Next()
	}
}
