package middleware

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestModelRedisRateLimitUsesUTCRegardlessOfLocalTimezone(t *testing.T) {
	redisServer, redisClient := useRateLimitMiniRedis(t)
	previousLocation := time.Local
	time.Local = time.FixedZone("test-utc-plus-eight", 8*60*60)
	t.Cleanup(func() { time.Local = previousLocation })

	ctx := context.Background()
	recordKey := "rateLimit:model-utc-record"
	recordRedisRequest(ctx, redisClient, recordKey, 2)
	recorded, err := redisClient.LIndex(ctx, recordKey, 0).Result()
	require.NoError(t, err)
	recordedAt, err := time.Parse(modelRateLimitTimeFormat, recorded)
	require.NoError(t, err)
	assert.WithinDuration(t, time.Now().UTC(), recordedAt, 2*time.Second)

	checkKey := "rateLimit:model-utc-check"
	withinWindow := time.Now().UTC().Add(-30 * time.Second).Format(modelRateLimitTimeFormat)
	_, err = redisServer.Push(checkKey, withinWindow, withinWindow)
	require.NoError(t, err)
	allowed, err := checkRedisRateLimit(ctx, redisClient, checkKey, 2, 60)
	require.NoError(t, err)
	assert.False(t, allowed, "an existing UTC timestamp inside the window must remain limited on a non-UTC host")
}

