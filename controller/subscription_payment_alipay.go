/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/

package controller

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/smartwalle/alipay/v3"
	"github.com/thanhpk/randstr"
)

type SubscriptionAlipayPayRequest struct {
	PlanId     int    `json:"plan_id" form:"plan_id"`
	ClientType string `json:"client_type" form:"client_type"` // pc / wap / qr
}

// SubscriptionRequestAlipay 创建支付宝订阅订单：根据 client_type 走 PagePay / WapPay / PreCreate
func SubscriptionRequestAlipay(c *gin.Context) {
	var req SubscriptionAlipayPayRequest
	// 同时接受 JSON 和 form-data
	if err := c.ShouldBind(&req); err != nil || req.PlanId <= 0 {
		// 兼容前端用 form 提交但 Content-Type 为 application/json 的情况，再尝试 PostForm
		if pf := c.PostForm("plan_id"); pf != "" {
			fmt.Sscanf(pf, "%d", &req.PlanId)
		}
		if req.ClientType == "" {
			req.ClientType = c.PostForm("client_type")
		}
		if req.PlanId <= 0 {
			common.ApiErrorMsg(c, "参数错误")
			return
		}
	}

	client := GetAlipayClient()
	if client == nil {
		common.ApiErrorMsg(c, "服务器尚未配置支付宝参数，请联系管理员")
		return
	}

	plan, err := model.GetSubscriptionPlanById(req.PlanId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !plan.Enabled {
		common.ApiErrorMsg(c, "套餐未启用")
		return
	}
	if plan.PriceAmount < 0.01 {
		common.ApiErrorMsg(c, "套餐金额过低")
		return
	}

	userId := c.GetInt("id")
	if plan.MaxPurchasePerUser > 0 {
		count, err := model.CountUserSubscriptionsByPlan(userId, plan.Id)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if count >= int64(plan.MaxPurchasePerUser) {
			common.ApiErrorMsg(c, "已达到该套餐购买上限")
			return
		}
	}

	clientType := strings.ToLower(strings.TrimSpace(req.ClientType))
	if clientType == "" {
		ua := strings.ToLower(c.Request.UserAgent())
		if strings.Contains(ua, "mobi") || strings.Contains(ua, "android") ||
			strings.Contains(ua, "iphone") || strings.Contains(ua, "ipad") ||
			strings.Contains(ua, "ipod") || strings.Contains(ua, "windows phone") ||
			strings.Contains(ua, "micromessenger") {
			clientType = "wap"
		} else {
			clientType = "pc"
		}
	}

	tradeNo := fmt.Sprintf("SUBALI%s%s", time.Now().Format("20060102150405"), randstr.String(6))

	order := &model.SubscriptionOrder{
		UserId:          userId,
		PlanId:          plan.Id,
		Money:           plan.PriceAmount,
		TradeNo:         tradeNo,
		PaymentMethod:   model.PaymentMethodAlipayNative,
		PaymentProvider: model.PaymentProviderAlipayNative,
		CreateTime:      time.Now().Unix(),
		Status:          common.TopUpStatusPending,
	}
	if err := order.Insert(); err != nil {
		common.ApiErrorMsg(c, "创建订单失败")
		return
	}

	callbackAddress := strings.TrimRight(service.GetCallbackAddress(), "/")
	notifyURL := callbackAddress + "/api/subscription/alipay/notify"
	returnURL := callbackAddress + "/api/subscription/alipay/return"

	subject := fmt.Sprintf("SUB:%s", plan.Title)
	totalAmount := fmt.Sprintf("%.2f", plan.PriceAmount)

	if clientType == "qr" {
		var p alipay.TradePreCreate
		p.NotifyURL = notifyURL
		p.Subject = subject
		p.OutTradeNo = tradeNo
		p.TotalAmount = totalAmount
		logger.LogInfo(c.Request.Context(), fmt.Sprintf("订阅支付宝下单[QR] user_id=%d trade_no=%s plan_id=%d money=%.2f notify_url=%q production=%t", userId, tradeNo, plan.Id, plan.PriceAmount, notifyURL, setting.AlipayProduction))
		rsp, err := client.TradePreCreate(c.Request.Context(), p)
		if err != nil {
			_ = model.ExpireSubscriptionOrder(tradeNo, model.PaymentProviderAlipayNative)
			c.JSON(http.StatusOK, gin.H{"message": "error", "data": err.Error()})
			return
		}
		if rsp.IsFailure() {
			_ = model.ExpireSubscriptionOrder(tradeNo, model.PaymentProviderAlipayNative)
			c.JSON(http.StatusOK, gin.H{"message": "error", "data": fmt.Sprintf("%s: %s", rsp.Msg, rsp.SubMsg)})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"message":   "success",
			"success":   true,
			"data":      rsp.QRCode,
			"mode":      "qr",
			"trade_no":  tradeNo,
			"total_fee": totalAmount,
		})
		return
	}

	var payURL fmt.Stringer
	if clientType == "wap" {
		var p alipay.TradeWapPay
		p.NotifyURL = notifyURL
		p.ReturnURL = returnURL
		p.Subject = subject
		p.OutTradeNo = tradeNo
		p.TotalAmount = totalAmount
		p.ProductCode = "QUICK_WAP_WAY"
		logger.LogInfo(c.Request.Context(), fmt.Sprintf("订阅支付宝下单[WAP] user_id=%d trade_no=%s plan_id=%d money=%.2f notify_url=%q return_url=%q production=%t", userId, tradeNo, plan.Id, plan.PriceAmount, notifyURL, returnURL, setting.AlipayProduction))
		u, err := client.TradeWapPay(p)
		if err != nil {
			_ = model.ExpireSubscriptionOrder(tradeNo, model.PaymentProviderAlipayNative)
			c.JSON(http.StatusOK, gin.H{"message": "error", "data": err.Error()})
			return
		}
		payURL = u
	} else {
		var p alipay.TradePagePay
		p.NotifyURL = notifyURL
		p.ReturnURL = returnURL
		p.Subject = subject
		p.OutTradeNo = tradeNo
		p.TotalAmount = totalAmount
		p.ProductCode = "FAST_INSTANT_TRADE_PAY"
		logger.LogInfo(c.Request.Context(), fmt.Sprintf("订阅支付宝下单[PC] user_id=%d trade_no=%s plan_id=%d money=%.2f notify_url=%q return_url=%q production=%t", userId, tradeNo, plan.Id, plan.PriceAmount, notifyURL, returnURL, setting.AlipayProduction))
		u, err := client.TradePagePay(p)
		if err != nil {
			_ = model.ExpireSubscriptionOrder(tradeNo, model.PaymentProviderAlipayNative)
			c.JSON(http.StatusOK, gin.H{"message": "error", "data": err.Error()})
			return
		}
		payURL = u
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "success",
		"success": true,
		"data":    payURL.String(),
	})
}

