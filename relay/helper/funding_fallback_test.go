package helper

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Exercise pricing and real funding together: an active subscription can be
// insufficient even though it still wins the initial funding preference.
func TestFundingFallbackBucketPricing(t *testing.T) {
	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		saved[key] = value
		return nil
	}))
	oldDB, oldLogDB := model.DB, model.LOG_DB
	oldMainType, oldLogType := common.MainDatabaseType(), common.LogDatabaseType()
	oldRedis, oldBatch := common.RedisEnabled, common.BatchUpdateEnabled
	oldBuckets, oldPaidGroup := setting.QuotaBucketBillingEnabled, setting.PaidQuotaBillingGroup
	oldQuotaPerUnit := common.QuotaPerUnit
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.SetDatabaseTypes(oldMainType, oldLogType)
		common.RedisEnabled, common.BatchUpdateEnabled = oldRedis, oldBatch
		setting.QuotaBucketBillingEnabled, setting.PaidQuotaBillingGroup = oldBuckets, oldPaidGroup
		common.QuotaPerUnit = oldQuotaPerUnit
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
	})
	common.RedisEnabled, common.BatchUpdateEnabled = false, false
	setting.QuotaBucketBillingEnabled, setting.PaidQuotaBillingGroup = true, "vip"
	common.QuotaPerUnit = 500000
	require.NoError(t, i18n.Init())
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode":          `{"funding-fixed":"tiered_expr"}`,
		"billing_setting.billing_expr":          `{"funding-fixed":"tier(\"request\", fixed(0.080326))"}`,
		"group_ratio_setting.group_ratio":       `{"Team/Plus":1}`,
		"group_ratio_setting.group_group_ratio": `{"vip":{"Team/Plus":0.5}}`,
	}))

	var dialector gorm.Dialector
	switch os.Getenv("NEWAPI_TEST_DB") {
	case "mysql":
		dialector = mysql.Open(os.Getenv("NEWAPI_TEST_DSN"))
		common.SetDatabaseTypes(common.DatabaseTypeMySQL, common.DatabaseTypeMySQL)
	case "postgres":
		dialector = postgres.Open(os.Getenv("NEWAPI_TEST_DSN"))
		common.SetDatabaseTypes(common.DatabaseTypePostgreSQL, common.DatabaseTypePostgreSQL)
	default:
		dialector = sqlite.Open(":memory:")
		common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	}
	db, err := gorm.Open(dialector, &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	model.DB, model.LOG_DB = db, db
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Token{}, &model.UserQuotaBucket{}, &model.UserQuotaBucketTransaction{}, &model.SubscriptionPlan{}, &model.UserSubscription{}, &model.SubscriptionPreConsumeRecord{}))

	for _, tc := range []struct {
		name                                 string
		pref                                 string
		subRemaining                         int64
		defaultQuota, vipQuota               int
		blockOverflow, pinDefault, wantError bool
		wantSource, wantGroup                string
		wantQuota                            int
	}{
		{"reported subscription fallback", "subscription_first", 17579, 34869, 27497112, false, false, false, "wallet", "vip", 20082},
		{"subscription still wins when sufficient", "subscription_first", 50000, 34869, 27497112, false, false, false, "subscription", "", 40163},
		{"insufficient VIP uses ordinary price", "subscription_first", 17579, 50000, 100, false, false, false, "wallet", "", 40163},
		{"neither wallet bucket suffices", "subscription_first", 17579, 34869, 100, false, false, true, "", "", 0},
		{"overflow disabled", "subscription_first", 17579, 34869, 27497112, true, false, true, "", "", 0},
		{"subscription only", "subscription_only", 17579, 34869, 27497112, false, false, true, "", "", 0},
		{"pinned ordinary bucket", "subscription_first", 17579, 34869, 27497112, false, true, true, "", "", 0},
		{"wallet first", "wallet_first", 50000, 34869, 27497112, false, false, false, "wallet", "vip", 20082},
	} {
		t.Run(tc.name, func(t *testing.T) {
			requestID := fmt.Sprintf("funding-%d", time.Now().UnixNano())
			user := &model.User{Username: requestID, Quota: tc.defaultQuota, Status: common.UserStatusEnabled}
			require.NoError(t, db.Create(user).Error)
			t.Cleanup(func() {
				for _, row := range []any{&model.SubscriptionPreConsumeRecord{}, &model.UserSubscription{}, &model.UserQuotaBucketTransaction{}, &model.UserQuotaBucket{}} {
					require.NoError(t, db.Where("user_id = ?", user.Id).Delete(row).Error)
				}
				require.NoError(t, db.Unscoped().Delete(user).Error)
			})
			require.NoError(t, model.CreditUserQuotaBucket(user.Id, tc.vipQuota, model.QuotaBucketSourceRedemption, requestID, "vip"))
			plan := &model.SubscriptionPlan{Title: requestID, TotalAmount: 100000, QuotaResetPeriod: model.SubscriptionResetNever}
			require.NoError(t, db.Create(plan).Error)
			t.Cleanup(func() { require.NoError(t, db.Delete(plan).Error) })
			sub := &model.UserSubscription{UserId: user.Id, PlanId: plan.Id, AmountTotal: 100000, AmountUsed: 100000 - tc.subRemaining, Status: "active", StartTime: time.Now().Unix() - 60, EndTime: time.Now().Unix() + 3600, AllowedTokenGroups: "Team/Plus", AllowWalletOverflow: !tc.blockOverflow}
			require.NoError(t, db.Create(sub).Error)
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			if tc.pinDefault {
				ctx.Set(string(constant.ContextKeyQuotaBucketBillingGroup), "")
			}
			info := &relaycommon.RelayInfo{UserId: user.Id, UserGroup: "default", UsingGroup: "Team/Plus", OriginModelName: "funding-fixed", RequestId: requestID, ForcePreConsume: true, IsPlayground: true, UserSetting: dto.UserSetting{BillingPreference: tc.pref}, BillingRequestInput: &billingexpr.RequestInput{}}
			price, err := ModelPriceHelper(ctx, info, 0, &types.TokenCountMeta{})
			require.NoError(t, err)
			session, apiErr := service.NewBillingSession(ctx, info, price.QuotaToPreConsume)
			if tc.wantError {
				require.NotNil(t, apiErr)
				assert.Equal(t, http.StatusForbidden, apiErr.StatusCode)
				assert.Equal(t, types.ErrorCodeInsufficientUserQuota, apiErr.GetErrorCode())
			} else {
				require.Nil(t, apiErr, "funding fallback must succeed with sufficient selected bucket: %v", apiErr)
				require.NotNil(t, session)
				assert.Equal(t, tc.wantSource, info.BillingSource)
				assert.Equal(t, tc.wantGroup, info.BillingGroup)
				assert.Equal(t, tc.wantQuota, session.GetPreConsumedQuota())
				assert.Equal(t, tc.wantQuota, info.PriceData.QuotaToPreConsume)
				assert.Equal(t, tc.wantQuota, info.TieredBillingSnapshot.EstimatedQuotaAfterGroup)
				if tc.wantGroup == "vip" {
					assert.Equal(t, 0.5, info.PriceData.GroupRatioInfo.GroupRatio)
					assert.Equal(t, 0.5, info.TieredBillingSnapshot.GroupRatio)
				}
				// Settlement must debit the same bucket, then returning the charge
				// to zero must restore the exact starting balances.
				require.NoError(t, session.Settle(0))
			}
			balance, err := model.GetUserQuotaBucketBalance(user.Id, "default")
			require.NoError(t, err)
			assert.Equal(t, tc.defaultQuota, balance)
			balance, err = model.GetUserQuotaBucketBalance(user.Id, "vip")
			require.NoError(t, err)
			assert.Equal(t, tc.vipQuota, balance)
			var after model.UserSubscription
			require.NoError(t, db.First(&after, sub.Id).Error)
			assert.Equal(t, sub.AmountUsed, after.AmountUsed)
		})
	}
}
