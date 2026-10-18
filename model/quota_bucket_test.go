package model

import (
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func withQuotaBucketBilling(t *testing.T) {
	t.Helper()
	oldEnabled := setting.QuotaBucketBillingEnabled
	oldPaidGroup := setting.PaidQuotaBillingGroup
	setting.QuotaBucketBillingEnabled = true
	setting.PaidQuotaBillingGroup = "vip"
	t.Cleanup(func() {
		setting.QuotaBucketBillingEnabled = oldEnabled
		setting.PaidQuotaBillingGroup = oldPaidGroup
	})
}

func insertQuotaBucketUser(t *testing.T, id int, quota int) {
	t.Helper()
	require.NoError(t, DB.Create(&User{
		Id:       id,
		Username: "quota_bucket_user",
		Status:   common.UserStatusEnabled,
		Quota:    quota,
	}).Error)
}

func withQuotaPerUnit(t *testing.T, value float64) {
	t.Helper()
	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = value
	t.Cleanup(func() {
		common.QuotaPerUnit = oldQuotaPerUnit
	})
}

func getBucketBalanceForTest(t *testing.T, userId int, group string) int {
	t.Helper()
	balance, err := GetUserQuotaBucketBalance(userId, group)
	require.NoError(t, err)
	return balance
}

func TestCreditUserQuotaBucketMigratesLegacyAndCreditsPaidBucket(t *testing.T) {
	truncateTables(t)
	withQuotaBucketBilling(t)

	insertQuotaBucketUser(t, 301, 50)

	require.NoError(t, CreditUserQuotaBucket(301, 10, QuotaBucketSourceTopup, "trade-301", GetPaidQuotaBillingGroup()))
	assert.Equal(t, 50, getBucketBalanceForTest(t, 301, QuotaBucketBillingGroupDefault))
	assert.Equal(t, 10, getBucketBalanceForTest(t, 301, GetPaidQuotaBillingGroup()))
	assert.Equal(t, 60, getUserQuotaForPaymentGuardTest(t, 301))

	// Same source/source_id is idempotent.
	require.NoError(t, CreditUserQuotaBucket(301, 10, QuotaBucketSourceTopup, "trade-301", GetPaidQuotaBillingGroup()))
	assert.Equal(t, 10, getBucketBalanceForTest(t, 301, GetPaidQuotaBillingGroup()))
	assert.Equal(t, 60, getUserQuotaForPaymentGuardTest(t, 301))
}

func TestDebitUserQuotaBucketsUsesRequestedBillingGroup(t *testing.T) {
	truncateTables(t)
	withQuotaBucketBilling(t)

	insertQuotaBucketUser(t, 302, 50)
	require.NoError(t, CreditUserQuotaBucket(302, 10, QuotaBucketSourceRedemption, "redeem-302", GetPaidQuotaBillingGroup()))

	_, err := DebitUserQuotaBuckets(302, 6, QuotaBucketChargeMeta{RequestID: "req-paid", BillingGroup: GetPaidQuotaBillingGroup()}, QuotaBucketTxnTypePreConsume)
	require.NoError(t, err)
	assert.Equal(t, 4, getBucketBalanceForTest(t, 302, GetPaidQuotaBillingGroup()))
	assert.Equal(t, 50, getBucketBalanceForTest(t, 302, QuotaBucketBillingGroupDefault))
	assert.Equal(t, 54, getUserQuotaForPaymentGuardTest(t, 302))

	_, err = DebitUserQuotaBuckets(302, 20, QuotaBucketChargeMeta{RequestID: "req-default", BillingGroup: QuotaBucketBillingGroupDefault}, QuotaBucketTxnTypePreConsume)
	require.NoError(t, err)
	assert.Equal(t, 4, getBucketBalanceForTest(t, 302, GetPaidQuotaBillingGroup()))
	assert.Equal(t, 30, getBucketBalanceForTest(t, 302, QuotaBucketBillingGroupDefault))
	assert.Equal(t, 34, getUserQuotaForPaymentGuardTest(t, 302))
}

func TestPurchaseSubscriptionWithWalletUsesPaidBucketOnly(t *testing.T) {
	truncateTables(t)
	withQuotaBucketBilling(t)
	withQuotaPerUnit(t, 1000)

	insertQuotaBucketUser(t, 303, 1000)
	require.NoError(t, CreditUserQuotaBucket(303, 5000, QuotaBucketSourceRedemption, "redeem-303", GetPaidQuotaBillingGroup()))
	plan := &SubscriptionPlan{
		Id:            303,
		Title:         "Wallet Plan",
		PriceAmount:   2,
		Currency:      "USD",
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		Enabled:       true,
		TotalAmount:   10000,
	}
	require.NoError(t, DB.Create(plan).Error)

	result, err := PurchaseSubscriptionWithWallet(303, plan.Id)
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, 2000, result.ChargedQuota)
	assert.Equal(t, 3000, getBucketBalanceForTest(t, 303, GetPaidQuotaBillingGroup()))
	assert.Equal(t, 1000, getBucketBalanceForTest(t, 303, QuotaBucketBillingGroupDefault))
	assert.Equal(t, 4000, getUserQuotaForPaymentGuardTest(t, 303))
	assert.Equal(t, int64(1), countUserSubscriptionsForPaymentGuardTest(t, 303))

	var order SubscriptionOrder
	require.NoError(t, DB.Where("trade_no = ?", result.TradeNo).First(&order).Error)
	assert.Equal(t, PaymentMethodBalance, order.PaymentMethod)
	assert.Equal(t, common.TopUpStatusSuccess, order.Status)
}

