package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSubscriptionRequestEpayKeepsPlanTitleLocal(t *testing.T) {
	db := openPublicSubscriptionPlanTestDB(t)
	confirmPaymentComplianceForTest(t)
	require.NoError(t, db.AutoMigrate(&model.SubscriptionOrder{}))

	previousAddress := operation_setting.PayAddress
	previousID := operation_setting.EpayId
	previousKey := operation_setting.EpayKey
	previousMethods := operation_setting.PayMethods
	previousCallback := operation_setting.CustomCallbackAddress
	t.Cleanup(func() {
		operation_setting.PayAddress = previousAddress
		operation_setting.EpayId = previousID
		operation_setting.EpayKey = previousKey
		operation_setting.PayMethods = previousMethods
		operation_setting.CustomCallbackAddress = previousCallback
	})
	operation_setting.PayAddress = "https://pay.example.com"
	operation_setting.EpayId = "test_merchant"
	operation_setting.EpayKey = "test_key"
	operation_setting.PayMethods = []map[string]string{{"type": "alipay"}}
	operation_setting.CustomCallbackAddress = "https://gateway.example.com"

	plan := model.SubscriptionPlan{Title: "Private premium plan", Enabled: true, PriceAmount: 19.95}
	require.NoError(t, db.Create(&plan).Error)
	model.InvalidateSubscriptionPlanCache(plan.Id)
	t.Cleanup(func() { model.InvalidateSubscriptionPlanCache(plan.Id) })

	body, err := common.Marshal(SubscriptionEpayPayRequest{PlanId: plan.Id, PaymentMethod: "alipay"})
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("id", 42)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/subscription/epay/pay", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	SubscriptionRequestEpay(c)

	var response struct {
		Message string            `json:"message"`
		Data    map[string]string `json:"data"`
		URL     string            `json:"url"`
	}
	require.Equal(t, http.StatusOK, recorder.Code)
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.Equal(t, "success", response.Message)
	assert.Equal(t, "https://pay.example.com/submit.php", response.URL)
	assert.Equal(t, "TUC19.95", response.Data["name"])
	assert.NotContains(t, recorder.Body.String(), plan.Title)
	assert.Equal(t, "19.95", response.Data["money"])
	assert.Equal(t, "alipay", response.Data["type"])
	assert.Equal(t, "https://gateway.example.com/api/subscription/epay/notify", response.Data["notify_url"])
	assert.Equal(t, "https://gateway.example.com/api/subscription/epay/return", response.Data["return_url"])

	client := GetEpayClient()
	require.NotNil(t, client)
	verified, err := client.Verify(response.Data)
	require.NoError(t, err)
	assert.True(t, verified.VerifyStatus)

	order := model.GetSubscriptionOrderByTradeNo(response.Data["out_trade_no"])
	require.NotNil(t, order)
	assert.Equal(t, plan.Id, order.PlanId)
	assert.Equal(t, 42, order.UserId)
	assert.Equal(t, plan.PriceAmount, order.Money)
	assert.Equal(t, model.PaymentProviderEpay, order.PaymentProvider)
	assert.Equal(t, common.TopUpStatusPending, order.Status)
	var storedPlan model.SubscriptionPlan
	require.NoError(t, db.First(&storedPlan, plan.Id).Error)
	assert.Equal(t, plan.Title, storedPlan.Title)
}
