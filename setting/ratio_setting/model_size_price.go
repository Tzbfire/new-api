package ratio_setting

import (
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"
)

// modelSizePriceMap 存储「模型按分辨率档位的价格表」。
// 数据形态：{ "gpt-image-2": { "1K": 0.04, "2K": 0.08, "4K": 0.16 } }，
// 单位为 USD/次，与现有 modelPriceMap 单位一致。
//
// 命中后会覆盖 modelPriceMap 中该模型的基础价。
var modelSizePriceMap = types.NewRWMap[string, map[string]float64]()

// GetModelSizePriceMap 返回完整价格表（用于 admin 序列化）。
func GetModelSizePriceMap() map[string]map[string]float64 {
	return modelSizePriceMap.ReadAll()
}

func ModelSizePrice2JSONString() string {
	return modelSizePriceMap.MarshalJSONString()
}

func UpdateModelSizePriceByJSONString(jsonStr string) error {
	return types.LoadFromJsonStringWithCallback(modelSizePriceMap, jsonStr, InvalidateExposedDataCache)
}

// GetModelSizePrice 按 (model, size) 返回价格（USD/次）。
// 若未配置或档位缺失返回 0, false。
func GetModelSizePrice(model string, size string) (float64, bool) {
	if model == "" {
		return 0, false
	}
	matched := FormatMatchingModelName(model)
	tiers, ok := modelSizePriceMap.Get(matched)
	if !ok {
		// 兼容通配符 / 后缀回退
		tiers, ok = modelSizePriceMap.Get(model)
		if !ok {
			return 0, false
		}
	}
	tier := operation_setting.ClassifyImageSizeTier(size)
	if price, exists := tiers[tier]; exists {
		return price, true
	}
	return 0, false
}

// GetModelSizePriceTiers 返回某模型已配置的所有档位价格，未配置返回 nil。
// 用于前端展示「价格 chip」。
func GetModelSizePriceTiers(model string) map[string]float64 {
	if model == "" {
		return nil
	}
	matched := FormatMatchingModelName(model)
	if tiers, ok := modelSizePriceMap.Get(matched); ok {
		return tiers
	}
	if tiers, ok := modelSizePriceMap.Get(model); ok {
		return tiers
	}
	return nil
}
