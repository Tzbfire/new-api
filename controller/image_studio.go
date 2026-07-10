package controller

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"runtime/debug"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

const (
	imageStudioTaskPlatform = constant.TaskPlatformImageStudio
	imageStudioMaxTaskCount = constant.ImageStudioMaxBatchConcurrency
)

type imageStudioTaskPayload struct {
	Request  imageStudioRequestMeta `json:"request,omitempty"`
	Response any                    `json:"response,omitempty"`
	Usage    *dto.Usage             `json:"usage,omitempty"`
}

type imageStudioRequestMeta struct {
	Model      string `json:"model,omitempty"`
	Prompt     string `json:"prompt,omitempty"`
	Size       string `json:"size,omitempty"`
	Quality    string `json:"quality,omitempty"`
	N          uint   `json:"n,omitempty"`
	Mode       string `json:"mode,omitempty"`
	Group      string `json:"group,omitempty"`
	RequestID  string `json:"request_id,omitempty"`
	BatchID    string `json:"batch_id,omitempty"`
	BatchIndex int    `json:"batch_index,omitempty"`
	BatchSize  int    `json:"batch_size,omitempty"`
}

type imageStudioEstimateResponse struct {
	EstimatedQuota int    `json:"estimated_quota"`
	PerImageQuota  int    `json:"per_image_quota"`
	Count          int    `json:"count"`
	ResolvedGroup  string `json:"resolved_group"`
}

func estimateImageStudioBatchQuota(perImageQuota int, count uint) int {
	return common.QuotaFromFloat(float64(perImageQuota) * float64(count))
}

// estimateImageStudioPerImageQuota follows the same pricing path as execute-time
// pre-consume, forced to n=1 so batch hold matches per-child billing.
func estimateImageStudioPerImageQuota(c *gin.Context, imageRequest *dto.ImageRequest) (quota int, usingGroup string, err error) {
	if imageRequest == nil {
		return 0, "", fmt.Errorf("invalid image request")
	}
	one := uint(1)
	imageRequest.N = &one
	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatOpenAIImage, imageRequest, nil)
	if err != nil {
		return 0, "", err
	}
	relayInfo.InitChannelMeta(c)
	billingInput, err := helper.BuildBillingExprRequestInputFromRequest(imageRequest, relayInfo.RequestHeaders)
	if err != nil {
		return 0, "", err
	}
	relayInfo.BillingRequestInput = &billingInput
	meta := imageRequest.GetTokenCountMeta()
	tokens, err := service.EstimateRequestToken(c, meta, relayInfo)
	if err != nil {
		return 0, "", err
	}
	relayInfo.SetEstimatePromptTokens(tokens)
	priceData, err := helper.ModelPriceHelper(c, relayInfo, tokens, meta)
	if err != nil {
		return 0, "", err
	}
	if priceData.QuotaToPreConsume < 0 {
		return 0, relayInfo.UsingGroup, nil
	}
	return priceData.QuotaToPreConsume, relayInfo.UsingGroup, nil
}

// EstimateImageStudioCost follows the same pricing path used immediately
// before relay pre-consumption, but does not reserve quota or create a task.
// Studio batches execute as n=1 child requests, so the per-image rounded quota
// is multiplied by the requested batch count to match the real billing shape.
func EstimateImageStudioCost(c *gin.Context) {
	if !common.DrawingEnabled {
		c.JSON(http.StatusForbidden, gin.H{"error": gin.H{"message": "image generation is disabled", "type": "invalid_request_error"}})
		return
	}
	if rejectImageStudioIfShuttingDown(c) {
		return
	}

	request, err := helper.GetAndValidateRequest(c, types.RelayFormatOpenAIImage)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	imageRequest, ok := request.(*dto.ImageRequest)
	if !ok {
		common.ApiErrorMsg(c, "invalid image request")
		return
	}

	count := uint(1)
	if imageRequest.N != nil && *imageRequest.N > 0 {
		count = *imageRequest.N
	}
	if count > imageStudioMaxTaskCount {
		common.ApiErrorMsg(c, fmt.Sprintf("生成数量不能超过 %d", imageStudioMaxTaskCount))
		return
	}
	if strings.EqualFold(c.Query("mode"), "edit") {
		c.Set("relay_mode", relayconstant.RelayModeImagesEdits)
	} else {
		c.Set("relay_mode", relayconstant.RelayModeImagesGenerations)
	}
	perImageQuota, usingGroup, err := estimateImageStudioPerImageQuota(c, imageRequest)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	estimatedQuota := estimateImageStudioBatchQuota(perImageQuota, count)
	resolvedGroup := usingGroup
	if autoGroup := c.GetString("auto_group"); autoGroup != "" {
		resolvedGroup = autoGroup
	}
	common.ApiSuccess(c, imageStudioEstimateResponse{
		EstimatedQuota: estimatedQuota,
		PerImageQuota:  perImageQuota,
		Count:          int(count),
		ResolvedGroup:  resolvedGroup,
	})
}

