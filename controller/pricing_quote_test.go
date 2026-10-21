package controller

import (
	"encoding/base64"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPricingQuotePublicGateUsesIPRateLimitWithoutRequiringUser(t *testing.T) {
	previousRedis, previousAPIEnabled, previousSearchEnabled := common.RedisEnabled, common.GlobalApiRateLimitEnable, common.SearchRateLimitEnable
	previousLimit, previousDuration := common.GlobalApiRateLimitNum, common.GlobalApiRateLimitDuration
	common.RedisEnabled, common.GlobalApiRateLimitEnable, common.SearchRateLimitEnable = false, true, true
	common.GlobalApiRateLimitNum, common.GlobalApiRateLimitDuration = 2, 60
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	previousNav, hadNav := common.OptionMap["HeaderNavModules"]
	common.OptionMap["HeaderNavModules"] = `{"pricing":{"enabled":true,"requireAuth":false}}`
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.RedisEnabled, common.GlobalApiRateLimitEnable, common.SearchRateLimitEnable = previousRedis, previousAPIEnabled, previousSearchEnabled
		common.GlobalApiRateLimitNum, common.GlobalApiRateLimitDuration = previousLimit, previousDuration
		common.OptionMapRWMutex.Lock()
		defer common.OptionMapRWMutex.Unlock()
		if hadNav {
			common.OptionMap["HeaderNavModules"] = previousNav
		} else {
			delete(common.OptionMap, "HeaderNavModules")
		}
	})
	router := gin.New()
	router.GET("/api/pricing/quote", middleware.GlobalAPIRateLimit(), middleware.HeaderNavModuleAuth("pricing"), GetPricingQuote)
	for index, expected := range []int{http.StatusBadRequest, http.StatusBadRequest, http.StatusTooManyRequests} {
		recorder := httptest.NewRecorder()
		// Invalid quantity intentionally reaches the real controller without
		// requiring a pricing database fixture. SearchRateLimit would return 401.
		request := httptest.NewRequest(http.MethodGet, "/api/pricing/quote?image_count=0", nil)
		request.RemoteAddr = "192.0.2.198:42000"
		router.ServeHTTP(recorder, request)
		assert.Equal(t, expected, recorder.Code, "request %d", index+1)
		if expected == http.StatusBadRequest {
			assert.Contains(t, recorder.Body.String(), "Invalid parameters")
		} else {
			assert.NotEmpty(t, recorder.Header().Get("Retry-After"))
		}
	}
}

