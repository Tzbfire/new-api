package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func withAffiliateUsageRebate(t *testing.T, bps int, group string) {
	t.Helper()
	oldEnabled := setting.AffiliateUsageRebateEnabled
	oldBps := setting.AffiliateUsageRebateBps
	oldGroup := setting.AffiliateUsageRebateGroup
	oldHour := setting.AffiliateUsageRebateHour
	setting.AffiliateUsageRebateEnabled = true
	setting.AffiliateUsageRebateBps = bps
	setting.AffiliateUsageRebateGroup = group
	setting.AffiliateUsageRebateHour = 0
	t.Cleanup(func() {
		setting.AffiliateUsageRebateEnabled = oldEnabled
		setting.AffiliateUsageRebateBps = oldBps
		setting.AffiliateUsageRebateGroup = oldGroup
		setting.AffiliateUsageRebateHour = oldHour
	})
}

func TestAffiliateUsageRebateSettlesEligibleBucketSpend(t *testing.T) {
	truncateTables(t)
	withQuotaBucketBilling(t)
	withAffiliateUsageRebate(t, 1000, QuotaBucketBillingGroupDefault)

	inviter := &User{Id: 401, Username: "affiliate_inviter", Status: common.UserStatusEnabled, AffCode: "aff-401"}
	invitee := &User{Id: 402, Username: "affiliate_invitee", Status: common.UserStatusEnabled, AffCode: "aff-402", InviterId: inviter.Id}
	require.NoError(t, DB.Create(inviter).Error)
	require.NoError(t, DB.Create(invitee).Error)
	require.NoError(t, CreditUserQuotaBucket(invitee.Id, 1000, QuotaBucketSourceRedemption, "redeem-402", GetPaidQuotaBillingGroup()))

	_, err := DebitUserQuotaBuckets(invitee.Id, 400, QuotaBucketChargeMeta{RequestID: "req-aff-402", BillingGroup: GetPaidQuotaBillingGroup(), UsingGroup: "default"}, QuotaBucketTxnTypePreConsume)
	require.NoError(t, err)
	require.NoError(t, RecordAffiliateUsageRebateFromBilling("req-aff-402", invitee.Id, "wallet", GetPaidQuotaBillingGroup(), 0, 400))

	settlementDate := time.Now().Local().Format("2006-01-02")
	summary, err := RunAffiliateDailyRebateSettlement(nil, settlementDate)
	require.NoError(t, err)
	require.NotNil(t, summary)
	assert.Equal(t, 1, summary.EventCount)
	assert.Equal(t, int64(400), summary.BaseQuota)
	assert.Equal(t, int64(40), summary.RebateQuota)
	assert.Equal(t, 40, getBucketBalanceForTest(t, inviter.Id, QuotaBucketBillingGroupDefault))

	var reloaded User
	require.NoError(t, DB.Select("aff_history", "quota").Where("id = ?", inviter.Id).First(&reloaded).Error)
	assert.Equal(t, 40, reloaded.AffHistoryQuota)
	assert.Equal(t, 40, reloaded.Quota)

	var event AffiliateUsageRebateEvent
	require.NoError(t, DB.Where("request_id = ?", "req-aff-402").First(&event).Error)
	assert.Equal(t, AffiliateRebateStatusSettled, event.Status)
}
