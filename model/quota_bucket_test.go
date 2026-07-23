package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
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
	assert.Equal(t, PaymentMethodWallet, order.PaymentMethod)
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
	assert.Equal(t, PaymentMethodWallet, order.PaymentMethod)
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