func TestPricingQuoteUsesCanonicalExpressionAndGroupPrice(t *testing.T) {
	previous := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = previous })
	for _, tc := range []struct {
		name       string
		pricing    model.Pricing
		scenario   pricingQuoteScenario
		ratio, usd float64
		unit, tier string
	}{
		{"token tier", model.Pricing{BillingMode: "tiered_expr", BillingExpr: `len > 2000 ? tier("long", p * 4 + c * 10) : tier("base", p * 2 + c * 5)`}, pricingQuoteScenario{3000, 1000, 1}, 2, .044, "token", "long"},
		{"free fixed", model.Pricing{BillingMode: "tiered_expr", BillingExpr: `tier("free", fixed(0))`}, pricingQuoteScenario{1000, 1000, 1}, 2, 0, "request", "free"},
		{"image quantity", model.Pricing{BillingMode: "tiered_expr", BillingExpr: `tier("image", fixed(0.04)) * image_count`}, pricingQuoteScenario{0, 0, 3}, 1.5, .18, "request", "image"},
		{"legacy text", model.Pricing{ModelRatio: 1, CompletionRatio: 3}, pricingQuoteScenario{1000, 1000, 1}, 2, .016, "token", ""},
		{"legacy request", model.Pricing{QuotaType: 1, ModelPrice: .04}, pricingQuoteScenario{1000, 1000, 1}, 1.5, .06, "request", ""},
		{"legacy minimum charge", model.Pricing{ModelRatio: .01, CompletionRatio: 1}, pricingQuoteScenario{1, 0, 1}, 1, .000002, "token", ""},
		{"legacy output-only free rate retains minimum", model.Pricing{ModelRatio: 1, CompletionRatio: 0}, pricingQuoteScenario{0, 100, 1}, 1, .000002, "token", ""},
		{"legacy request without usage is uncharged", model.Pricing{QuotaType: 1, ModelPrice: .04}, pricingQuoteScenario{0, 0, 1}, 1, 0, "request", ""},
		{"expression rounded charge", model.Pricing{BillingMode: "tiered_expr", BillingExpr: `tier("base", p * 3)`}, pricingQuoteScenario{1, 0, 1}, 1, .000004, "token", "base"},
		{"task constant uses USD without token scaling", model.Pricing{BillingMode: "tiered_expr", BillingExpr: `tier("task", 0.25)`, BillingUsageSchema: map[string]jsplugin.UsageFieldSchema{}}, pricingQuoteScenario{1000, 1000, 1}, 2, .5, "usage", "task"},
		{"task seconds", model.Pricing{BillingMode: "tiered_expr", BillingExpr: `tier("video", u("seconds") * 0.4)`, BillingUsageSchema: map[string]jsplugin.UsageFieldSchema{"seconds": {Type: "number", Unit: "second"}}, BillingUsageExamples: []jsplugin.UsageExample{{Label: "10s", Facts: map[string]any{"seconds": 10.0}}}}, pricingQuoteScenario{1000, 1000, 1}, 2, 8, "usage", "video"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			quotes := evaluatePricingQuotes(tc.pricing, tc.ratio, tc.scenario)
			require.Len(t, quotes, 1)
			require.Empty(t, quotes[0].UnavailableReason)
			require.NotNil(t, quotes[0].USD)
			assert.InDelta(t, tc.usd, *quotes[0].USD, 1e-10)
			assert.Equal(t, tc.unit, quotes[0].BillingUnit)
			assert.Equal(t, tc.tier, quotes[0].MatchedTier)
		})
	}
}

func TestPricingQuoteNeverPresentsUnknownOrInvalidPricingAsFree(t *testing.T) {
	for _, pricing := range []model.Pricing{
		{BillingMode: "tiered_expr"},
		{BillingMode: "tiered_expr", BillingExpr: `tier("base", param("missing") * p)`},
		{BillingMode: "tiered_expr", BillingExpr: `tier("base", u("seconds") * 0.4)`},
		{ModelRatio: math.NaN()},
		{ModelRatio: math.MaxFloat64, CompletionRatio: 1},
		{QuotaType: 1, ModelPrice: .1, SupportedEndpointTypes: []constant.EndpointType{constant.EndpointTypeImageGeneration}},
	} {
		quotes := evaluatePricingQuotes(pricing, 1, pricingQuoteScenario{1000, 1000, 1})
		require.Len(t, quotes, 1)
		assert.NotEmpty(t, quotes[0].UnavailableReason)
		assert.Nil(t, quotes[0].USD)
	}
}

func TestPricingQuoteRejectsInvalidQuantityAndGroupBeforeModelLookup(t *testing.T) {
	for _, query := range []string{"?image_count=129", "?input_tokens=-1", "?output_tokens=NaN", "?input_tokens=1000001", "?model=test&group=auto", "?model=test"} {
		t.Run(query, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(http.MethodGet, "/api/pricing/quote"+query, nil)
			GetPricingQuote(ctx)
			assert.Equal(t, http.StatusBadRequest, recorder.Code)
		})
	}
}

