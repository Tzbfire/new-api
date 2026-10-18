package model

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"gorm.io/gorm"
)

const (
	QuotaBucketStatusActive   = "active"
	QuotaBucketStatusInactive = "inactive"

	QuotaBucketBillingGroupDefault = "default"

	QuotaBucketSourceMigration       = "migration"
	QuotaBucketSourceTopup           = "topup"
	QuotaBucketSourceRedemption      = "redemption"
	QuotaBucketSourceRegister        = "register"
	QuotaBucketSourceInvite          = "invite"
	QuotaBucketSourceAffiliateRebate = "affiliate_rebate"
	QuotaBucketSourceCheckin         = "checkin"
	QuotaBucketSourceAdmin           = "admin"
	QuotaBucketSourceRefund          = "refund"
	QuotaBucketSourceLegacy          = "legacy"

	QuotaBucketTxnTypeCredit      = "credit"
	QuotaBucketTxnTypeMigration   = "migration"
	QuotaBucketTxnTypePreConsume  = "pre_consume"
	QuotaBucketTxnTypeSettle      = "settle"
	QuotaBucketTxnTypeRefund      = "refund"
	QuotaBucketTxnTypeAdjust      = "adjust"
	QuotaBucketTxnTypeSubPurchase = "subscription_purchase"
)

var ErrQuotaBucketInsufficient = errors.New("quota bucket balance insufficient")

type UserQuotaBucket struct {
	Id              int64  `json:"id" gorm:"primaryKey"`
	UserId          int    `json:"user_id" gorm:"index;index:idx_quota_bucket_active,priority:1;uniqueIndex:idx_quota_bucket_source,priority:1"`
	BillingGroup    string `json:"billing_group" gorm:"type:varchar(64);not null;default:'default';index:idx_quota_bucket_active,priority:3"`
	Source          string `json:"source" gorm:"type:varchar(32);not null;default:'';uniqueIndex:idx_quota_bucket_source,priority:2"`
	SourceID        string `json:"source_id" gorm:"type:varchar(191);not null;default:'';uniqueIndex:idx_quota_bucket_source,priority:3"`
	AmountTotal     int    `json:"amount_total" gorm:"type:bigint;not null;default:0"`
	AmountRemaining int    `json:"amount_remaining" gorm:"type:bigint;not null;default:0"`
	AmountUsed      int    `json:"amount_used" gorm:"type:bigint;not null;default:0"`
	ExpiresAt       int64  `json:"expires_at" gorm:"not null;default:0;index:idx_quota_bucket_active,priority:4"`
	Priority        int    `json:"priority" gorm:"not null;default:100;index:idx_quota_bucket_active,priority:5"`
	Status          string `json:"status" gorm:"type:varchar(32);not null;default:'active';index:idx_quota_bucket_active,priority:2"`
	CreatedAt       int64  `json:"created_at" gorm:"not null;default:0"`
	UpdatedAt       int64  `json:"updated_at" gorm:"not null;default:0"`
}

type UserQuotaBucketTransaction struct {
	Id           int64  `json:"id" gorm:"primaryKey"`
	RequestID    string `json:"request_id" gorm:"type:varchar(191);not null;default:'';index"`
	UserId       int    `json:"user_id" gorm:"index"`
	BucketID     int64  `json:"bucket_id" gorm:"index"`
	Type         string `json:"type" gorm:"type:varchar(32);not null;default:'';index"`
	Source       string `json:"source" gorm:"type:varchar(32);not null;default:''"`
	SourceID     string `json:"source_id" gorm:"type:varchar(191);not null;default:''"`
	Delta        int    `json:"delta" gorm:"type:bigint;not null;default:0"`
	BalanceAfter int    `json:"balance_after" gorm:"type:bigint;not null;default:0"`
	UsingGroup   string `json:"using_group" gorm:"type:varchar(64);not null;default:''"`
	BillingGroup string `json:"billing_group" gorm:"type:varchar(64);not null;default:''"`
	ModelName    string `json:"model_name" gorm:"type:varchar(255);not null;default:''"`
	TokenId      int    `json:"token_id" gorm:"not null;default:0"`
	ChannelId    int    `json:"channel_id" gorm:"not null;default:0"`
	Status       string `json:"status" gorm:"type:varchar(32);not null;default:'done'"`
	CreatedAt    int64  `json:"created_at" gorm:"not null;default:0;index"`
}

