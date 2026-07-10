package middleware

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relay/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestImageStudioGenerationReadsGroupAndNormalizesPath(t *testing.T) {
	gin.SetMode(gin.TestMode)
	body := []byte(`{"model":"gpt-image-1","prompt":"cat","group":"vip"}`)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/pg/image-studio/generations", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	storage, err := common.CreateBodyStorage(body)
	require.NoError(t, err)
	c.Set(common.KeyBodyStorage, storage)
	t.Cleanup(func() { common.CleanupBodyStorage(c) })

	request, shouldSelect, err := getModelRequest(c)
	require.NoError(t, err)
	assert.True(t, shouldSelect)
	assert.Equal(t, "gpt-image-1", request.Model)
	assert.Equal(t, "vip", request.Group)
	assert.Equal(t, constant.RelayModeImagesGenerations, c.GetInt("relay_mode"))
	assert.Equal(t, "/v1/images/generations", constant.NormalizeRequestPath(c.Request.URL.Path))
}
