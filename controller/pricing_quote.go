package controller

import (
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

type pricingQuoteScenario struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
	ImageCount   int `json:"image_count"`
}

type pricingQuote struct {
	SupportsTokenInput bool                           `json:"supports_token_input"`
	Explanation        pricingExplanation             `json:"billing_explanation"`
	Provider           string                         `json:"provider,omitempty"`
	Label              string                         `json:"label"`
	BillingMode        string                         `json:"billing_mode"`
	BillingUnit        string                         `json:"billing_unit,omitempty"`
	BasePriceUSD       *float64                       `json:"base_price_usd,omitempty"`
	PriceScope         string                         `json:"price_scope,omitempty"`
	USD                *float64                       `json:"usd,omitempty"`
	Quota              *int                           `json:"quota,omitempty"`
	MatchedTier        string                         `json:"matched_tier,omitempty"`
	RequestRules       []billingexpr.RequestRuleTrace `json:"request_rules,omitempty"`
	UsageFacts         map[string]any                 `json:"usage_facts,omitempty"`
	UnavailableReason  string                         `json:"unavailable_reason,omitempty"`
}

// GetPricingQuote 仅展示服务端计价示例，不预扣额度，也不提交上游任务。
func GetPricingQuote(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	group, name := c.Query("group"), c.Query("model")
	userGroup := ""
	acceptUnsetPrice := false
	if id, authenticated := c.Get("id"); authenticated {
		user, err := model.GetUserCache(id.(int))
		if err != nil {
			common.ApiError(c, err)
			return
		}
		userGroup = user.Group
		acceptUnsetPrice = user.GetSetting().AcceptUnsetRatioModel
	}
	if !service.IsUserSelectableGroup(userGroup, group) || name == "" {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"), nil)
		return
	}
	writePricingQuote(c, userGroup, acceptUnsetPrice)
}

// writePricingQuote shares the canonical quote calculation and unknown-price
// handling between current-access and subscription purchase previews. Callers
// validate their own group scope before entering this read-only calculation.
func writePricingQuote(c *gin.Context, userGroup string, acceptUnsetPrice bool) {
	group, name := c.Query("group"), c.Query("model")
	if name == "" {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"), nil)
		return
	}
	scenario := pricingQuoteScenario{InputTokens: 1000, OutputTokens: 1000, ImageCount: 1}
	for _, field := range []struct {
		name     string
		value    *int
		min, max int
	}{
		{"input_tokens", &scenario.InputTokens, 0, 1_000_000},
		{"output_tokens", &scenario.OutputTokens, 0, 1_000_000},
		{"image_count", &scenario.ImageCount, 1, dto.MaxImageN},
	} {
		if raw, exists := c.GetQuery(field.name); exists {
			value, err := strconv.Atoi(raw)
			if err != nil || value < field.min || value > field.max {
				common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"), nil)
				return
			}
			*field.value = value
		}
	}
	for _, item := range model.GetPricing() {
		if item.ModelName != name || (!slices.Contains(item.EnableGroup, group) && !slices.Contains(item.EnableGroup, "all")) {
			continue
		}
		ratio := service.GetUserGroupRatio(userGroup, group)
		quotes := evaluatePricingQuotes(item, ratio, scenario)
		_, configured, _ := ratio_setting.GetModelRatio(name)
		if item.QuotaType != 1 && !configured && !acceptUnsetPrice {
			for index := range quotes {
				if quotes[index].BillingMode != "tiered_expr" {
					quotes[index].USD, quotes[index].Quota = nil, nil
					quotes[index].Explanation = pricingExplanation{Status: "snapshot_unavailable"}
					quotes[index].UnavailableReason = "pricing_not_configured"
				}
			}
		}
		common.ApiSuccess(c, gin.H{
			"model": name, "group": group, "group_ratio": ratio, "currency": "USD",
			"input_tokens": scenario.InputTokens, "output_tokens": scenario.OutputTokens,
			"image_count": scenario.ImageCount, "estimated": true,
			"quotes": quotes, "supports_image_count": common.IsImageGenerationModel(item.ModelName) || slices.Contains(item.SupportedEndpointTypes, constant.EndpointTypeImageGeneration),
		})
		return
	}
	common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Invalid parameters"), nil)
}