func CreateImageStudioTask(c *gin.Context) {
	if !common.DrawingEnabled {
		c.JSON(http.StatusForbidden, gin.H{"error": gin.H{"message": "image generation is disabled", "type": "invalid_request_error"}})
		return
	}
	if rejectImageStudioIfShuttingDown(c) {
		return
	}
	if c.GetBool("use_access_token") {
		common.ApiErrorMsg(c, "暂不支持使用 access token")
		return
	}

	request, err := helper.GetAndValidateRequest(c, types.RelayFormatOpenAIImage)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	imageRequest, ok := request.(*dto.ImageRequest)
	if !ok {
		common.ApiErrorMsg(c, "invalid image request")
		return
	}
	if imageRequest.Stream != nil && *imageRequest.Stream {
		common.ApiErrorMsg(c, "AI 画室暂不支持流式图片响应")
		return
	}

	userID := c.GetInt("id")
	userCache, err := model.GetUserCache(userID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	userCache.WriteContext(c)

	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatOpenAIImage, request, nil)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	temporaryToken := &model.Token{
		UserId: userID,
		Name:   fmt.Sprintf("image-studio-%s", relayInfo.UsingGroup),
		Group:  relayInfo.UsingGroup,
	}
	if err := middleware.SetupContextForToken(c, temporaryToken); err != nil {
		common.ApiError(c, err)
		return
	}
	relayInfo.InitChannelMeta(c)

	bodyStorage, err := common.GetBodyStorage(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	body, err := bodyStorage.Bytes()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	contentType := c.Request.Header.Get("Content-Type")
	requestID := c.GetString(common.RequestIdKey)

	imageCount := uint(1)
	if imageRequest.N != nil && *imageRequest.N > 0 {
		imageCount = *imageRequest.N
	}
	if imageCount > imageStudioMaxTaskCount {
		common.ApiErrorMsg(c, fmt.Sprintf("生成数量不能超过 %d", imageStudioMaxTaskCount))
		return
	}
	if len(body) > imageStudioMaxBatchBodySize {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": gin.H{"message": "批量图片请求体过大，请减少图片数量或上传文件大小", "type": "invalid_request_error"}})
		return
	}
	taskBodies, err := buildImageStudioTaskBodies(c, contentType, body, int(imageCount))
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// Wallet hold at submit so concurrent batches cannot oversell quota.
	// subscription_only users skip hold and bill at execute time.
	perImageQuota := 0
	shouldHoldWallet := true
	if userCache != nil {
		pref := common.NormalizeBillingPreference(userCache.GetSetting().BillingPreference)
		if pref == "subscription_only" {
			shouldHoldWallet = false
		}
	}
	if shouldHoldWallet {
		perImageQuota, _, err = estimateImageStudioPerImageQuota(c, imageRequest)
		if err != nil {
			common.ApiErrorMsg(c, err.Error())
			return
		}
	}

	batchID := ""
	if imageCount > 1 {
		batchID = "batch_" + common.GetUUID()
	}
	now := time.Now().Unix()
	taskAction := constant.TaskActionImageGeneration
	requestMode := "generation"
	relayPath := "/v1/images/generations"
	if relayInfo.RelayMode == relayconstant.RelayModeImagesEdits {
		taskAction = constant.TaskActionImageEdit
		requestMode = "edit"
		relayPath = "/v1/images/edits"
	}

	taskDTOs := make([]*dto.TaskDto, 0, len(taskBodies))
	inserted := make([]*model.Task, 0, len(taskBodies))
	stagedKeys := make([]string, 0, len(taskBodies))
	defer func() {
		// Roll back staged bodies and wallet holds if we fail before commit.
		if len(taskDTOs) == len(taskBodies) {
			return
		}
		for _, key := range stagedKeys {
			service.RemoveImageStudioJobBody(key)
		}
		for _, task := range inserted {
			failAndRefundImageStudioTask(task, "批量任务提交未完成，退回预占额度")
		}
	}()

	for index, taskBody := range taskBodies {
		childRequestID := imageStudioChildRequestID(requestID, index, len(taskBodies))
		task := model.InitTask(imageStudioTaskPlatform, relayInfo)
		task.CreatedAt = now
		task.UpdatedAt = now
		task.SubmitTime = now
		task.Status = model.TaskStatusQueued
		task.Progress = "0%"
		task.Action = taskAction
		task.Properties.Input = imageRequest.Prompt
		task.PrivateData.Key = ""
		task.PrivateData.RequestId = childRequestID
		task.PrivateData.NodeName = common.NodeName
		task.PrivateData.TokenId = 0
		if shouldHoldWallet && perImageQuota > 0 {
			if holdErr := model.DecreaseUserQuotaIfEnough(userID, perImageQuota); holdErr != nil {
				if errors.Is(holdErr, model.ErrInsufficientUserQuota) {
					common.ApiErrorMsg(c, fmt.Sprintf("余额不足，生成 %d 张约需 %s", imageCount, logger.FormatQuota(estimateImageStudioBatchQuota(perImageQuota, imageCount))))
					return
				}
				common.ApiError(c, holdErr)
				return
			}
			task.Quota = perImageQuota
			task.PrivateData.StudioHeldQuota = perImageQuota
			task.PrivateData.BillingSource = service.BillingSourceWallet
		}
		task.SetData(imageStudioTaskPayload{Request: imageStudioRequestMeta{
			Model:      imageRequest.Model,
			Prompt:     imageRequest.Prompt,
			Size:       imageRequest.Size,
			Quality:    imageRequest.Quality,
			N:          1,
			Mode:       requestMode,
			Group:      relayInfo.UsingGroup,
			RequestID:  childRequestID,
			BatchID:    batchID,
			BatchIndex: index + 1,
			BatchSize:  int(imageCount),
		}})

		// Stage before insert so a crash between the two leaves an orphan file
		// that cleanup can remove, never a QUEUED row without a body.
		bodyKey, stageErr := service.StageImageStudioJobBody(task.TaskID, taskBody.ContentType, taskBody.Body)
		if stageErr != nil {
			releaseImageStudioUncommittedHold(userID, task)
			common.ApiError(c, stageErr)
			return
		}
		stagedKeys = append(stagedKeys, bodyKey)
		task.PrivateData.StudioBodyKey = bodyKey
		task.PrivateData.StudioContentType = taskBody.ContentType
		task.PrivateData.StudioRelayPath = relayPath

		if err := task.Insert(); err != nil {
			releaseImageStudioUncommittedHold(userID, task)
			service.RemoveImageStudioJobBody(bodyKey)
			common.ApiError(c, err)
			return
		}
		inserted = append(inserted, task)
		taskDTOs = append(taskDTOs, relay.TaskModel2Dto(task))
	}

	if len(taskDTOs) == 1 {
		common.ApiSuccess(c, taskDTOs[0])
	} else {
		common.ApiSuccess(c, gin.H{"batch_id": batchID, "tasks": taskDTOs})
	}
	WakeImageStudioWorkers()
}

func imageStudioChildRequestID(parent string, index int, total int) string {
	if total <= 1 {
		if parent != "" {
			return parent
		}
		return common.NewRequestId()
	}
	if parent == "" {
		parent = common.NewRequestId()
	}
	return fmt.Sprintf("%s-%02d", parent, index+1)
}

// runImageStudioClaimedTask executes one durable job already claimed by a worker.
func runImageStudioClaimedTask(task *model.Task) {
	if task == nil {
		return
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			reason := fmt.Sprintf("后台任务异常: %v", recovered)
			logger.LogError(context.Background(), fmt.Sprintf("image studio task %s panic: %s\n%s", task.TaskID, reason, string(debug.Stack())))
			failAndRefundImageStudioTask(task, reason)
		}
		service.RemoveImageStudioJobBody(task.PrivateData.StudioBodyKey)
	}()

	contentType := task.PrivateData.StudioContentType
	bodyKey := task.PrivateData.StudioBodyKey
	relayPath := task.PrivateData.StudioRelayPath
	if relayPath == "" {
		relayPath = "/v1/images/generations"
	}
	bodyCT, body, err := service.LoadImageStudioJobBody(bodyKey)
	if err != nil {
		failAndRefundImageStudioTask(task, "加载任务请求失败: "+err.Error())
		return
	}
	if contentType == "" {
		contentType = bodyCT
	}

	var meta imageStudioTaskPayload
	_ = common.Unmarshal(task.Data, &meta)
	modelName := strings.TrimSpace(meta.Request.Model)
	groupName := strings.TrimSpace(task.Group)
	if groupName == "" {
		groupName = strings.TrimSpace(meta.Request.Group)
	}

	timeoutMinutes := service.ImageStudioTaskTimeoutMinutes()
	taskCtx, cancelTask := context.WithTimeout(context.Background(), time.Duration(timeoutMinutes)*time.Minute)
	defer cancelTask()

	c, responseWriter, err := buildImageStudioExecutionContext(taskCtx, task, relayPath, contentType, body, groupName, modelName)
	if err != nil {
		failAndRefundImageStudioTask(task, "初始化任务上下文失败: "+err.Error())
		return
	}
	defer common.CleanupBodyStorage(c)
	defer responseWriter.Close()

	service.SetBillingSettlementObserver(c, func(info *relaycommon.RelayInfo, actualQuota int) {
		persistImageStudioBillingSnapshot(task, info, actualQuota)
	})
	service.SetDurableAsyncBilling(c)
	if task.PrivateData.StudioHeldQuota > 0 {
		service.SetImageStudioPreheldQuota(c, task.PrivateData.StudioHeldQuota)
	}
	c.Set(string(constant.ContextKeyImageStudioStrictB64), true)

	payload, usage, quota, relayErr := executeImageStudioRelay(c, responseWriter, task)
	if relayErr != nil || payload == nil {
		cleanupImageStudioTaskAssets(context.Background(), task)
		reason := "上游未返回图片"
		if relayErr != nil {
			reason = relayErr.Error()
		}
		if errors.Is(taskCtx.Err(), context.DeadlineExceeded) {
			reason = fmt.Sprintf("AI 画室任务超时（%d分钟），上游在限制时间内未完成", timeoutMinutes)
		}
		failAndRefundImageStudioTask(task, reason)
		return
	}

	task.Status = model.TaskStatusSuccess
	task.Progress = "100%"
	task.Quota = quota
	task.FinishTime = time.Now().Unix()
	task.UpdatedAt = task.FinishTime
	task.FailReason = ""
	var previous imageStudioTaskPayload
	_ = common.Unmarshal(task.Data, &previous)
	task.SetData(imageStudioTaskPayload{Request: previous.Request, Response: payload, Usage: usage})
	if won, err := model.FinalizeImageStudioTask(task); err != nil {
		cleanupImageStudioPayloadAssets(context.Background(), task, payload)
		logger.LogError(context.Background(), fmt.Sprintf("image studio finish task %s failed: %s", task.TaskID, err.Error()))
		failAndRefundImageStudioTask(task, "保存生成结果失败: "+err.Error())
	} else if !won {
		cleanupImageStudioPayloadAssets(context.Background(), task, payload)
		refundImageStudioChargeAfterLostFinalUpdate(task, task.PrivateData.RequestId)
	}
}

