package controller

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"net/http/httptest"
	"slices"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	pluginruntime "github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/relay"
	taskplugin "github.com/QuantumNous/new-api/relay/channel/task/jsplugin"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// imageStudioPluginSnapshot keeps a provider operation inside its original Studio job.
// An attempted submit without a saved upstream result is never replayed after restart.
type imageStudioPluginSnapshot struct {
	Key            string                `json:"key"`
	Version        string                `json:"version"`
	UpstreamTaskID string                `json:"upstream_task_id,omitempty"`
	Data           json.RawMessage       `json:"data,omitempty"`
	State          json.RawMessage       `json:"state,omitempty"`
	Result         *relaycommon.TaskInfo `json:"result,omitempty"`
	Quota          int                   `json:"quota"`
	Settled        bool                  `json:"settled,omitempty"`
	Logged         bool                  `json:"logged,omitempty"`
}

// prepareImageStudioPlugin uses the same ownership and decode gates as /v1/images.
func prepareImageStudioPlugin(c *gin.Context) (*pluginruntime.PinnedEndpoint, error) {
	middleware.PinTaskPluginEndpoint()(c)
	if c.IsAborted() {
		return nil, errors.New("image task plugin rejected the request")
	}
	value, exists := c.Get(pluginruntime.ContextKeyPinnedEndpoint)
	if !exists {
		return nil, nil
	}
	pinned, ok := value.(pluginruntime.PinnedEndpoint)
	if !ok || pinned.Protocol != pluginruntime.ProtocolOpenAIImage {
		return nil, errors.New("invalid image task protocol")
	}
	ch, err := model.CacheGetChannel(common.GetContextKeyInt(c, constant.ContextKeyChannelId))
	if err != nil {
		return nil, err
	}
	matched := false
	for _, candidate := range pinned.Candidates {
		if candidate.Plugin == nil {
			continue
		}
		if slices.Contains(candidate.Plugin.Meta.ChannelTypes, ch.Type) ||
			((ch.Type == constant.ChannelTypeTaskPlugin || ch.Type == constant.ChannelTypeNewAPI) && ch.GetSetting().BindsTaskPlugin(candidate.Plugin.Meta.Key)) {
			matched = true
			break
		}
	}
	if !matched {
		delete(c.Keys, pluginruntime.ContextKeyPinnedEndpoint)
		delete(c.Keys, pluginruntime.ContextKeyPinnedPlugin)
		return nil, nil
	}
	middleware.PrepareTaskPluginEndpoint()(c)
	if c.IsAborted() {
		return nil, errors.New("image task plugin rejected the request")
	}
	if apiErr := middleware.SetupContextForSelectedChannel(c, ch, pinned.Model); apiErr != nil {
		return nil, apiErr
	}
	value, _ = c.Get(pluginruntime.ContextKeyPinnedEndpoint)
	pinned = value.(pluginruntime.PinnedEndpoint)
	return &pinned, nil
}

