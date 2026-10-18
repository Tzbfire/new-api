package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSubscriptionGroupScopeNormalizationAndMatching(t *testing.T) {
	tests := []struct {
		name       string
		scope      string
		group      string
		normalized string
		allowed    bool
	}{
		{name: "empty means all", group: "default", allowed: true},
		{name: "csv is normalized", scope: " vip,default,vip ", group: "vip", normalized: "default,vip", allowed: true},
		{name: "json legacy format", scope: `["vip","auto"]`, group: "auto", normalized: "auto,vip", allowed: true},
		{name: "unrelated group", scope: "vip", group: "default", normalized: "vip", allowed: false},
		{name: "scoped subscription requires group", scope: "vip", normalized: "vip", allowed: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assert.Equal(t, test.normalized, NormalizeAllowedTokenGroups(test.scope))
			assert.Equal(t, test.allowed, IsSubscriptionGroupAllowed(test.scope, test.group))
		})
	}
}

func TestPreConsumeUserSubscriptionUsesPurchaseScopeAndRequestGroup(t *testing.T) {
	truncateTables(t)
	now := GetDBTimestamp()
	allowOverflow := true
	plan := &SubscriptionPlan{
		Id:                  9701,
		Title:               "VIP",
		DurationUnit:        SubscriptionDurationMonth,
		DurationValue:       1,
		TotalAmount:         100,
		AllowWalletOverflow: &allowOverflow,
		AllowedTokenGroups:  "vip",
	}
	require.NoError(t, DB.Create(plan).Error)
	require.NoError(t, DB.Create(&UserSubscription{
		Id:                  9702,
		UserId:              9703,
		PlanId:              plan.Id,
		AmountTotal:         100,
		StartTime:           now - 60,
		EndTime:             now + 3600,
		Status:              "active",
		AllowWalletOverflow: true,
		AllowedTokenGroups:  "vip",
	}).Error)

	_, err := PreConsumeUserSubscription("scope-default", 9703, "gpt-image-1", 0, "default", 10)
	require.ErrorContains(t, err, "subscription quota insufficient")

	result, err := PreConsumeUserSubscription("scope-vip", 9703, "gpt-image-1", 0, "vip", 10)
	require.NoError(t, err)
	assert.Equal(t, 9702, result.UserSubscriptionId)
	assert.EqualValues(t, 10, result.AmountUsedAfter)

	replayed, err := PreConsumeUserSubscription("scope-vip", 9703, "gpt-image-1", 0, "vip", 10)
	require.NoError(t, err)
	assert.Equal(t, result.UserSubscriptionId, replayed.UserSubscriptionId)

	_, err = PreConsumeUserSubscription("scope-vip", 9703, "gpt-image-1", 0, "default", 10)
	require.ErrorContains(t, err, "request group mismatch")
}

func TestWalletOverflowOnlyConsidersMatchingSubscriptions(t *testing.T) {
	truncateTables(t)
	now := GetDBTimestamp()
	require.NoError(t, DB.Create(&UserSubscription{
		Id:                  9801,
		UserId:              9802,
		PlanId:              1,
		EndTime:             now + 3600,
		Status:              "active",
		AllowWalletOverflow: false,
		AllowedTokenGroups:  "vip",
	}).Error)

	allowed, err := UserActiveSubscriptionsAllowWalletOverflow(9802, "default")
	require.NoError(t, err)
	assert.True(t, allowed)

	allowed, err = UserActiveSubscriptionsAllowWalletOverflow(9802, "vip")
	require.NoError(t, err)
	assert.False(t, allowed)
}

func TestGroupScopedSubscriptionHonorsAllowWalletOverflowFlag(t *testing.T) {
	truncateTables(t)
	now := GetDBTimestamp()
	require.NoError(t, DB.Create(&UserSubscription{
		Id:                  9811,
		UserId:              9812,
		PlanId:              1,
		EndTime:             now + 3600,
		Status:              "active",
		AllowWalletOverflow: true,
		AllowedTokenGroups:  "codeplan",
	}).Error)

	allowed, err := UserActiveSubscriptionsAllowWalletOverflow(9812, "codeplan")
	require.NoError(t, err)
	assert.True(t, allowed)

	require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", 9811).Update("allow_wallet_overflow", false).Error)
	allowed, err = UserActiveSubscriptionsAllowWalletOverflow(9812, "codeplan")
	require.NoError(t, err)
	assert.False(t, allowed)

	// Unrelated group is not blocked by the codeplan subscription.
	allowed, err = UserActiveSubscriptionsAllowWalletOverflow(9812, "default")
	require.NoError(t, err)
	assert.True(t, allowed)

	// Unscoped + overflow=false blocks any group.
	require.NoError(t, DB.Create(&UserSubscription{
		Id:                  9813,
		UserId:              9814,
		PlanId:              1,
		EndTime:             now + 3600,
		Status:              "active",
		AllowWalletOverflow: false,
		AllowedTokenGroups:  "",
	}).Error)
	allowed, err = UserActiveSubscriptionsAllowWalletOverflow(9814, "codeplan")
	require.NoError(t, err)
	assert.False(t, allowed)
}