// SubscriptionAlipayNotify 异步回调
func SubscriptionAlipayNotify(c *gin.Context) {
	req := c.Request
	if err := req.ParseForm(); err != nil {
		logger.LogError(req.Context(), fmt.Sprintf("订阅支付宝回调表单解析失败 path=%q client_ip=%s error=%q", req.RequestURI, c.ClientIP(), err.Error()))
		c.String(http.StatusBadRequest, "fail")
		return
	}
	ctx := req.Context()
	client := GetAlipayClient()
	if client == nil {
		logger.LogError(ctx, fmt.Sprintf("订阅支付宝回调 client 未初始化 path=%q client_ip=%s", req.RequestURI, c.ClientIP()))
		c.String(http.StatusBadRequest, "fail")
		return
	}
	noti, err := client.DecodeNotification(ctx, req.Form)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("订阅支付宝回调验签失败: %v, app_id=%s, out_trade_no=%s, trade_no=%s", err, req.Form.Get("app_id"), req.Form.Get("out_trade_no"), req.Form.Get("trade_no")))
		c.String(http.StatusBadRequest, "fail")
		return
	}
	logger.LogInfo(ctx, fmt.Sprintf("订阅支付宝回调验签成功 trade_no=%s alipay_trade_no=%s status=%s amount=%s", noti.OutTradeNo, noti.TradeNo, noti.TradeStatus, noti.TotalAmount))

	if noti.TradeStatus != "TRADE_SUCCESS" && noti.TradeStatus != "TRADE_FINISHED" {
		c.String(http.StatusOK, "success")
		return
	}

	tradeNo := noti.OutTradeNo
	order := model.GetSubscriptionOrderByTradeNo(tradeNo)
	if order == nil {
		logger.LogError(ctx, fmt.Sprintf("订阅支付宝回调订单不存在 trade_no=%s", tradeNo))
		c.String(http.StatusBadRequest, "fail")
		return
	}
	if order.PaymentMethod != model.PaymentMethodAlipayNative {
		logger.LogError(ctx, fmt.Sprintf("订阅支付宝回调支付方式不匹配 trade_no=%s expected=%s actual=%s", tradeNo, model.PaymentMethodAlipayNative, order.PaymentMethod))
		c.String(http.StatusBadRequest, "fail")
		return
	}
	if fmt.Sprintf("%.2f", order.Money) != noti.TotalAmount {
		logger.LogError(ctx, fmt.Sprintf("订阅支付宝回调金额不匹配 trade_no=%s expected=%.2f actual=%s", tradeNo, order.Money, noti.TotalAmount))
		c.String(http.StatusBadRequest, "fail")
		return
	}

	LockOrder(tradeNo)
	defer UnlockOrder(tradeNo)
	if err := model.CompleteSubscriptionOrder(tradeNo, common.GetJsonString(noti), model.PaymentProviderAlipayNative, model.PaymentMethodAlipayNative); err != nil {
		logger.LogError(ctx, fmt.Sprintf("订阅支付宝订单加账失败 trade_no=%s error=%q", tradeNo, err.Error()))
		c.String(http.StatusInternalServerError, "fail")
		return
	}
	logger.LogInfo(ctx, fmt.Sprintf("订阅支付宝充值成功到账 trade_no=%s", tradeNo))
	c.String(http.StatusOK, "success")
}

