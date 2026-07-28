package model

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	AffiliateRebateStatusPending = "pending"
	AffiliateRebateStatusSettled = "settled"
	AffiliateRebateStatusSkipped = "skipped"
	AffiliateRebateStatusFailed  = "failed"

	AffiliateRebateSourceTypeBucket       = "bucket"
	AffiliateRebateSourceTypeSubscription = "subscription"
)

var affiliateRebateGatewayProviders = map[string]struct{}{
	PaymentProviderEpay:         {},
	PaymentProviderStripe:       {},
	PaymentProviderCreem:        {},
	PaymentProviderWaffo:        {},
	PaymentProviderWaffoPancake: {},
}

type AffiliateUsageRebateEvent struct {
	Id int64 `json:"id" gorm:"primaryKey"`

	RequestId string `json:"request_id" gorm:"type:varchar(191);not null;uniqueIndex"`

	InviteeId int `json:"invitee_id" gorm:"index;not null"`
	InviterId int `json:"inviter_id" gorm:"index;not null"`

	BillingSource string `json:"billing_source" gorm:"type:varchar(32);not null"`
	BillingGroup  string `json:"billing_group" gorm:"type:varchar(64);not null;default:''"`

	SourceType     string `json:"source_type" gorm:"type:varchar(32);not null"`
	SourceId       string `json:"source_id" gorm:"type:varchar(191);not null;default:''"`
	SourceProvider string `json:"source_provider" gorm:"type:varchar(50);not null;default:''"`

	ActualQuota   int64 `json:"actual_quota" gorm:"not null;default:0"`
	EligibleQuota int64 `json:"eligible_quota" gorm:"not null;default:0"`

	RebateBps   int    `json:"rebate_bps" gorm:"not null;default:0"`
	RebateGroup string `json:"rebate_group" gorm:"type:varchar(64);not null;default:'default'"`

	Status    string `json:"status" gorm:"type:varchar(32);not null;default:'pending';index"`
	EventDate string `json:"event_date" gorm:"type:varchar(10);not null;index"`

	CreatedAt int64 `json:"created_at" gorm:"not null;default:0"`
	UpdatedAt int64 `json:"updated_at" gorm:"not null;default:0"`
	SettledAt int64 `json:"settled_at" gorm:"not null;default:0"`
}

func (e *AffiliateUsageRebateEvent) BeforeCreate(_ *gorm.DB) error {
	now := common.GetTimestamp()
	if e.CreatedAt == 0 {
		e.CreatedAt = now
	}
	if e.UpdatedAt == 0 {
		e.UpdatedAt = now
	}
	if e.Status == "" {
		e.Status = AffiliateRebateStatusPending
	}
	if e.EventDate == "" {
		e.EventDate = affiliateRebateDate(time.Unix(now, 0))
	}
	return nil
}

func (e *AffiliateUsageRebateEvent) BeforeUpdate(_ *gorm.DB) error {
	e.UpdatedAt = common.GetTimestamp()
	return nil
}

type AffiliateDailyRebateSettlement struct {
	Id int64 `json:"id" gorm:"primaryKey"`

	SettlementDate string `json:"settlement_date" gorm:"type:varchar(10);not null;uniqueIndex:idx_aff_rebate_daily,priority:1;index"`
	InviterId      int    `json:"inviter_id" gorm:"not null;uniqueIndex:idx_aff_rebate_daily,priority:2;index"`

	RebateBps   int    `json:"rebate_bps" gorm:"not null;default:0;uniqueIndex:idx_aff_rebate_daily,priority:4"`
	RebateGroup string `json:"rebate_group" gorm:"type:varchar(64);not null;default:'default';uniqueIndex:idx_aff_rebate_daily,priority:3"`

	EventCount  int   `json:"event_count" gorm:"not null;default:0"`
	BaseQuota   int64 `json:"base_quota" gorm:"not null;default:0"`
	RebateQuota int64 `json:"rebate_quota" gorm:"not null;default:0"`

	Status string `json:"status" gorm:"type:varchar(32);not null;default:'settled';index"`

	SourceId string `json:"source_id" gorm:"type:varchar(191);not null;default:''"`

	CreatedAt int64 `json:"created_at" gorm:"not null;default:0"`
	UpdatedAt int64 `json:"updated_at" gorm:"not null;default:0"`
}