func buildImageStudioExecutionContext(ctx context.Context, task *model.Task, relayPath, contentType string, body []byte, groupName, modelName string) (*gin.Context, *imageStudioResponseWriter, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, relayPath, bytes.NewReader(body))
	if err != nil {
		return nil, nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if task.PrivateData.RequestId != "" {
		req.Header.Set("X-Request-Id", task.PrivateData.RequestId)
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	responseWriter, err := newImageStudioResponseWriter(c.Writer, task)
	if err != nil {
		return nil, nil, err
	}
	c.Writer = responseWriter
	c.Request = req
	c.Keys = make(map[string]any, 16)
	c.Set(common.RequestIdKey, task.PrivateData.RequestId)
	c.Set("id", task.UserId)

	userCache, err := model.GetUserCache(task.UserId)
	if err != nil {
		responseWriter.Close()
		return nil, nil, err
	}
	userCache.WriteContext(c)

	temporaryToken := &model.Token{
		UserId: task.UserId,
		Name:   fmt.Sprintf("image-studio-%s", groupName),
		Group:  groupName,
	}
	if err := middleware.SetupContextForToken(c, temporaryToken); err != nil {
		responseWriter.Close()
		return nil, nil, err
	}
	if groupName != "" {
		common.SetContextKey(c, constant.ContextKeyUsingGroup, groupName)
	}

	// Fresh channel selection at execution time keeps unhealthy channels out of
	// durable jobs that may have waited in QUEUED after a restart.
	retry := 0
	channel, _, channelErr := service.CacheGetRandomSatisfiedChannel(&service.RetryParam{
		Ctx:         c,
		TokenGroup:  groupName,
		ModelName:   modelName,
		RequestPath: relayPath,
		Retry:       &retry,
	})
	if channelErr != nil {
		responseWriter.Close()
		return nil, nil, channelErr
	}
	if setupErr := middleware.SetupContextForSelectedChannel(c, channel, modelName); setupErr != nil {
		responseWriter.Close()
		return nil, nil, setupErr
	}

	storage, err := common.CreateBodyStorage(body)
	if err != nil {
		responseWriter.Close()
		return nil, nil, err
	}
	c.Set(common.KeyBodyStorage, storage)
	return c, responseWriter, nil
}

func executeImageStudioRelay(c *gin.Context, responseWriter *imageStudioResponseWriter, task *model.Task) (any, *dto.Usage, int, error) {
	Relay(c, types.RelayFormatOpenAIImage)
	if responseWriter.exceeded {
		return nil, nil, 0, errors.New("上游图片响应超过 AI 画室大小限制")
	}
	status := responseWriter.Status()
	if status < http.StatusOK || status >= http.StatusMultipleChoices {
		response, err := responseWriter.readSmallResponse()
		if err != nil {
			return nil, nil, 0, err
		}
		return nil, nil, 0, parseImageStudioRelayError(status, response)
	}
	payload, usage, err := responseWriter.Process()
	if err != nil {
		return nil, nil, 0, err
	}
	return payload, usage, task.Quota, nil
}

func parseImageStudioRelayError(status int, data []byte) error {
	var response struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
		Message string `json:"message"`
	}
	if len(data) > 0 && common.Unmarshal(data, &response) == nil {
		if response.Error != nil && strings.TrimSpace(response.Error.Message) != "" {
			return fmt.Errorf("图片生成失败（HTTP %d）: %s", status, strings.TrimSpace(response.Error.Message))
		}
		if strings.TrimSpace(response.Message) != "" {
			return fmt.Errorf("图片生成失败（HTTP %d）: %s", status, strings.TrimSpace(response.Message))
		}
	}
	return fmt.Errorf("图片生成失败（HTTP %d）", status)
}