// evaluatePricingQuotes 复用表达式结算引擎计算公开示例，保留无法报价的原因，避免把未知价格显示为免费。
func evaluatePricingQuotes(item model.Pricing, ratio float64, scenario pricingQuoteScenario) []pricingQuote {
	variants := item.BillingPluginVariants
	if len(variants) == 0 {
		variants = []model.PricingPluginVariant{{BillingExpr: item.BillingExpr, BillingMode: item.BillingMode,
			BillingUsageSchema: item.BillingUsageSchema, BillingUsageExamples: item.BillingUsageExamples}}
	}
	quotes := make([]pricingQuote, 0, len(variants))
	for _, variant := range variants {
		examples := variant.BillingUsageExamples
		if len(examples) == 0 {
			examples = []jsplugin.UsageExample{{Label: "Standard example"}}
		}
		for _, example := range examples {
			quote := pricingQuote{Provider: variant.PluginName, Label: example.Label, BillingMode: variant.BillingMode, UsageFacts: example.Facts}
			quote.SupportsTokenInput = variant.BillingMode != "tiered_expr" && item.QuotaType != 1
			if variant.BillingMode == "tiered_expr" {
				used := billingexpr.UsedVars(variant.BillingExpr)
				for _, name := range []string{"p", "c", "len", "cr", "cc", "cc1h", "img", "img_o", "img_cr", "ai", "ao"} {
					if used[name] {
						quote.SupportsTokenInput = true
						break
					}
				}
			}
			if ratio < 0 || math.IsNaN(ratio) || math.IsInf(ratio, 0) || common.QuotaPerUnit <= 0 || math.IsInf(common.QuotaPerUnit, 0) || math.IsNaN(common.QuotaPerUnit) {
				quote.UnavailableReason = "invalid_pricing"
				quotes = append(quotes, quote)
				continue
			}
			if variant.BillingMode != "tiered_expr" {
				quote.BillingMode = "ratio"
				quote.BillingUnit = "token"
				if item.QuotaType == 1 {
					quote.BillingUnit = "request"
				}
				isImage := common.IsImageGenerationModel(item.ModelName) || slices.Contains(item.SupportedEndpointTypes, constant.EndpointTypeImageGeneration)
				// Image count and provider-specific request modifiers are not a final
				// quote. Expose only the configured one-image base, including the group
				// ratio, and keep exact USD/quota unavailable. Task plugins may apply
				// additional billing hooks, even without a usage schema.
				if isImage && item.QuotaType == 1 && variant.PluginName == "" && variant.BillingUsageSchema == nil {
					if item.ModelPrice < 0 || math.IsNaN(item.ModelPrice) || math.IsInf(item.ModelPrice, 0) {
						quote.UnavailableReason = "invalid_pricing"
					} else {
						base, _ := decimal.NewFromFloat(item.ModelPrice).Mul(decimal.NewFromFloat(ratio)).Float64()
						if math.IsInf(base, 0) || math.IsNaN(base) {
							quote.UnavailableReason = "invalid_pricing"
						} else {
							quote.BasePriceUSD, quote.PriceScope = &base, "base"
							quote.UnavailableReason = "request_parameters_required"
						}
					}
					quotes = append(quotes, quote)
					continue
				}
				// Legacy task/image request multipliers are provider-specific. A base
				// price alone is not enough to promise their final request price.
				if variant.PluginName != "" || variant.BillingUsageSchema != nil || isImage {
					quote.UnavailableReason = "request_parameters_required"
				} else if item.ModelRatio < 0 || item.ModelPrice < 0 || item.CompletionRatio < 0 || math.IsNaN(item.ModelRatio) || math.IsInf(item.ModelRatio, 0) || math.IsNaN(item.ModelPrice) || math.IsInf(item.ModelPrice, 0) || math.IsNaN(item.CompletionRatio) || math.IsInf(item.CompletionRatio, 0) {
					quote.UnavailableReason = "invalid_pricing"
				} else {
					price := decimal.NewFromFloat(item.ModelRatio).Mul(decimal.NewFromInt(int64(scenario.InputTokens)).Add(decimal.NewFromInt(int64(scenario.OutputTokens)).Mul(decimal.NewFromFloat(item.CompletionRatio)))).Mul(decimal.NewFromFloat(ratio))
					if item.QuotaType == 1 {
						price = decimal.NewFromFloat(item.ModelPrice).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).Mul(decimal.NewFromFloat(ratio))
						quote.BillingUnit = "request"
					}
					quota, clamp := common.QuotaFromDecimalChecked(price)
					if clamp != nil {
						quote.UnavailableReason = "invalid_pricing"
					} else {
						// Legacy text settlement clears charges when upstream reports no
						// usage and otherwise retains its one-quota minimum, including
						// an explicitly free output rate on a paid input model.
						if scenario.InputTokens+scenario.OutputTokens == 0 {
							quota = 0
						} else if quota == 0 && item.ModelRatio > 0 && ratio > 0 {
							quota = 1
						}
						usd := float64(quota) / common.QuotaPerUnit
						quote.USD, quote.Quota = &usd, &quota
						if quote.BillingUnit == "token" {
							input := decimal.NewFromFloat(item.ModelRatio).Mul(decimal.NewFromInt(1_000_000)).Div(decimal.NewFromFloat(common.QuotaPerUnit)).Mul(decimal.NewFromFloat(ratio))
							inputPrice, _ := input.Float64()
							outputPrice, _ := input.Mul(decimal.NewFromFloat(item.CompletionRatio)).Float64()
							prices := map[string]float64{"p": inputPrice, "c": outputPrice}
							valid := !math.IsInf(inputPrice, 0) && !math.IsInf(outputPrice, 0)
							// Only explicitly configured cache reads share this price
							// contract. Cache writes have protocol/TTL-specific semantics.
							if item.CacheRatio != nil {
								cacheRatio := *item.CacheRatio
								if cacheRatio < 0 || math.IsNaN(cacheRatio) || math.IsInf(cacheRatio, 0) {
									valid = false
								} else {
									cachePrice, _ := input.Mul(decimal.NewFromFloat(cacheRatio)).Float64()
									prices["cr"] = cachePrice
									valid = valid && !math.IsInf(cachePrice, 0)
								}
							}
							quote.Explanation.Status = "not_separable"
							if valid {
								quote.Explanation = pricingExplanation{Status: "available", UnitPrices: prices}
							}
						}
					}
				}
				quotes = append(quotes, quote)
				continue
			}
			expression := variant.BillingExpr
			if strings.TrimSpace(expression) == "" {
				quote.UnavailableReason = "pricing_not_configured"
				quotes = append(quotes, quote)
				continue
			}
			version, _ := billingexpr.ParseExprVersion(expression)
			usageKeys := billingexpr.UsedUsageKeys(expression)
			isTask := variant.BillingUsageSchema != nil || len(usageKeys) > 0
			if isTask && len(example.Facts) == 0 && (len(variant.BillingUsageSchema) > 0 || len(usageKeys) > 0) {
				quote.UnavailableReason = "usage_example_required"
				quotes = append(quotes, quote)
				continue
			}
			snapshot := &billingexpr.BillingSnapshot{ExprString: expression, ExprHash: billingexpr.ExprHashString(expression),
				ExprVersion: version, GroupRatio: ratio, QuotaPerUnit: common.QuotaPerUnit, TaskUsageBilling: isTask}
			params := billingexpr.TokenParams{P: float64(scenario.InputTokens), C: float64(scenario.OutputTokens), Len: float64(scenario.InputTokens)}
			body, _ := common.Marshal(map[string]int{"n": scenario.ImageCount})
			request := billingexpr.RequestInput{ImageCount: &scenario.ImageCount, Usage: example.Facts,
				Body: body}
			result, err := billingexpr.ComputeTieredQuotaWithRequest(snapshot, params, request)
			if err != nil || result.Clamp != nil || result.ActualQuotaBeforeGroup < 0 || math.IsNaN(result.ActualQuotaBeforeGroup) || math.IsInf(result.ActualQuotaBeforeGroup, 0) {
				quote.UnavailableReason = "request_parameters_required"
			} else {
				usd := float64(result.ActualQuotaAfterGroup) / common.QuotaPerUnit
				quote.USD, quote.Quota = &usd, &result.ActualQuotaAfterGroup
				quote.BillingUnit = string(result.BillingUnit)
				if isTask {
					quote.BillingUnit = "usage"
				}
				quote.MatchedTier, quote.RequestRules = result.MatchedTier, result.RequestRules
				if !isTask {
					quote.Explanation = explainTokenPrices(expression, result.MatchedTier, ratio)
				}
			}
			quotes = append(quotes, quote)
		}
	}
	return quotes
}