func (s *AffiliateDailyRebateSettlement) BeforeCreate(_ *gorm.DB) error {
	now := common.GetTimestamp()
	if s.CreatedAt == 0 {
		s.CreatedAt = now
	}
	if s.UpdatedAt == 0 {
		s.UpdatedAt = now
	}
	if s.Status == "" {
		s.Status = AffiliateRebateStatusSettled
	}
	return nil
}

func (s *AffiliateDailyRebateSettlement) BeforeUpdate(_ *gorm.DB) error {
	s.UpdatedAt = common.GetTimestamp()
	return nil
}

type AffiliateRebateRecordParams struct {
	RequestId      string
	InviteeId      int
	BillingSource  string
	BillingGroup   string
	ActualQuota    int
	EligibleQuota  int
	SourceType     string
	SourceId       string
	SourceProvider string
}

type AffiliateRebateSettlementSummary struct {
	SettlementDate string `json:"settlement_date"`
	EventCount     int    `json:"event_count"`
	InviterCount   int    `json:"inviter_count"`
	BaseQuota      int64  `json:"base_quota"`
	RebateQuota    int64  `json:"rebate_quota"`
	SkippedEvents  int64  `json:"skipped_events"`
}

func affiliateRebateDate(t time.Time) string {
	return t.Local().Format("2006-01-02")
}

func AffiliateRebateYesterdayDate() string {
	return affiliateRebateDate(time.Now().AddDate(0, 0, -1))
}

func IsAffiliateUsageRebateEnabled() bool {
	return setting.AffiliateUsageRebateEnabled && setting.AffiliateUsageRebateBps > 0
}

func NormalizeAffiliateUsageRebateGroup(group string) string {
	group = strings.TrimSpace(group)
	if group == "" {
		return QuotaBucketBillingGroupDefault
	}
	return group
}

func isAffiliateGatewayProvider(provider string) bool {
	provider = strings.TrimSpace(provider)
	_, ok := affiliateRebateGatewayProviders[provider]
	return ok
}

func RecordAffiliateUsageRebateEvent(params AffiliateRebateRecordParams) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		return RecordAffiliateUsageRebateEventTx(tx, params)
	})
}

func RecordAffiliateUsageRebateEventTx(tx *gorm.DB, params AffiliateRebateRecordParams) error {
	if tx == nil {
		tx = DB
	}
	if !IsAffiliateUsageRebateEnabled() {
		return nil
	}
	requestID := strings.TrimSpace(params.RequestId)
	if requestID == "" || params.InviteeId <= 0 || params.ActualQuota <= 0 || params.EligibleQuota <= 0 {
		return nil
	}

	var invitee User
	if err := tx.Select("id", "inviter_id").Where("id = ?", params.InviteeId).First(&invitee).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if invitee.InviterId <= 0 || invitee.InviterId == params.InviteeId {
		return nil
	}
	var inviter User
	if err := tx.Select("id", "status").Where("id = ?", invitee.InviterId).First(&inviter).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if inviter.Status == common.UserStatusDisabled {
		return nil
	}

	rebateBps := setting.AffiliateUsageRebateBps
	if rebateBps <= 0 {
		return nil
	}
	if rebateBps > 10000 {
		rebateBps = 10000
	}
	rebateGroup := NormalizeAffiliateUsageRebateGroup(setting.GetAffiliateUsageRebateGroup())
	now := common.GetTimestamp()
	event := &AffiliateUsageRebateEvent{
		RequestId:      requestID,
		InviteeId:      params.InviteeId,
		InviterId:      invitee.InviterId,
		BillingSource:  strings.TrimSpace(params.BillingSource),
		BillingGroup:   strings.TrimSpace(params.BillingGroup),
		SourceType:     strings.TrimSpace(params.SourceType),
		SourceId:       strings.TrimSpace(params.SourceId),
		SourceProvider: strings.TrimSpace(params.SourceProvider),
		ActualQuota:    int64(params.ActualQuota),
		EligibleQuota:  int64(params.EligibleQuota),
		RebateBps:      rebateBps,
		RebateGroup:    rebateGroup,
		Status:         AffiliateRebateStatusPending,
		EventDate:      affiliateRebateDate(time.Unix(now, 0)),
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(event).Error
}

func eligibleWalletRebateQuota(requestID string, userId int) (int, string, string, error) {
	return eligibleWalletRebateQuotaTx(DB, requestID, userId)
}

func eligibleWalletRebateQuotaTx(tx *gorm.DB, requestID string, userId int) (int, string, string, error) {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" || userId <= 0 || !IsQuotaBucketBillingEnabled() {
		return 0, "", "", nil
	}
	if tx == nil {
		tx = DB
	}
	var txns []UserQuotaBucketTransaction
	if err := tx.Where("request_id = ? AND user_id = ? AND status = ?", requestID, userId, "done").Find(&txns).Error; err != nil {
		return 0, "", "", err
	}
	eligible := 0
	var sourceID string
	for _, txn := range txns {
		if txn.Source != QuotaBucketSourceTopup && txn.Source != QuotaBucketSourceRedemption {
			continue
		}
		if sourceID == "" && txn.SourceID != "" {
			sourceID = txn.SourceID
		}
		if txn.Delta < 0 {
			eligible += -txn.Delta
		} else if txn.Delta > 0 {
			eligible -= txn.Delta
		}
	}
	if eligible < 0 {
		eligible = 0
	}
	return eligible, AffiliateRebateSourceTypeBucket, sourceID, nil
}