func TestPricingDisplayUsesOnlyRecordedCanonicalTier(t *testing.T) {
	for _, tc := range []struct {
		name, expression, tier string
		ratio                  float64
		want                   map[string]float64
	}{
		{"zero remains free", `tier("base", p * 2 + c * 0 + cr * 0)`, "base", 1.5, map[string]float64{"p": 3, "c": 0, "cr": 0}},
		{"matched leaf", `len > 100 ? tier("long", p * 4 + c * 8) : tier("short", p * 2 + c * 3)`, "long", 2, map[string]float64{"p": 8, "c": 16}},
		{"unsupported version", `v2:tier("base", p * 2)`, "base", 1, nil},
		{"unknown multiplier", `tier("base", p * 2) * 3`, "base", 1, nil},
		{"complex quantity", `tier("base", max(p, 100) * 2)`, "base", 1, nil},
		{"unmatched", `tier("base", p * 2)`, "missing", 1, nil},
		{"ambiguous label", `len > 100 ? tier("base", p * 4) : tier("base", p * 2)`, "base", 1, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := explainTokenPrices(tc.expression, tc.tier, tc.ratio)
			assert.Equal(t, tc.want, result.UnitPrices)
		})
	}
	for _, other := range []string{`broken`, `{}`, `{"billing_mode":"tiered_expr","expr_b64":"bad"}`} {
		log := &model.Log{Other: other}
		enrichLogPricing(log)
		if other == "broken" {
			assert.Equal(t, other, log.Other)
		} else {
			var data map[string]any
			require.NoError(t, common.UnmarshalJsonStr(log.Other, &data))
			if other != "{}" {
				explanation, ok := data["billing_explanation"].(map[string]any)
				require.True(t, ok)
				assert.Equal(t, "snapshot_unavailable", explanation["status"])
				assert.Empty(t, explanation["unit_prices"])
			}
		}
	}
}

func TestPricingDisplayHistoricalSnapshotPreservesUserGroupZero(t *testing.T) {
	expression := base64.StdEncoding.EncodeToString([]byte(`tier("base", p * 2 + c * 8 + cr * 0)`))
	other, err := common.Marshal(map[string]any{"billing_mode": "tiered_expr", "expr_b64": expression, "matched_tier": "base", "group_ratio": 3, "user_group_ratio": 0})
	require.NoError(t, err)
	log := &model.Log{Other: string(other)}
	enrichLogPricing(log)
	var data struct {
		Explanation pricingExplanation `json:"billing_explanation"`
	}
	require.NoError(t, common.UnmarshalJsonStr(log.Other, &data))
	assert.Equal(t, "available", data.Explanation.Status)
	assert.Equal(t, map[string]float64{"p": 0, "c": 0, "cr": 0}, data.Explanation.UnitPrices)
	assert.NotContains(t, data.Explanation.CacheIncluded, "cr")
}

func TestPricingDisplayHistoricalDefaultGroupRatio(t *testing.T) {
	for _, tc := range []struct {
		name      string
		userRatio any
		status    string
		price     float64
	}{
		{"default sentinel", float64(-1), "available", 6},
		{"invalid negative", float64(-2), "not_separable", 0},
		{"malformed override", "broken", "snapshot_unavailable", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			expression := base64.StdEncoding.EncodeToString([]byte(`tier("base", p * 2)`))
			other, err := common.Marshal(map[string]any{"billing_mode": "tiered_expr", "expr_b64": expression, "matched_tier": "base", "group_ratio": 3, "user_group_ratio": tc.userRatio})
			require.NoError(t, err)
			log := &model.Log{Other: string(other)}
			enrichLogPricing(log)
			var data struct {
				Explanation pricingExplanation `json:"billing_explanation"`
			}
			require.NoError(t, common.UnmarshalJsonStr(log.Other, &data))
			assert.Equal(t, tc.status, data.Explanation.Status)
			if tc.status == "available" {
				assert.Equal(t, tc.price, data.Explanation.UnitPrices["p"])
			} else {
				assert.Nil(t, data.Explanation.UnitPrices)
			}
		})
	}
}

func TestPricingQuoteLegacyUnitPricesUsePublishedRatios(t *testing.T) {
	previous := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = previous })
	zero := 0.0
	invalid := math.NaN()
	for _, tc := range []struct {
		name string
		item model.Pricing
		want map[string]float64
	}{
		{"legacy", model.Pricing{ModelRatio: 1, CompletionRatio: 3}, map[string]float64{"p": 4, "c": 12}},
		{"explicit free cache", model.Pricing{ModelRatio: 1, CompletionRatio: 0, CacheRatio: &zero}, map[string]float64{"p": 4, "c": 0, "cr": 0}},
		{"free model", model.Pricing{ModelRatio: 0, CompletionRatio: 3}, map[string]float64{"p": 0, "c": 0}},
		{"invalid cache", model.Pricing{ModelRatio: 1, CompletionRatio: 3, CacheRatio: &invalid}, nil},
		{"invalid model", model.Pricing{ModelRatio: math.NaN(), CompletionRatio: 3}, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			quotes := evaluatePricingQuotes(tc.item, 2, pricingQuoteScenario{1000, 1000, 1})
			require.Len(t, quotes, 1)
			assert.Equal(t, tc.want, quotes[0].Explanation.UnitPrices)
		})
	}
}