type QuotaBucketAllocation struct {
	BucketID int64 `json:"bucket_id"`
	Amount   int   `json:"amount"`
}

type QuotaBucketChargeMeta struct {
	RequestID         string
	UsingGroup        string
	BillingGroup      string
	ModelName         string
	TokenId           int
	ChannelId         int
	LegacyPreConsumed int
}

type QuotaBucketChargePlan struct {
	UserId       int                     `json:"user_id"`
	BillingGroup string                  `json:"billing_group"`
	RequestID    string                  `json:"request_id"`
	PreConsumed  int                     `json:"pre_consumed"`
	Allocations  []QuotaBucketAllocation `json:"allocations"`
}

type UserQuotaBucketGroupSummary struct {
	BillingGroup    string `json:"billing_group"`
	AmountTotal     int64  `json:"amount_total"`
	AmountRemaining int64  `json:"amount_remaining"`
	AmountUsed      int64  `json:"amount_used"`
	BucketCount     int64  `json:"bucket_count"`
}

func IsQuotaBucketBillingEnabled() bool {
	return setting.QuotaBucketBillingEnabled
}

func GetPaidQuotaBillingGroup() string {
	return normalizeQuotaBucketBillingGroup(setting.GetPaidQuotaBillingGroup())
}

func normalizeQuotaBucketBillingGroup(group string) string {
	group = strings.TrimSpace(group)
	if group == "" {
		return QuotaBucketBillingGroupDefault
	}
	return group
}

func quotaBucketSourceID(source, sourceID string) string {
	source = strings.TrimSpace(source)
	sourceID = strings.TrimSpace(sourceID)
	if sourceID != "" {
		return sourceID
	}
	if source == "" {
		source = QuotaBucketSourceLegacy
	}
	return fmt.Sprintf("%s:%d:%s", source, time.Now().UnixNano(), common.GetRandomString(8))
}

func quotaBucketPriority(group string) int {
	if normalizeQuotaBucketBillingGroup(group) == GetPaidQuotaBillingGroup() {
		return 10
	}
	return 100
}

func activeQuotaBucketQuery(tx *gorm.DB, userId int, billingGroup string) *gorm.DB {
	now := common.GetTimestamp()
	return tx.Where("user_id = ? AND billing_group = ? AND status = ? AND amount_remaining > 0", userId, normalizeQuotaBucketBillingGroup(billingGroup), QuotaBucketStatusActive).
		Where("expires_at = ? OR expires_at > ?", 0, now)
}

func activeAnyQuotaBucketQuery(tx *gorm.DB, userId int) *gorm.DB {
	now := common.GetTimestamp()
	return tx.Where("user_id = ? AND status = ? AND amount_remaining > 0", userId, QuotaBucketStatusActive).
		Where("expires_at = ? OR expires_at > ?", 0, now)
}

func EnsureUserQuotaBucketsMigrated(userId int) error {
	if !IsQuotaBucketBillingEnabled() || userId <= 0 {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		return ensureUserQuotaBucketsMigratedTx(tx, userId)
	})
}