func subscriptionRebateEligibility(subscriptionId int) (bool, string, string, error) {
	if subscriptionId <= 0 {
		return false, "", "", nil
	}
	var sub UserSubscription
	if err := DB.Select("id", "purchase_trade_no", "payment_provider").Where("id = ?", subscriptionId).First(&sub).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, "", "", nil
		}
		return false, "", "", err
	}
	if !isAffiliateGatewayProvider(sub.PaymentProvider) || strings.TrimSpace(sub.PurchaseTradeNo) == "" {
		return false, "", "", nil
	}
	return true, sub.PurchaseTradeNo, sub.PaymentProvider, nil
}

func RecordAffiliateUsageRebateFromBilling(requestID string, userId int, billingSource string, billingGroup string, subscriptionId int, actualQuota int) error {
	if !IsAffiliateUsageRebateEnabled() || actualQuota <= 0 || userId <= 0 {
		return nil
	}
	if billingSource == "subscription" {
		// Subscription quota usage itself is not eligible for affiliate rebates.
		// Eligible subscription purchases are recorded at purchase time instead.
		return nil
	}
	return recordAffiliateUsageRebateFromWalletDebitTx(DB, requestID, userId, billingGroup, actualQuota, "wallet")
}

func RecordAffiliateUsageRebateFromWalletPurchaseTx(tx *gorm.DB, requestID string, userId int, billingGroup string, actualQuota int) error {
	return recordAffiliateUsageRebateFromWalletDebitTx(tx, requestID, userId, billingGroup, actualQuota, "subscription_purchase")
}

func RecordAffiliateUsageRebateFromSubscriptionOrderPurchaseTx(tx *gorm.DB, requestID string, userId int, plan *SubscriptionPlan, paymentProvider string) error {
	if !IsAffiliateUsageRebateEnabled() || userId <= 0 || plan == nil || strings.TrimSpace(requestID) == "" || !isAffiliateGatewayProvider(paymentProvider) {
		return nil
	}
	quota, err := subscriptionWalletChargeQuota(plan)
	if err != nil || quota <= 0 {
		return nil
	}
	return RecordAffiliateUsageRebateEventTx(tx, AffiliateRebateRecordParams{
		RequestId:      requestID,
		InviteeId:      userId,
		BillingSource:  "subscription_purchase",
		BillingGroup:   "subscription",
		ActualQuota:    quota,
		EligibleQuota:  quota,
		SourceType:     AffiliateRebateSourceTypeSubscription,
		SourceId:       requestID,
		SourceProvider: strings.TrimSpace(paymentProvider),
	})
}

