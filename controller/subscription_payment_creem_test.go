package controller

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type creemCheckoutCapture struct {
	Request *http.Request
	Body    []byte
}

func (capture *creemCheckoutCapture) RoundTrip(req *http.Request) (*http.Response, error) {
	body, err := io.ReadAll(req.Body)
	if err != nil {
		return nil, err
	}
	capture.Request = req
	capture.Body = body
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(`{"checkout_url":"https://checkout.example.com/test","id":"checkout_test"}`)),
		Request:    req,
	}, nil
}

func captureCreemCheckoutForTest(t *testing.T) *creemCheckoutCapture {
	t.Helper()
	originalTransport := http.DefaultTransport
	originalAPIKey := setting.CreemApiKey
	originalTestMode := setting.CreemTestMode
	originalWebhookSecret := setting.CreemWebhookSecret
	t.Cleanup(func() {
		http.DefaultTransport = originalTransport
		setting.CreemApiKey = originalAPIKey
		setting.CreemTestMode = originalTestMode
		setting.CreemWebhookSecret = originalWebhookSecret
	})
	capture := &creemCheckoutCapture{}
	http.DefaultTransport = capture
	setting.CreemApiKey = "creem_test_key"
	setting.CreemTestMode = false
	setting.CreemWebhookSecret = "creem_test_webhook_secret"
	return capture
}

func TestSubscriptionCreemCheckoutKeepsPlanTitleLocal(t *testing.T) {
	db := openPublicSubscriptionPlanTestDB(t)
	confirmPaymentComplianceForTest(t)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.SubscriptionOrder{}))
	user := model.User{Username: "creem-test-user", Email: "buyer@example.com"}
	require.NoError(t, db.Create(&user).Error)
	plan := model.SubscriptionPlan{
		Title:          "Internal subscription title 保密套餐",
		Enabled:        true,
		PriceAmount:    12.5,
		CreemProductId: "prod_subscription_test",
	}
	require.NoError(t, db.Create(&plan).Error)
	model.InvalidateSubscriptionPlanCache(plan.Id)
	t.Cleanup(func() { model.InvalidateSubscriptionPlanCache(plan.Id) })
	capture := captureCreemCheckoutForTest(t)

	body, err := common.Marshal(SubscriptionCreemPayRequest{PlanId: plan.Id})
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/subscription/creem/pay", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("id", user.Id)
	SubscriptionRequestCreemPay(c)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Message string `json:"message"`
		Data    struct {
			CheckoutURL string `json:"checkout_url"`
			OrderID     string `json:"order_id"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.Equal(t, "success", response.Message)
	assert.Equal(t, "https://checkout.example.com/test", response.Data.CheckoutURL)
	require.NotNil(t, capture.Request)
	assert.Equal(t, http.MethodPost, capture.Request.Method)
	assert.Equal(t, "https://api.creem.io/v1/checkouts", capture.Request.URL.String())
	var checkout CreemCheckoutRequest
	require.NoError(t, common.Unmarshal(capture.Body, &checkout))
	assert.Equal(t, plan.CreemProductId, checkout.ProductId)
	assert.Equal(t, user.Email, checkout.Customer.Email)
	assert.Equal(t, response.Data.OrderID, checkout.RequestId)
	assert.Equal(t, response.Data.OrderID, checkout.Metadata["reference_id"])
	assert.Equal(t, "TUC12.50", checkout.Metadata["product_name"])
	assert.NotContains(t, string(capture.Body), plan.Title)

	var order model.SubscriptionOrder
	require.NoError(t, db.Where("trade_no = ?", checkout.RequestId).First(&order).Error)
	assert.Equal(t, plan.Id, order.PlanId)
	assert.Equal(t, user.Id, order.UserId)
	assert.Equal(t, plan.PriceAmount, order.Money)
	assert.Equal(t, model.PaymentProviderCreem, order.PaymentProvider)
	assert.Equal(t, common.TopUpStatusPending, order.Status)
	var storedPlan model.SubscriptionPlan
	require.NoError(t, db.First(&storedPlan, plan.Id).Error)
	assert.Equal(t, plan.Title, storedPlan.Title)
}

func TestCreemWalletCheckoutPreservesProductMetadata(t *testing.T) {
	capture := captureCreemCheckoutForTest(t)
	product := &CreemProduct{
		ProductId: "prod_wallet_test",
		Name:      "Wallet credits",
		Quota:     100,
	}
	checkoutURL, err := genCreemLink(context.Background(), "ref_wallet_test", product, "buyer@example.com", "wallet-user")
	require.NoError(t, err)
	assert.Equal(t, "https://checkout.example.com/test", checkoutURL)
	require.NotNil(t, capture.Request)
	var checkout CreemCheckoutRequest
	require.NoError(t, common.Unmarshal(capture.Body, &checkout))
	assert.Equal(t, product.ProductId, checkout.ProductId)
	assert.Equal(t, "ref_wallet_test", checkout.RequestId)
	assert.Equal(t, map[string]string{
		"username":     "wallet-user",
		"reference_id": "ref_wallet_test",
		"product_name": "Wallet credits",
		"quota":        "100",
	}, checkout.Metadata)
}
