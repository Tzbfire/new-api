package controller

import (
	"encoding/base64"
	"math"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/expr-lang/expr/ast"
	"github.com/expr-lang/expr/parser"
)

// pricingExplanation is display-only metadata, never a source of settlement.
type pricingExplanation struct {
	Status        string             `json:"status"`
	UnitPrices    map[string]float64 `json:"unit_prices,omitempty"`
	CacheIncluded []string           `json:"cache_included,omitempty"`
}

// explainTokenPrices recognizes literal linear token prices without evaluating
// conditions, quantities or multipliers. The billing engine supplies the tier.
func explainTokenPrices(expression, matchedTier string, ratio float64) pricingExplanation {
	result := pricingExplanation{Status: "not_separable"}
	if ratio < 0 || math.IsNaN(ratio) || math.IsInf(ratio, 0) {
		return result
	}
	if strings.HasPrefix(expression, "v") && !strings.HasPrefix(expression, "v1:") {
		return result
	}
	_, body := billingexpr.ParseExprVersion(expression)
	tree, err := parser.Parse(body)
	if err != nil {
		return result
	}
	leaves, valid := pricingTierLeaves(tree.Node, matchedTier)
	if !valid || len(leaves) != 1 {
		return result
	}
	prices := make(map[string]float64)
	if !collectLiteralTokenPrices(leaves[0], ratio, prices) {
		return result
	}
	result.Status, result.UnitPrices = "available", prices
	_, hasInputPrice := prices["p"]
	// Only cache reads have the same omitted-variable fallback across upstream
	// protocols. Claude cache creation is separate from input, unlike OpenAI.
	for _, key := range []string{"cr"} {
		if _, exists := prices[key]; !exists && hasInputPrice && ast.Find(tree.Node, func(node ast.Node) bool {
			identifier, ok := node.(*ast.IdentifierNode)
			return ok && identifier.Value == key
		}) == nil {
			result.CacheIncluded = append(result.CacheIncluded, key)
		}
	}
	return result
}

func pricingTierLeaves(node ast.Node, matched string) ([]ast.Node, bool) {
	if conditional, ok := node.(*ast.ConditionalNode); ok {
		left, valid := pricingTierLeaves(conditional.Exp1, matched)
		if !valid {
			return nil, false
		}
		right, valid := pricingTierLeaves(conditional.Exp2, matched)
		return append(left, right...), valid
	}
	call, ok := node.(*ast.CallNode)
	if !ok || len(call.Arguments) != 2 {
		return nil, false
	}
	name, ok := call.Callee.(*ast.IdentifierNode)
	if !ok || name.Value != "tier" {
		return nil, false
	}
	label, ok := call.Arguments[0].(*ast.StringNode)
	if !ok {
		return nil, false
	}
	if label.Value != matched {
		return nil, true
	}
	return []ast.Node{call.Arguments[1]}, true
}

func collectLiteralTokenPrices(node ast.Node, ratio float64, prices map[string]float64) bool {
	binary, ok := node.(*ast.BinaryNode)
	if !ok {
		return false
	}
	if binary.Operator == "+" {
		return collectLiteralTokenPrices(binary.Left, ratio, prices) && collectLiteralTokenPrices(binary.Right, ratio, prices)
	}
	if binary.Operator != "*" {
		return false
	}
	variable, ok := binary.Left.(*ast.IdentifierNode)
	if !ok {
		return false
	}
	switch variable.Value {
	case "p", "c", "cr", "cc", "cc1h", "img", "img_o", "img_cr", "ai", "ao":
	default:
		return false
	}
	var value float64
	switch literal := binary.Right.(type) {
	case *ast.IntegerNode:
		value = float64(literal.Value)
	case *ast.FloatNode:
		value = literal.Value
	default:
		return false
	}
	value *= ratio
	if value < 0 || math.IsNaN(value) || math.IsInf(value, 0) {
		return false
	}
	if _, exists := prices[variable.Value]; exists {
		return false
	}
	prices[variable.Value] = value
	return true
}

// enrichLogPricing uses only the public historical snapshot already returned by
// the log query; current model pricing must never fill missing historical data.
func enrichLogPricing(log *model.Log) {
	var data map[string]any
	if common.UnmarshalJsonStr(log.Other, &data) != nil || data == nil || data["billing_mode"] != "tiered_expr" {
		return
	}
	explanation := pricingExplanation{Status: "snapshot_unavailable"}
	encoded, _ := data["expr_b64"].(string)
	tier, _ := data["matched_tier"].(string)
	ratio, ok := data["user_group_ratio"].(float64)
	if _, exists := data["user_group_ratio"]; !exists || (ok && ratio == -1) {
		ratio, ok = data["group_ratio"].(float64)
	}
	expression, err := base64.StdEncoding.DecodeString(encoded)
	if err == nil && len(expression) > 0 && tier != "" && ok {
		explanation = explainTokenPrices(string(expression), tier, ratio)
	}
	data["billing_explanation"] = explanation
	if encoded, err := common.Marshal(data); err == nil {
		log.Other = string(encoded)
	}
}