func recordAffiliateUsageRebateFromWalletDebitTx(tx *gorm.DB, requestID string, userId int, billingGroup string, actualQuota int, billingSource string) error {
	if !IsAffiliateUsageRebateEnabled() || actualQuota <= 0 || userId <= 0 {
		return nil
	}
	eligibleQuota, sourceType, sourceID, err := eligibleWalletRebateQuotaTx(tx, requestID, userId)
	if err != nil || eligibleQuota <= 0 {
		return err
	}
	if eligibleQuota > actualQuota {
		eligibleQuota = actualQuota
	}
	return RecordAffiliateUsageRebateEventTx(tx, AffiliateRebateRecordParams{
		RequestId:      requestID,
		InviteeId:      userId,
		BillingSource:  billingSource,
		BillingGroup:   billingGroup,
		ActualQuota:    actualQuota,
		EligibleQuota:  eligibleQuota,
		SourceType:     sourceType,
		SourceId:       sourceID,
		SourceProvider: "quota_bucket",
	})
}

func RunAffiliateDailyRebateSettlement(ctx context.Context, settlementDate string) (*AffiliateRebateSettlementSummary, error) {
	settlementDate = strings.TrimSpace(settlementDate)
	if settlementDate == "" {
		settlementDate = AffiliateRebateYesterdayDate()
	}
	summary := &AffiliateRebateSettlementSummary{SettlementDate: settlementDate}
	if !IsAffiliateUsageRebateEnabled() {
		return summary, nil
	}
	type rebateLogMessage struct {
		userId  int
		message string
	}
	logMessages := make([]rebateLogMessage, 0)

	err := DB.Transaction(func(tx *gorm.DB) error {
		if ctx != nil {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}
		}
		var events []AffiliateUsageRebateEvent
		if err := lockForUpdate(tx).Where("event_date = ? AND status = ?", settlementDate, AffiliateRebateStatusPending).
			Order("id asc").Find(&events).Error; err != nil {
			return err
		}
		if len(events) == 0 {
			return nil
		}
		type groupKey struct {
			InviterId   int
			RebateBps   int
			RebateGroup string
		}
		groups := make(map[groupKey][]AffiliateUsageRebateEvent)
		for _, event := range events {
			if event.EligibleQuota <= 0 || event.RebateBps <= 0 {
				summary.SkippedEvents++
				if err := tx.Model(&AffiliateUsageRebateEvent{}).Where("id = ?", event.Id).Updates(map[string]interface{}{"status": AffiliateRebateStatusSkipped, "settled_at": common.GetTimestamp()}).Error; err != nil {
					return err
				}
				continue
			}
			key := groupKey{InviterId: event.InviterId, RebateBps: event.RebateBps, RebateGroup: event.RebateGroup}
			groups[key] = append(groups[key], event)
		}

		for key, groupedEvents := range groups {
			if ctx != nil {
				select {
				case <-ctx.Done():
					return ctx.Err()
				default:
				}
			}
			var baseQuota int64
			eventIds := make([]int64, 0, len(groupedEvents))
			for _, event := range groupedEvents {
				baseQuota += event.EligibleQuota
				eventIds = append(eventIds, event.Id)
			}
			rebateQuota := baseQuota * int64(key.RebateBps) / 10000
			settledAt := common.GetTimestamp()
			if rebateQuota <= 0 {
				summary.SkippedEvents += int64(len(groupedEvents))
				if err := tx.Model(&AffiliateUsageRebateEvent{}).Where("id IN ?", eventIds).Updates(map[string]interface{}{"status": AffiliateRebateStatusSkipped, "settled_at": settledAt}).Error; err != nil {
					return err
				}
				continue
			}
			rebateGroup := NormalizeAffiliateUsageRebateGroup(key.RebateGroup)
			settlementSourceID := fmt.Sprintf("affiliate-rebate:%s:inviter:%d:group:%s:bps:%d", settlementDate, key.InviterId, rebateGroup, key.RebateBps)
			creditSourceID := settlementSourceID
			if len(eventIds) > 0 {
				creditSourceID = fmt.Sprintf("%s:events:%d-%d", settlementSourceID, eventIds[0], eventIds[len(eventIds)-1])
			}
			settlement := &AffiliateDailyRebateSettlement{
				SettlementDate: settlementDate,
				InviterId:      key.InviterId,
				RebateBps:      key.RebateBps,
				RebateGroup:    rebateGroup,
				EventCount:     len(groupedEvents),
				BaseQuota:      baseQuota,
				RebateQuota:    rebateQuota,
				Status:         AffiliateRebateStatusSettled,
				SourceId:       settlementSourceID,
			}
			res := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(settlement)
			if res.Error != nil {
				return res.Error
			}
			if res.RowsAffected == 0 {
				if err := tx.Model(&AffiliateDailyRebateSettlement{}).
					Where("settlement_date = ? AND inviter_id = ? AND rebate_bps = ? AND rebate_group = ?", settlementDate, key.InviterId, key.RebateBps, rebateGroup).
					Updates(map[string]interface{}{
						"event_count":  gorm.Expr("event_count + ?", len(groupedEvents)),
						"base_quota":   gorm.Expr("base_quota + ?", baseQuota),
						"rebate_quota": gorm.Expr("rebate_quota + ?", rebateQuota),
						"status":       AffiliateRebateStatusSettled,
					}).Error; err != nil {
					return err
				}
			}
			if err := creditAffiliateRebateQuotaTx(tx, key.InviterId, int(rebateQuota), creditSourceID, rebateGroup); err != nil {
				return err
			}
			if err := tx.Model(&User{}).Where("id = ?", key.InviterId).Updates(map[string]interface{}{
				"aff_history": gorm.Expr("aff_history + ?", int(rebateQuota)),
			}).Error; err != nil {
				return err
			}
			if err := tx.Model(&AffiliateUsageRebateEvent{}).Where("id IN ?", eventIds).Updates(map[string]interface{}{"status": AffiliateRebateStatusSettled, "settled_at": settledAt}).Error; err != nil {
				return err
			}
			summary.EventCount += len(groupedEvents)
			summary.InviterCount++
			summary.BaseQuota += baseQuota
			summary.RebateQuota += rebateQuota
			logMessages = append(logMessages, rebateLogMessage{
				userId: key.InviterId,
				message: fmt.Sprintf("邀请返利到账：结算日期 %s，被邀请用户实际消耗 %s，返利比例 %.2f%%，返利 %s，到账额度桶 %s",
					settlementDate, logger.LogQuota(int(baseQuota)), float64(key.RebateBps)/100, logger.LogQuota(int(rebateQuota)), rebateGroup),
			})
		}
		return nil
	})
	if err == nil {
		for _, logMessage := range logMessages {
			RecordLog(logMessage.userId, LogTypeSystem, logMessage.message)
		}
	}
	return summary, err
}