func TestPurchaseSubscriptionWithBalanceDelegatesToPaidBucketWhenBucketBillingEnabled(t *testing.T) {
	truncateTables(t)
	withQuotaBucketBilling(t)
	withQuotaPerUnit(t, 1000)

	insertQuotaBucketUser(t, 305, 1000)
	require.NoError(t, CreditUserQuotaBucket(305, 5000, QuotaBucketSourceRedemption, "redeem-305", GetPaidQuotaBillingGroup()))
	plan := &SubscriptionPlan{
		Id:            305,
		Title:         "Legacy Balance Plan",
		PriceAmount:   2,
		Currency:      "USD",
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		Enabled:       true,
		TotalAmount:   10000,
	}
	require.NoError(t, DB.Create(plan).Error)

	require.NoError(t, PurchaseSubscriptionWithBalance(305, plan.Id))
	assert.Equal(t, 3000, getBucketBalanceForTest(t, 305, GetPaidQuotaBillingGroup()))
	assert.Equal(t, 1000, getBucketBalanceForTest(t, 305, QuotaBucketBillingGroupDefault))
	assert.Equal(t, 4000, getUserQuotaForPaymentGuardTest(t, 305))
	assert.Equal(t, int64(1), countUserSubscriptionsForPaymentGuardTest(t, 305))

	var order SubscriptionOrder
	require.NoError(t, DB.Where("user_id = ?", 305).First(&order).Error)
	assert.Equal(t, PaymentMethodBalance, order.PaymentMethod)
	assert.Equal(t, common.TopUpStatusSuccess, order.Status)
}

func TestPurchaseSubscriptionWithWalletDoesNotFallbackToDefaultBucket(t *testing.T) {
	truncateTables(t)
	withQuotaBucketBilling(t)
	withQuotaPerUnit(t, 1000)

	insertQuotaBucketUser(t, 304, 1000)
	require.NoError(t, CreditUserQuotaBucket(304, 500, QuotaBucketSourceRedemption, "redeem-304", GetPaidQuotaBillingGroup()))
	plan := &SubscriptionPlan{
		Id:            304,
		Title:         "Wallet Plan",
		PriceAmount:   1,
		Currency:      "USD",
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		Enabled:       true,
		TotalAmount:   10000,
	}
	require.NoError(t, DB.Create(plan).Error)

	_, err := PurchaseSubscriptionWithWallet(304, plan.Id)
	require.ErrorIs(t, err, ErrQuotaBucketInsufficient)
	assert.Equal(t, 500, getBucketBalanceForTest(t, 304, GetPaidQuotaBillingGroup()))
	assert.Equal(t, 1000, getBucketBalanceForTest(t, 304, QuotaBucketBillingGroupDefault))
	assert.Equal(t, 1500, getUserQuotaForPaymentGuardTest(t, 304))
	assert.Equal(t, int64(0), countUserSubscriptionsForPaymentGuardTest(t, 304))
}

