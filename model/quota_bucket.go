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

	QuotaBucketSourceMigration  = "migration"
	QuotaBucketSourceTopup      = "topup"
	QuotaBucketSourceRedemption = "redemption"
	QuotaBucketSourceRegister   = "register"
	QuotaBucketSourceInvite     = "invite"
	QuotaBucketSourceCheckin    = "checkin"
	QuotaBucketSourceAdmin      = "admin"
	QuotaBucketSourceRefund     = "refund"
	QuotaBucketSourceLegacy     = "legacy"

	QuotaBucketTxnTypeCredit     = "credit"
	QuotaBucketTxnTypeMigration  = "migration"
	QuotaBucketTxnTypePreConsume = "pre_consume"
	QuotaBucketTxnTypeSettle     = "settle"
	QuotaBucketTxnTypeRefund     = "refund"
	QuotaBucketTxnTypeAdjust     = "adjust"
)

var ErrQuotaBucketInsufficient = errors.New("quota bucket balance insufficient")

type UserQuotaBucket struct {
	Id              int64  `json:"id" gorm:"primaryKey"`
	UserId          int    `json:"user_id" gorm:"index;index:idx_quota_bucket_active,priority:1;uniqueIndex:idx_quota_bucket_source,priority:1"`
	BillingGroup    string `json:"billing_group" gorm:"type:varchar(64);not null;default:'default';index:idx_quota_bucket_active,priority:3"`
	Source          string `json:"source" gorm:"type:varchar(32);not null;default:'';uniqueIndex:idx_quota_bucket_source,priority:2"`
	SourceID        string `json:"source_id" gorm:"type:varchar(191);not null;default:'';uniqueIndex:idx_quota_bucket_source,priority:3"`
	AmountTotal     int    `json:"amount_total" gorm:"not null;default:0"`
	AmountRemaining int    `json:"amount_remaining" gorm:"not null;default:0"`
	AmountUsed      int    `json:"amount_used" gorm:"not null;default:0"`
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
	Delta        int    `json:"delta" gorm:"not null;default:0"`
	BalanceAfter int    `json:"balance_after" gorm:"not null;default:0"`
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
	RequestID    string
	UsingGroup   string
	BillingGroup string
	ModelName    string
	TokenId      int
	ChannelId    int
}