func creditAffiliateRebateQuotaTx(tx *gorm.DB, userId int, quota int, sourceID string, rebateGroup string) error {
	if quota <= 0 {
		return nil
	}
	if IsQuotaBucketBillingEnabled() {
		return creditUserQuotaBucketTx(tx, userId, quota, QuotaBucketSourceAffiliateRebate, sourceID, rebateGroup, true)
	}
	return tx.Model(&User{}).Where("id = ?", userId).Update("quota", gorm.Expr("quota + ?", quota)).Error
}

func GetUserAffiliateRebateSettlements(userId int, startIdx int, num int) ([]AffiliateDailyRebateSettlement, int64, error) {
	if userId <= 0 {
		return nil, 0, errors.New("invalid userId")
	}
	if num <= 0 || num > 100 {
		num = 20
	}
	var total int64
	query := DB.Model(&AffiliateDailyRebateSettlement{}).Where("inviter_id = ?", userId)
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := make([]AffiliateDailyRebateSettlement, 0)
	if err := query.Order("settlement_date desc, id desc").Limit(num).Offset(startIdx).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func GetAllAffiliateRebateSettlements(startIdx int, num int) ([]AffiliateDailyRebateSettlement, int64, error) {
	if num <= 0 || num > 100 {
		num = 20
	}
	var total int64
	query := DB.Model(&AffiliateDailyRebateSettlement{})
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := make([]AffiliateDailyRebateSettlement, 0)
	if err := query.Order("settlement_date desc, id desc").Limit(num).Offset(startIdx).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}
