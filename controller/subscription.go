package controller

import (
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ---- Shared types ----

type SubscriptionPlanDTO struct {
	Plan model.SubscriptionPlan `json:"plan"`
}

// PublicSubscriptionPlanDTO is the deliberately small, anonymous-facing plan
// contract used by the landing page. Payment-provider identifiers and
// administrative lifecycle fields must never be added here.
type PublicSubscriptionPlanDTO struct {
	Id                      int     `json:"id"`
	Title                   string  `json:"title"`
	Subtitle                string  `json:"subtitle"`
	PriceAmount             float64 `json:"price_amount"`
	Currency                string  `json:"currency"`
	DurationUnit            string  `json:"duration_unit"`
	DurationValue           int     `json:"duration_value"`
	CustomSeconds           int64   `json:"custom_seconds"`
	TotalAmount             int64   `json:"total_amount"`
	QuotaResetPeriod        string  `json:"quota_reset_period"`
	QuotaResetCustomSeconds int64   `json:"quota_reset_custom_seconds"`
	UpgradeGroup            string  `json:"upgrade_group"`
	AllowedTokenGroups      string  `json:"allowed_token_groups"`
	AllowWalletOverflow     bool    `json:"allow_wallet_overflow"`
}

type BillingPreferenceRequest struct {
	BillingPreference string `json:"billing_preference"`
}

type SubscriptionBalancePayRequest struct {
	PlanId int `json:"plan_id"`
}

// ---- User APIs ----

func GetPublicSubscriptionPlans(c *gin.Context) {
	if !operation_setting.IsPaymentComplianceConfirmed() {
		common.ApiSuccess(c, []PublicSubscriptionPlanDTO{})
		return
	}

	var plans []model.SubscriptionPlan
	if err := model.DB.Where("enabled = ?", true).Order("sort_order desc, id desc").Find(&plans).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	result := make([]PublicSubscriptionPlanDTO, 0, len(plans))
	for index := range plans {
		plan := &plans[index]
		plan.NormalizeDefaults()
		result = append(result, PublicSubscriptionPlanDTO{
			Id:                      plan.Id,
			Title:                   plan.Title,
			Subtitle:                plan.Subtitle,
			PriceAmount:             plan.PriceAmount,
			Currency:                plan.Currency,
			DurationUnit:            plan.DurationUnit,
			DurationValue:           plan.DurationValue,
			CustomSeconds:           plan.CustomSeconds,
			TotalAmount:             plan.TotalAmount,
			QuotaResetPeriod:        plan.QuotaResetPeriod,
			QuotaResetCustomSeconds: plan.QuotaResetCustomSeconds,
			UpgradeGroup:            plan.UpgradeGroup,
			AllowedTokenGroups:      plan.AllowedTokenGroups,
			AllowWalletOverflow:     *plan.AllowWalletOverflow,
		})
	}
	common.ApiSuccess(c, result)
}

func GetSubscriptionPlans(c *gin.Context) {
	if !operation_setting.IsPaymentComplianceConfirmed() {
		common.ApiSuccess(c, []SubscriptionPlanDTO{})
		return
	}

	var plans []model.SubscriptionPlan
	if err := model.DB.Where("enabled = ?", true).Order("sort_order desc, id desc").Find(&plans).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	result := make([]SubscriptionPlanDTO, 0, len(plans))
	for _, p := range plans {
		p.NormalizeDefaults()
		result = append(result, SubscriptionPlanDTO{
			Plan: p,
		})
	}
	common.ApiSuccess(c, result)
}

type subscriptionPricingPreview struct {
	Models                  []model.Pricing `json:"models"`
	Group                   string          `json:"group"`
	GroupRatio              float64         `json:"group_ratio"`
	PurchaseUserGroup       string          `json:"purchase_user_group"`
	SelectableNow           bool            `json:"selectable_now"`
	SelectableAfterPurchase bool            `json:"selectable_after_purchase"`
	AcceptUnsetPrice        bool            `json:"-"`
}

// subscriptionPlanPricingScope grants only a read-only preview of a published
// plan. It never changes the user's group or the normal model/token permissions.
func subscriptionPlanPricingScope(c *gin.Context) (subscriptionPricingPreview, bool) {
	c.Header("Cache-Control", "private, no-store")
	preview := subscriptionPricingPreview{}
	if !requirePaymentCompliance(c) {
		return preview, false
	}
	planID, err := strconv.Atoi(c.Param("id"))
	group := c.Query("group")
	if err != nil || planID <= 0 || group == "" || group == "auto" || !ratio_setting.ContainsGroupRatio(group) {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"), nil)
		return preview, false
	}
	var plan model.SubscriptionPlan
	if err := model.DB.Where("id = ? AND enabled = ?", planID, true).First(&plan).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Invalid parameters"), nil)
		} else {
			common.ApiError(c, err)
		}
		return preview, false
	}
	user, err := model.GetUserCache(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return preview, false
	}
	purchaseUserGroup := strings.TrimSpace(plan.UpgradeGroup)
	if purchaseUserGroup == "" {
		purchaseUserGroup = user.Group
	}
	selectableAfterPurchase := service.IsUserSelectableGroup(purchaseUserGroup, group)
	allowedGroups := model.ParseAllowedTokenGroups(plan.AllowedTokenGroups)
	// A billing scope does not grant group membership. Explicitly advertised
	// groups may be inspected, but the response must state whether purchase
	// actually permits their use. Unscoped plans expose only reachable groups.
	if (len(allowedGroups) > 0 && !slices.Contains(allowedGroups, group)) || (len(allowedGroups) == 0 && !selectableAfterPurchase) {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"), nil)
		return preview, false
	}
	preview.Group = group
	preview.GroupRatio = service.GetUserGroupRatio(purchaseUserGroup, group)
	preview.PurchaseUserGroup = purchaseUserGroup
	preview.SelectableNow = service.IsUserSelectableGroup(user.Group, group)
	preview.SelectableAfterPurchase = selectableAfterPurchase
	preview.AcceptUnsetPrice = user.GetSetting().AcceptUnsetRatioModel
	return preview, true
}

