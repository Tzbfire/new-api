package helper

import (
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

func modelPriceNotConfiguredError(modelName string, userId int) error {
	if model.IsAdmin(userId) {
		return fmt.Errorf(
			"模型 %s 的价格未配置。请前往「系统设置 → 运营设置」开启自用模式，或在「系统设置 → 分组与模型定价设置」中为该模型配置价格；"+
				"Model %s price not configured. Go to System Settings → Operation Settings to enable self-use mode, or configure the model price in System Settings → Group & Model Pricing.",
			modelName, modelName,
		)
	}
	return fmt.Errorf(
		"模型 %s 的价格尚未由管理员配置，暂时无法使用，请联系站点管理员开启该模型；"+
			"Model %s has not been priced by the administrator yet. Please contact the site administrator to enable this model.",
		modelName, modelName,
	)
}

// https://docs.claude.com/en/docs/build-with-claude/prompt-caching#1-hour-cache-duration
const claudeCacheCreation1hMultiplier = 6 / 3.75

func quotaBucketBillingAppliesToWallet(info *relaycommon.RelayInfo) bool {
	if info == nil || !setting.QuotaBucketBillingEnabled {
		return false
	}
	pref := common.NormalizeBillingPreference(info.UserSetting.BillingPreference)
	switch pref {
	case "subscription_only":
		return false
	case "wallet_only", "wallet_first":
		return true
	case "subscription_first", "":
		fallthrough
	default:
		hasSub, err := model.HasActiveUserSubscription(info.UserId)
		if err != nil {
			common.SysLog("failed to check active subscription for quota bucket billing: " + err.Error())
			return false
		}
		return !hasSub
	}
}

func prepareQuotaBucketBillingGroup(ctx *gin.Context, info *relaycommon.RelayInfo) {
	if !quotaBucketBillingAppliesToWallet(info) {
		return
	}
	paidGroup := model.GetPaidQuotaBillingGroup()
	balance, err := model.GetUserQuotaBucketBalance(info.UserId, paidGroup)
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("quota bucket billing balance check failed: %s", err.Error()))
		return
	}
	if balance > 0 {
		info.BillingGroup = paidGroup
	}
}

func fallbackQuotaBucketBillingGroup(ctx *gin.Context, info *relaycommon.RelayInfo, quota int) bool {
	if !quotaBucketBillingAppliesToWallet(info) || quota <= 0 {
		return false
	}
	paidGroup := model.GetPaidQuotaBillingGroup()
	if info.BillingGroup != paidGroup {
		return false
	}
	balance, err := model.GetUserQuotaBucketBalance(info.UserId, paidGroup)
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("quota bucket billing fallback balance check failed: %s", err.Error()))
		return false
	}
	if balance >= quota {
		return false
	}
	logger.LogInfo(ctx, fmt.Sprintf("用户 %d 的 %s 余额桶不足，回退普通余额桶计费（付费桶余额: %s，需要: %s）",
		info.UserId, paidGroup, logger.FormatQuota(balance), logger.FormatQuota(quota)))
	info.BillingGroup = ""
	return true
}

// HandleGroupRatio checks for "auto_group" in the context and updates the group ratio and relayInfo.UsingGroup if present
func HandleGroupRatio(ctx *gin.Context, relayInfo *relaycommon.RelayInfo) types.GroupRatioInfo {
	groupRatioInfo := types.GroupRatioInfo{
		GroupRatio:        1.0, // default ratio
		GroupSpecialRatio: -1,
	}

	// check auto group
	autoGroup, exists := ctx.Get("auto_group")
	if exists {
		logger.LogDebug(ctx, fmt.Sprintf("final group: %s", autoGroup))
		relayInfo.UsingGroup = autoGroup.(string)
	}

	// check user group special ratio
	effectiveUserGroup := relayInfo.UserGroup
	if setting.QuotaBucketBillingEnabled && relayInfo.BillingGroup != "" {
		effectiveUserGroup = relayInfo.BillingGroup
	}
	userGroupRatio, ok := ratio_setting.GetGroupGroupRatio(effectiveUserGroup, relayInfo.UsingGroup)
	if ok {
		// user group special ratio
		groupRatioInfo.GroupSpecialRatio = userGroupRatio
		groupRatioInfo.GroupRatio = userGroupRatio
		groupRatioInfo.HasSpecialRatio = true
	} else {
		// normal group ratio
		groupRatioInfo.GroupRatio = ratio_setting.GetGroupRatio(relayInfo.UsingGroup)
	}

	return groupRatioInfo
}