func persistImageStudioBillingSnapshot(task *model.Task, info *relaycommon.RelayInfo, actualQuota int) {
	if task == nil || info == nil {
		return
	}
	task.Quota = actualQuota
	task.Group = info.UsingGroup
	task.Properties.OriginModelName = info.OriginModelName
	// The pre-consume observer runs before the relay handler initializes
	// ChannelMeta. Keep the channel snapshot captured when the task was created
	// until the settlement callback has authoritative channel metadata.
	if info.ChannelMeta != nil {
		task.ChannelId = info.ChannelMeta.ChannelId
		task.Properties.UpstreamModelName = info.ChannelMeta.UpstreamModelName
	}
	task.PrivateData.BillingSource = info.BillingSource
	task.PrivateData.SubscriptionId = info.SubscriptionId
	// Browser Studio uses a session-backed virtual token; it must never mutate
	// or persist a real API token quota.
	task.PrivateData.TokenId = 0
	task.PrivateData.NodeName = common.NodeName
	task.PrivateData.BillingContext = &model.TaskBillingContext{
		ModelPrice:      info.PriceData.ModelPrice,
		GroupRatio:      info.PriceData.GroupRatioInfo.GroupRatio,
		ModelRatio:      info.PriceData.ModelRatio,
		OtherRatios:     info.PriceData.OtherRatios(),
		OriginModelName: info.OriginModelName,
		PerCallBilling:  common.StringsContains(constant.TaskPricePatches, info.OriginModelName) || info.PriceData.UsePrice,
	}
	task.UpdatedAt = time.Now().Unix()
	won, err := task.UpdateBillingSnapshot(model.TaskStatusInProgress)
	if err != nil {
		logger.LogError(context.Background(), fmt.Sprintf("persist image studio billing task %s failed: %s", task.TaskID, err.Error()))
		return
	}
	if !won {
		if _, err := task.UpdateBillingSnapshot(model.TaskStatusFailure); err != nil {
			logger.LogError(context.Background(), fmt.Sprintf("persist failed image studio billing task %s failed: %s", task.TaskID, err.Error()))
		}
		_, _ = service.RefundImageStudioTaskQuotaOnce(context.Background(), task, "AI 画室任务结算时已进入失败终态")
	}
}