func ensureUserQuotaBucketsMigratedTx(tx *gorm.DB, userId int) error {
	if tx == nil {
		tx = DB
	}
	var user User
	if err := lockForUpdate(tx).Where("id = ?", userId).First(&user).Error; err != nil {
		return err
	}
	var migrationCount int64
	if err := tx.Model(&UserQuotaBucket{}).Where("user_id = ? AND source = ?", userId, QuotaBucketSourceMigration).Count(&migrationCount).Error; err != nil {
		return err
	}
	if migrationCount > 0 {
		return nil
	}

	var existingRemaining int64
	if err := tx.Model(&UserQuotaBucket{}).Where("user_id = ? AND status = ?", userId, QuotaBucketStatusActive).
		Select("COALESCE(SUM(amount_remaining), 0)").Scan(&existingRemaining).Error; err != nil {
		return err
	}
	legacyQuota := user.Quota - int(existingRemaining)
	if legacyQuota < 0 {
		legacyQuota = 0
	}

	now := common.GetTimestamp()
	bucket := &UserQuotaBucket{
		UserId:          userId,
		BillingGroup:    QuotaBucketBillingGroupDefault,
		Source:          QuotaBucketSourceMigration,
		SourceID:        fmt.Sprintf("user:%d", userId),
		AmountTotal:     legacyQuota,
		AmountRemaining: legacyQuota,
		Priority:        quotaBucketPriority(QuotaBucketBillingGroupDefault),
		Status:          QuotaBucketStatusActive,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := tx.Create(bucket).Error; err != nil {
		return err
	}
	return tx.Create(&UserQuotaBucketTransaction{
		UserId:       userId,
		BucketID:     bucket.Id,
		Type:         QuotaBucketTxnTypeMigration,
		Source:       QuotaBucketSourceMigration,
		SourceID:     bucket.SourceID,
		Delta:        legacyQuota,
		BalanceAfter: legacyQuota,
		BillingGroup: bucket.BillingGroup,
		Status:       "done",
		CreatedAt:    now,
	}).Error
}

func GetUserQuotaBucketBalance(userId int, billingGroup string) (int, error) {
	if err := EnsureUserQuotaBucketsMigrated(userId); err != nil {
		return 0, err
	}
	var total int64
	err := activeQuotaBucketQuery(DB.Model(&UserQuotaBucket{}), userId, billingGroup).
		Select("COALESCE(SUM(amount_remaining), 0)").Scan(&total).Error
	return int(total), err
}

func GetUserQuotaBucketGroupSummaries(userId int) ([]UserQuotaBucketGroupSummary, error) {
	if !IsQuotaBucketBillingEnabled() || userId <= 0 {
		return []UserQuotaBucketGroupSummary{}, nil
	}
	if err := EnsureUserQuotaBucketsMigrated(userId); err != nil {
		return nil, err
	}
	summaries := make([]UserQuotaBucketGroupSummary, 0)
	err := DB.Model(&UserQuotaBucket{}).
		Select("billing_group, COUNT(*) AS bucket_count, COALESCE(SUM(amount_total), 0) AS amount_total, COALESCE(SUM(amount_remaining), 0) AS amount_remaining, COALESCE(SUM(amount_used), 0) AS amount_used").
		Where("user_id = ? AND status = ?", userId, QuotaBucketStatusActive).
		Where("expires_at = 0 OR expires_at > ?", common.GetTimestamp()).
		Group("billing_group").
		Order("billing_group ASC").
		Scan(&summaries).Error
	if err != nil {
		return nil, err
	}
	return summaries, nil
}

func CreditUserQuotaBucket(userId int, quota int, source string, sourceID string, billingGroup string) error {
	if quota < 0 {
		return common.NewMessage("Quota cannot be negative")
	}
	if quota == 0 {
		return nil
	}
	if !IsQuotaBucketBillingEnabled() {
		return IncreaseUserQuota(userId, quota, true)
	}
	credited := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		return creditUserQuotaBucketTx(tx, userId, quota, source, sourceID, billingGroup, true, &credited)
	})
	if err != nil {
		return err
	}
	if credited {
		syncCreditUserQuotaCache(userId, quota, "bucket credit")
	}
	return nil
}

