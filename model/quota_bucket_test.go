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