func GetSubscriptionPlanPricing(c *gin.Context) {
	preview, ok := subscriptionPlanPricingScope(c)
	if !ok {
		return
	}
	preview.Models = filterPricingByUsableGroups(model.GetPricing(), map[string]string{preview.Group: ""})
	if preview.Models == nil {
		preview.Models = []model.Pricing{}
	}
	common.ApiSuccess(c, preview)
}

func GetSubscriptionPlanPricingQuote(c *gin.Context) {
	preview, ok := subscriptionPlanPricingScope(c)
	if !ok {
		return
	}
	writePricingQuote(c, preview.PurchaseUserGroup, preview.AcceptUnsetPrice)
}

func GetSubscriptionSelf(c *gin.Context) {
	userId := c.GetInt("id")
	settingMap, _ := model.GetUserSetting(userId, false)
	pref := common.NormalizeBillingPreference(settingMap.BillingPreference)

	// Get all subscriptions (including expired)
	allSubscriptions, err := model.GetAllUserSubscriptions(userId)
	if err != nil {
		allSubscriptions = []model.SubscriptionSummary{}
	}

	// Get active subscriptions for backward compatibility
	activeSubscriptions, err := model.GetAllActiveUserSubscriptions(userId)
	if err != nil {
		activeSubscriptions = []model.SubscriptionSummary{}
	}

	common.ApiSuccess(c, gin.H{
		"billing_preference": pref,
		"subscriptions":      activeSubscriptions, // all active subscriptions
		"all_subscriptions":  allSubscriptions,    // all subscriptions including expired
	})
}

func UpdateSubscriptionPreference(c *gin.Context) {
	userId := c.GetInt("id")
	var req BillingPreferenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	pref := common.NormalizeBillingPreference(req.BillingPreference)

	user, err := model.GetUserById(userId, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	current := user.GetSetting()
	current.BillingPreference = pref
	if err := model.UpdateUserSetting(user.Id, current); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"billing_preference": pref})
}