func TestQuotaBucketPartialThenFullRefundRestoresOnlyNetDebit(t *testing.T) {
	truncateTables(t)
	withQuotaBucketBilling(t)
	insertQuotaBucketUser(t, 310, 50)
	require.NoError(t, CreditUserQuotaBucket(310, 30, QuotaBucketSourceTopup, "refund-credit", "vip"))
	meta := QuotaBucketChargeMeta{RequestID: "refund-net", BillingGroup: "vip"}
	_, err := DebitUserQuotaBuckets(310, 20, meta, QuotaBucketTxnTypePreConsume)
	require.NoError(t, err)
	require.NoError(t, RefundUserQuotaBucketDelta(meta.RequestID, 310, 5))
	assert.Equal(t, 15, getBucketBalanceForTest(t, 310, "vip"))
	require.NoError(t, RefundUserQuotaBuckets(meta.RequestID))
	require.NoError(t, RefundUserQuotaBuckets(meta.RequestID))
	assert.Equal(t, 30, getBucketBalanceForTest(t, 310, "vip"))
	assert.Equal(t, 80, getUserQuotaForPaymentGuardTest(t, 310))
}

func TestQuotaBucketAdminOverridePreservesSpendableInflightRefund(t *testing.T) {
	truncateTables(t)
	withQuotaBucketBilling(t)
	insertQuotaBucketUser(t, 311, 50)
	require.NoError(t, CreditUserQuotaBucket(311, 30, QuotaBucketSourceTopup, "override-credit", "vip"))
	meta := QuotaBucketChargeMeta{RequestID: "override-hold", BillingGroup: "vip"}
	_, err := DebitUserQuotaBuckets(311, 20, meta, QuotaBucketTxnTypePreConsume)
	require.NoError(t, err)
	_, err = AdjustUserQuota(311, common.RoleRootUser, "override", 100)
	require.NoError(t, err)
	require.NoError(t, RefundUserQuotaBuckets(meta.RequestID))
	assert.Equal(t, 100, getBucketBalanceForTest(t, 311, "default"))
	assert.Equal(t, 20, getBucketBalanceForTest(t, 311, "vip"))
	assert.Equal(t, 120, getUserQuotaForPaymentGuardTest(t, 311))
	_, err = AdjustUserQuota(311, common.RoleRootUser, "subtract", 10)
	require.NoError(t, err)
	_, err = AdjustUserQuota(311, common.RoleRootUser, "add", 5)
	require.NoError(t, err)
	assert.Equal(t, 10, getBucketBalanceForTest(t, 311, "vip"))
	assert.Equal(t, 105, getBucketBalanceForTest(t, 311, "default"))
	assert.Equal(t, 115, getUserQuotaForPaymentGuardTest(t, 311))
}

func TestQuotaBucketStudioSettlementAndRefundStayInOriginalBucket(t *testing.T) {
	truncateTables(t)
	withQuotaBucketBilling(t)
	insertQuotaBucketUser(t, 312, 50)
	require.NoError(t, CreditUserQuotaBucket(312, 100, QuotaBucketSourceTopup, "studio-credit", "vip"))
	meta := QuotaBucketChargeMeta{RequestID: "studio-hold", BillingGroup: "vip"}
	_, err := DebitUserQuotaBuckets(312, 20, meta, QuotaBucketTxnTypePreConsume)
	require.NoError(t, err)
	task := &Task{TaskID: "studio-bucket", Platform: constant.TaskPlatformImageStudio, UserId: 312, Status: TaskStatusInProgress, Quota: 20, PrivateData: TaskPrivateData{RequestId: meta.RequestID, BillingSource: "wallet", BillingGroup: "vip"}}
	insertTask(t, task)
	require.NoError(t, SettleImageStudioPluginTask(task, 30, []byte(`{"plugin":{"settled":false}}`), false))
	assert.Equal(t, 70, getBucketBalanceForTest(t, 312, "vip"))
	require.NoError(t, SettleImageStudioPluginTask(task, 15, []byte(`{"plugin":{"settled":true}}`), true))
	require.NoError(t, SettleImageStudioPluginTask(task, 15, []byte(`{"plugin":{"settled":true}}`), true))
	assert.Equal(t, 85, getBucketBalanceForTest(t, 312, "vip"))
	delta, err := ApplyTaskRefundTarget(task.TaskID, 312, 0, 15, meta)
	require.NoError(t, err)
	assert.Equal(t, 15, delta)
	delta, err = ApplyTaskRefundTarget(task.TaskID, 312, 0, 15, meta)
	require.NoError(t, err)
	assert.Zero(t, delta)
	assert.Equal(t, 100, getBucketBalanceForTest(t, 312, "vip"))
	assert.Equal(t, 150, getUserQuotaForPaymentGuardTest(t, 312))
	_, err = ApplyTaskRefundTarget(task.TaskID, 312, 0, 10, meta)
	require.NoError(t, err)
	assert.Equal(t, 95, getBucketBalanceForTest(t, 312, "vip"))
}

