package controller

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type waffoPancakeProductTransport func(*http.Request) (*http.Response, error)

func (transport waffoPancakeProductTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return transport(req)
}

func TestCreateWaffoPancakeSubscriptionProductUsesPriceName(t *testing.T) {
	originalClient := http.DefaultClient
	originalMerchantID := setting.WaffoPancakeMerchantID
	originalPrivateKey := setting.WaffoPancakePrivateKey
	originalStoreID := setting.WaffoPancakeStoreID
	originalReturnURL := setting.WaffoPancakeReturnURL
	t.Cleanup(func() {
		http.DefaultClient = originalClient
		setting.WaffoPancakeMerchantID = originalMerchantID
		setting.WaffoPancakePrivateKey = originalPrivateKey
		setting.WaffoPancakeStoreID = originalStoreID
		setting.WaffoPancakeReturnURL = originalReturnURL
	})

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	setting.WaffoPancakeMerchantID = "MER_AbCdEfGhIjKlMnOpQrStUv"
	setting.WaffoPancakePrivateKey = string(pem.EncodeToMemory(&pem.Block{
		Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
	}))
	setting.WaffoPancakeStoreID = "STO_AbCdEfGhIjKlMnOpQrStUv"
	setting.WaffoPancakeReturnURL = "https://gateway.example/wallet"

	for _, tc := range []struct {
		name           string
		body           string
		expectedAmount string
	}{
		{name: "price without local title", body: `{"amount":"29.90"}`, expectedAmount: "29.90"},
		{name: "legacy client title is ignored", body: `{"name":"Private Premium Plan","amount":"29.90"}`, expectedAmount: "29.90"},
		{name: "whole price has two decimals", body: `{"amount":"29"}`, expectedAmount: "29.00"},
		{name: "short decimal is normalized", body: `{"amount":"29.9"}`, expectedAmount: "29.90"},
		{name: "price and name use the same rounded cents", body: `{"amount":"29.999"}`, expectedAmount: "30.00"},
		{name: "non-numeric price cannot leak a title", body: `{"amount":"Private Premium Plan"}`},
		{name: "NaN price rejected", body: `{"amount":"NaN"}`},
		{name: "infinite price rejected", body: `{"amount":"+Inf"}`},
		{name: "zero price rejected", body: `{"amount":"0"}`},
		{name: "negative price rejected", body: `{"amount":"-1"}`},
		{name: "price rounding to zero rejected", body: `{"amount":"0.004"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var paths []string
			http.DefaultClient = &http.Client{Transport: waffoPancakeProductTransport(func(req *http.Request) (*http.Response, error) {
				require.NotEmpty(t, tc.expectedAmount, "invalid prices must be rejected before any provider request")
				paths = append(paths, req.URL.Path)
				assert.Equal(t, http.MethodPost, req.Method)
				body, err := io.ReadAll(req.Body)
				require.NoError(t, err)
				assert.NotContains(t, string(body), "Private Premium Plan")
				switch req.URL.Path {
				case "/v1/actions/onetime-product/create-product":
					assert.JSONEq(t, fmt.Sprintf(`{"storeId":"STO_AbCdEfGhIjKlMnOpQrStUv","name":"TUC%s","prices":{"USD":{"amount":"%s","taxCategory":"saas"}},"successUrl":"https://gateway.example/wallet"}`, tc.expectedAmount, tc.expectedAmount), string(body))
				case "/v1/actions/onetime-product/publish-product":
					assert.JSONEq(t, `{"id":"PROD_AbCdEfGhIjKlMnOpQrStUv"}`, string(body))
				default:
					require.FailNow(t, "unexpected provider request path", "%s", req.URL.Path)
				}
				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     http.Header{"Content-Type": {"application/json"}},
					Body:       io.NopCloser(strings.NewReader(`{"data":{"product":{"id":"PROD_AbCdEfGhIjKlMnOpQrStUv"}}}`)),
					Request:    req,
				}, nil
			})}

			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(http.MethodPost, "/api/option/waffo-pancake/subscription-product", strings.NewReader(tc.body))
			ctx.Request.Header.Set("Content-Type", "application/json")
			CreateWaffoPancakeSubscriptionProduct(ctx)

			assert.Equal(t, http.StatusOK, recorder.Code)
			if tc.expectedAmount == "" {
				assert.JSONEq(t, `{"message":"error","data":"创建套餐产品失败"}`, recorder.Body.String())
				assert.Empty(t, paths)
				return
			}
			assert.JSONEq(t, fmt.Sprintf(`{"message":"success","data":{"product_id":"PROD_AbCdEfGhIjKlMnOpQrStUv","product_name":"TUC%s","store_id":"STO_AbCdEfGhIjKlMnOpQrStUv"}}`, tc.expectedAmount), recorder.Body.String())
			assert.Equal(t, []string{
				"/v1/actions/onetime-product/create-product",
				"/v1/actions/onetime-product/publish-product",
			}, paths)
		})
	}
}

func TestFormatWaffoPancakeAmount_UsesDisplayPriceString(t *testing.T) {
	testCases := []struct {
		name     string
		amount   float64
		expected string
	}{
		{name: "whole amount", amount: 29, expected: "29.00"},
		{name: "decimal amount", amount: 29.9, expected: "29.90"},
		{name: "round half up to cents", amount: 29.999, expected: "30.00"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.expected, formatWaffoPancakeAmount(tc.amount))
		})
	}
}

func TestGetWaffoPancakePayMoney(t *testing.T) {
	originalUnitPrice := setting.WaffoPancakeUnitPrice
	originalQuotaDisplayType := operation_setting.GetGeneralSetting().QuotaDisplayType
	originalDiscounts := make(map[int]float64, len(operation_setting.GetPaymentSetting().AmountDiscount))
	for k, v := range operation_setting.GetPaymentSetting().AmountDiscount {
		originalDiscounts[k] = v
	}
	originalTopupGroupRatio := common.TopupGroupRatio2JSONString()

	t.Cleanup(func() {
		setting.WaffoPancakeUnitPrice = originalUnitPrice
		operation_setting.GetGeneralSetting().QuotaDisplayType = originalQuotaDisplayType
		operation_setting.GetPaymentSetting().AmountDiscount = originalDiscounts
		require.NoError(t, common.UpdateTopupGroupRatioByJSONString(originalTopupGroupRatio))
	})

	setting.WaffoPancakeUnitPrice = 2.5
	operation_setting.GetPaymentSetting().AmountDiscount = map[int]float64{
		10:                           0.8,
		int(common.QuotaPerUnit * 3): 0.5,
		20:                           0,
	}
	require.NoError(t, common.UpdateTopupGroupRatioByJSONString(`{"default":1,"vip":1.2}`))

	testCases := []struct {
		name             string
		amount           int64
		group            string
		quotaDisplayType string
		expected         float64
	}{
		{
			name:             "currency display applies unit price group ratio and discount",
			amount:           10,
			group:            "vip",
			quotaDisplayType: operation_setting.QuotaDisplayTypeUSD,
			expected:         24,
		},
		{
			name:             "tokens display converts quota to display units before pricing",
			amount:           int64(common.QuotaPerUnit * 3),
			group:            "vip",
			quotaDisplayType: operation_setting.QuotaDisplayTypeTokens,
			expected:         4.5,
		},
		{
			name:             "non-positive discount falls back to no discount",
			amount:           20,
			group:            "default",
			quotaDisplayType: operation_setting.QuotaDisplayTypeUSD,
			expected:         50,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			operation_setting.GetGeneralSetting().QuotaDisplayType = tc.quotaDisplayType
			actual := getWaffoPancakePayMoney(tc.amount, tc.group)
			require.InDelta(t, tc.expected, actual, 0.000001)
		})
	}
}
