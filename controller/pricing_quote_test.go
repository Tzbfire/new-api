package controller

import (
	"encoding/base64"
	"math"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func requestSubscriptionPricingTest(t *testing.T, handler gin.HandlerFunc, userID, planID int, query string, response any) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set("id", userID)
	context.Params = gin.Params{{Key: "id", Value: strconv.Itoa(planID)}}
	context.Request = httptest.NewRequest(http.MethodGet, "/preview"+query, nil)
	handler(context)
	if response != nil {
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), response))
	}
	return recorder
}

func TestSubscriptionPlanPricingPreviewPreservesPermissionsAndPurchasePrices(t *testing.T) {
	user, _ := setupSecurityEnrollmentTest(t)
	db := model.DB
	setPublicPlanCompliance(t, true)
	require.NoError(t, db.AutoMigrate(&model.SubscriptionPlan{}, &model.Channel{}, &model.Ability{}, &model.Model{}, &model.Vendor{}))
	previousGroups := setting.UserUsableGroups2JSONString()
	previousRatios := ratio_setting.GroupRatio2JSONString()
	previousGroupRatios := ratio_setting.GroupGroupRatio2JSONString()
	previousModelRatios := ratio_setting.ModelRatio2JSONString()
	previousModelPrices := ratio_setting.ModelPrice2JSONString()
	previousCompletionRatios := ratio_setting.CompletionRatio2JSONString()
	previousSpecialGroups := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.ReadAll()
	previousQuota, previousSelfUse := common.QuotaPerUnit, operation_setting.SelfUseModeEnabled
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(previousGroups))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(previousRatios))
		require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(previousGroupRatios))
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(previousModelRatios))
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(previousModelPrices))
		require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(previousCompletionRatios))
		ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.Clear()
		ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.AddAll(previousSpecialGroups)
		common.QuotaPerUnit, operation_setting.SelfUseModeEnabled = previousQuota, previousSelfUse
		model.InvalidatePricingCache()
	})
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"codeplan":2,"private":3,"empty":1}`))
	require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(`{"default":{"codeplan":4},"codeplan":{"codeplan":0.5}}`))
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"plan-preview-token":2}`))
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"plan-preview-request":0.4}`))
	require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(`{"plan-preview-token":3}`))
	ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.Clear()
	common.QuotaPerUnit, operation_setting.SelfUseModeEnabled = 500000, false
	user.Quota = 12345
	require.NoError(t, db.Model(user).Update("quota", user.Quota).Error)
	channel := model.Channel{Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled, Name: "preview", Key: "synthetic-test-key"}
	require.NoError(t, db.Create(&channel).Error)
	for name, group := range map[string]string{
		"plan-preview-token": "codeplan", "plan-preview-request": "codeplan", "plan-preview-unknown": "codeplan",
		"plan-preview-public": "default", "plan-preview-private": "private",
	} {
		require.NoError(t, db.Create(&model.Ability{Group: group, Model: name, ChannelId: channel.Id, Enabled: true}).Error)
	}
	model.InvalidatePricingCache()
	plans := []model.SubscriptionPlan{
		{Title: "Upgrade plan", Enabled: true, AllowedTokenGroups: `["codeplan","empty"]`, UpgradeGroup: "codeplan"},
		{Title: "Billing scope only", Enabled: true, AllowedTokenGroups: "codeplan"},
		{Title: "Unscoped upgrade", Enabled: true, UpgradeGroup: "codeplan"},
		{Title: "Unrelated plan", Enabled: true, AllowedTokenGroups: "default"},
		{Title: "Disabled plan", Enabled: true, AllowedTokenGroups: "codeplan", UpgradeGroup: "codeplan"},
	}
	for i := range plans {
		require.NoError(t, db.Create(&plans[i]).Error)
	}
	require.NoError(t, db.Model(&plans[4]).Update("enabled", false).Error)

	t.Run("published upgrade offers exact models and purchase ratio without granting access", func(t *testing.T) {
		var response struct {
			Success bool                       `json:"success"`
			Data    subscriptionPricingPreview `json:"data"`
		}
		recorder := requestSubscriptionPricingTest(t, GetSubscriptionPlanPricing, user.Id, plans[0].Id, "?group=codeplan", &response)
		require.Equal(t, http.StatusOK, recorder.Code)
		require.True(t, response.Success)
		assert.Equal(t, "private, no-store", recorder.Header().Get("Cache-Control"))
		assert.Equal(t, "codeplan", response.Data.Group)
		assert.Equal(t, "codeplan", response.Data.PurchaseUserGroup)
		assert.Equal(t, 0.5, response.Data.GroupRatio)
		assert.False(t, response.Data.SelectableNow)
		assert.True(t, response.Data.SelectableAfterPurchase)
		var names []string
		for _, item := range response.Data.Models {
			names = append(names, item.ModelName)
		}
		assert.ElementsMatch(t, []string{"plan-preview-token", "plan-preview-request", "plan-preview-unknown"}, names)
		assert.NotContains(t, recorder.Body.String(), "accept_unset_price")
	})

	t.Run("quotes share configured token request and unavailable price semantics", func(t *testing.T) {
		for _, tc := range []struct {
			model  string
			usd    float64
			reason string
		}{
			{"plan-preview-token", 0.008, ""},
			{"plan-preview-request", 0.2, ""},
			{"plan-preview-unknown", 0, "pricing_not_configured"},
		} {
			var response struct {
				Success bool `json:"success"`
				Data    struct {
					GroupRatio float64        `json:"group_ratio"`
					Quotes     []pricingQuote `json:"quotes"`
				} `json:"data"`
			}
			recorder := requestSubscriptionPricingTest(t, GetSubscriptionPlanPricingQuote, user.Id, plans[0].Id, "?group=codeplan&model="+tc.model, &response)
			require.Equal(t, http.StatusOK, recorder.Code)
			require.True(t, response.Success)
			assert.Equal(t, 0.5, response.Data.GroupRatio)
			require.Len(t, response.Data.Quotes, 1)
			quote := response.Data.Quotes[0]
			assert.Equal(t, tc.reason, quote.UnavailableReason)
			if tc.reason != "" {
				assert.Nil(t, quote.USD)
				assert.Nil(t, quote.Quota)
			} else {
				require.NotNil(t, quote.USD)
				assert.InDelta(t, tc.usd, *quote.USD, 1e-9)
			}
		}
	})

	t.Run("billing scope does not promise permissions or inherit upgrade prices", func(t *testing.T) {
		var response struct {
			Success bool                       `json:"success"`
			Data    subscriptionPricingPreview `json:"data"`
		}
		requestSubscriptionPricingTest(t, GetSubscriptionPlanPricing, user.Id, plans[1].Id, "?group=codeplan", &response)
		require.True(t, response.Success)
		assert.False(t, response.Data.SelectableNow)
		assert.False(t, response.Data.SelectableAfterPurchase)
		assert.Equal(t, "default", response.Data.PurchaseUserGroup)
		assert.Equal(t, 4.0, response.Data.GroupRatio)
	})

	t.Run("unscoped plan shows only groups usable after purchase", func(t *testing.T) {
		for _, group := range []string{"codeplan", "default"} {
			var response struct {
				Success bool                       `json:"success"`
				Data    subscriptionPricingPreview `json:"data"`
			}
			requestSubscriptionPricingTest(t, GetSubscriptionPlanPricing, user.Id, plans[2].Id, "?group="+group, &response)
			require.True(t, response.Success)
			assert.True(t, response.Data.SelectableAfterPurchase)
		}
	})

	t.Run("rejects invalid plans scopes models and quantities", func(t *testing.T) {
		for _, tc := range []struct {
			name    string
			plan    int
			query   string
			handler gin.HandlerFunc
			status  int
		}{
			{"disabled plan", plans[4].Id, "?group=codeplan", GetSubscriptionPlanPricing, 404},
			{"missing plan", plans[4].Id + 1000, "?group=codeplan", GetSubscriptionPlanPricing, 404},
			{"invalid plan", 0, "?group=codeplan", GetSubscriptionPlanPricing, 400},
			{"other plan scope", plans[3].Id, "?group=codeplan", GetSubscriptionPlanPricing, 400},
			{"hidden group", plans[0].Id, "?group=private", GetSubscriptionPlanPricing, 400},
			{"unscoped hidden group", plans[2].Id, "?group=private", GetSubscriptionPlanPricing, 400},
			{"missing group", plans[0].Id, "", GetSubscriptionPlanPricing, 400},
			{"auto group", plans[0].Id, "?group=auto", GetSubscriptionPlanPricing, 400},
			{"unknown group", plans[0].Id, "?group=missing", GetSubscriptionPlanPricing, 400},
			{"quote other plan", plans[3].Id, "?group=codeplan&model=plan-preview-token", GetSubscriptionPlanPricingQuote, 400},
			{"quote disabled plan", plans[4].Id, "?group=codeplan&model=plan-preview-token", GetSubscriptionPlanPricingQuote, 404},
			{"quote missing model", plans[0].Id, "?group=codeplan", GetSubscriptionPlanPricingQuote, 400},
			{"quote other model", plans[0].Id, "?group=codeplan&model=plan-preview-private", GetSubscriptionPlanPricingQuote, 404},
			{"quote invalid quantity", plans[0].Id, "?group=codeplan&model=plan-preview-token&image_count=129", GetSubscriptionPlanPricingQuote, 400},
		} {
			t.Run(tc.name, func(t *testing.T) {
				var response struct {
					Success bool `json:"success"`
				}
				recorder := requestSubscriptionPricingTest(t, tc.handler, user.Id, tc.plan, tc.query, &response)
				assert.Equal(t, tc.status, recorder.Code)
				assert.False(t, response.Success)
				assert.NotContains(t, recorder.Body.String(), "model_name")
			})
		}
	})

	t.Run("legitimate empty group remains empty", func(t *testing.T) {
		var response struct {
			Success bool                       `json:"success"`
			Data    subscriptionPricingPreview `json:"data"`
		}
		requestSubscriptionPricingTest(t, GetSubscriptionPlanPricing, user.Id, plans[0].Id, "?group=empty", &response)
		require.True(t, response.Success)
		assert.Empty(t, response.Data.Models)
	})

	t.Run("preview leaves actual group wallet and regular catalogue unchanged", func(t *testing.T) {
		var stored model.User
		require.NoError(t, db.First(&stored, user.Id).Error)
		assert.Equal(t, user.Group, stored.Group)
		assert.Equal(t, user.Quota, stored.Quota)
		assert.False(t, service.IsUserSelectableGroup(stored.Group, "codeplan"))
		var response struct {
			Success bool            `json:"success"`
			Data    []model.Pricing `json:"data"`
		}
		requestSubscriptionPricingTest(t, GetPricing, user.Id, 0, "", &response)
		require.True(t, response.Success)
		require.Len(t, response.Data, 1)
		assert.Equal(t, "plan-preview-public", response.Data[0].ModelName)
		recorder := requestSubscriptionPricingTest(t, GetPricingQuote, user.Id, 0, "?group=codeplan&model=plan-preview-token&plan_id="+strconv.Itoa(plans[0].Id), nil)
		assert.Equal(t, http.StatusBadRequest, recorder.Code)
	})

	t.Run("payment compliance gates both preview endpoints", func(t *testing.T) {
		setPublicPlanCompliance(t, false)
		for _, handler := range []gin.HandlerFunc{GetSubscriptionPlanPricing, GetSubscriptionPlanPricingQuote} {
			var response struct {
				Success bool `json:"success"`
			}
			recorder := requestSubscriptionPricingTest(t, handler, user.Id, plans[0].Id, "?group=codeplan&model=plan-preview-token", &response)
			assert.False(t, response.Success)
			assert.NotContains(t, recorder.Body.String(), "model_name")
		}
	})
}

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
