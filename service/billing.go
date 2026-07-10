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

// SetImageStudioPreheldQuota tells PreConsumeBilling that the wallet hold was
// already taken when the durable studio job was submitted. Execute must not
// debit the wallet a second time.
func SetImageStudioPreheldQuota(c *gin.Context, quota int) {
	if c == nil || quota < 0 {
		return
	}
	c.Set(imageStudioPreheldQuotaKey, quota)
}

func imageStudioPreheldQuota(c *gin.Context) (int, bool) {
	if c == nil {
		return 0, false
	}
	value, ok := c.Get(imageStudioPreheldQuotaKey)
	if !ok {
		return 0, false
	}
	held, ok := value.(int)
	if !ok || held < 0 {
		return 0, false
	}
	return held, true
}

func PreConsumeBilling(c *gin.Context, preConsumedQuota int, relayInfo *relaycommon.RelayInfo) *types.NewAPIError {
	if held, ok := imageStudioPreheldQuota(c); ok {
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

// adoptImageStudioPreheldBilling builds a wallet BillingSession whose pre-consume
// was already applied at job submit. Settlement still adjusts to the real charge.
func adoptImageStudioPreheldBilling(c *gin.Context, relayInfo *relaycommon.RelayInfo, held int) *types.NewAPIError {
	if relayInfo == nil {
		return types.NewError(fmt.Errorf("relayInfo is nil"), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}
	userQuota, err := model.GetUserQuota(relayInfo.UserId, false)
	if err != nil {
		return types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
	}
	relayInfo.UserQuota = userQuota
	session := &BillingSession{
		relayInfo:        relayInfo,
		funding:          &WalletFunding{userId: relayInfo.UserId, forceDB: true, consumed: held},
		preConsumedQuota: held,
	}
	session.syncRelayInfo()
	relayInfo.Billing = session
	relayInfo.BillingSource = BillingSourceWallet
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
