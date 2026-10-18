package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type publicSubscriptionPlansResponse struct {
	Success bool                        `json:"success"`
	Data    []PublicSubscriptionPlanDTO `json:"data"`
}

func openPublicSubscriptionPlanTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gin.SetMode(gin.TestMode)
	previousDB := model.DB
	previousLogDB := model.LOG_DB
	previousMainDatabaseType := common.MainDatabaseType()
	previousLogDatabaseType := common.LogDatabaseType()
	previousRedisEnabled := common.RedisEnabled
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.RedisEnabled = false

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	model.LOG_DB = db
	require.NoError(t, db.AutoMigrate(&model.SubscriptionPlan{}))
	t.Cleanup(func() {
		model.DB = previousDB
		model.LOG_DB = previousLogDB
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
		common.RedisEnabled = previousRedisEnabled
		sqlDB, dbErr := db.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

func setPublicPlanCompliance(t *testing.T, confirmed bool) {
	t.Helper()
	paymentSetting := operation_setting.GetPaymentSetting()
	previousConfirmed := paymentSetting.ComplianceConfirmed
	previousVersion := paymentSetting.ComplianceTermsVersion
	t.Cleanup(func() {
		paymentSetting.ComplianceConfirmed = previousConfirmed
		paymentSetting.ComplianceTermsVersion = previousVersion
	})
	paymentSetting.ComplianceConfirmed = confirmed
	if confirmed {
		paymentSetting.ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	} else {
		paymentSetting.ComplianceTermsVersion = ""
	}
}

func requestPublicSubscriptionPlans(t *testing.T) (*httptest.ResponseRecorder, publicSubscriptionPlansResponse) {
	t.Helper()
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/subscription/public-plans", nil)
	GetPublicSubscriptionPlans(context)
	var response publicSubscriptionPlansResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	return recorder, response
}

func TestGetPublicSubscriptionPlansRequiresPaymentCompliance(t *testing.T) {
	openPublicSubscriptionPlanTestDB(t)
	setPublicPlanCompliance(t, false)
	recorder, response := requestPublicSubscriptionPlans(t)
	require.Equal(t, http.StatusOK, recorder.Code)
	assert.True(t, response.Success)
	assert.Empty(t, response.Data)
}

func TestGetPublicSubscriptionPlansIsSanitizedEnabledSortedAndNormalized(t *testing.T) {
	db := openPublicSubscriptionPlanTestDB(t)
	setPublicPlanCompliance(t, true)
	allowOverflow := true
	plans := []model.SubscriptionPlan{
		{Title: "Basic", Enabled: true, SortOrder: 10, PriceAmount: 9.5, Currency: "USD", DurationUnit: "month", DurationValue: 1, TotalAmount: 1000, QuotaResetPeriod: "monthly", StripePriceId: "price_secret", CreemProductId: "creem_secret", WaffoPancakeProductId: "waffo_secret", MaxPurchasePerUser: 2, DowngradeGroup: "legacy", AllowedTokenGroups: `["vip","default"]`, DisableWalletFallback: true},
		{Title: "Pro older", Enabled: true, SortOrder: 20, PriceAmount: 19, Currency: "USD", DurationUnit: "custom", DurationValue: 2, CustomSeconds: 3600, TotalAmount: 2000, QuotaResetPeriod: "custom", QuotaResetCustomSeconds: 600, UpgradeGroup: "vip", AllowWalletOverflow: &allowOverflow},
		{Title: "Pro newer", Enabled: true, SortOrder: 20, PriceAmount: 29, Currency: "CNY", DurationUnit: "year", DurationValue: 1, TotalAmount: 3000, QuotaResetPeriod: "never"},
		{Title: "Disabled", Enabled: false, SortOrder: 999, StripePriceId: "must_not_appear"},
	}
	for index := range plans {
		require.NoError(t, db.Create(&plans[index]).Error)
	}
	require.NoError(t, db.Model(&model.SubscriptionPlan{}).Where("id = ?", plans[3].Id).Update("enabled", false).Error)

	recorder, response := requestPublicSubscriptionPlans(t)
	require.Equal(t, http.StatusOK, recorder.Code)
	require.True(t, response.Success)
	require.Len(t, response.Data, 3)
	assert.Equal(t, []int{plans[2].Id, plans[1].Id, plans[0].Id}, []int{response.Data[0].Id, response.Data[1].Id, response.Data[2].Id})
	assert.Equal(t, "default,vip", response.Data[2].AllowedTokenGroups)
	assert.False(t, response.Data[2].AllowWalletOverflow)
	assert.True(t, response.Data[1].AllowWalletOverflow)

	var rawResponse struct {
		Data []map[string]any `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &rawResponse))
	allowedKeys := map[string]struct{}{
		"id": {}, "title": {}, "subtitle": {}, "price_amount": {}, "currency": {},
		"duration_unit": {}, "duration_value": {}, "custom_seconds": {}, "total_amount": {},
		"quota_reset_period": {}, "quota_reset_custom_seconds": {}, "upgrade_group": {},
		"allowed_token_groups": {}, "allow_wallet_overflow": {},
	}
	for _, plan := range rawResponse.Data {
		keys := make(map[string]struct{}, len(plan))
		for key := range plan {
			keys[key] = struct{}{}
		}
		assert.Equal(t, allowedKeys, keys)
	}
}