func ModelPriceHelper(c *gin.Context, info *relaycommon.RelayInfo, promptTokens int, meta *types.TokenCountMeta) (types.PriceData, error) {
	modelPrice, usePrice := ratio_setting.GetModelPrice(info.OriginModelName, false)

	// 按分辨率档位的绝对价覆盖（D-Plus 方案）：
	// 当 dto 层在 GetTokenCountMeta 中检测到 ModelSizePrice 命中时，会写入 meta.ImagePriceOverride（USD/次）。
	// 此处直接覆盖 modelPrice 并强制 usePrice=true，使后续走「按次计费」分支，跳过 ratio 计算。
	if meta != nil && meta.ImagePriceOverride > 0 {
		modelPrice = meta.ImagePriceOverride
		usePrice = true
	}

	prepareQuotaBucketBillingGroup(c, info)
	groupRatioInfo := HandleGroupRatio(c, info)

	var preConsumedQuota int
	var modelRatio float64
	var completionRatio float64
	var cacheRatio float64
	var imageRatio float64
	var cacheCreationRatio float64
	var cacheCreationRatio5m float64
	var cacheCreationRatio1h float64
	var audioRatio float64
	var audioCompletionRatio float64
	var freeModel bool
	if !usePrice {
		preConsumedTokens := common.Max(promptTokens, common.PreConsumedQuota)
		if meta.MaxTokens != 0 {
			preConsumedTokens += meta.MaxTokens
		}
		var success bool
		var matchName string
		modelRatio, success, matchName = ratio_setting.GetModelRatio(info.OriginModelName)
		if !success {
			acceptUnsetRatio := false
			if info.UserSetting.AcceptUnsetRatioModel {
				acceptUnsetRatio = true
			}
			if !acceptUnsetRatio {
				return types.PriceData{}, modelPriceNotConfiguredError(matchName, info.UserId)
			}
		}
		completionRatio = ratio_setting.GetCompletionRatio(info.OriginModelName)
		cacheRatio, _ = ratio_setting.GetCacheRatio(info.OriginModelName)
		cacheCreationRatio, _ = ratio_setting.GetCreateCacheRatio(info.OriginModelName)
		cacheCreationRatio5m = cacheCreationRatio
		// 固定1h和5min缓存写入价格的比例
		cacheCreationRatio1h = cacheCreationRatio * claudeCacheCreation1hMultiplier
		imageRatio, _ = ratio_setting.GetImageRatio(info.OriginModelName)
		audioRatio = ratio_setting.GetAudioRatio(info.OriginModelName)
		audioCompletionRatio = ratio_setting.GetAudioCompletionRatio(info.OriginModelName)
		ratio := modelRatio * groupRatioInfo.GroupRatio
		preConsumedQuota = int(float64(preConsumedTokens) * ratio)
	} else {
		if meta.ImagePriceRatio != 0 {
			modelPrice = modelPrice * meta.ImagePriceRatio
		}
		preConsumedQuota = int(modelPrice * common.QuotaPerUnit * groupRatioInfo.GroupRatio)
	}

	// check if free model pre-consume is disabled
	if !operation_setting.GetQuotaSetting().EnableFreeModelPreConsume {
		// if model price or ratio is 0, do not pre-consume quota
		if groupRatioInfo.GroupRatio == 0 {
			preConsumedQuota = 0
			freeModel = true
		} else if usePrice {
			if modelPrice == 0 {
				preConsumedQuota = 0
				freeModel = true
			}
		} else {
			if modelRatio == 0 {
				preConsumedQuota = 0
				freeModel = true
			}
		}
	}

	if fallbackQuotaBucketBillingGroup(c, info, preConsumedQuota) {
		groupRatioInfo = HandleGroupRatio(c, info)
		freeModel = false
		if !usePrice {
			preConsumedTokens := common.Max(promptTokens, common.PreConsumedQuota)
			if meta.MaxTokens != 0 {
				preConsumedTokens += meta.MaxTokens
			}
			ratio := modelRatio * groupRatioInfo.GroupRatio
			preConsumedQuota = int(float64(preConsumedTokens) * ratio)
		} else {
			preConsumedQuota = int(modelPrice * common.QuotaPerUnit * groupRatioInfo.GroupRatio)
		}
		if !operation_setting.GetQuotaSetting().EnableFreeModelPreConsume {
			if groupRatioInfo.GroupRatio == 0 {
				preConsumedQuota = 0
				freeModel = true
			} else if usePrice {
				if modelPrice == 0 {
					preConsumedQuota = 0
					freeModel = true
				}
			} else {
				if modelRatio == 0 {
					preConsumedQuota = 0
					freeModel = true
				}
			}
		}
	}

	priceData := types.PriceData{
		FreeModel:            freeModel,
		ModelPrice:           modelPrice,
		ModelRatio:           modelRatio,
		CompletionRatio:      completionRatio,
		GroupRatioInfo:       groupRatioInfo,
		UsePrice:             usePrice,
		CacheRatio:           cacheRatio,
		ImageRatio:           imageRatio,
		AudioRatio:           audioRatio,
		AudioCompletionRatio: audioCompletionRatio,
		CacheCreationRatio:   cacheCreationRatio,
		CacheCreation5mRatio: cacheCreationRatio5m,
		CacheCreation1hRatio: cacheCreationRatio1h,
		QuotaToPreConsume:    preConsumedQuota,
	}

	if common.DebugEnabled {
		println(fmt.Sprintf("model_price_helper result: %s", priceData.ToSetting()))
	}
	info.PriceData = priceData
	return priceData, nil
}

