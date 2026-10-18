package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newPublicPlansTestEngine() *gin.Engine {
	engine := gin.New()
	engine.Use(sessions.Sessions("session", cookie.NewStore([]byte("public-plans-test"))))
	SetApiRouter(engine)
	return engine
}

func setPublicPlansHeaderNavModules(t *testing.T, value string) {
	t.Helper()
	common.OptionMapRWMutex.Lock()
	mapWasNil := common.OptionMap == nil
	previous, hadPrevious := common.OptionMap["HeaderNavModules"]
	if mapWasNil {
		common.OptionMap = map[string]string{}
	}
	common.OptionMap["HeaderNavModules"] = value
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		defer common.OptionMapRWMutex.Unlock()
		if mapWasNil {
			common.OptionMap = nil
		} else if hadPrevious {
			common.OptionMap["HeaderNavModules"] = previous
		} else {
			delete(common.OptionMap, "HeaderNavModules")
		}
	})
}

func TestPublicSubscriptionPlansRouteIsAnonymous(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setPublicPlansHeaderNavModules(t, "")
	paymentSetting := operation_setting.GetPaymentSetting()
	previousConfirmed := paymentSetting.ComplianceConfirmed
	previousVersion := paymentSetting.ComplianceTermsVersion
	t.Cleanup(func() {
		paymentSetting.ComplianceConfirmed = previousConfirmed
		paymentSetting.ComplianceTermsVersion = previousVersion
	})
	paymentSetting.ComplianceConfirmed = false
	paymentSetting.ComplianceTermsVersion = ""

	engine := newPublicPlansTestEngine()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/subscription/public-plans", nil)
	engine.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool  `json:"success"`
		Data    []any `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.True(t, response.Success)
	assert.Empty(t, response.Data)
}

func TestPublicSubscriptionPlansRouteHonorsDisabledPricing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setPublicPlansHeaderNavModules(t, `{"pricing":{"enabled":false,"requireAuth":false}}`)

	engine := newPublicPlansTestEngine()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/subscription/public-plans", nil)
	engine.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusForbidden, recorder.Code)
}
