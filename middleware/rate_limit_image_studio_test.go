package middleware

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestImageStudioEstimateRequestsDoNotConsumeSubmitLimit(t *testing.T) {
	const legacySharedLimit = 20

	gin.SetMode(gin.TestMode)
	previousRedisEnabled := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() {
		common.RedisEnabled = previousRedisEnabled
	})

	estimateLimit := ImageStudioEstimateRateLimit()
	for range legacySharedLimit + 1 {
		context, _ := gin.CreateTestContext(httptest.NewRecorder())
		context.Set("id", 900001)
		estimateLimit(context)
		require.False(t, context.IsAborted())
	}

	submitContext, _ := gin.CreateTestContext(httptest.NewRecorder())
	submitContext.Set("id", 900001)
	ImageStudioSubmitRateLimit()(submitContext)
	require.False(t, submitContext.IsAborted())
}
