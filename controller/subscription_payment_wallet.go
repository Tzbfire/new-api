package controller

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type SubscriptionWalletPayRequest struct {
	PlanId int `json:"plan_id"`
}

func SubscriptionRequestWalletPay(c *gin.Context) {
	var req SubscriptionWalletPayRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PlanId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	result, err := model.PurchaseSubscriptionWithWallet(c.GetInt("id"), req.PlanId)
	if err != nil {
		if errors.Is(err, model.ErrQuotaBucketInsufficient) {
			common.ApiErrorMsg(c, "VIP余额不足: "+err.Error())
			return
		}
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, result)
}