func creditUserQuotaBucketTx(tx *gorm.DB, userId int, quota int, source string, sourceID string, billingGroup string, updateUserQuota bool, credited ...*bool) error {
	if quota < 0 {
		return common.NewMessage("Quota cannot be negative")
	}
	if quota == 0 {
		return nil
	}
	if tx == nil {
		tx = DB
	}
	if source != QuotaBucketSourceMigration {
		if err := ensureUserQuotaBucketsMigratedTx(tx, userId); err != nil {
			return err
		}
	}
	billingGroup = normalizeQuotaBucketBillingGroup(billingGroup)
	source = strings.TrimSpace(source)
	if source == "" {
		source = QuotaBucketSourceLegacy
	}
	sourceID = quotaBucketSourceID(source, sourceID)

	var existing UserQuotaBucket
	err := tx.Where("user_id = ? AND source = ? AND source_id = ?", userId, source, sourceID).First(&existing).Error
	if err == nil {
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	now := common.GetTimestamp()
	bucket := &UserQuotaBucket{
		UserId:          userId,
		BillingGroup:    billingGroup,
		Source:          source,
		SourceID:        sourceID,
		AmountTotal:     quota,
		AmountRemaining: quota,
		Priority:        quotaBucketPriority(billingGroup),
		Status:          QuotaBucketStatusActive,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := tx.Create(bucket).Error; err != nil {
		return err
	}
	if err := tx.Create(&UserQuotaBucketTransaction{
		UserId:       userId,
		BucketID:     bucket.Id,
		Type:         QuotaBucketTxnTypeCredit,
		Source:       source,
		SourceID:     sourceID,
		Delta:        quota,
		BalanceAfter: quota,
		BillingGroup: billingGroup,
		Status:       "done",
		CreatedAt:    now,
	}).Error; err != nil {
		return err
	}
	if updateUserQuota {
		if quota > common.MaxWalletQuota {
			return ErrWalletQuotaLimitExceeded
		}
		result := tx.Model(&User{}).Where("id = ? AND quota <= ?", userId, common.MaxWalletQuota-quota).Update("quota", gorm.Expr("quota + ?", quota))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrWalletQuotaLimitExceeded
		}
	}
	if len(credited) > 0 && credited[0] != nil {
		*credited[0] = true
	}
	return nil
}

func DebitUserQuotaBuckets(userId int, amount int, meta QuotaBucketChargeMeta, txnType string) (*QuotaBucketChargePlan, error) {
	return debitUserQuotaBuckets(userId, amount, meta, txnType, false)
}

func DebitUserQuotaAnyBuckets(userId int, amount int, meta QuotaBucketChargeMeta, txnType string) (*QuotaBucketChargePlan, error) {
	return debitUserQuotaBuckets(userId, amount, meta, txnType, true)
}

func debitUserQuotaBuckets(userId int, amount int, meta QuotaBucketChargeMeta, txnType string, anyGroup bool) (*QuotaBucketChargePlan, error) {
	if amount < 0 {
		return nil, common.NewMessage("Quota cannot be negative")
	}
	if amount == 0 {
		return &QuotaBucketChargePlan{UserId: userId, BillingGroup: normalizeQuotaBucketBillingGroup(meta.BillingGroup), RequestID: meta.RequestID}, nil
	}
	if !IsQuotaBucketBillingEnabled() {
		return nil, DecreaseUserQuota(userId, amount, false)
	}
	if err := EnsureUserQuotaBucketsMigrated(userId); err != nil {
		return nil, err
	}
	if txnType == "" {
		txnType = QuotaBucketTxnTypePreConsume
	}
	meta.BillingGroup = normalizeQuotaBucketBillingGroup(meta.BillingGroup)
	meta.RequestID = strings.TrimSpace(meta.RequestID)
	if meta.RequestID == "" {
		meta.RequestID = common.GetTimeString() + common.GetRandomString(8)
	}

	plan := &QuotaBucketChargePlan{
		UserId:       userId,
		BillingGroup: meta.BillingGroup,
		RequestID:    meta.RequestID,
		PreConsumed:  amount,
		Allocations:  make([]QuotaBucketAllocation, 0),
	}

	err := DB.Transaction(func(tx *gorm.DB) error {
		return debitUserQuotaBucketsTx(tx, userId, amount, meta, txnType, anyGroup, plan)
	})
	if err != nil {
		return nil, err
	}
	if err := cacheDecrUserQuota(userId, int64(amount)); err != nil {
		common.SysLog("failed to decrease user quota cache after bucket debit: " + err.Error())
	}
	return plan, nil
}

func debitUserQuotaBucketsTx(tx *gorm.DB, userId int, amount int, meta QuotaBucketChargeMeta, txnType string, anyGroup bool, plan *QuotaBucketChargePlan) error {
	if tx == nil {
		tx = DB
	}
	if amount < 0 {
		return common.NewMessage("Quota cannot be negative")
	}
	if amount == 0 {
		return nil
	}
	if err := ensureUserQuotaBucketsMigratedTx(tx, userId); err != nil {
		return err
	}
	var buckets []UserQuotaBucket
	query := activeQuotaBucketQuery(lockForUpdate(tx), userId, meta.BillingGroup)
	if anyGroup {
		query = activeAnyQuotaBucketQuery(lockForUpdate(tx), userId)
	}
	if err := query.Order("priority asc, expires_at asc, id asc").Find(&buckets).Error; err != nil {
		return err
	}
	remaining := amount
	now := common.GetTimestamp()
	for i := range buckets {
		if remaining <= 0 {
			break
		}
		bucket := buckets[i]
		useAmount := bucket.AmountRemaining
		if useAmount > remaining {
			useAmount = remaining
		}
		if useAmount <= 0 {
			continue
		}
		newRemaining := bucket.AmountRemaining - useAmount
		updated := tx.Model(&UserQuotaBucket{}).
			Where("id = ? AND amount_remaining >= ?", bucket.Id, useAmount).
			Updates(map[string]any{
				"amount_remaining": gorm.Expr("amount_remaining - ?", useAmount),
				"amount_used":      gorm.Expr("amount_used + ?", useAmount),
				"updated_at":       now,
			})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrQuotaBucketInsufficient
		}
		if err := tx.Create(&UserQuotaBucketTransaction{
			RequestID:    meta.RequestID,
			UserId:       userId,
			BucketID:     bucket.Id,
			Type:         txnType,
			Source:       bucket.Source,
			SourceID:     bucket.SourceID,
			Delta:        -useAmount,
			BalanceAfter: newRemaining,
			UsingGroup:   meta.UsingGroup,
			BillingGroup: bucket.BillingGroup,
			ModelName:    meta.ModelName,
			TokenId:      meta.TokenId,
			ChannelId:    meta.ChannelId,
			Status:       "done",
			CreatedAt:    now,
		}).Error; err != nil {
			return err
		}
		if plan != nil {
			plan.Allocations = append(plan.Allocations, QuotaBucketAllocation{BucketID: bucket.Id, Amount: useAmount})
		}
		remaining -= useAmount
	}
	if remaining > 0 {
		return fmt.Errorf("%w: billing_group=%s need=%d short=%d", ErrQuotaBucketInsufficient, meta.BillingGroup, amount, remaining)
	}
	result := tx.Model(&User{}).Where("id = ? AND quota >= ?", userId, amount).Update("quota", gorm.Expr("quota - ?", amount))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrQuotaBucketInsufficient
	}
	return nil
}