// estimateImageStudioPluginQuota validates a one-image copy without reserving funds.
func estimateImageStudioPluginQuota(c *gin.Context, imageRequest *dto.ImageRequest) (int, string, string, bool, error) {
	generation := pluginruntime.DefaultRegistry.Generation()
	if generation == nil {
		return 0, "", "", false, nil
	}
	path := "/v1/images/generations"
	if c.GetInt("relay_mode") == relayconstant.RelayModeImagesEdits {
		path = "/v1/images/edits"
	}
	modelName := imageRequest.Model
	if alias, ok := model.ResolveTaskModelAlias(generation, modelName); ok && alias.Declared != "" {
		modelName = alias.Declared
	}
	if _, found := generation.LookupEndpoint(http.MethodPost, path, modelName); !found {
		return 0, "", "", false, nil
	}

	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return 0, "", "", false, err
	}
	body, err := storage.Bytes()
	if err != nil {
		return 0, "", "", false, err
	}
	bodyContext, _ := gin.CreateTestContext(httptest.NewRecorder())
	bodyContext.Request = c.Request.Clone(c.Request.Context())
	bodyContext.Request.Body = io.NopCloser(bytes.NewReader(body))
	bodyContext.Request.MultipartForm = nil
	bodyContext.Request.Form = nil
	bodyContext.Request.PostForm = nil
	children, err := buildImageStudioTaskBodies(bodyContext, c.Request.Header.Get("Content-Type"), body, 1)
	if err != nil {
		return 0, "", "", false, err
	}
	probe, _ := gin.CreateTestContext(httptest.NewRecorder())
	probe.Keys = maps.Clone(c.Keys)
	probe.Request = c.Request.Clone(c.Request.Context())
	probe.Request.URL.Path = path
	probe.Request.Body = io.NopCloser(bytes.NewReader(children[0].Body))
	probe.Request.Header.Set("Content-Type", children[0].ContentType)
	probe.Request.MultipartForm = nil
	probe.Request.PostForm = nil
	probe.Request.Form = nil
	bodyStorage, err := common.CreateBodyStorage(children[0].Body)
	if err != nil {
		return 0, "", "", false, err
	}
	probe.Set(common.KeyBodyStorage, bodyStorage)
	delete(probe.Keys, "_original_multipart_ct")
	defer common.CleanupBodyStorage(probe)
	pinned, err := prepareImageStudioPlugin(probe)
	if err != nil || pinned == nil {
		return 0, "", "", pinned != nil, err
	}
	info, err := relaycommon.GenRelayInfo(probe, types.RelayFormatTask, nil, nil)
	if err != nil {
		return 0, "", "", true, err
	}
	info.OriginModelName = probe.GetString("resolved_task_model")
	info.IsPlayground = true
	_, _, taskErr := relay.EstimateTaskSubmission(probe, info)
	if taskErr != nil {
		return 0, "", "", true, errors.New(taskErr.Message)
	}
	return info.PriceData.Quota, info.UsingGroup, info.BillingGroup, true, nil
}

// persistImageStudioPluginSnapshot never changes lifecycle or billing columns.
func persistImageStudioPluginSnapshot(task *model.Task, payload *imageStudioTaskPayload) error {
	task.SetData(payload)
	result := model.DB.Model(&model.Task{}).Where("id = ? AND status = ?", task.ID, model.TaskStatusInProgress).
		Updates(map[string]any{"data": task.Data, "updated_at": time.Now().Unix()})
	if result.Error != nil {
		return result.Error
	}
	// MySQL may report zero changed rows for an identical checkpoint.
	var count int64
	if result.RowsAffected == 0 {
		if err := model.DB.Model(&model.Task{}).Where("id = ? AND status = ?", task.ID, model.TaskStatusInProgress).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			return errors.New("image studio task is no longer running")
		}
	}
	return nil
}