// ModelPriceHelperPerCall 按次/按量计费的 PriceHelper (MJ、Task)
func ModelPriceHelperPerCall(c *gin.Context, info *relaycommon.RelayInfo) (types.PriceData, error) {
	prepareQuotaBucketBillingGroup(c, info)
	groupRatioInfo := HandleGroupRatio(c, info)

	modelPrice, success := ratio_setting.GetModelPrice(info.OriginModelName, true)
	usePrice := success
	var modelRatio float64

	if !success {
		defaultPrice, ok := ratio_setting.GetDefaultModelPriceMap()[info.OriginModelName]
		if ok {
			modelPrice = defaultPrice
			usePrice = true
		} else {
			var ratioSuccess bool
			var matchName string
			modelRatio, ratioSuccess, matchName = ratio_setting.GetModelRatio(info.OriginModelName)
			acceptUnsetRatio := false
			if info.UserSetting.AcceptUnsetRatioModel {
				acceptUnsetRatio = true
			}
			if !ratioSuccess && !acceptUnsetRatio {
				return types.PriceData{}, modelPriceNotConfiguredError(matchName, info.UserId)
			}
		}
	}

	var quota int
	freeModel := false

	if usePrice {
		quota = int(modelPrice * common.QuotaPerUnit * groupRatioInfo.GroupRatio)
		if !operation_setting.GetQuotaSetting().EnableFreeModelPreConsume {
			if groupRatioInfo.GroupRatio == 0 || modelPrice == 0 {
				quota = 0
				freeModel = true
			}
		}
	} else {
		// 按量计费：以模型倍率的一半作为预扣额度
		quota = int(modelRatio / 2 * common.QuotaPerUnit * groupRatioInfo.GroupRatio)
		modelPrice = -1
		if !operation_setting.GetQuotaSetting().EnableFreeModelPreConsume {
			if groupRatioInfo.GroupRatio == 0 || modelRatio == 0 {
				quota = 0
				freeModel = true
			}
		}
	}

	if fallbackQuotaBucketBillingGroup(c, info, quota) {
		groupRatioInfo = HandleGroupRatio(c, info)
		freeModel = false
		if usePrice {
			quota = int(modelPrice * common.QuotaPerUnit * groupRatioInfo.GroupRatio)
			if !operation_setting.GetQuotaSetting().EnableFreeModelPreConsume {
				if groupRatioInfo.GroupRatio == 0 || modelPrice == 0 {
					quota = 0
					freeModel = true
				}
			}
		} else {
			quota = int(modelRatio / 2 * common.QuotaPerUnit * groupRatioInfo.GroupRatio)
			if !operation_setting.GetQuotaSetting().EnableFreeModelPreConsume {
				if groupRatioInfo.GroupRatio == 0 || modelRatio == 0 {
					quota = 0
					freeModel = true
				}
			}
		}
	}

	priceData := types.PriceData{
		FreeModel:      freeModel,
		ModelPrice:     modelPrice,
		ModelRatio:     modelRatio,
		UsePrice:       usePrice,
		Quota:          quota,
		GroupRatioInfo: groupRatioInfo,
	}
	return priceData, nil
}

func ContainPriceOrRatio(modelName string) bool {
	_, ok := ratio_setting.GetModelPrice(modelName, false)
	if ok {
		return true
	}
	_, ok, _ = ratio_setting.GetModelRatio(modelName)
	if ok {
		return true
	}
	return false
}
