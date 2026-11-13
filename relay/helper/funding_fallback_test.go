package helper_test

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
	pluginruntime "github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/relay"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
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
	oldPrices, oldRatios := ratio_setting.ModelPrice2JSONString(), ratio_setting.ModelRatio2JSONString()
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.SetDatabaseTypes(oldMainType, oldLogType)
		common.RedisEnabled, common.BatchUpdateEnabled = oldRedis, oldBatch
		setting.QuotaBucketBillingEnabled, setting.PaidQuotaBillingGroup = oldBuckets, oldPaidGroup
		common.QuotaPerUnit = oldQuotaPerUnit
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(oldPrices))
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(oldRatios))
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
	})
	common.RedisEnabled, common.BatchUpdateEnabled = false, false
	setting.QuotaBucketBillingEnabled, setting.PaidQuotaBillingGroup = true, "vip"
	common.QuotaPerUnit = 500000
	require.NoError(t, i18n.Init())
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode":          `{"funding-fixed":"tiered_expr","funding-task-expr":"tiered_expr"}`,
		"billing_setting.billing_expr":          `{"funding-fixed":"tier(\"request\", fixed(0.080326))","funding-task-expr":"tier(\"task\", u(\"seconds\") * 0.0200815)"}`,
		"group_ratio_setting.group_ratio":       `{"Team/Plus":1}`,
		"group_ratio_setting.group_group_ratio": `{"vip":{"Team/Plus":0.5}}`,
	}))

	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"funding-image":0.080326,"funding-task":0.0200815}`))
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"funding-token":1}`))

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
		name, pref, pricing                          string
		subRemaining                                 int64
		defaultQuota, vipQuota                       int
		blockOverflow, pinDefault, wantError, refund bool
		wantSource, wantGroup                        string
		wantQuota                                    int
	}{
		{name: "reported subscription fallback", pref: "subscription_first", subRemaining: 17579, defaultQuota: 34869, vipQuota: 27497112, wantSource: "wallet", wantGroup: "vip", wantQuota: 20082},
		{name: "subscription still wins when sufficient", pref: "subscription_first", subRemaining: 50000, defaultQuota: 34869, vipQuota: 27497112, wantSource: "subscription", wantQuota: 40163},
		{name: "insufficient VIP uses ordinary price", pref: "subscription_first", subRemaining: 17579, defaultQuota: 50000, vipQuota: 100, wantSource: "wallet", wantQuota: 40163},
		{name: "neither wallet bucket suffices", pref: "subscription_first", subRemaining: 17579, defaultQuota: 34869, vipQuota: 100, wantError: true},
		{name: "overflow disabled", pref: "subscription_first", subRemaining: 17579, defaultQuota: 34869, vipQuota: 27497112, blockOverflow: true, wantError: true},
		{name: "subscription only", pref: "subscription_only", subRemaining: 17579, defaultQuota: 34869, vipQuota: 27497112, wantError: true},
		{name: "pinned ordinary bucket", pref: "subscription_first", subRemaining: 17579, defaultQuota: 34869, vipQuota: 27497112, pinDefault: true, wantError: true},
		{name: "wallet first", pref: "wallet_first", subRemaining: 50000, defaultQuota: 34869, vipQuota: 27497112, wantSource: "wallet", wantGroup: "vip", wantQuota: 20082},
		{name: "wallet fallback restores subscription price", pref: "wallet_first", subRemaining: 50000, defaultQuota: 34869, vipQuota: 27497112, blockOverflow: true, wantSource: "subscription", wantQuota: 40163},
		{name: "token pricing and refund", pricing: "token", pref: "subscription_first", subRemaining: 17579, defaultQuota: 34869, vipQuota: 27497112, wantSource: "wallet", wantGroup: "vip", wantQuota: 20081, refund: true},
		{name: "image pricing", pricing: "image", pref: "subscription_first", subRemaining: 17579, defaultQuota: 34869, vipQuota: 27497112, wantSource: "wallet", wantGroup: "vip", wantQuota: 20081},
		{name: "studio hold", pricing: "studio", pref: "subscription_first", subRemaining: 17579, defaultQuota: 34869, vipQuota: 27497112, wantSource: "wallet", wantGroup: "vip", wantQuota: 20081},
		{name: "task legacy modifiers", pricing: "task", pref: "subscription_first", subRemaining: 17579, defaultQuota: 34869, vipQuota: 27497112, wantSource: "wallet", wantGroup: "vip", wantQuota: 20080},
		{name: "task expression", pricing: "task-expr", pref: "subscription_first", subRemaining: 17579, defaultQuota: 34869, vipQuota: 27497112, wantSource: "wallet", wantGroup: "vip", wantQuota: 20082},
	} {
		t.Run(tc.name, func(t *testing.T) {
			requestID := fmt.Sprintf("funding-%d", time.Now().UnixNano())
			user := &model.User{Username: requestID, Quota: tc.defaultQuota, Status: common.UserStatusEnabled}
			require.NoError(t, db.Create(user).Error)
			t.Cleanup(func() {
				for _, row := range []any{&model.Token{}, &model.SubscriptionPreConsumeRecord{}, &model.UserSubscription{}, &model.UserQuotaBucketTransaction{}, &model.UserQuotaBucket{}} {
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
			token := &model.Token{UserId: user.Id, Key: requestID, Status: common.TokenStatusEnabled, RemainQuota: 100000}
			require.NoError(t, db.Create(token).Error)
			info.IsPlayground = false
			info.TokenId, info.TokenKey = token.Id, token.Key
			var quota int
			switch tc.pricing {
			case "task", "task-expr":
				info.OriginModelName = "funding-" + tc.pricing
				ctx.Set("task_request", map[string]any{"prompt": "test"})
				common.SetContextKey(ctx, constant.ContextKeyChannelBaseUrl, "https://provider.example")
				registry := pluginruntime.NewRegistry()
				plugin, err := registry.Register(`
export const meta = {apiVersion:1,key:"funding-test",name:"Funding Test",version:"1.0.0",author:{name:"Test"},models:["funding-task","funding-task-expr"],fetchMode:"per_task",usageSchema:{seconds:{type:"number",unit:"second",description:{en:"Video generation unit price",zh:"视频生成单价"}}}};
export function buildSubmitRequest(ctx){return {url:ctx.baseUrl+"/submit",method:"POST",body:{model:ctx.model},action:"text_to_video"};}
export function parseSubmitResponse(){return {taskId:"1"};}
export function buildQueryRequest(){return {url:"https://provider.example/query"};}
export function parseTaskResult(){return {status:"SUCCESS"};}
export function extractUsage(){return {seconds:4};}
`, pluginruntime.Options{})
				require.NoError(t, err)
				ctx.Set(pluginruntime.ContextKeyPinnedPlugin, pluginruntime.PinnedPlugin{Generation: registry.Generation(), Plugin: plugin})
				_, _, taskErr := relay.EstimateTaskSubmission(ctx, info)
				require.Nil(t, taskErr)
				quota = info.PriceData.Quota
			default:
				prompt := 0
				if tc.pricing == "token" {
					info.OriginModelName, prompt = "funding-token", 40163
				}
				if tc.pricing == "image" || tc.pricing == "studio" {
					info.OriginModelName = "funding-image"
					one := uint(1)
					info.Request = &dto.ImageRequest{Model: info.OriginModelName, N: &one}
				}
				price, err := helper.ModelPriceHelper(ctx, info, prompt, &types.TokenCountMeta{})
				require.NoError(t, err)
				quota = price.QuotaToPreConsume
			}
			var session relaycommon.BillingSettler
			var apiErr *types.NewAPIError
			if tc.pricing == "studio" {
				hold, holdErr := service.PreHoldImageStudioBilling(ctx, info, quota)
				require.Nil(t, holdErr)
				assert.Equal(t, tc.wantSource, hold.Source)
				assert.Equal(t, tc.wantGroup, hold.BillingGroup)
				assert.Equal(t, tc.wantQuota, hold.Quota)
				require.NoError(t, model.RefundUserQuotaBuckets(requestID))
			} else {
				session, apiErr = service.NewBillingSession(ctx, info, quota)
			}
			spent := 0
			if tc.wantError {
				require.NotNil(t, apiErr)
				assert.Equal(t, http.StatusForbidden, apiErr.StatusCode)
				assert.Equal(t, types.ErrorCodeInsufficientUserQuota, apiErr.GetErrorCode())
			} else if tc.pricing != "studio" {
				require.Nil(t, apiErr, "funding fallback must succeed with sufficient selected bucket: %v", apiErr)
				require.NotNil(t, session)
				assert.Equal(t, tc.wantSource, info.BillingSource)
				assert.Equal(t, tc.wantGroup, info.BillingGroup)
				assert.Equal(t, tc.wantQuota, session.GetPreConsumedQuota())
				if tc.pricing == "task" || tc.pricing == "task-expr" {
					assert.Equal(t, tc.wantQuota, info.PriceData.Quota)
				} else {
					assert.Equal(t, tc.wantQuota, info.PriceData.QuotaToPreConsume)
				}
				if info.TieredBillingSnapshot != nil {
					assert.Equal(t, tc.wantQuota, info.TieredBillingSnapshot.EstimatedQuotaAfterGroup)
					assert.Equal(t, info.PriceData.GroupRatioInfo.GroupRatio, info.TieredBillingSnapshot.GroupRatio)
				}
				if tc.wantGroup == "vip" {
					assert.Equal(t, 0.5, info.PriceData.GroupRatioInfo.GroupRatio)
				}
				if tc.pricing == "task" {
					assert.Equal(t, float64(4), info.PriceData.OtherRatios()["seconds"])
				}
				if tc.refund {
					session.Refund(ctx)
					require.Eventually(t, func() bool {
						var after model.Token
						return db.First(&after, token.Id).Error == nil && after.RemainQuota == token.RemainQuota
					}, 3*time.Second, 5*time.Millisecond)
				} else {
					spent = tc.wantQuota + 10
					require.NoError(t, session.Settle(spent))
					require.NoError(t, session.Settle(spent))
				}
			}
			balance, err := model.GetUserQuotaBucketBalance(user.Id, "default")
			require.NoError(t, err)
			wantDefault, wantVIP := tc.defaultQuota, tc.vipQuota
			wantSubUsed := sub.AmountUsed
			if tc.wantSource == "subscription" {
				wantSubUsed += int64(spent)
			} else if tc.wantGroup == "vip" {
				wantVIP -= spent
			} else {
				wantDefault -= spent
			}
			assert.Equal(t, wantDefault, balance)
			balance, err = model.GetUserQuotaBucketBalance(user.Id, "vip")
			require.NoError(t, err)
			assert.Equal(t, wantVIP, balance)
			var after model.UserSubscription
			require.NoError(t, db.First(&after, sub.Id).Error)
			assert.Equal(t, wantSubUsed, after.AmountUsed)
			var tokenAfter model.Token
			require.NoError(t, db.First(&tokenAfter, token.Id).Error)
			assert.Equal(t, token.RemainQuota-spent, tokenAfter.RemainQuota)
		})
	}
}