func TestGroupSubscriptionMigrationBackfillsLegacySnapshotsOnce(t *testing.T) {
	truncateTables(t)
	legacyDefault := true
	require.NoError(t, DB.Create(&SubscriptionPlan{
		Id:                    9901,
		Title:                 "Legacy VIP",
		DurationUnit:          SubscriptionDurationMonth,
		DurationValue:         1,
		AllowedTokenGroups:    "vip",
		DisableWalletFallback: true,
		AllowWalletOverflow:   &legacyDefault,
	}).Error)
	require.NoError(t, DB.Create(&UserSubscription{Id: 9902, UserId: 9903, PlanId: 9901}).Error)

	err := migrateGroupSubscriptionSnapshots(groupSubscriptionMigrationState{
		planHadLegacyFallback: true,
	})
	require.NoError(t, err)

	var plan SubscriptionPlan
	require.NoError(t, DB.First(&plan, 9901).Error)
	require.NotNil(t, plan.AllowWalletOverflow)
	assert.False(t, *plan.AllowWalletOverflow)
	var subscription UserSubscription
	require.NoError(t, DB.First(&subscription, 9902).Error)
	assert.Equal(t, "vip", subscription.AllowedTokenGroups)
	assert.False(t, subscription.AllowWalletOverflow)

	// The marker prevents later plan edits from mutating purchase snapshots.
	require.NoError(t, DB.Model(&SubscriptionPlan{}).Where("id = ?", 9901).Update("allowed_token_groups", "default").Error)
	require.NoError(t, migrateGroupSubscriptionSnapshots(groupSubscriptionMigrationState{}))
	require.NoError(t, DB.First(&subscription, 9902).Error)
	assert.Equal(t, "vip", subscription.AllowedTokenGroups)

	var marker Option
	require.NoError(t, DB.Where("key = ?", "MigrationGroupSubscriptionsV1").First(&marker).Error)
	assert.Equal(t, "done", marker.Value)
}

func TestGroupScopedExhaustedQuotaCannotPreConsume(t *testing.T) {
	truncateTables(t)
	now := GetDBTimestamp()
	allowOverflow := false
	plan := &SubscriptionPlan{
		Id:                  9841,
		Title:               "Code Plan",
		DurationUnit:        SubscriptionDurationMonth,
		DurationValue:       1,
		TotalAmount:         20,
		AllowWalletOverflow: &allowOverflow,
		AllowedTokenGroups:  "codeplan",
	}
	require.NoError(t, DB.Create(plan).Error)
	require.NoError(t, DB.Create(&UserSubscription{
		Id:                  9842,
		UserId:              9843,
		PlanId:              plan.Id,
		AmountTotal:         20,
		AmountUsed:          20, // already exhausted
		StartTime:           now - 60,
		EndTime:             now + 3600,
		Status:              "active",
		AllowWalletOverflow: false,
		AllowedTokenGroups:  "codeplan",
	}).Error)

	// Cannot pre-consume from subscription when exhausted.
	_, err := PreConsumeUserSubscription("codeplan-exhausted", 9843, "gpt-4", 0, "codeplan", 1)
	require.ErrorContains(t, err, "subscription quota insufficient")

	// Wallet fallback blocked when overflow is off.
	allowed, err := UserActiveSubscriptionsAllowWalletOverflow(9843, "codeplan")
	require.NoError(t, err)
	assert.False(t, allowed)

	// Other groups remain wallet-eligible.
	allowed, err = UserActiveSubscriptionsAllowWalletOverflow(9843, "default")
	require.NoError(t, err)
	assert.True(t, allowed)
}

func TestMigrateGroupScopedWalletLockForcesOverflowOff(t *testing.T) {
	truncateTables(t)
	now := GetDBTimestamp()
	allowOverflow := true
	require.NoError(t, DB.Create(&SubscriptionPlan{
		Id:                  9851,
		Title:               "Scoped",
		DurationUnit:        SubscriptionDurationMonth,
		DurationValue:       1,
		AllowedTokenGroups:  "codeplan",
		AllowWalletOverflow: &allowOverflow,
	}).Error)
	require.NoError(t, DB.Create(&UserSubscription{
		Id:                  9852,
		UserId:              9853,
		PlanId:              9851,
		EndTime:             now + 3600,
		Status:              "active",
		AllowWalletOverflow: true,
		AllowedTokenGroups:  "codeplan",
	}).Error)

	require.NoError(t, migrateGroupScopedWalletLock())

	var plan SubscriptionPlan
	require.NoError(t, DB.First(&plan, 9851).Error)
	require.NotNil(t, plan.AllowWalletOverflow)
	assert.False(t, *plan.AllowWalletOverflow)
	assert.True(t, plan.DisableWalletFallback)

	var sub UserSubscription
	require.NoError(t, DB.First(&sub, 9852).Error)
	assert.False(t, sub.AllowWalletOverflow)

	// Marker makes migration idempotent.
	require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", 9852).Update("allow_wallet_overflow", true).Error)
	require.NoError(t, migrateGroupScopedWalletLock())
	require.NoError(t, DB.First(&sub, 9852).Error)
	assert.True(t, sub.AllowWalletOverflow, "second run must not re-apply after marker")
}
