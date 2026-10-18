package common

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenRelayInfoMarksDurableAsyncAsPlayground(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)
	c.Request = req
	c.Set("id", 1)
	c.Set(string(constant.ContextKeyUserGroup), "default")
	c.Set(string(constant.ContextKeyUsingGroup), "default")
	c.Set("durable_async_billing", true)

	info, err := GenRelayInfo(c, types.RelayFormatOpenAIImage, nil, nil)
	require.NoError(t, err)
	require.NotNil(t, info)
	assert.True(t, info.IsPlayground, "durable image-studio workers must skip token quota lookups")
}