func TestModelRedisTotalRateLimitRecoversAfterScriptFlush(t *testing.T) {
	require.NoError(t, i18n.Init())
	redisServer, redisClient := useRateLimitMiniRedis(t)
	redisServer.SetTime(time.Date(2026, 10, 29, 0, 0, 0, 0, time.UTC))
	router := gin.New()
	router.GET("/", redisRateLimitHandler("script-flush", 60, 2, 0), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	require.Equal(t, http.StatusOK, performRateLimitRequest(router, "/", "127.0.0.1:1000").Code)
	require.NoError(t, redisClient.ScriptFlush(context.Background()).Err())

	response := performRateLimitRequest(router, "/", "127.0.0.1:1000")
	assert.Equal(t, http.StatusOK, response.Code, response.Body.String())
	response = performRateLimitRequest(router, "/", "127.0.0.1:1000")
	assert.Equal(t, http.StatusTooManyRequests, response.Code, response.Body.String())
}

func TestModelRedisTotalRateLimitRecoversAfterInitialRedisFailure(t *testing.T) {
	require.NoError(t, i18n.Init())
	redisServer, _ := useRateLimitMiniRedis(t)
	redisServer.SetTime(time.Date(2026, 10, 29, 0, 0, 0, 0, time.UTC))
	router := gin.New()
	router.GET("/", redisRateLimitHandler("initial-failure", 60, 1, 0), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	redisServer.SetError("ERR test Redis unavailable")
	assert.Equal(t, http.StatusInternalServerError, performRateLimitRequest(router, "/", "127.0.0.1:1000").Code)
	redisServer.SetError("")

	response := performRateLimitRequest(router, "/", "127.0.0.1:1000")
	assert.Equal(t, http.StatusOK, response.Code, response.Body.String())
	response = performRateLimitRequest(router, "/", "127.0.0.1:1000")
	assert.Equal(t, http.StatusTooManyRequests, response.Code, response.Body.String())
}

func TestModelRedisTotalRateLimitUsesCurrentRedisClient(t *testing.T) {
	require.NoError(t, i18n.Init())
	router := gin.New()
	router.GET("/", redisRateLimitHandler("current-client", 60, 1, 0), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	for range 2 {
		redisServer, _ := useRateLimitMiniRedis(t)
		redisServer.SetTime(time.Date(2026, 10, 29, 0, 0, 0, 0, time.UTC))
		response := performRateLimitRequest(router, "/", "127.0.0.1:1000")
		assert.Equal(t, http.StatusOK, response.Code, response.Body.String())
		response = performRateLimitRequest(router, "/", "127.0.0.1:1000")
		assert.Equal(t, http.StatusTooManyRequests, response.Code, response.Body.String())
	}
}

var modelRateLimitTestUsers atomic.Int64

func TestModelRateLimitStreamFailuresDoNotConsumeSuccessLimit(t *testing.T) {
	require.NoError(t, i18n.Init())
	for _, backend := range []string{"memory", "redis"} {
		for _, totalLimit := range []int{0, 2} {
			t.Run(fmt.Sprintf("%s/total=%d", backend, totalLimit), func(t *testing.T) {
				subject := strconv.Itoa(7200000 + int(modelRateLimitTestUsers.Add(1)))
				handler := memoryRateLimitHandler(subject, 60, totalLimit, 1)
				if backend == "redis" {
					useRateLimitMiniRedis(t)
					handler = redisRateLimitHandler(subject, 60, totalLimit, 1)
				}
				router := gin.New()
				router.GET("/:outcome", handler, func(c *gin.Context) {
					status := relaycommon.NewStreamStatus()
					if c.Param("outcome") == "failed" {
						status.MarkFailed("server_error", "", 0)
					} else {
						status.MarkCompleted()
					}
					common.SetContextKey(c, constant.ContextKeyResponseStreamStatus, status)
					c.Status(http.StatusOK)
				})
				assert.Equal(t, http.StatusOK, performRateLimitRequest(router, "/failed", "127.0.0.1:1000").Code)
				if totalLimit > 0 {
					assert.Equal(t, http.StatusOK, performRateLimitRequest(router, "/failed", "127.0.0.1:1000").Code)
				} else {
					assert.Equal(t, http.StatusOK, performRateLimitRequest(router, "/completed", "127.0.0.1:1000").Code)
				}
				assert.Equal(t, http.StatusTooManyRequests, performRateLimitRequest(router, "/completed", "127.0.0.1:1000").Code)
			})
		}
	}
}

func TestModelMemoryRateLimitReservesConcurrentSuccessAdmission(t *testing.T) {
	require.NoError(t, i18n.Init())
	subject := strconv.Itoa(7200000 + int(modelRateLimitTestUsers.Add(1)))
	entered, release, finished := make(chan struct{}), make(chan struct{}), make(chan struct{})
	router := gin.New()
	router.GET("/:outcome", memoryRateLimitHandler(subject, 60, 0, 1), func(c *gin.Context) {
		if c.Param("outcome") == "failed" {
			close(entered)
			<-release
			status := relaycommon.NewStreamStatus()
			status.MarkFailed("server_error", "", 0)
			common.SetContextKey(c, constant.ContextKeyResponseStreamStatus, status)
		}
		c.Status(http.StatusOK)
	})
	go func() {
		defer close(finished)
		assert.Equal(t, http.StatusOK, performRateLimitRequest(router, "/failed", "127.0.0.1:1000").Code)
	}()
	<-entered
	assert.Equal(t, http.StatusTooManyRequests, performRateLimitRequest(router, "/completed", "127.0.0.1:1000").Code)
	close(release)
	<-finished
	assert.Equal(t, http.StatusOK, performRateLimitRequest(router, "/completed", "127.0.0.1:1000").Code)
	assert.Equal(t, http.StatusTooManyRequests, performRateLimitRequest(router, "/completed", "127.0.0.1:1000").Code)
}

// The memory limiter answers like the Redis limiter: an OpenAI error body
// naming the limit that was reached, not an empty 429.
func TestModelMemoryRateLimitRejectionsReturnOpenAIError(t *testing.T) {
	require.NoError(t, i18n.Init())
	for _, tc := range []struct {
		name                     string
		totalLimit, successLimit int
		messageKey               string
	}{
		{name: "total", totalLimit: 1, messageKey: i18n.MsgRateLimitTotalReached},
		{name: "success", successLimit: 1, messageKey: i18n.MsgRateLimitReached},
	} {
		t.Run(tc.name, func(t *testing.T) {
			subject := strconv.Itoa(7200000 + int(modelRateLimitTestUsers.Add(1)))
			router := gin.New()
			router.GET("/", func(c *gin.Context) {
				c.Set(common.RequestIdKey, "req-limited")
			}, memoryRateLimitHandler(subject, 60, tc.totalLimit, tc.successLimit), func(c *gin.Context) {
				c.Status(http.StatusOK)
			})
			require.Equal(t, http.StatusOK, performRateLimitRequest(router, "/", "127.0.0.1:1000").Code)

			resp := performRateLimitRequest(router, "/", "127.0.0.1:1000")
			assert.Equal(t, http.StatusTooManyRequests, resp.Code)
			message := i18n.Translate("", tc.messageKey, map[string]any{"Minutes": setting.ModelRequestRateLimitDurationMinutes, "Max": 1})
			want, err := common.Marshal(gin.H{"error": gin.H{
				"message": common.MessageWithRequestId(message, "req-limited"),
				"type":    "new_api_error",
				"code":    "",
			}})
			require.NoError(t, err)
			assert.JSONEq(t, string(want), resp.Body.String())
		})
	}
}

// A group with its own limit counts each user's requests on its own; groups
// without one keep sharing the user's global limit.
func TestModelRateLimitCountsConfiguredGroupsSeparately(t *testing.T) {
	require.NoError(t, i18n.Init())
	previousEnabled, previousMinutes := setting.ModelRequestRateLimitEnabled, setting.ModelRequestRateLimitDurationMinutes
	previousTotal, previousSuccess := setting.ModelRequestRateLimitCount, setting.ModelRequestRateLimitSuccessCount
	previousGroups, previousRedisEnabled := setting.ModelRequestRateLimitGroup, common.RedisEnabled
	t.Cleanup(func() {
		setting.ModelRequestRateLimitEnabled, setting.ModelRequestRateLimitDurationMinutes = previousEnabled, previousMinutes
		setting.ModelRequestRateLimitCount, setting.ModelRequestRateLimitSuccessCount = previousTotal, previousSuccess
		setting.ModelRequestRateLimitGroup, common.RedisEnabled = previousGroups, previousRedisEnabled
	})
	setting.ModelRequestRateLimitEnabled, setting.ModelRequestRateLimitDurationMinutes = true, 1
	common.RedisEnabled = false

	// Groups a and b have their own limits; c and d have none and share the global one.
	steps := []struct {
		group string
		want  int
	}{
		{"a", http.StatusOK}, {"a", http.StatusTooManyRequests},
		{"b", http.StatusOK}, {"b", http.StatusTooManyRequests},
		{"c", http.StatusOK}, {"d", http.StatusTooManyRequests},
	}
	for _, tc := range []struct {
		backend, limit string
		counts         [2]int // [total, success] for groups a and b and for the global limit
	}{
		{"memory", "success", [2]int{0, 1}},
		{"redis", "success", [2]int{0, 1}},
		{"memory", "total", [2]int{1, 1000}},
		{"redis", "total", [2]int{1, 1000}},
	} {
		t.Run(tc.backend+"/"+tc.limit, func(t *testing.T) {
			if tc.backend == "redis" {
				useRateLimitMiniRedis(t)
			}
			setting.ModelRequestRateLimitCount, setting.ModelRequestRateLimitSuccessCount = tc.counts[0], tc.counts[1]
			setting.ModelRequestRateLimitGroup = map[string][2]int{"a": tc.counts, "b": tc.counts}
			userID := 7200000 + int(modelRateLimitTestUsers.Add(1))
			router := gin.New()
			router.GET("/:group", func(c *gin.Context) {
				c.Set("id", userID)
				common.SetContextKey(c, constant.ContextKeyTokenGroup, c.Param("group"))
			}, ModelRequestRateLimit(), func(c *gin.Context) {
				c.Status(http.StatusOK)
			})

			for _, step := range steps {
				assert.Equal(t, step.want, performRateLimitRequest(router, "/"+step.group, "127.0.0.1:1000").Code, "group %s", step.group)
			}
		})
	}
}

func TestModelRateLimitCountsConfiguredModelsPerUser(t *testing.T) {
	require.NoError(t, i18n.Init())
	previousEnabled := setting.ModelRequestRateLimitEnabled
	previousDuration := setting.ModelRequestRateLimitDurationMinutes
	previousTotal := setting.ModelRequestRateLimitCount
	previousSuccess := setting.ModelRequestRateLimitSuccessCount
	previousRedisEnabled := common.RedisEnabled
	setting.ModelRequestRateLimitMutex.Lock()
	previousModels := setting.ModelRequestRateLimitModel
	setting.ModelRequestRateLimitMutex.Unlock()
	t.Cleanup(func() {
		setting.ModelRequestRateLimitEnabled = previousEnabled
		setting.ModelRequestRateLimitDurationMinutes = previousDuration
		setting.ModelRequestRateLimitCount = previousTotal
		setting.ModelRequestRateLimitSuccessCount = previousSuccess
		common.RedisEnabled = previousRedisEnabled
		setting.ModelRequestRateLimitMutex.Lock()
		setting.ModelRequestRateLimitModel = previousModels
		setting.ModelRequestRateLimitMutex.Unlock()
	})
	setting.ModelRequestRateLimitEnabled = true
	setting.ModelRequestRateLimitDurationMinutes = 1
	setting.ModelRequestRateLimitCount = 0
	setting.ModelRequestRateLimitSuccessCount = 1000
	for _, tc := range []struct {
		name   string
		redis  bool
		counts [2]int
	}{
		{name: "memory/success", counts: [2]int{0, 1}},
		{name: "memory/total", counts: [2]int{1, 1000}},
		{name: "redis/success", redis: true, counts: [2]int{0, 1}},
		{name: "redis/total", redis: true, counts: [2]int{1, 1000}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			common.RedisEnabled = false
			if tc.redis {
				redisServer, _ := useRateLimitMiniRedis(t)
				redisServer.SetTime(time.Date(2026, 10, 29, 0, 0, 0, 0, time.UTC))
			}
			setting.ModelRequestRateLimitMutex.Lock()
			setting.ModelRequestRateLimitModel = map[string][2]int{"gpt-6-luna": tc.counts}
			setting.ModelRequestRateLimitMutex.Unlock()
			userID := 7300000 + int(modelRateLimitTestUsers.Add(1))
			router := gin.New()
			router.Use(BodyStorageCleanup(), func(c *gin.Context) {
				id, _ := strconv.Atoi(c.GetHeader("X-Test-User"))
				c.Set("id", id)
				common.SetContextKey(c, constant.ContextKeyTokenGroup, c.GetHeader("X-Test-Group"))
			}, ModelRequestRateLimit())
			for _, path := range []string{"/v1/chat/completions", "/v1/responses"} {
				router.POST(path, func(c *gin.Context) { c.Status(http.StatusOK) })
			}

			for _, step := range []struct {
				path, model, group string
				userID, want       int
			}{
				{"/v1/chat/completions", "gpt-6-luna", "default", userID, http.StatusOK},
				{"/v1/responses", "gpt-6-luna@effort:high", "default", userID, http.StatusTooManyRequests},
				{"/v1/responses", "gpt-6.1-sol", "default", userID, http.StatusOK},
				{"/v1/responses", "gpt-6-luna", "default", userID + 1, http.StatusOK},
				{"/v1/responses", "gpt-6-luna", "Luna-Pro", userID, http.StatusTooManyRequests},
			} {
				body := []byte(fmt.Sprintf(`{"model":%q}`, step.model))
				req := httptest.NewRequest(http.MethodPost, step.path, bytes.NewReader(body))
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("X-Test-User", strconv.Itoa(step.userID))
				req.Header.Set("X-Test-Group", step.group)
				recorder := httptest.NewRecorder()
				router.ServeHTTP(recorder, req)
				assert.Equal(t, step.want, recorder.Code, "%s %s %s user %d: %s", step.path, step.model, step.group, step.userID, recorder.Body.String())
			}
		})
	}
}

func TestModelRateLimitGroupModelValidation(t *testing.T) {
	previous := setting.ModelRequestRateLimitGroupModel2JSONString()
	t.Cleanup(func() { require.NoError(t, setting.UpdateModelRequestRateLimitGroupModelByJSONString(previous)) })
	valid := `{"default":{"gpt-6-luna":[2,0],"gpt-6.1-luna":[0,2]},"Luna-Pro":{"gpt-6-luna":[0,0]}}`
	require.NoError(t, setting.CheckModelRequestRateLimitGroupModel(valid))
	require.NoError(t, setting.UpdateModelRequestRateLimitGroupModelByJSONString(valid))
	assert.JSONEq(t, valid, setting.ModelRequestRateLimitGroupModel2JSONString())
	for _, input := range []string{
		`null`, `[]`, `{"default":null}`, `{"default":[]}`,
		`{" ":{"gpt-6-luna":[1,1]}}`, `{"default ":{"gpt-6-luna":[1,1]}}`,
		`{"default":{" ":[1,1]}}`, `{"default":{"gpt-6-luna ":[1,1]}}`,
		`{"default":{"gpt-6-luna":null}}`, `{"default":{"gpt-6-luna":[0]}}`,
		`{"default":{"gpt-6-luna":[0,0,1]}}`, `{"default":{"gpt-6-luna":[null,1]}}`,
		`{"default":{"gpt-6-luna":[1.5,1]}}`, `{"default":{"gpt-6-luna":["1",1]}}`,
		`{"default":{"gpt-6-luna":[-1,1]}}`, `{"default":{"gpt-6-luna":[1,-1]}}`,
		`{"default":{"gpt-6-luna":[9223372036854775808,1]}}`,
		`{"default":{"gpt-6-luna":[106751991167301,1]}}`,
	} {
		assert.Error(t, setting.CheckModelRequestRateLimitGroupModel(input), input)
		assert.Error(t, setting.UpdateModelRequestRateLimitGroupModelByJSONString(input), input)
		assert.JSONEq(t, valid, setting.ModelRequestRateLimitGroupModel2JSONString(), "invalid updates must preserve active rules")
	}
	require.NoError(t, setting.UpdateModelRequestRateLimitGroupModelByJSONString(`{}`))
	assert.JSONEq(t, `{}`, setting.ModelRequestRateLimitGroupModel2JSONString())
}

func TestModelRateLimitGroupModelOverridesAndIsolation(t *testing.T) {
	require.NoError(t, i18n.Init())
	previousEnabled, previousMinutes := setting.ModelRequestRateLimitEnabled, setting.ModelRequestRateLimitDurationMinutes
	previousTotal, previousSuccess := setting.ModelRequestRateLimitCount, setting.ModelRequestRateLimitSuccessCount
	previousRedisEnabled := common.RedisEnabled
	setting.ModelRequestRateLimitMutex.Lock()
	previousGroups, previousModels := setting.ModelRequestRateLimitGroup, setting.ModelRequestRateLimitModel
	previousGroupModels := setting.ModelRequestRateLimitGroupModel
	setting.ModelRequestRateLimitMutex.Unlock()
	t.Cleanup(func() {
		setting.ModelRequestRateLimitEnabled, setting.ModelRequestRateLimitDurationMinutes = previousEnabled, previousMinutes
		setting.ModelRequestRateLimitCount, setting.ModelRequestRateLimitSuccessCount = previousTotal, previousSuccess
		common.RedisEnabled = previousRedisEnabled
		setting.ModelRequestRateLimitMutex.Lock()
		setting.ModelRequestRateLimitGroup, setting.ModelRequestRateLimitModel = previousGroups, previousModels
		setting.ModelRequestRateLimitGroupModel = previousGroupModels
		setting.ModelRequestRateLimitMutex.Unlock()
	})
	setting.ModelRequestRateLimitEnabled, setting.ModelRequestRateLimitDurationMinutes = true, 1
	setting.ModelRequestRateLimitCount, setting.ModelRequestRateLimitSuccessCount = 1, 1
	for _, backend := range []string{"memory", "redis"} {
		for _, counts := range [][2]int{{0, 2}, {2, 0}, {2, 2}} {
			t.Run(fmt.Sprintf("%s/%d-%d", backend, counts[0], counts[1]), func(t *testing.T) {
				common.RedisEnabled = false
				if backend == "redis" {
					redisServer, _ := useRateLimitMiniRedis(t)
					redisServer.SetTime(time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC))
				}
				setting.ModelRequestRateLimitMutex.Lock()
				setting.ModelRequestRateLimitGroup = map[string][2]int{
					"default": {1, 1}, "Codex-Plus": {1, 1}, "Codex-Pro": {1, 1}, "Luna-Pro": {1, 1}, "group-only": {0, 2},
				}
				setting.ModelRequestRateLimitModel = map[string][2]int{"gpt-6-luna": {1, 1}, "gpt-6.1-luna": {1, 1}, "model-only": {0, 2}}
				setting.ModelRequestRateLimitGroupModel = map[string]map[string][2]int{
					"default":    {"gpt-6-luna": counts, "gpt-6.1-luna": counts},
					"Codex-Plus": {"gpt-6-luna": counts}, "Codex-Pro": {"gpt-6-luna": counts},
					"Luna-Pro": {"gpt-6-luna": {0, 0}},
					"a:b":      {"c": {0, 1}}, "a": {"b:c": {0, 1}},
				}
				setting.ModelRequestRateLimitMutex.Unlock()
				userID := 7400000 + 2*int(modelRateLimitTestUsers.Add(1))
				router := gin.New()
				router.Use(BodyStorageCleanup(), func(c *gin.Context) {
					id, _ := strconv.Atoi(c.GetHeader("X-Test-User"))
					tokenID, _ := strconv.Atoi(c.GetHeader("X-Test-Token"))
					c.Set("id", id)
					common.SetContextKey(c, constant.ContextKeyTokenId, tokenID)
					common.SetContextKey(c, constant.ContextKeyTokenGroup, c.GetHeader("X-Test-Group"))
					common.SetContextKey(c, constant.ContextKeyUserGroup, "Luna-Pro")
				}, ModelRequestRateLimit())
				for _, path := range []string{"/v1/chat/completions", "/v1/responses", "/v1/messages", "/pg/chat/completions"} {
					router.POST(path, func(c *gin.Context) { c.Status(http.StatusOK) })
				}
				steps := []struct {
					group, model, path string
					userID, want       int
				}{
					{"default", "gpt-6-luna", "/v1/chat/completions", userID, http.StatusOK},
					{"default", "gpt-6-luna@effort:high", "/v1/responses", userID, http.StatusOK},
					{"default", "gpt-6-luna", "/v1/messages", userID, http.StatusTooManyRequests},
					{"default", "gpt-6-luna", "/pg/chat/completions", userID, http.StatusTooManyRequests},
					{"Codex-Plus", "gpt-6-luna", "/v1/responses", userID, http.StatusOK},
					{"Codex-Plus", "gpt-6-luna", "/v1/responses", userID, http.StatusOK},
					{"Codex-Plus", "gpt-6-luna", "/v1/responses", userID, http.StatusTooManyRequests},
					{"Codex-Pro", "gpt-6-luna", "/v1/responses", userID, http.StatusOK},
					{"Codex-Pro", "gpt-6-luna", "/v1/responses", userID, http.StatusOK},
					{"Codex-Pro", "gpt-6-luna", "/v1/responses", userID, http.StatusTooManyRequests},
					{"Luna-Pro", "gpt-6-luna", "/v1/responses", userID, http.StatusOK},
					{"Luna-Pro", "gpt-6-luna", "/v1/responses", userID, http.StatusOK},
					{"Luna-Pro", "gpt-6-luna@effort:high", "/v1/responses", userID, http.StatusOK},
					{"", "gpt-6-luna", "/v1/responses", userID, http.StatusOK},
					{"default", "gpt-6-luna", "/v1/responses", userID + 1, http.StatusOK},
					{"default", "gpt-6.1-luna", "/v1/responses", userID, http.StatusOK},
					{"default", "model-only", "/v1/responses", userID, http.StatusOK},
					{"Codex-Pro", "model-only", "/v1/responses", userID, http.StatusOK},
					{"default", "model-only", "/v1/responses", userID, http.StatusTooManyRequests},
					{"group-only", "other-model", "/v1/responses", userID, http.StatusOK},
					{"group-only", "another-model", "/v1/responses", userID, http.StatusOK},
					{"group-only", "other-model", "/v1/responses", userID, http.StatusTooManyRequests},
					{"fallback-a", "other-model", "/v1/responses", userID, http.StatusOK},
					{"fallback-b", "other-model", "/v1/responses", userID, http.StatusTooManyRequests},
					{"a:b", "c", "/v1/responses", userID, http.StatusOK},
					{"a", "b:c", "/v1/responses", userID, http.StatusOK},
					{"a:b", "c", "/v1/responses", userID, http.StatusTooManyRequests},
				}
				for tokenID, step := range steps {
					body, err := common.Marshal(map[string]string{"model": step.model})
					require.NoError(t, err)
					req := httptest.NewRequest(http.MethodPost, step.path, bytes.NewReader(body))
					req.Header.Set("Content-Type", "application/json")
					req.Header.Set("X-Test-User", strconv.Itoa(step.userID))
					req.Header.Set("X-Test-Token", strconv.Itoa(tokenID+1))
					req.Header.Set("X-Test-Group", step.group)
					recorder := httptest.NewRecorder()
					router.ServeHTTP(recorder, req)
					assert.Equal(t, step.want, recorder.Code, "%s %s %s: %s", step.group, step.model, step.path, recorder.Body.String())
				}
			})
		}
	}
}