func TestPricingQuoteKeepsContextInputsForConditionalFixedPrices(t *testing.T) {
	quotes := evaluatePricingQuotes(model.Pricing{BillingMode: "tiered_expr", BillingExpr: `len < 5000 ? tier("short", fixed(0.01)) : tier("long", p * 2 + c * 4)`}, 1, pricingQuoteScenario{1000, 1000, 1})
	require.Len(t, quotes, 1)
	assert.True(t, quotes[0].SupportsTokenInput)
	fixed := evaluatePricingQuotes(model.Pricing{BillingMode: "tiered_expr", BillingExpr: `tier("image", fixed(0.04)) * image_count`}, 1, pricingQuoteScenario{1000, 1000, 1})
	require.Len(t, fixed, 1)
	assert.False(t, fixed[0].SupportsTokenInput)
	explanation := explainTokenPrices(`tier("base", p * 2 + c * 4)`, "base", 1)
	assert.Equal(t, []string{"cr"}, explanation.CacheIncluded)
}

func TestPricingQuoteLegacyImageBasePrice(t *testing.T) {
	for _, tc := range []struct {
		name         string
		price, ratio float64
		count        int
		want         *float64
	}{
		{"group price", .5, .15, 1, new(.075)},
		{"quantity does not change base", .5, .15, 3, new(.075)},
		{"explicit free price", 0, 1, 1, new(0.0)},
		{"free group", .5, 0, 1, new(0.0)},
		{"negative price", -1, 1, 1, nil},
		{"nonfinite price", math.NaN(), 1, 1, nil},
		{"overflow price", math.MaxFloat64, 2, 1, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			quotes := evaluatePricingQuotes(model.Pricing{ModelName: "gpt-image-2", QuotaType: 1, ModelPrice: tc.price,
				SupportedEndpointTypes: []constant.EndpointType{constant.EndpointTypeImageGeneration}}, tc.ratio, pricingQuoteScenario{0, 0, tc.count})
			require.Len(t, quotes, 1)
			assert.Nil(t, quotes[0].USD)
			assert.Nil(t, quotes[0].Quota)
			encoded, err := common.Marshal(quotes[0])
			require.NoError(t, err)
			var data map[string]any
			require.NoError(t, common.Unmarshal(encoded, &data))
			if tc.want == nil {
				assert.Equal(t, "invalid_pricing", quotes[0].UnavailableReason)
				assert.NotContains(t, data, "base_price_usd")
				return
			}
			assert.Equal(t, "request", quotes[0].BillingUnit)
			assert.Equal(t, "request_parameters_required", quotes[0].UnavailableReason)
			assert.Equal(t, "base", data["price_scope"])
			require.Contains(t, data, "base_price_usd")
			assert.InDelta(t, *tc.want, data["base_price_usd"], 1e-12)
			assert.False(t, quotes[0].SupportsTokenInput)
		})
	}
	for _, item := range []model.Pricing{
		{ModelName: "gpt-image-2", QuotaType: 1, ModelPrice: .5, BillingUsageSchema: map[string]jsplugin.UsageFieldSchema{}},
		{ModelName: "gpt-image-2", QuotaType: 1, ModelPrice: .5, BillingPluginVariants: []model.PricingPluginVariant{{PluginName: "provider"}}},
		{ModelName: "gpt-image-2", ModelRatio: 1},
	} {
		quotes := evaluatePricingQuotes(item, 1, pricingQuoteScenario{1000, 1000, 1})
		encoded, err := common.Marshal(quotes)
		require.NoError(t, err)
		assert.NotContains(t, string(encoded), "base_price_usd")
		assert.Nil(t, quotes[0].USD)
	}
}