func SettleUserQuotaBuckets(userId int, meta QuotaBucketChargeMeta, delta int) error {
	if delta == 0 {
		return nil
	}
	if delta > 0 {
		_, err := DebitUserQuotaBuckets(userId, delta, meta, QuotaBucketTxnTypeSettle)
		return err
	}
	return RefundUserQuotaBucketDelta(meta.RequestID, userId, -delta)
}

func RefundUserQuotaBuckets(requestID string) error {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" || !IsQuotaBucketBillingEnabled() {
		return nil
	}
	return refundUserQuotaBucketAmount(requestID, 0, 0, true)
}

func RefundUserQuotaBucketDelta(requestID string, userId int, amount int) error {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" || amount <= 0 || !IsQuotaBucketBillingEnabled() {
		return nil
	}
	return refundUserQuotaBucketAmount(requestID, userId, amount, false)
}

// refundUserQuotaBucketAmountTx restores only the outstanding net debit for this
// request, under the same user lock as debit/credit. Repeated full refunds are no-ops.
func refundUserQuotaBucketAmountTx(tx *gorm.DB, requestID string, userId, amount int, all bool) (int, error) {
	var user User
	if err := lockForUpdate(tx).First(&user, userId).Error; err != nil {
		return 0, err
	}
	var txns []UserQuotaBucketTransaction
	if err := tx.Where("request_id = ? AND user_id = ?", requestID, userId).Order("id desc").Find(&txns).Error; err != nil {
		return 0, err
	}
	net := make(map[int64]int)
	for _, entry := range txns {
		net[entry.BucketID] -= entry.Delta
	}
	refunded := 0
	now := common.GetTimestamp()
	for _, entry := range txns {
		outstanding := net[entry.BucketID]
		if outstanding <= 0 {
			continue
		}
		if !all && outstanding > amount-refunded {
			outstanding = amount - refunded
		}
		if outstanding <= 0 {
			break
		}
		var bucket UserQuotaBucket
		if err := lockForUpdate(tx).Where("id = ? AND user_id = ?", entry.BucketID, userId).First(&bucket).Error; err != nil {
			return 0, err
		}
		if outstanding > bucket.AmountUsed || outstanding > common.MaxWalletQuota-bucket.AmountRemaining {
			return 0, errors.New("invalid quota bucket refund")
		}
		if err := tx.Model(&bucket).Updates(map[string]any{
			"amount_remaining": gorm.Expr("amount_remaining + ?", outstanding),
			"amount_used":      gorm.Expr("amount_used - ?", outstanding), "updated_at": now,
		}).Error; err != nil {
			return 0, err
		}
		if bucket.Status != QuotaBucketStatusActive || bucket.ExpiresAt > 0 && bucket.ExpiresAt <= now {
			if err := creditUserQuotaBucketTx(tx, userId, outstanding, bucket.Source, quotaBucketSourceID(QuotaBucketSourceRefund, ""), bucket.BillingGroup, false); err != nil {
				return 0, err
			}
		}
		entry.Id = 0
		entry.Type = QuotaBucketTxnTypeRefund
		entry.Delta = outstanding
		entry.BalanceAfter = bucket.AmountRemaining + outstanding
		entry.CreatedAt = now
		if err := tx.Create(&entry).Error; err != nil {
			return 0, err
		}
		net[entry.BucketID] -= outstanding
		refunded += outstanding
	}
	if refunded > 0 {
		result := tx.Model(&User{}).Where("id = ? AND quota <= ?", userId, common.MaxWalletQuota-refunded).Update("quota", gorm.Expr("quota + ?", refunded))
		if result.Error != nil {
			return 0, result.Error
		}
		if result.RowsAffected != 1 {
			return 0, ErrWalletQuotaLimitExceeded
		}
	}
	return refunded, nil
}

