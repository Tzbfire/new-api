package service

import (
	"fmt"

	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

const (
	BillingSourceWallet           = "wallet"
	BillingSourceSubscription     = "subscription"
	billingSettlementObserverKey  = "billing_settlement_observer"
	forceImmediateQuotaBillingKey = "force_immediate_quota_billing"
	durableAsyncBillingKey        = "durable_async_billing"
)

// BillingSettlementObserver receives the authoritative billing result before
// optional consume-log recording. Async browser features use it to persist
// recovery state in the primary database without depending on audit logs.
type BillingSettlementObserver func(info *relaycommon.RelayInfo, actualQuota int)

func SetBillingSettlementObserver(c *gin.Context, observer BillingSettlementObserver) {
	if c != nil && observer != nil {
		c.Set(billingSettlementObserverKey, observer)
	}
}

func SetDurableAsyncBilling(c *gin.Context) {
	if c != nil {
		c.Set(durableAsyncBillingKey, true)
		c.Set(forceImmediateQuotaBillingKey, true)
	}
}

func UsesDurableAsyncBilling(c *gin.Context) bool {
	return c != nil && c.GetBool(durableAsyncBillingKey)
}

func notifyBillingSettlementObserver(c *gin.Context, info *relaycommon.RelayInfo, actualQuota int) {
	if c == nil {
		return
	}
	observer, exists := c.Get(billingSettlementObserverKey)
	if !exists {
		return
	}
	if callback, ok := observer.(BillingSettlementObserver); ok {
		callback(info, actualQuota)
	}
}

// PreConsumeBilling 根据用户计费偏好创建 BillingSession 并执行预扣费。
// 会话存储在 relayInfo.Billing 上，供后续 Settle / Refund 使用。
const imageStudioPreheldQuotaKey = "image_studio_preheld_quota"

// ImageStudioPrehold describes a submit-time funding hold that execute must adopt.
type ImageStudioPrehold struct {
	Quota          int
	Source         string
	SubscriptionId int
	RequestId      string
}

// SetImageStudioPreheldQuota tells PreConsumeBilling that a wallet hold was
// already taken when the durable studio job was submitted. Prefer
// SetImageStudioPreheldBilling when the source may be subscription.
func SetImageStudioPreheldQuota(c *gin.Context, quota int) {
	SetImageStudioPreheldBilling(c, ImageStudioPrehold{
		Quota:  quota,
		Source: BillingSourceWallet,
	})
}

// SetImageStudioPreheldBilling tells PreConsumeBilling that funding was already
// reserved at job submit (wallet or subscription). Execute must not debit again.
func SetImageStudioPreheldBilling(c *gin.Context, hold ImageStudioPrehold) {
	if c == nil || hold.Quota < 0 {
		return
	}
	if hold.Source == "" {
		hold.Source = BillingSourceWallet
	}
	c.Set(imageStudioPreheldQuotaKey, hold)
}

func imageStudioPreheld(c *gin.Context) (ImageStudioPrehold, bool) {
	if c == nil {
		return ImageStudioPrehold{}, false
	}
	value, ok := c.Get(imageStudioPreheldQuotaKey)
	if !ok {
		return ImageStudioPrehold{}, false
	}
	switch held := value.(type) {
	case ImageStudioPrehold:
		if held.Quota < 0 {
			return ImageStudioPrehold{}, false
		}
		return held, true
	case int:
		// Backward-compatible with older callers/tests that stored a bare int.
		if held < 0 {
			return ImageStudioPrehold{}, false
		}
		return ImageStudioPrehold{Quota: held, Source: BillingSourceWallet}, true
	default:
		return ImageStudioPrehold{}, false
	}
}

// PreHoldImageStudioBilling reserves funding at job submit according to the
// user's billing preference (subscription_first / wallet_first / ...).
// Caller must set relayInfo.RequestId to the per-task request id first.
func PreHoldImageStudioBilling(c *gin.Context, relayInfo *relaycommon.RelayInfo, quota int) (ImageStudioPrehold, *types.NewAPIError) {
	if relayInfo == nil {
		return ImageStudioPrehold{}, types.NewError(fmt.Errorf("relayInfo is nil"), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}
	if quota <= 0 {
		return ImageStudioPrehold{}, nil
	}

	prevForce := relayInfo.ForcePreConsume
	prevPlayground := relayInfo.IsPlayground
	relayInfo.ForcePreConsume = true
	relayInfo.IsPlayground = true
	defer func() {
		relayInfo.ForcePreConsume = prevForce
		relayInfo.IsPlayground = prevPlayground
		relayInfo.Billing = nil
	}()

	if c != nil {
		c.Set(forceImmediateQuotaBillingKey, true)
	}

	session, apiErr := NewBillingSession(c, relayInfo, quota)
	if apiErr != nil {
		return ImageStudioPrehold{}, apiErr
	}
	hold := ImageStudioPrehold{
		Quota:          session.GetPreConsumedQuota(),
		Source:         relayInfo.BillingSource,
		SubscriptionId: relayInfo.SubscriptionId,
		RequestId:      relayInfo.RequestId,
	}
	if hold.Source == "" {
		hold.Source = BillingSourceWallet
	}
	return hold, nil
}

func PreConsumeBilling(c *gin.Context, preConsumedQuota int, relayInfo *relaycommon.RelayInfo) *types.NewAPIError {
	if held, ok := imageStudioPreheld(c); ok {
		return adoptImageStudioPreheldBilling(c, relayInfo, held)
	}
	session, apiErr := NewBillingSession(c, relayInfo, preConsumedQuota)
	if apiErr != nil {
		return apiErr
	}
	relayInfo.Billing = session
	notifyBillingSettlementObserver(c, relayInfo, session.GetPreConsumedQuota())
	return nil
}

// adoptImageStudioPreheldBilling builds a BillingSession whose pre-consume was
// already applied at job submit. Settlement still adjusts to the real charge.
func adoptImageStudioPreheldBilling(c *gin.Context, relayInfo *relaycommon.RelayInfo, hold ImageStudioPrehold) *types.NewAPIError {
	if relayInfo == nil {
		return types.NewError(fmt.Errorf("relayInfo is nil"), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}
	held := hold.Quota
	userQuota, err := model.GetUserQuota(relayInfo.UserId, false)
	if err != nil {
		return types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
	}
	relayInfo.UserQuota = userQuota

	var funding FundingSource
	source := hold.Source
	if source == "" {
		source = BillingSourceWallet
	}
	if source == BillingSourceSubscription {
		requestId := hold.RequestId
		if requestId == "" {
			requestId = relayInfo.RequestId
		}
		subFunding := &SubscriptionFunding{
			requestId:      requestId,
			userId:         relayInfo.UserId,
			modelName:      relayInfo.OriginModelName,
			usingGroup:     relayInfo.UsingGroup,
			amount:         int64(held),
			subscriptionId: hold.SubscriptionId,
			preConsumed:    int64(held),
		}
		if hold.SubscriptionId > 0 {
			if planInfo, planErr := model.GetSubscriptionPlanInfoByUserSubscriptionId(hold.SubscriptionId); planErr == nil && planInfo != nil {
				subFunding.PlanId = planInfo.PlanId
				subFunding.PlanTitle = planInfo.PlanTitle
			}
		}
		funding = subFunding
	} else {
		funding = &WalletFunding{userId: relayInfo.UserId, forceDB: true, consumed: held}
	}

	session := &BillingSession{
		relayInfo:        relayInfo,
		funding:          funding,
		preConsumedQuota: held,
	}
	session.syncRelayInfo()
	relayInfo.Billing = session
	relayInfo.BillingSource = source
	notifyBillingSettlementObserver(c, relayInfo, held)
	return nil
}

// ---------------------------------------------------------------------------
// SettleBilling — 后结算辅助函数
// ---------------------------------------------------------------------------

// SettleBilling 执行计费结算。如果 RelayInfo 上有 BillingSession 则通过 session 结算，
// 否则回退到旧的 PostConsumeQuota 路径（兼容按次计费等场景）。
func SettleBilling(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, actualQuota int) error {
	if relayInfo.Billing != nil {
		preConsumed := relayInfo.Billing.GetPreConsumedQuota()
		delta := actualQuota - preConsumed

		if delta > 0 {
			logger.LogInfo(ctx, fmt.Sprintf("预扣费后补扣费：%s（实际消耗：%s，预扣费：%s）",
				logger.FormatQuota(delta),
				logger.FormatQuota(actualQuota),
				logger.FormatQuota(preConsumed),
			))
		} else if delta < 0 {
			logger.LogInfo(ctx, fmt.Sprintf("预扣费后返还扣费：%s（实际消耗：%s，预扣费：%s）",
				logger.FormatQuota(-delta),
				logger.FormatQuota(actualQuota),
				logger.FormatQuota(preConsumed),
			))
		} else {
			logger.LogInfo(ctx, fmt.Sprintf("预扣费与实际消耗一致，无需调整：%s（按次计费）",
				logger.FormatQuota(actualQuota),
			))
		}

		if err := relayInfo.Billing.Settle(actualQuota); err != nil {
			return err
		}
		notifyBillingSettlementObserver(ctx, relayInfo, actualQuota)

		// 发送额度通知（订阅计费使用订阅剩余额度）
		if actualQuota != 0 {
			if relayInfo.BillingSource == BillingSourceSubscription {
				checkAndSendSubscriptionQuotaNotify(relayInfo)
			} else {
				checkAndSendQuotaNotify(relayInfo, actualQuota-preConsumed, preConsumed)
			}
		}
		return nil
	}

	// 回退：无 BillingSession 时使用旧路径
	quotaDelta := actualQuota - relayInfo.FinalPreConsumedQuota
	if quotaDelta != 0 {
		if err := PostConsumeQuota(relayInfo, quotaDelta, relayInfo.FinalPreConsumedQuota, true); err != nil {
			return err
		}
	}
	notifyBillingSettlementObserver(ctx, relayInfo, actualQuota)
	return nil
}