func SubscriptionRequestBalancePay(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	userId := c.GetInt("id")
	var req SubscriptionBalancePayRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PlanId <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}

	if err := model.PurchaseSubscriptionWithBalance(userId, req.PlanId); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// ---- Admin APIs ----

func AdminListSubscriptionPlans(c *gin.Context) {
	var plans []model.SubscriptionPlan
	if err := model.DB.Order("sort_order desc, id desc").Find(&plans).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	result := make([]SubscriptionPlanDTO, 0, len(plans))
	for _, p := range plans {
		p.NormalizeDefaults()
		result = append(result, SubscriptionPlanDTO{
			Plan: p,
		})
	}
	common.ApiSuccess(c, result)
}

type AdminUpsertSubscriptionPlanRequest struct {
	Plan model.SubscriptionPlan `json:"plan"`
}

func normalizeSubscriptionTokenGroups(value string) (string, error) {
	normalized := model.NormalizeAllowedTokenGroups(value)
	groupRatios := ratio_setting.GetGroupRatioCopy()
	for _, group := range model.ParseAllowedTokenGroups(normalized) {
		if group == "auto" {
			continue
		}
		if _, exists := groupRatios[group]; !exists {
			return "", fmt.Errorf("允许使用分组不存在: %s", group)
		}
	}
	return normalized, nil
}

// defaultPlanWalletOverflow sets AllowWalletOverflow when omitted.
// Group-scoped plans default to false so package ratios do not silently fall
// onto wallet billing; unscoped plans keep the legacy disable_wallet_fallback mapping.
func defaultPlanWalletOverflow(plan *model.SubscriptionPlan, allowedTokenGroups string) {
	if plan.AllowWalletOverflow != nil {
		plan.DisableWalletFallback = !*plan.AllowWalletOverflow
		return
	}
	if allowedTokenGroups != "" {
		plan.AllowWalletOverflow = common.GetPointer(false)
	} else {
		plan.AllowWalletOverflow = common.GetPointer(!plan.DisableWalletFallback)
	}
	plan.DisableWalletFallback = !*plan.AllowWalletOverflow
}

func AdminCreateSubscriptionPlan(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	var req AdminUpsertSubscriptionPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	req.Plan.Id = 0
	if strings.TrimSpace(req.Plan.Title) == "" {
		common.ApiErrorT(c, "Subscription plan title cannot be empty")
		return
	}
	if req.Plan.PriceAmount < 0 {
		common.ApiErrorT(c, "Price cannot be negative")
		return
	}
	if req.Plan.PriceAmount > 9999 {
		common.ApiErrorT(c, "Price cannot exceed 9999")
		return
	}
	if req.Plan.Currency == "" {
		req.Plan.Currency = "USD"
	}
	req.Plan.Currency = "USD"
	if req.Plan.AllowBalancePay == nil {
		req.Plan.AllowBalancePay = common.GetPointer(true)
	}
	allowedTokenGroups, err := normalizeSubscriptionTokenGroups(req.Plan.AllowedTokenGroups)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	req.Plan.AllowedTokenGroups = allowedTokenGroups
	defaultPlanWalletOverflow(&req.Plan, allowedTokenGroups)
	if req.Plan.DurationUnit == "" {
		req.Plan.DurationUnit = model.SubscriptionDurationMonth
	}
	if req.Plan.DurationValue <= 0 && req.Plan.DurationUnit != model.SubscriptionDurationCustom {
		req.Plan.DurationValue = 1
	}
	if req.Plan.MaxPurchasePerUser < 0 {
		common.ApiErrorT(c, "Purchase limit cannot be negative")
		return
	}
	if req.Plan.TotalAmount < 0 {
		common.ApiErrorT(c, "Total quota cannot be negative")
		return
	}
	req.Plan.UpgradeGroup = strings.TrimSpace(req.Plan.UpgradeGroup)
	if req.Plan.UpgradeGroup != "" {
		if _, ok := ratio_setting.GetGroupRatioCopy()[req.Plan.UpgradeGroup]; !ok {
			common.ApiErrorT(c, "Upgrade group does not exist")
			return
		}
	}
	req.Plan.DowngradeGroup = strings.TrimSpace(req.Plan.DowngradeGroup)
	if req.Plan.DowngradeGroup != "" {
		if _, ok := ratio_setting.GetGroupRatioCopy()[req.Plan.DowngradeGroup]; !ok {
			common.ApiErrorT(c, "Downgrade group does not exist")
			return
		}
	}
	req.Plan.QuotaResetPeriod = model.NormalizeResetPeriod(req.Plan.QuotaResetPeriod)
	if req.Plan.QuotaResetPeriod == model.SubscriptionResetCustom && req.Plan.QuotaResetCustomSeconds <= 0 {
		common.ApiErrorT(c, "Custom reset cycle must be greater than 0 seconds")
		return
	}
	err = model.DB.Create(&req.Plan).Error
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.InvalidateSubscriptionPlanCache(req.Plan.Id)
	common.ApiSuccess(c, req.Plan)
}