func refundUserQuotaBucketAmount(requestID string, userId int, amount int, all bool) error {
	if userId <= 0 {
		var entry UserQuotaBucketTransaction
		found := DB.Where("request_id = ?", requestID).Limit(1).Find(&entry)
		if found.Error != nil {
			return found.Error
		}
		if found.RowsAffected == 0 {
			return nil
		}
		userId = entry.UserId
	}
	var refunded int
	err := DB.Transaction(func(tx *gorm.DB) error {
		var err error
		refunded, err = refundUserQuotaBucketAmountTx(tx, requestID, userId, amount, all)
		return err
	})
	if err != nil {
		return err
	}
	if refunded > 0 {
		if err := cacheIncrUserQuota(userId, int64(refunded)); err != nil {
			common.SysError("failed to sync bucket refund cache: " + err.Error())
		}
	}
	return nil
}

func ResetUserQuotaBuckets(userId int, quota int, source string, sourceID string, billingGroup string) error {
	if quota < 0 {
		return common.NewMessage("Quota cannot be negative")
	}
	if !IsQuotaBucketBillingEnabled() {
		err := DB.Model(&User{}).Where("id = ?", userId).Update("quota", quota).Error
		if err == nil {
			_ = invalidateUserCache(userId)
		}
		return err
	}
	source = strings.TrimSpace(source)
	if source == "" {
		source = QuotaBucketSourceAdmin
	}
	sourceID = quotaBucketSourceID(source, sourceID)
	billingGroup = normalizeQuotaBucketBillingGroup(billingGroup)
	before := 0
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).First(&user, userId).Error; err != nil {
			return err
		}
		before = user.Quota
		return resetUserQuotaBucketsTx(tx, userId, quota, source, sourceID, billingGroup)
	})
	if err != nil {
		return err
	}
	if err := cacheIncrUserQuota(userId, int64(quota)-int64(before)); err != nil {
		common.SysLog("failed to refresh user quota cache after bucket reset: " + err.Error())
	}
	return nil
}