// executeImageStudioPlugin shares the task adaptor, but Studio alone owns persistence,
// settlement and refunds. The normal task presenter would create a second task.
func executeImageStudioPlugin(c *gin.Context, writer *imageStudioResponseWriter, task *model.Task) (bool, error) {
	var payload imageStudioTaskPayload
	if err := common.Unmarshal(task.Data, &payload); err != nil {
		return false, err
	}
	pinned, err := prepareImageStudioPlugin(c)
	if err != nil {
		return true, err
	}
	if pinned == nil {
		if payload.Plugin != nil {
			return true, errors.New("the image task plugin is no longer available")
		}
		return false, nil
	}
	info, err := relaycommon.GenRelayInfo(c, types.RelayFormatTask, nil, nil)
	if err != nil {
		return true, err
	}
	info.OriginModelName = c.GetString("resolved_task_model")
	info.PublicTaskID = task.TaskID
	info.IsPlayground = true
	info.ImageRequestCount = 1
	info.InitChannelMeta(c)
	snapshot := payload.Plugin
	if snapshot == nil {
		snapshot = &imageStudioPluginSnapshot{Key: pinned.Plugin.Meta.Key, Version: pinned.Plugin.Meta.Version}
		payload.Plugin = snapshot
		if err := persistImageStudioPluginSnapshot(task, &payload); err != nil {
			return true, err
		}
		platform, adaptor, taskErr := relay.EstimateTaskSubmission(c, info)
		if taskErr != nil {
			return true, errors.New(taskErr.Message)
		}
		info.BillingGroup = task.PrivateData.BillingGroup
		info.BillingSource = task.PrivateData.BillingSource
		info.SubscriptionId = task.PrivateData.SubscriptionId
		persistImageStudioBillingSnapshot(task, info, task.Quota)
		checkpoint, err := common.Marshal(payload)
		if err != nil {
			return true, err
		}
		if err := service.SettleImageStudioPluginTask(c, task, max(task.Quota, info.PriceData.Quota), checkpoint); err != nil {
			return true, err
		}
		service.SetImageStudioPreheldBilling(c, service.ImageStudioPrehold{Quota: task.Quota, Source: task.PrivateData.BillingSource, BillingGroup: task.PrivateData.BillingGroup, SubscriptionId: task.PrivateData.SubscriptionId, RequestId: task.PrivateData.RequestId})
		if apiErr := service.PreConsumeBilling(c, info.PriceData.Quota, info); apiErr != nil {
			return true, apiErr
		}
		result, taskErr := relay.SubmitEstimatedTask(c, info, platform, adaptor)
		if taskErr != nil {
			return true, errors.New(taskErr.Message)
		}
		snapshot.UpstreamTaskID = result.UpstreamTaskID
		snapshot.Data = result.TaskData
		snapshot.State = result.PluginState
		snapshot.Result = result.Immediate
		snapshot.Quota = result.Quota
		if err := persistImageStudioPluginSnapshot(task, &payload); err != nil {
			return true, err
		}
	} else {
		if snapshot.Key != pinned.Plugin.Meta.Key || snapshot.Version != pinned.Plugin.Meta.Version {
			return true, errors.New("the image task plugin changed while the task was pending")
		}
		if snapshot.UpstreamTaskID == "" && snapshot.Result == nil {
			return true, errors.New("the previous image submission was interrupted; it will not be submitted again")
		}
		info.UpstreamModelName = task.Properties.UpstreamModelName
		if billing := task.PrivateData.BillingContext; billing != nil {
			info.PriceData.ModelPrice = billing.ModelPrice
			info.PriceData.ModelRatio = billing.ModelRatio
			info.PriceData.GroupRatioInfo.GroupRatio = billing.GroupRatio
			info.PriceData.ReplaceOtherRatios(billing.OtherRatios)
			info.TieredBillingSnapshot = billing.TieredSnapshot
		}
		if !snapshot.Settled {
			service.SetImageStudioPreheldBilling(c, service.ImageStudioPrehold{Quota: task.Quota, Source: task.PrivateData.BillingSource, BillingGroup: task.PrivateData.BillingGroup, SubscriptionId: task.PrivateData.SubscriptionId, RequestId: task.PrivateData.RequestId})
			if apiErr := service.PreConsumeBilling(c, task.Quota, info); apiErr != nil {
				return true, apiErr
			}
		}
	}
	adaptor := taskplugin.New(pinned.Plugin)
	adaptor.Init(info)
	viewTask := *task
	viewTask.Platform = constant.TaskPlatform(snapshot.Key)
	viewTask.PrivateData.UpstreamTaskID = snapshot.UpstreamTaskID
	pollFailures := 0
	for snapshot.Result == nil || (snapshot.Result.Status != model.TaskStatusSuccess && snapshot.Result.Status != model.TaskStatusFailure) {
		timer := time.NewTimer(2 * time.Second)
		select {
		case <-c.Request.Context().Done():
			timer.Stop()
			return true, c.Request.Context().Err()
		case <-timer.C:
		}
		viewTask.Data = snapshot.Data
		viewTask.PrivateData.PluginState = snapshot.State
		response, fetchErr := adaptor.FetchTaskWithContext(c.Request.Context(), info.ChannelBaseUrl, info.ApiKey, &viewTask, info.ChannelSetting.Proxy)
		if fetchErr != nil {
			pollFailures++
			if constant.TaskPollMaxFailures > 0 && pollFailures >= constant.TaskPollMaxFailures {
				return true, errors.New("image task polling repeatedly failed")
			}
			logger.LogWarn(c, "image studio plugin polling temporarily failed")
			continue
		}
		if response == nil || response.Body == nil {
			return true, errors.New("image task poll returned no response")
		}
		data, readErr := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
		response.Body.Close()
		if readErr != nil {
			return true, readErr
		}
		if len(data) > 1<<20 {
			return true, errors.New("image task response is too large")
		}
		if response.StatusCode/100 != 2 {
			if response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusGone {
				return true, fmt.Errorf("image task no longer exists (HTTP %d)", response.StatusCode)
			}
			pollFailures++
			if constant.TaskPollMaxFailures > 0 && pollFailures >= constant.TaskPollMaxFailures {
				return true, fmt.Errorf("image task polling repeatedly failed (HTTP %d)", response.StatusCode)
			}
			continue
		}
		result, parseErr := adaptor.ParseTaskResult(&viewTask, response, data)
		if parseErr != nil || result == nil || !slices.Contains([]string{"NOT_START", "SUBMITTED", "QUEUED", "IN_PROGRESS", "SUCCESS", "FAILURE"}, result.Status) {
			pollFailures++
			if constant.TaskPollMaxFailures > 0 && pollFailures >= constant.TaskPollMaxFailures {
				return true, errors.New("image task polling returned no recognized status")
			}
			continue
		}
		pollFailures = 0
		snapshot.Result = result
		snapshot.Data = data
		if len(result.PluginState) > 0 {
			snapshot.State = result.PluginState
		}
		if err := persistImageStudioPluginSnapshot(task, &payload); err != nil {
			return true, err
		}
	}
	if snapshot.Result.Status == model.TaskStatusFailure {
		return true, errors.New(snapshot.Result.Reason)
	}
	viewTask.Data = snapshot.Data
	viewTask.PrivateData.PluginState = snapshot.State
	viewTask.Status = model.TaskStatusSuccess
	view, err := service.BuildTaskPluginView(&viewTask)
	if err != nil {
		return true, err
	}
	viewValue, err := taskPluginProtocolJSONValue(view)
	if err != nil {
		return true, err
	}
	request, ok := c.MustGet(pluginruntime.ContextKeyProtocolRequest).(pluginruntime.ProtocolRequestContext)
	if !ok {
		return true, errors.New("invalid image protocol context")
	}
	rendered, err := pinned.Plugin.Engine.CallPathWithAdmissionTimeout(c.Request.Context(), pluginruntime.DefaultCallTimeout, "protocols", []string{pinned.Protocol, "render"}, request.JSValue(), viewValue)
	if err != nil {
		return true, err
	}
	body, err := common.Marshal(rendered)
	if err != nil {
		return true, err
	}
	response := &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(body))}
	if _, err := writer.CaptureImageStudioResponse(response); err != nil {
		return true, err
	}
	if _, _, err := writer.Process(); err != nil {
		return true, err
	}
	quota := snapshot.Quota
	if info.TieredBillingSnapshot != nil && len(snapshot.Result.UsageFacts) > 0 {
		settlement, facts, evalErr := service.EvaluateTaskCompletionUsage(info.TieredBillingSnapshot, snapshot.Result.UsageFacts)
		if evalErr == nil {
			quota = settlement.ActualQuotaAfterGroup
			info.TieredBillingSnapshot.UsageFacts = facts
			info.TieredBillingSnapshot.EstimatedTier = settlement.MatchedTier
			if info.QuotaClamp == nil {
				info.QuotaClamp = settlement.Clamp
			}
		}
	}
	if !snapshot.Settled {
		snapshot.Quota = quota
		snapshot.Settled = true
		checkpoint, err := common.Marshal(payload)
		if err != nil {
			return true, err
		}
		if err := service.SettleImageStudioPluginTask(c, task, quota, checkpoint); err != nil {
			return true, err
		}
	}

	info.PriceData.Quota = snapshot.Quota
	task.Quota = snapshot.Quota
	if !snapshot.Logged {
		alreadyLogged := false
		if common.LogConsumeEnabled {
			var count int64
			if err := model.LOG_DB.Model(&model.Log{}).Where("user_id = ? AND type = ? AND request_id = ?", task.UserId, model.LogTypeConsume, task.PrivateData.RequestId).Limit(1).Count(&count).Error; err != nil {
				logger.LogWarn(c, "image studio accounting lookup failed after successful generation")
				return true, nil
			}
			alreadyLogged = count > 0
		}
		if !alreadyLogged {
			service.LogTaskConsumption(c, info, task)
		}
		// The log database and quota statistics may be separate databases. The
		// request id prevents replaying completed accounting after a restart;
		// this checkpoint does not claim an atomic cross-database transaction.
		snapshot.Logged = true
		if err := persistImageStudioPluginSnapshot(task, &payload); err != nil {
			logger.LogWarn(c, "image studio accounting checkpoint failed after successful generation")
		}
	}
	return true, nil
}