func AdminUpdateSubscriptionPlan(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorT(c, "Invalid ID")
		return
	}
	var req AdminUpsertSubscriptionPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if strings.TrimSpace(req.Plan.Title) == "" {
		common.ApiErrorT(c, "Subscription plan title cannot be empty")
		return
	}
	if req.Plan.PriceAmount < 0 {
		common.ApiErrorT(c, "Price cannot be negative")
		return
	}
	if req.Plan.PriceAmount > 9999 {
		common.ApiErrorT(c, "Price cannot exceed 9999")
		return
	}
	req.Plan.Id = id
	if req.Plan.Currency == "" {
		req.Plan.Currency = "USD"
	}
	req.Plan.Currency = "USD"
	if req.Plan.DurationUnit == "" {
		req.Plan.DurationUnit = model.SubscriptionDurationMonth
	}
	if req.Plan.DurationValue <= 0 && req.Plan.DurationUnit != model.SubscriptionDurationCustom {
		req.Plan.DurationValue = 1
	}
	if req.Plan.MaxPurchasePerUser < 0 {
		common.ApiErrorT(c, "Purchase limit cannot be negative")
		return
	}
	if req.Plan.TotalAmount < 0 {
		common.ApiErrorT(c, "Total quota cannot be negative")
		return
	}
	allowedTokenGroups, err := normalizeSubscriptionTokenGroups(req.Plan.AllowedTokenGroups)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	req.Plan.AllowedTokenGroups = allowedTokenGroups
	defaultPlanWalletOverflow(&req.Plan, allowedTokenGroups)
	req.Plan.UpgradeGroup = strings.TrimSpace(req.Plan.UpgradeGroup)
	if req.Plan.UpgradeGroup != "" {
		if _, ok := ratio_setting.GetGroupRatioCopy()[req.Plan.UpgradeGroup]; !ok {
			common.ApiErrorT(c, "Upgrade group does not exist")
			return
		}
	}
	req.Plan.DowngradeGroup = strings.TrimSpace(req.Plan.DowngradeGroup)
	if req.Plan.DowngradeGroup != "" {
		if _, ok := ratio_setting.GetGroupRatioCopy()[req.Plan.DowngradeGroup]; !ok {
			common.ApiErrorT(c, "Downgrade group does not exist")
			return
		}
	}
	req.Plan.QuotaResetPeriod = model.NormalizeResetPeriod(req.Plan.QuotaResetPeriod)
	if req.Plan.QuotaResetPeriod == model.SubscriptionResetCustom && req.Plan.QuotaResetCustomSeconds <= 0 {
		common.ApiErrorT(c, "Custom reset cycle must be greater than 0 seconds")
		return
	}

	err = model.DB.Transaction(func(tx *gorm.DB) error {
		// update plan (allow zero values updates with map)
		updateMap := map[string]any{
			"title":                      req.Plan.Title,
			"subtitle":                   req.Plan.Subtitle,
			"price_amount":               req.Plan.PriceAmount,
			"currency":                   req.Plan.Currency,
			"duration_unit":              req.Plan.DurationUnit,
			"duration_value":             req.Plan.DurationValue,
			"custom_seconds":             req.Plan.CustomSeconds,
			"enabled":                    req.Plan.Enabled,
			"sort_order":                 req.Plan.SortOrder,
			"stripe_price_id":            req.Plan.StripePriceId,
			"creem_product_id":           req.Plan.CreemProductId,
			"waffo_pancake_product_id":   req.Plan.WaffoPancakeProductId,
			"max_purchase_per_user":      req.Plan.MaxPurchasePerUser,
			"total_amount":               req.Plan.TotalAmount,
			"upgrade_group":              req.Plan.UpgradeGroup,
			"downgrade_group":            req.Plan.DowngradeGroup,
			"allowed_token_groups":       req.Plan.AllowedTokenGroups,
			"disable_wallet_fallback":    req.Plan.DisableWalletFallback,
			"quota_reset_period":         req.Plan.QuotaResetPeriod,
			"quota_reset_custom_seconds": req.Plan.QuotaResetCustomSeconds,
			"updated_at":                 common.GetTimestamp(),
		}
		if req.Plan.AllowBalancePay != nil {
			updateMap["allow_balance_pay"] = *req.Plan.AllowBalancePay
		}
		if req.Plan.AllowWalletOverflow != nil {
			updateMap["allow_wallet_overflow"] = *req.Plan.AllowWalletOverflow
		}
		if err := tx.Model(&model.SubscriptionPlan{}).Where("id = ?", id).Updates(updateMap).Error; err != nil {
			return err
		}
		// Active subscriptions keep purchase-time snapshots; push overflow +
		// group scope when the admin updates the plan so the switch takes effect.
		if req.Plan.AllowWalletOverflow != nil {
			now := common.GetTimestamp()
			if err := tx.Model(&model.UserSubscription{}).
				Where("plan_id = ? AND status = ? AND end_time > ?", id, "active", now).
				Updates(map[string]any{
					"allow_wallet_overflow": *req.Plan.AllowWalletOverflow,
					"allowed_token_groups":  req.Plan.AllowedTokenGroups,
					"updated_at":            now,
				}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.InvalidateSubscriptionPlanCache(id)
	common.ApiSuccess(c, nil)
}

type AdminUpdateSubscriptionPlanStatusRequest struct {
	Enabled *bool `json:"enabled"`
}

func AdminUpdateSubscriptionPlanStatus(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorT(c, "Invalid ID")
		return
	}
	var req AdminUpdateSubscriptionPlanStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Enabled == nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := model.DB.Model(&model.SubscriptionPlan{}).Where("id = ?", id).Update("enabled", *req.Enabled).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	model.InvalidateSubscriptionPlanCache(id)
	common.ApiSuccess(c, nil)
}

type AdminBindSubscriptionRequest struct {
	UserId int `json:"user_id"`
	PlanId int `json:"plan_id"`
}

func AdminBindSubscription(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	var req AdminBindSubscriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.UserId <= 0 || req.PlanId <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	msg, err := model.AdminBindSubscription(req.UserId, req.PlanId, "")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	subscriptionChangeSuccess(c, msg)
}

// subscriptionChangeSuccess replies to an admin subscription change. notice
// tells the admin how the user's group changes, when it does.
func subscriptionChangeSuccess(c *gin.Context, notice *common.Message) {
	if notice == nil {
		common.ApiSuccess(c, nil)
		return
	}
	data := notice.Fields()
	data["message"] = notice.Error()
	common.ApiSuccess(c, data)
}

// ---- Admin: user subscription management ----

func AdminListUserSubscriptions(c *gin.Context) {
	userId, _ := strconv.Atoi(c.Param("id"))
	if userId <= 0 {
		common.ApiErrorT(c, "Invalid user ID")
		return
	}
	subs, err := model.GetAllUserSubscriptions(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, subs)
}

type AdminCreateUserSubscriptionRequest struct {
	PlanId int `json:"plan_id"`
}

type AdminResetSubscriptionRequest struct {
	PlanId           int   `json:"plan_id"`
	AdvanceResetTime *bool `json:"advance_reset_time"`
}

func resolveAdvanceResetTime(value *bool) bool {
	if value == nil {
		return true
	}
	return *value
}

func recordSubscriptionResetUserLogs(c *gin.Context, result *model.SubscriptionResetResult, adminInfo *model.AuditAdminInfo) {
	if result == nil || result.ResetCount == 0 {
		return
	}
	const action = "subscription.user_quota_reset"
	params := map[string]any{"plan_id": result.PlanId, "plan_title": result.PlanTitle}
	operation := model.AuditOperation{Action: action, Params: params}
	content := auditContentEN(action, params)
	for _, userId := range result.AffectedUserIds {
		model.RecordLogWithAdminInfo(userId, model.LogTypeManage, content, adminInfo, &operation, c)
	}
}

// AdminCreateUserSubscription creates a new user subscription from a plan (no payment).
func AdminCreateUserSubscription(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	userId, _ := strconv.Atoi(c.Param("id"))
	if userId <= 0 {
		common.ApiErrorT(c, "Invalid user ID")
		return
	}
	var req AdminCreateUserSubscriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PlanId <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	msg, err := model.AdminBindSubscription(userId, req.PlanId, "")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	subscriptionChangeSuccess(c, msg)
}

func AdminResetUserSubscriptionsByPlan(c *gin.Context) {
	userId, _ := strconv.Atoi(c.Param("id"))
	if userId <= 0 {
		common.ApiErrorT(c, "Invalid user ID")
		return
	}
	var req AdminResetSubscriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if req.PlanId <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	advanceResetTime := resolveAdvanceResetTime(req.AdvanceResetTime)
	result, err := model.AdminResetUserSubscriptionsByPlan(userId, req.PlanId, advanceResetTime)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordSubscriptionResetUserLogs(c, result, auditOperatorInfo(c))
	recordManageAuditFor(c, userId, "subscription.user_plan_reset", map[string]any{
		"target_user_id":     userId,
		"plan_id":            result.PlanId,
		"plan_title":         result.PlanTitle,
		"reset_count":        result.ResetCount,
		"user_count":         result.UserCount,
		"advance_reset_time": result.AdvanceResetTime,
	})
	common.ApiSuccess(c, result)
}

func AdminResetPlanSubscriptions(c *gin.Context) {
	planId, _ := strconv.Atoi(c.Param("id"))
	if planId <= 0 {
		common.ApiErrorT(c, "Invalid ID")
		return
	}
	var req AdminResetSubscriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	advanceResetTime := resolveAdvanceResetTime(req.AdvanceResetTime)
	result, err := model.AdminResetPlanSubscriptions(planId, advanceResetTime)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordSubscriptionResetUserLogs(c, result, auditOperatorInfo(c))
	common.SysLog(common.LogText("admin reset subscription plan %d quota: reset_count=%d user_count=%d advance_reset_time=%t",
		result.PlanId, result.ResetCount, result.UserCount, result.AdvanceResetTime))
	recordManageAudit(c, "subscription.plan_reset", map[string]any{
		"plan_id":            result.PlanId,
		"plan_title":         result.PlanTitle,
		"reset_count":        result.ResetCount,
		"user_count":         result.UserCount,
		"advance_reset_time": result.AdvanceResetTime,
	})
	common.ApiSuccess(c, result)
}

// AdminInvalidateUserSubscription cancels a user subscription immediately.
func AdminInvalidateUserSubscription(c *gin.Context) {
	subId, _ := strconv.Atoi(c.Param("id"))
	if subId <= 0 {
		common.ApiErrorT(c, "Invalid subscription ID")
		return
	}
	msg, err := model.AdminInvalidateUserSubscription(subId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	subscriptionChangeSuccess(c, msg)
}

// AdminDeleteUserSubscription hard-deletes a user subscription.
func AdminDeleteUserSubscription(c *gin.Context) {
	subId, _ := strconv.Atoi(c.Param("id"))
	if subId <= 0 {
		common.ApiErrorT(c, "Invalid subscription ID")
		return
	}
	msg, err := model.AdminDeleteUserSubscription(subId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	subscriptionChangeSuccess(c, msg)
}