func resetUserQuotaBucketsTx(tx *gorm.DB, userId, quota int, source, sourceID, billingGroup string) error {
	if quota < 0 || quota > common.MaxWalletQuota {
		return ErrWalletQuotaLimitExceeded
	}
	now := common.GetTimestamp()
	if err := ensureUserQuotaBucketsMigratedTx(tx, userId); err != nil {
		return err
	}
	if err := tx.Model(&UserQuotaBucket{}).Where("user_id = ? AND status = ?", userId, QuotaBucketStatusActive).
		Updates(map[string]any{"status": QuotaBucketStatusInactive, "updated_at": now}).Error; err != nil {
		return err
	}
	if quota > 0 {
		bucket := &UserQuotaBucket{
			UserId:          userId,
			BillingGroup:    billingGroup,
			Source:          source,
			SourceID:        sourceID,
			AmountTotal:     quota,
			AmountRemaining: quota,
			Priority:        quotaBucketPriority(billingGroup),
			Status:          QuotaBucketStatusActive,
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		if err := tx.Create(bucket).Error; err != nil {
			return err
		}
		if err := tx.Create(&UserQuotaBucketTransaction{
			UserId:       userId,
			BucketID:     bucket.Id,
			Type:         QuotaBucketTxnTypeAdjust,
			Source:       source,
			SourceID:     sourceID,
			Delta:        quota,
			BalanceAfter: quota,
			BillingGroup: billingGroup,
			Status:       "done",
			CreatedAt:    now,
		}).Error; err != nil {
			return err
		}
	}
	return tx.Model(&User{}).Where("id = ?", userId).Update("quota", quota).Error
}

// adjustTaskQuotaBucketsTx preserves the wallet identity of holds persisted before
// bucket billing existed, and otherwise restores precisely the original buckets.
func adjustTaskQuotaBucketsTx(tx *gorm.DB, userId int, meta QuotaBucketChargeMeta, delta int) error {
	if err := ensureUserQuotaBucketsMigratedTx(tx, userId); err != nil {
		return err
	}
	var debitCount int64
	if err := tx.Model(&UserQuotaBucketTransaction{}).Where("request_id = ? AND user_id = ? AND delta < 0", meta.RequestID, userId).Count(&debitCount).Error; err != nil {
		return err
	}
	if debitCount == 0 && meta.LegacyPreConsumed > 0 {
		now := common.GetTimestamp()
		bucket := &UserQuotaBucket{UserId: userId, BillingGroup: normalizeQuotaBucketBillingGroup(meta.BillingGroup), Source: QuotaBucketSourceLegacy, SourceID: quotaBucketSourceID(QuotaBucketSourceLegacy, ""), AmountTotal: meta.LegacyPreConsumed, AmountUsed: meta.LegacyPreConsumed, Status: QuotaBucketStatusActive, CreatedAt: now, UpdatedAt: now}
		if err := tx.Create(bucket).Error; err != nil {
			return err
		}
		if err := tx.Create(&UserQuotaBucketTransaction{RequestID: meta.RequestID, UserId: userId, BucketID: bucket.Id, Type: QuotaBucketTxnTypePreConsume, Source: bucket.Source, SourceID: bucket.SourceID, Delta: -meta.LegacyPreConsumed, BillingGroup: bucket.BillingGroup, CreatedAt: now, Status: "done"}).Error; err != nil {
			return err
		}
		debitCount = 1
	}
	if delta > 0 {
		return debitUserQuotaBucketsTx(tx, userId, delta, meta, QuotaBucketTxnTypeSettle, debitCount == 0, nil)
	}
	if delta == 0 {
		return nil
	}
	if debitCount == 0 {
		return creditUserQuotaBucketTx(tx, userId, -delta, QuotaBucketSourceRefund, "", QuotaBucketBillingGroupDefault, true)
	}
	refunded, err := refundUserQuotaBucketAmountTx(tx, meta.RequestID, userId, -delta, false)
	if err != nil {
		return err
	}
	if refunded != -delta {
		return errors.New("task refund exceeds outstanding quota bucket debit")
	}
	return nil
}
