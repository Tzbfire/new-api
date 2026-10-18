package controller

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	pluginruntime "github.com/QuantumNous/new-api/pkg/jsplugin"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestImageStudioPluginOwnsOneTaskAndRefundsOnlyOnce(t *testing.T) {
	for _, mode := range []string{"success", "url", "resume", "interrupted", "price-increase", "fallback", "settled", "logged", "zero-hold"} {
		t.Run(mode, func(t *testing.T) {
			t.Setenv("IMAGE_STUDIO_STORAGE_PATH", t.TempDir())
			db, dialect := openTaskDialectDatabase(t, &model.User{}, &model.Channel{}, &model.Task{}, &model.Log{}, &model.ImageStudioAsset{}, &model.TaskBillingAdjustment{}, &model.UserSubscription{}, &model.SubscriptionPlan{})
			oldDB, oldLogDB, registry := model.DB, model.LOG_DB, pluginruntime.DefaultRegistry
			oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
			redis, memory, batch, consume := common.RedisEnabled, common.MemoryCacheEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled
			model.DB, model.LOG_DB = db, db
			common.SetDatabaseTypes(dialect, dialect)
			common.RedisEnabled, common.MemoryCacheEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled = false, false, false, true
			pluginruntime.DefaultRegistry = pluginruntime.NewRegistry()
			t.Cleanup(func() {
				model.DB, model.LOG_DB, pluginruntime.DefaultRegistry = oldDB, oldLogDB, registry
				common.SetDatabaseTypes(oldMain, oldLog)
				common.RedisEnabled, common.MemoryCacheEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled = redis, memory, batch, consume
			})
			withTieredBillingConfig(t, map[string]string{"studio-test-image": "tiered_expr"}, map[string]string{"studio-test-image": `tier("image", u("image_count") * 0.01)`})
			var pngBuffer bytes.Buffer
			require.NoError(t, png.Encode(&pngBuffer, image.NewRGBA(image.Rect(0, 0, 1, 1))))
			encoded := base64.StdEncoding.EncodeToString(pngBuffer.Bytes())
			submits, queries := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/submit" {
					submits++
				} else {
					queries++
				}
				w.Header().Set("Content-Type", "application/json")
				if mode == "url" {
					fmt.Fprint(w, `{"data":[{"url":"https://example.invalid/image.png"}]}`)
				} else {
					fmt.Fprintf(w, `{"data":[{"b64_json":%q}]}`, encoded)
				}
			}))
			defer server.Close()
			source := `export const meta={apiVersion:1,key:"studio-test",name:"Studio test",version:"1.0.0",author:{name:"Test"},models:["studio-test-image"],fetchMode:"per_task",protocols:["openai_image"],usageSchema:{image_count:{type:"number",unit:"count"}}};
export const protocols={openai_image:{decodeRequest:function(ctx){return {kind:"submit",model:ctx.model,requestBody:ctx.body.value};},render:function(ctx,task){return task.data;}}};
export function buildSubmitRequest(ctx){return {url:ctx.baseUrl+"/submit",body:ctx.requestBody};}
export function parseSubmitResponse(ctx,response){return {taskId:"upstream-one",taskData:response.body,immediate:{status:"SUCCESS"}};}
export function extractUsage(){return {image_count:1};}
export function extractUsageOnComplete(){return {image_count:1};}
export function buildQueryRequest(ctx){return {url:ctx.baseUrl+"/query"};}
export function parseTaskResult(){return {status:"SUCCESS"};}`
			_, err := pluginruntime.DefaultRegistry.Register(source, pluginruntime.Options{})
			require.NoError(t, err)
			user := model.User{Username: "studio-user", AffCode: "stdtest", Group: "default", Status: common.UserStatusEnabled, Quota: 100000, Setting: `{"billing_preference":"wallet_only"}`}
			require.NoError(t, db.Create(&user).Error)
			setting := `{"task_plugin_key":"studio-test"}`
			ch := model.Channel{Name: "studio", Type: constant.ChannelTypeTaskPlugin, Status: common.ChannelStatusEnabled, Key: "test-key", BaseURL: &server.URL, Setting: &setting}
			if mode == "fallback" {
				ch.Type = constant.ChannelTypeOpenAI
			}
			require.NoError(t, db.Create(&ch).Error)
			hold := common.QuotaRound(0.01 * common.QuotaPerUnit)
			reserved := hold
			if mode == "price-increase" {
				reserved = hold / 2
			}
			if mode == "zero-hold" {
				reserved = 0
			}
			require.NoError(t, model.DecreaseUserQuotaIfEnough(user.Id, reserved))
			task := &model.Task{TaskID: "task-studio", UserId: user.Id, ChannelId: ch.Id, Group: "default", Platform: constant.TaskPlatformImageStudio, Status: model.TaskStatusInProgress, Quota: reserved}
			task.Properties.OriginModelName = "studio-test-image"
			task.Properties.UpstreamModelName = "studio-test-image"
			task.PrivateData.StudioHeldQuota = reserved
			task.PrivateData.BillingSource = service.BillingSourceWallet
			task.PrivateData.RequestId = "studio-request"
			payload := imageStudioTaskPayload{Request: imageStudioRequestMeta{Model: "studio-test-image"}}
			if mode == "resume" {
				payload.Plugin = &imageStudioPluginSnapshot{Key: "studio-test", Version: "1.0.0", UpstreamTaskID: "upstream-one", Quota: hold}
			}
			if mode == "interrupted" {
				payload.Plugin = &imageStudioPluginSnapshot{Key: "studio-test", Version: "1.0.0"}
			}
			if mode == "settled" || mode == "logged" {
				payload.Plugin = &imageStudioPluginSnapshot{Key: "studio-test", Version: "1.0.0", UpstreamTaskID: "upstream-one", Quota: hold, Settled: true, Result: &relaycommon.TaskInfo{Status: model.TaskStatusSuccess}}
				payload.Plugin.Data = []byte(fmt.Sprintf(`{"data":[{"b64_json":%q}]}`, encoded))
				if mode == "logged" {
					require.NoError(t, db.Create(&model.Log{UserId: user.Id, Type: model.LogTypeConsume, RequestId: "studio-request", Quota: hold}).Error)
					require.NoError(t, db.Model(&user).Updates(map[string]any{"used_quota": hold, "request_count": 1}).Error)
				}
			}
			task.SetData(payload)
			require.NoError(t, db.Create(task).Error)
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", strings.NewReader(`{"model":"studio-test-image","prompt":"one image","n":1,"response_format":"b64_json"}`))
			c.Request.Header.Set("Content-Type", "application/json")
			c.Set("id", user.Id)
			c.Set(common.RequestIdKey, task.PrivateData.RequestId)
			cached, err := model.GetUserCache(user.Id)
			require.NoError(t, err)
			cached.WriteContext(c)
			require.NoError(t, middleware.SetupContextForToken(c, &model.Token{UserId: user.Id, Group: "default", Name: "studio"}))
			t.Cleanup(func() { common.CleanupBodyStorage(c) })
			require.Nil(t, middleware.SetupContextForSelectedChannel(c, &ch, "studio-test-image"))
			writer, err := newImageStudioResponseWriter(c.Writer, task)
			require.NoError(t, err)
			defer writer.Close()
			c.Writer = writer
			service.SetDurableAsyncBilling(c)
			service.SetImageStudioPreheldBilling(c, service.ImageStudioPrehold{Quota: reserved, Source: service.BillingSourceWallet, RequestId: task.PrivateData.RequestId})
			service.SetBillingSettlementObserver(c, func(info *relaycommon.RelayInfo, quota int) { persistImageStudioBillingSnapshot(task, info, quota) })
			handled, err := executeImageStudioPlugin(c, writer, task)
			assert.Equal(t, mode != "fallback", handled)
			if mode == "url" || mode == "interrupted" {
				require.Error(t, err)
				failAndRefundImageStudioTask(task, err.Error())
				_, refundErr := service.RefundImageStudioTaskQuotaOnce(context.Background(), task, "retry")
				require.NoError(t, refundErr)
			} else {
				require.NoError(t, err)
			}
			var tasks int64
			require.NoError(t, db.Model(&model.Task{}).Count(&tasks).Error)
			assert.EqualValues(t, 1, tasks)
			var stored model.User
			require.NoError(t, db.First(&stored, user.Id).Error)
			if mode == "url" || mode == "interrupted" {
				assert.Equal(t, 100000, stored.Quota)
			} else {
				assert.Equal(t, 100000-hold, stored.Quota)
			}
			if mode == "settled" || mode == "logged" {
				assert.Equal(t, hold, stored.UsedQuota)
				assert.Equal(t, 1, stored.RequestCount)
				var logCount int64
				require.NoError(t, db.Model(&model.Log{}).Where("request_id = ?", "studio-request").Count(&logCount).Error)
				assert.EqualValues(t, 1, logCount)
			}
			if mode == "fallback" || mode == "settled" || mode == "logged" {
				assert.Zero(t, submits)
				assert.Zero(t, queries)
			} else if mode == "resume" {
				assert.Equal(t, 0, submits)
				assert.Equal(t, 1, queries)
			} else if mode == "interrupted" {
				assert.Zero(t, submits)
				assert.Zero(t, queries)
			} else {
				assert.Equal(t, 1, submits)
				assert.Zero(t, queries)
			}
		})
	}
}