type QuotaBucketChargePlan struct {
	UserId       int                     `json:"user_id"`
	BillingGroup string                  `json:"billing_group"`
	RequestID    string                  `json:"request_id"`
	PreConsumed  int                     `json:"pre_consumed"`
	Allocations  []QuotaBucketAllocation `json:"allocations"`
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

func refreshUserQuotaCacheFromDB(userId int, reason string) {
	if userId <= 0 {
		return
	}
	var quota int
	if err := DB.Model(&User{}).Where("id = ?", userId).Select("quota").Scan(&quota).Error; err != nil {
		common.SysLog("failed to query user quota cache after " + reason + ": " + err.Error())
		return
	}
	if err := updateUserQuotaCache(userId, quota); err != nil {
		common.SysLog("failed to refresh user quota cache after " + reason + ": " + err.Error())
	}
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
	var migrationCount int64
	if err := tx.Model(&UserQuotaBucket{}).Where("user_id = ? AND source = ?", userId, QuotaBucketSourceMigration).Count(&migrationCount).Error; err != nil {
		return err
	}
	if migrationCount > 0 {
		return nil
	}

	var user User
	if err := tx.Set("gorm:query_option", "FOR UPDATE").Where("id = ?", userId).First(&user).Error; err != nil {
		return err
	}
	var existingRemaining int64
	if err := tx.Model(&UserQuotaBucket{}).Where("user_id = ? AND status = ?", userId, QuotaBucketStatusActive).
		Select("COALESCE(SUM(amount_remaining), 0)").Scan(&existingRemaining).Error; err != nil {
		return err
	}
	legacyQuota := user.Quota - int(existingRemaining)
	if legacyQuota <= 0 {
		return nil
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

func CreditUserQuotaBucket(userId int, quota int, source string, sourceID string, billingGroup string) error {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	if quota == 0 {
		return nil
	}
	if !IsQuotaBucketBillingEnabled() {
		return IncreaseUserQuota(userId, quota, true)
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		return creditUserQuotaBucketTx(tx, userId, quota, source, sourceID, billingGroup, true)
	})
	if err != nil {
		return err
	}
	refreshUserQuotaCacheFromDB(userId, "bucket credit")
	return nil
}

func creditUserQuotaBucketTx(tx *gorm.DB, userId int, quota int, source string, sourceID string, billingGroup string, updateUserQuota bool) error {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
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
		if err := tx.Model(&User{}).Where("id = ?", userId).Update("quota", gorm.Expr("quota + ?", quota)).Error; err != nil {
			return err
		}
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
		return nil, errors.New("quota 不能为负数！")
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
	var buckets []UserQuotaBucket
	query := activeQuotaBucketQuery(tx.Set("gorm:query_option", "FOR UPDATE"), userId, meta.BillingGroup)
	if anyGroup {
		query = activeAnyQuotaBucketQuery(tx.Set("gorm:query_option", "FOR UPDATE"), userId)
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
		if err := tx.Model(&UserQuotaBucket{}).
			Where("id = ? AND amount_remaining >= ?", bucket.Id, useAmount).
			Updates(map[string]interface{}{
				"amount_remaining": gorm.Expr("amount_remaining - ?", useAmount),
				"amount_used":      gorm.Expr("amount_used + ?", useAmount),
				"updated_at":       now,
			}).Error; err != nil {
			return err
		}
		if err := tx.Create(&UserQuotaBucketTransaction{
			RequestID:    meta.RequestID,
			UserId:       userId,
			BucketID:     bucket.Id,
			Type:         txnType,
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
	return tx.Model(&User{}).Where("id = ?", userId).Update("quota", gorm.Expr("quota - ?", amount)).Error
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

func refundUserQuotaBucketAmount(requestID string, userId int, amount int, all bool) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		query := tx.Where("request_id = ? AND type = ?", requestID, QuotaBucketTxnTypeRefund)
		if userId > 0 {
			query = query.Where("user_id = ?", userId)
		}
		var refundCount int64
		if err := query.Model(&UserQuotaBucketTransaction{}).Count(&refundCount).Error; err != nil {
			return err
		}
		if all && refundCount > 0 {
			return nil
		}

		debitTypes := []string{QuotaBucketTxnTypePreConsume, QuotaBucketTxnTypeSettle, QuotaBucketTxnTypeAdjust}
		debitQuery := tx.Where("request_id = ? AND type IN ?", requestID, debitTypes)
		if userId > 0 {
			debitQuery = debitQuery.Where("user_id = ?", userId)
		}
		var debits []UserQuotaBucketTransaction
		if err := debitQuery.Order("id desc").Find(&debits).Error; err != nil {
			return err
		}
		if len(debits) == 0 {
			return nil
		}

		remaining := amount
		if all {
			remaining = 0
			for _, debit := range debits {
				if debit.Delta < 0 {
					remaining += -debit.Delta
				}
			}
		}
		if remaining <= 0 {
			return nil
		}

		now := common.GetTimestamp()
		refundedTotal := 0
		refundedUserId := debits[0].UserId
		for _, debit := range debits {
			if remaining <= 0 {
				break
			}
			if debit.Delta >= 0 {
				continue
			}
			refundAmount := -debit.Delta
			if refundAmount > remaining {
				refundAmount = remaining
			}
			var bucket UserQuotaBucket
			if err := tx.Set("gorm:query_option", "FOR UPDATE").Where("id = ?", debit.BucketID).First(&bucket).Error; err != nil {
				return err
			}
			newRemaining := bucket.AmountRemaining + refundAmount
			if err := tx.Model(&UserQuotaBucket{}).Where("id = ?", bucket.Id).Updates(map[string]interface{}{
				"amount_remaining": gorm.Expr("amount_remaining + ?", refundAmount),
				"amount_used":      gorm.Expr("amount_used - ?", refundAmount),
				"updated_at":       now,
			}).Error; err != nil {
				return err
			}
			if err := tx.Create(&UserQuotaBucketTransaction{
				RequestID:    requestID,
				UserId:       debit.UserId,
				BucketID:     bucket.Id,
				Type:         QuotaBucketTxnTypeRefund,
				Delta:        refundAmount,
				BalanceAfter: newRemaining,
				UsingGroup:   debit.UsingGroup,
				BillingGroup: debit.BillingGroup,
				ModelName:    debit.ModelName,
				TokenId:      debit.TokenId,
				ChannelId:    debit.ChannelId,
				Status:       "done",
				CreatedAt:    now,
			}).Error; err != nil {
				return err
			}
			remaining -= refundAmount
			refundedTotal += refundAmount
			refundedUserId = debit.UserId
		}
		if refundedTotal <= 0 {
			return nil
		}
		if err := tx.Model(&User{}).Where("id = ?", refundedUserId).Update("quota", gorm.Expr("quota + ?", refundedTotal)).Error; err != nil {
			return err
		}
		refreshUserQuotaCacheFromDB(refundedUserId, "bucket refund")
		return nil
	})
}

func ResetUserQuotaBuckets(userId int, quota int, source string, sourceID string, billingGroup string) error {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	if !IsQuotaBucketBillingEnabled() {
		err := DB.Model(&User{}).Where("id = ?", userId).Update("quota", quota).Error
		if err == nil {
			_ = updateUserQuotaCache(userId, quota)
		}
		return err
	}
	source = strings.TrimSpace(source)
	if source == "" {
		source = QuotaBucketSourceAdmin
	}
	sourceID = quotaBucketSourceID(source, sourceID)
	billingGroup = normalizeQuotaBucketBillingGroup(billingGroup)
	err := DB.Transaction(func(tx *gorm.DB) error {
		now := common.GetTimestamp()
		if err := ensureUserQuotaBucketsMigratedTx(tx, userId); err != nil {
			return err
		}
		if err := tx.Model(&UserQuotaBucket{}).Where("user_id = ? AND status = ?", userId, QuotaBucketStatusActive).
			Updates(map[string]interface{}{"status": QuotaBucketStatusInactive, "updated_at": now}).Error; err != nil {
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
	})
	if err != nil {
		return err
	}
	if err := updateUserQuotaCache(userId, quota); err != nil {
		common.SysLog("failed to refresh user quota cache after bucket reset: " + err.Error())
	}
	return nil
}