func TestQuotaBucketFailedStudioSettlementRollsBackFundsAndCheckpoint(t *testing.T) {
	truncateTables(t)
	withQuotaBucketBilling(t)
	insertQuotaBucketUser(t, 313, 50)
	require.NoError(t, CreditUserQuotaBucket(313, 10, QuotaBucketSourceTopup, "studio-small", "vip"))
	meta := QuotaBucketChargeMeta{RequestID: "studio-insufficient", BillingGroup: "vip"}
	_, err := DebitUserQuotaBuckets(313, 10, meta, QuotaBucketTxnTypePreConsume)
	require.NoError(t, err)
	task := &Task{TaskID: "studio-insufficient-task", Platform: constant.TaskPlatformImageStudio, UserId: 313, Status: TaskStatusInProgress, Quota: 10, PrivateData: TaskPrivateData{RequestId: meta.RequestID, BillingSource: "wallet", BillingGroup: "vip"}}
	insertTask(t, task)
	require.ErrorIs(t, SettleImageStudioPluginTask(task, 11, []byte(`{}`), true), ErrQuotaBucketInsufficient)
	var stored Task
	require.NoError(t, DB.First(&stored, task.ID).Error)
	assert.Equal(t, 10, stored.Quota)
	assert.Empty(t, stored.Data)
	assert.Equal(t, 50, getUserQuotaForPaymentGuardTest(t, 313))
}

func TestQuotaBucketLegacyTaskRefundTargetCanBeCorrected(t *testing.T) {
	truncateTables(t)
	withQuotaBucketBilling(t)
	insertQuotaBucketUser(t, 314, 80) // historical 20-unit hold was already deducted
	meta := QuotaBucketChargeMeta{RequestID: "legacy-hold", BillingGroup: "default", LegacyPreConsumed: 20}
	_, err := ApplyTaskRefundTarget("legacy-task", 314, 0, 20, meta)
	require.NoError(t, err)
	_, err = ApplyTaskRefundTarget("legacy-task", 314, 0, 10, meta)
	require.NoError(t, err)
	_, err = ApplyTaskRefundTarget("legacy-task", 314, 0, 20, meta)
	require.NoError(t, err)
	assert.Equal(t, 100, getBucketBalanceForTest(t, 314, "default"))
	assert.Equal(t, 100, getUserQuotaForPaymentGuardTest(t, 314))
}

func TestQuotaBucketConcurrentDebitCannotOverspend(t *testing.T) {
	truncateTables(t)
	withQuotaBucketBilling(t)
	insertQuotaBucketUser(t, 315, 0)
	require.NoError(t, CreditUserQuotaBucket(315, 10, QuotaBucketSourceTopup, "concurrent-credit", "vip"))
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, requestID := range []string{"concurrent-one", "concurrent-two"} {
		go func(id string) {
			<-start
			_, err := DebitUserQuotaBuckets(315, 10, QuotaBucketChargeMeta{RequestID: id, BillingGroup: "vip"}, QuotaBucketTxnTypePreConsume)
			results <- err
		}(requestID)
	}
	close(start)
	successes := 0
	for range 2 {
		if err := <-results; err == nil {
			successes++
		}
	}
	assert.Equal(t, 1, successes)
	assert.Zero(t, getBucketBalanceForTest(t, 315, "vip"))
	assert.Zero(t, getUserQuotaForPaymentGuardTest(t, 315))
}