// releaseImageStudioUncommittedHold returns a submit-time wallet hold that
// never became a durable task row (stage/insert failed before Insert).
func releaseImageStudioUncommittedHold(userID int, task *model.Task) {
	if task == nil || task.PrivateData.StudioHeldQuota <= 0 {
		return
	}
	held := task.PrivateData.StudioHeldQuota
	if err := model.IncreaseUserQuota(userID, held, true); err != nil {
		logger.LogError(context.Background(), fmt.Sprintf("release uncommitted image studio hold user=%d quota=%d: %s", userID, held, err.Error()))
	}
}

func failAndRefundImageStudioTask(task *model.Task, reason string) {
	if task == nil {
		return
	}
	service.BackfillTaskBillingFromConsumeLog(context.Background(), task, task.PrivateData.RequestId)
	if failImageStudioTask(task, reason) && task.Quota > 0 {
		_, _ = service.RefundImageStudioTaskQuotaOnce(context.Background(), task, reason)
	}
}

func failImageStudioTask(task *model.Task, reason string) bool {
	if task == nil || task.Status == model.TaskStatusFailure || task.Status == model.TaskStatusSuccess {
		return false
	}
	fromStatus := task.Status
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "生成失败，后台任务未返回错误详情"
	}
	task.Status = model.TaskStatusFailure
	task.Progress = "100%"
	task.FailReason = reason
	task.FinishTime = time.Now().Unix()
	task.UpdatedAt = task.FinishTime
	won, err := task.UpdateWithStatus(fromStatus)
	if err != nil {
		logger.LogError(context.Background(), fmt.Sprintf("image studio fail task %s update failed: %s", task.TaskID, err.Error()))
		return false
	}
	return won
}

func refundImageStudioChargeAfterLostFinalUpdate(settledTask *model.Task, requestID string) {
	if settledTask == nil || settledTask.Quota < 0 {
		return
	}
	task, exists, err := model.GetByOnlyTaskId(settledTask.TaskID)
	if err != nil || !exists || task.Status != model.TaskStatusFailure {
		return
	}
	task.Quota = settledTask.Quota
	task.ChannelId = settledTask.ChannelId
	task.Group = settledTask.Group
	task.Properties = settledTask.Properties
	task.PrivateData = settledTask.PrivateData
	if task.PrivateData.BillingSource == "" {
		service.BackfillTaskBillingFromConsumeLog(context.Background(), task, requestID)
	}
	task.UpdatedAt = time.Now().Unix()
	if _, err := task.UpdateBillingSnapshot(model.TaskStatusFailure); err != nil {
		logger.LogError(context.Background(), fmt.Sprintf("image studio persist late billing %s failed: %s", task.TaskID, err.Error()))
	}
	_, _ = service.RefundImageStudioTaskQuotaOnce(context.Background(), task, "AI 画室任务已进入失败终态，取消迟到的生图扣费")
}