// SubscriptionAlipayReturn 同步跳转：验签 + 主动查询 + 完成
func SubscriptionAlipayReturn(c *gin.Context) {
	req := c.Request
	baseRedirect := strings.TrimRight(system_setting.ServerAddress, "/") + "/console/topup"
	if err := req.ParseForm(); err != nil {
		logger.LogError(req.Context(), fmt.Sprintf("订阅支付宝同步回跳表单解析失败 path=%q error=%q", req.RequestURI, err.Error()))
		c.Redirect(http.StatusFound, baseRedirect+"?pay=fail")
		return
	}
	ctx := req.Context()
	client := GetAlipayClient()
	if client == nil {
		c.Redirect(http.StatusFound, baseRedirect+"?pay=fail")
		return
	}
	if err := client.VerifySign(ctx, req.Form); err != nil {
		logger.LogError(ctx, fmt.Sprintf("订阅支付宝同步回跳验签失败 path=%q error=%q out_trade_no=%s", req.RequestURI, err.Error(), req.Form.Get("out_trade_no")))
		c.Redirect(http.StatusFound, baseRedirect+"?pay=fail")
		return
	}

	tradeNo := req.Form.Get("out_trade_no")
	queryRsp, err := client.TradeQuery(ctx, alipay.TradeQuery{OutTradeNo: tradeNo})
	if err != nil || queryRsp.IsFailure() {
		c.Redirect(http.StatusFound, baseRedirect+"?pay=pending")
		return
	}
	if queryRsp.TradeStatus == alipay.TradeStatusSuccess || queryRsp.TradeStatus == alipay.TradeStatusFinished {
		LockOrder(tradeNo)
		defer UnlockOrder(tradeNo)
		if err := model.CompleteSubscriptionOrder(tradeNo, common.GetJsonString(queryRsp), model.PaymentProviderAlipayNative, model.PaymentMethodAlipayNative); err != nil {
			logger.LogError(ctx, fmt.Sprintf("订阅支付宝同步回跳加账失败 trade_no=%s error=%q", tradeNo, err.Error()))
			c.Redirect(http.StatusFound, baseRedirect+"?pay=fail")
			return
		}
		c.Redirect(http.StatusFound, baseRedirect+"?pay=success")
		return
	}
	c.Redirect(http.StatusFound, baseRedirect+"?pay=pending")
}