func TestQuotaBucketWalletPurchaseHonorsDisabledBalancePayment(t *testing.T) {
	truncateTables(t)
	withQuotaBucketBilling(t)
	insertQuotaBucketUser(t, 316, 0)
	require.NoError(t, CreditUserQuotaBucket(316, 100, QuotaBucketSourceTopup, "purchase-policy", "vip"))
	disabled := false
	plan := &SubscriptionPlan{Id: 316, Title: "Disabled balance plan", PriceAmount: 1, Enabled: true, AllowBalancePay: &disabled, DurationUnit: SubscriptionDurationMonth, DurationValue: 1}
	require.NoError(t, DB.Create(plan).Error)
	_, err := PurchaseSubscriptionWithWallet(316, plan.Id)
	require.Error(t, err)
	assert.Equal(t, 100, getUserQuotaForPaymentGuardTest(t, 316))
	assert.Zero(t, countUserSubscriptionsForPaymentGuardTest(t, 316))
}

func TestQuotaBucketMigrationPreservesLegacyBalancesAndIsRepeatable(t *testing.T) {
	truncateTables(t)
	withQuotaBucketBilling(t)
	insertQuotaBucketUser(t, 317, 50)
	require.NoError(t, CreditUserQuotaBucket(317, 30, QuotaBucketSourceTopup, "upgrade-paid", "vip"))
	_, err := DebitUserQuotaBuckets(317, 10, QuotaBucketChargeMeta{RequestID: "upgrade-spend", BillingGroup: "vip"}, QuotaBucketTxnTypePreConsume)
	require.NoError(t, err)
	for range 2 {
		require.NoError(t, DB.AutoMigrate(&UserQuotaBucket{}, &UserQuotaBucketTransaction{}, &AffiliateUsageRebateEvent{}, &AffiliateDailyRebateSettlement{}, &UserSubscription{}))
		require.NoError(t, EnsureUserQuotaBucketsMigrated(317))
	}
	assert.Equal(t, 50, getBucketBalanceForTest(t, 317, "default"))
	assert.Equal(t, 20, getBucketBalanceForTest(t, 317, "vip"))
	assert.Equal(t, 70, getUserQuotaForPaymentGuardTest(t, 317))
	require.NoError(t, CreditUserQuotaBucket(317, 30, QuotaBucketSourceTopup, "upgrade-paid", "vip"))
	assert.Equal(t, 70, getUserQuotaForPaymentGuardTest(t, 317))
}

// CI seeds this database with the real pre-upgrade revision before starting this
// test process. The fresh mode exercises the same startup migration without data.
func TestQuotaBucketStartupMigrationCompatibility(t *testing.T) {
	if os.Getenv("NEWAPI_TEST_MODE") == "" {
		t.Skip("dedicated migration matrix only")
	}
	withQuotaBucketBilling(t)
	for range 2 {
		require.NoError(t, migrateDB())
	}
	if os.Getenv("NEWAPI_TEST_MODE") != "upgrade" {
		return
	}
	assert.Equal(t, 50, getBucketBalanceForTest(t, 9001, "default"))
	assert.Equal(t, 20, getBucketBalanceForTest(t, 9001, "vip"))
	assert.Equal(t, 70, getUserQuotaForPaymentGuardTest(t, 9001))
	require.NoError(t, CreditUserQuotaBucket(9001, 30, QuotaBucketSourceTopup, "ci-legacy-paid", "vip"))
	assert.Equal(t, 70, getUserQuotaForPaymentGuardTest(t, 9001))
	require.NoError(t, RefundUserQuotaBuckets("ci-legacy-debit"))
	assert.Equal(t, 30, getBucketBalanceForTest(t, 9001, "vip"))
	require.NoError(t, DB.Where("user_id = ?", 9001).Delete(&UserQuotaBucketTransaction{}).Error)
	require.NoError(t, DB.Where("user_id = ?", 9001).Delete(&UserQuotaBucket{}).Error)
	require.NoError(t, DB.Delete(&User{}, 9001).Error)
}
