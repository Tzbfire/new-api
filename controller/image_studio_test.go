package controller

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupImageStudioAssetDB(t *testing.T) {
	t.Helper()
	previous := model.DB
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Task{}, &model.ImageStudioAsset{}))
	model.DB = db
	t.Cleanup(func() { model.DB = previous })
}

func TestBuildImageStudioJSONBodiesSplitsAndPreservesExplicitZeroValues(t *testing.T) {
	body := []byte(`{"model":"gpt-image-1","prompt":"cat","n":3,"group":"vip","watermark":false,"output_compression":0}`)
	bodies, err := buildImageStudioJSONBodies(body, "application/json", 3)
	require.NoError(t, err)
	require.Len(t, bodies, 3)
	for _, child := range bodies {
		var payload map[string]any
		require.NoError(t, common.Unmarshal(child.Body, &payload))
		assert.EqualValues(t, 1, payload["n"])
		assert.Equal(t, "b64_json", payload["response_format"])
		assert.Equal(t, false, payload["watermark"])
		assert.EqualValues(t, 0, payload["output_compression"])
		assert.NotContains(t, payload, "group")
	}
	assert.Same(t, &bodies[0].Body[0], &bodies[1].Body[0])
}

func TestImageStudioMultipartJobBodyPreservesRebuiltBoundary(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", t.TempDir())

	var requestBody bytes.Buffer
	writer := multipart.NewWriter(&requestBody)
	require.NoError(t, writer.WriteField("prompt", "edit me"))
	require.NoError(t, writer.WriteField("model", "gpt-image-1"))
	require.NoError(t, writer.WriteField("n", "2"))
	part, err := writer.CreateFormFile("image", "source.png")
	require.NoError(t, err)
	_, err = part.Write([]byte("fake-image"))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	req := httptest.NewRequest(http.MethodPost, "/pg/image-studio/edits", bytes.NewReader(requestBody.Bytes()))
	req.Header.Set("Content-Type", writer.FormDataContentType())
	context.Request = req
	storage, err := common.CreateBodyStorage(requestBody.Bytes())
	require.NoError(t, err)
	context.Set(common.KeyBodyStorage, storage)
	context.Set("_original_multipart_ct", writer.FormDataContentType())

	// The normal validation pass caches the original multipart boundary.
	_, err = helper.GetAndValidOpenAIImageRequest(context, relayconstant.RelayModeImagesEdits)
	require.NoError(t, err)

	bodies, err := buildImageStudioTaskBodies(context, writer.FormDataContentType(), requestBody.Bytes(), 2)
	require.NoError(t, err)
	require.Len(t, bodies, 2)

	key, err := service.StageImageStudioJobBody("task_multipart_job", bodies[0].ContentType, bodies[0].Body)
	require.NoError(t, err)
	t.Cleanup(func() { service.RemoveImageStudioJobBody(key) })

	loadedCT, loadedBody, err := service.LoadImageStudioJobBody(key)
	require.NoError(t, err)
	require.Equal(t, bodies[0].ContentType, loadedCT)
	require.Equal(t, bodies[0].Body, loadedBody)

	replayRecorder := httptest.NewRecorder()
	replayContext, _ := gin.CreateTestContext(replayRecorder)
	replayReq := httptest.NewRequest(http.MethodPost, "/v1/images/edits", bytes.NewReader(loadedBody))
	replayReq.Header.Set("Content-Type", loadedCT)
	replayContext.Request = replayReq
	replayStorage, err := common.CreateBodyStorage(loadedBody)
	require.NoError(t, err)
	replayContext.Set(common.KeyBodyStorage, replayStorage)
	t.Cleanup(func() {
		common.CleanupBodyStorage(replayContext)
	})

	replayedForm, err := common.ParseMultipartFormReusable(replayContext)
	require.NoError(t, err)
	require.Equal(t, []string{"1"}, replayedForm.Value["n"])
	require.Equal(t, []string{"b64_json"}, replayedForm.Value["response_format"])
	require.Len(t, replayedForm.File["image"], 1)
}

func TestValidateImageStudioBatchConcurrency(t *testing.T) {
	for _, value := range []string{"1", "4", "10"} {
		require.NoError(t, validateImageStudioBatchConcurrency(value))
	}
	for _, value := range []string{"", "0", "11", "1.5", "not-a-number"} {
		require.Error(t, validateImageStudioBatchConcurrency(value))
	}
}

func TestValidateImageStudioTaskTimeout(t *testing.T) {
	for _, value := range []string{"1", "10", "120"} {
		require.NoError(t, validateImageStudioTaskTimeout(value))
	}
	for _, value := range []string{"", "0", "121", "1.5", "not-a-number"} {
		require.Error(t, validateImageStudioTaskTimeout(value))
	}
}

func TestValidateImageStudioRetentionDays(t *testing.T) {
	for _, value := range []string{"0", "1", "30", "3650"} {
		require.NoError(t, validateImageStudioRetentionDays(value))
	}
	for _, value := range []string{"-1", "3651", "1.5", "invalid"} {
		require.Error(t, validateImageStudioRetentionDays(value))
	}
}

func TestParseImageStudioPromptPresetsAcceptsDefaultAndEmptyList(t *testing.T) {
	presets, err := parseImageStudioPromptPresets(constant.ImageStudioDefaultPromptPresets)
	require.NoError(t, err)
	require.Len(t, presets, 3)
	assert.Equal(t, "cpr-first-aid-guide", presets[0].ID)
	assert.Equal(t, "9:16", presets[0].AspectRatio)
	assert.Equal(t, "4k", presets[0].Tier)
	assert.Contains(t, presets[0].Prompt, "每分钟按压100—120次")
	assert.Equal(t, "messy-macos-chatgpt", presets[1].ID)
	assert.Contains(t, presets[1].Prompt, "draw me a dog")
	assert.Equal(t, "anime-expression-grid", presets[2].ID)
	assert.Contains(t, presets[2].Prompt, "严格使用 4×4 等大网格")

	presets, err = parseImageStudioPromptPresets("[]")
	require.NoError(t, err)
	assert.Empty(t, presets)
}

func TestParseImageStudioPromptPresetsRejectsInvalidOrUnsafeConfig(t *testing.T) {
	cases := []string{
		`not-json`,
		`[{"id":"same","title":"One","prompt":"Prompt"},{"id":"same","title":"Two","prompt":"Prompt"}]`,
		`[{"id":"missing-prompt","title":"Title","prompt":""}]`,
	}
	for _, value := range cases {
		_, err := parseImageStudioPromptPresets(value)
		require.Error(t, err)
	}
}

func TestParseImageStudioSizePresetsAcceptsBuiltInMatrix(t *testing.T) {
	presets, err := parseImageStudioSizePresets(constant.ImageStudioDefaultSizePresets)
	require.NoError(t, err)
	require.Len(t, presets, 14)
	assert.Equal(t, "gpt-standard-square", presets[0].ID)
	assert.Equal(t, "*", presets[0].GroupPattern)
	assert.Equal(t, "gpt-image*", presets[0].ModelPattern)
	assert.Equal(t, "gpt2-4k-landscape", presets[6].ID)
	assert.Equal(t, 3840, presets[6].Width)
	assert.Equal(t, 2160, presets[6].Height)
	assert.True(t, presets[6].Experimental)
}

func TestParseImageStudioSizePresetsDefaultsLegacyGroupPattern(t *testing.T) {
	presets, err := parseImageStudioSizePresets(`[{"id":"legacy","model_pattern":"gpt-image*","aspect_ratio":"1:1","tier":"hd","tier_label":"HD","width":1024,"height":1024,"enabled":true}]`)
	require.NoError(t, err)
	require.Len(t, presets, 1)
	assert.Equal(t, "*", presets[0].GroupPattern)
}

func TestParseImageStudioSizePresetsAllowsGroupSpecificOverrides(t *testing.T) {
	presets, err := parseImageStudioSizePresets(`[
		{"id":"default","group_pattern":"*","model_pattern":"gpt-image*","aspect_ratio":"1:1","tier":"hd","tier_label":"HD","width":1024,"height":1024,"enabled":true},
		{"id":"vip","group_pattern":"vip","model_pattern":"gpt-image*","aspect_ratio":"1:1","tier":"hd","tier_label":"VIP HD","width":2048,"height":2048,"enabled":true}
	]`)
	require.NoError(t, err)
	assert.Len(t, presets, 2)
}

func TestParseImageStudioSizePresetsRejectsUnsafeOrAmbiguousConfig(t *testing.T) {
	for _, value := range []string{
		`not-json`,
		`[{"id":"same","model_pattern":"gpt-image*","aspect_ratio":"1:1","tier":"hd","tier_label":"HD","width":1024,"height":1024,"enabled":true},{"id":"same","model_pattern":"gpt-image*","aspect_ratio":"1:1","tier":"4k","tier_label":"4K","width":2048,"height":2048,"enabled":true}]`,
		`[{"id":"first","model_pattern":"gpt-image*","aspect_ratio":"1:1","tier":"hd","tier_label":"HD","width":1024,"height":1024,"enabled":true},{"id":"second","model_pattern":"gpt-image*","aspect_ratio":"1:1","tier":"hd","tier_label":"HD 2","width":2048,"height":2048,"enabled":true}]`,
		`[{"id":"wild","model_pattern":"*gpt*image*","aspect_ratio":"1:1","tier":"hd","tier_label":"HD","width":1024,"height":1024,"enabled":true}]`,
		`[{"id":"wild-group","group_pattern":"*vip*group*","model_pattern":"gpt-image*","aspect_ratio":"1:1","tier":"hd","tier_label":"HD","width":1024,"height":1024,"enabled":true}]`,
		`[{"id":"huge","model_pattern":"gpt-image*","aspect_ratio":"1:1","tier":"4k","tier_label":"4K","width":8192,"height":8192,"enabled":true}]`,
	} {
		_, err := parseImageStudioSizePresets(value)
		require.Error(t, err)
	}
}

func TestGetImageStudioConfigFallsBackToDefaultPresets(t *testing.T) {
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	previous, existed := common.OptionMap["ImageStudioPromptPresets"]
	previousSizes, sizesExisted := common.OptionMap["ImageStudioSizePresets"]
	previousRetention, retentionExisted := common.OptionMap["ImageStudioRetentionDays"]
	common.OptionMap["ImageStudioPromptPresets"] = "invalid"
	common.OptionMap["ImageStudioSizePresets"] = "invalid"
	common.OptionMap["ImageStudioRetentionDays"] = "30"
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		if existed {
			common.OptionMap["ImageStudioPromptPresets"] = previous
		} else {
			delete(common.OptionMap, "ImageStudioPromptPresets")
		}
		if retentionExisted {
			common.OptionMap["ImageStudioRetentionDays"] = previousRetention
		} else {
			delete(common.OptionMap, "ImageStudioRetentionDays")
		}
		if sizesExisted {
			common.OptionMap["ImageStudioSizePresets"] = previousSizes
		} else {
			delete(common.OptionMap, "ImageStudioSizePresets")
		}
		common.OptionMapRWMutex.Unlock()
	})

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/pg/image-studio/config", nil)
	GetImageStudioConfig(context)
	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			PromptPresets []imageStudioPromptPreset `json:"prompt_presets"`
			SizePresets   []imageStudioSizePreset   `json:"size_presets"`
			RetentionDays int                       `json:"retention_days"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.True(t, response.Success)
	assert.Len(t, response.Data.PromptPresets, 3)
	assert.Len(t, response.Data.SizePresets, 14)
	assert.Equal(t, "cpr-first-aid-guide", response.Data.PromptPresets[0].ID)
	assert.Equal(t, 30, response.Data.RetentionDays)
}

func TestEstimateImageStudioBatchQuotaMatchesPerTaskRounding(t *testing.T) {
	assert.Equal(t, 21, estimateImageStudioBatchQuota(7, 3))
	assert.Equal(t, common.MaxQuota, estimateImageStudioBatchQuota(common.MaxQuota, 10))
}

func TestClaimNextImageStudioTaskIsCAS(t *testing.T) {
	setupImageStudioAssetDB(t)
	now := time.Now().Unix()
	task := &model.Task{
		CreatedAt:  now,
		UpdatedAt:  now,
		SubmitTime: now,
		TaskID:     "task_claim_cas",
		Platform:   constant.TaskPlatformImageStudio,
		UserId:     1,
		Status:     model.TaskStatusQueued,
		Progress:   "0%",
		Data:       json.RawMessage(`{"request":{"model":"gpt-image-1"}}`),
	}
	require.NoError(t, task.Insert())

	first, err := model.ClaimNextImageStudioTask()
	require.NoError(t, err)
	require.NotNil(t, first)
	assert.Equal(t, task.TaskID, first.TaskID)
	assert.EqualValues(t, model.TaskStatusInProgress, first.Status)

	second, err := model.ClaimNextImageStudioTask()
	require.NoError(t, err)
	assert.Nil(t, second)
}

func TestImageStudioBatchConcurrencyIsConfigurableAndBounded(t *testing.T) {
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	previous, existed := common.OptionMap["ImageStudioBatchConcurrency"]
	delete(common.OptionMap, "ImageStudioBatchConcurrency")
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		if existed {
			common.OptionMap["ImageStudioBatchConcurrency"] = previous
		} else {
			delete(common.OptionMap, "ImageStudioBatchConcurrency")
		}
		common.OptionMapRWMutex.Unlock()
	})
	assert.Equal(t, 10, imageStudioBatchConcurrency())

	common.OptionMapRWMutex.Lock()
	common.OptionMap["ImageStudioBatchConcurrency"] = "4"
	common.OptionMapRWMutex.Unlock()
	assert.Equal(t, 4, imageStudioBatchConcurrency())

	common.OptionMapRWMutex.Lock()
	common.OptionMap["ImageStudioBatchConcurrency"] = "100"
	common.OptionMapRWMutex.Unlock()
	assert.Equal(t, imageStudioGlobalConcurrency, imageStudioBatchConcurrency())

	common.OptionMapRWMutex.Lock()
	common.OptionMap["ImageStudioBatchConcurrency"] = "0"
	common.OptionMapRWMutex.Unlock()
	assert.Equal(t, 1, imageStudioBatchConcurrency())
}

func TestImageStudioResponseWriterStopsBufferingAtLimit(t *testing.T) {
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	writer, err := newImageStudioResponseWriter(context.Writer, &model.Task{TaskID: "writer-limit", UserId: 1})
	require.NoError(t, err)
	defer writer.Close()
	writer.limit = 4
	context.Writer = writer

	written, err := context.Writer.Write([]byte("12345678"))
	require.NoError(t, err)
	assert.Equal(t, 8, written)
	assert.True(t, writer.exceeded)
	data := make([]byte, 4)
	_, err = writer.file.ReadAt(data, 0)
	require.NoError(t, err)
	assert.Equal(t, "1234", string(data))
}

func TestImageStudioResponseWriterResetsBetweenRelayAttempts(t *testing.T) {
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	writer, err := newImageStudioResponseWriter(context.Writer, &model.Task{TaskID: "writer-retry", UserId: 1})
	require.NoError(t, err)
	defer writer.Close()

	writer.WriteHeader(http.StatusOK)
	_, err = writer.Write([]byte("first-attempt"))
	require.NoError(t, err)
	require.NoError(t, writer.BeginImageStudioResponseAttempt())
	writer.WriteHeader(http.StatusOK)
	_, err = writer.Write([]byte("second-attempt"))
	require.NoError(t, err)

	data := make([]byte, len("second-attempt"))
	_, err = writer.file.ReadAt(data, 0)
	require.NoError(t, err)
	assert.Equal(t, "second-attempt", string(data))
	assert.EqualValues(t, len("second-attempt"), writer.written)
}

func TestImageStudioResponseWriterStreamsBase64ToLocalAsset(t *testing.T) {
	setupImageStudioAssetDB(t)
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", t.TempDir())
	t.Setenv("IMAGE_STUDIO_MAX_IMAGE_MB", "1")
	var pngBuffer bytes.Buffer
	require.NoError(t, png.Encode(&pngBuffer, image.NewRGBA(image.Rect(0, 0, 4, 4))))
	encoded := base64.StdEncoding.EncodeToString(pngBuffer.Bytes())
	response, err := common.Marshal(map[string]any{
		"created": 123,
		"data": []any{map[string]any{
			"b64_json":       encoded,
			"revised_prompt": "streamed pixel",
		}},
		"usage": map[string]any{"input_tokens": 7, "output_tokens": 11, "total_tokens": 18},
	})
	require.NoError(t, err)

	task := &model.Task{TaskID: "task_streaming_response", UserId: 42, Platform: constant.TaskPlatformImageStudio}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	writer, err := newImageStudioResponseWriter(context.Writer, task)
	require.NoError(t, err)
	defer writer.Close()
	context.Writer = writer
	upstream := &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       io.NopCloser(bytes.NewReader(response)),
	}

	sanitized, err := writer.CaptureImageStudioResponse(upstream)
	require.NoError(t, err)
	assert.NotContains(t, string(sanitized), encoded)
	assert.Less(t, len(sanitized), 2048)
	payload, usage, err := writer.Process()
	require.NoError(t, err)
	require.NotNil(t, usage)
	assert.Equal(t, 7, usage.InputTokens)
	payloadMap := payload.(map[string]any)
	imageData := payloadMap["data"].([]any)[0].(map[string]any)
	assert.NotEmpty(t, imageData["storage_key"])
	assert.NotContains(t, imageData, "b64_json")

	stored, exists, err := model.GetImageStudioAsset(task.UserId, task.TaskID, 1)
	require.NoError(t, err)
	require.True(t, exists)
	assert.Equal(t, model.ImageStudioAssetStatusPending, stored.Status)
	cleanupImageStudioTaskAssets(context, task)
}

func TestImageStudioStreamingResponseAcceptsBase64Alias(t *testing.T) {
	setupImageStudioAssetDB(t)
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", t.TempDir())
	var pngBuffer bytes.Buffer
	require.NoError(t, png.Encode(&pngBuffer, image.NewRGBA(image.Rect(0, 0, 2, 2))))
	response, err := common.Marshal(map[string]any{
		"data": []any{map[string]any{"base64": base64.StdEncoding.EncodeToString(pngBuffer.Bytes())}},
	})
	require.NoError(t, err)

	task := &model.Task{TaskID: "task_streaming_alias", UserId: 42, Platform: constant.TaskPlatformImageStudio}
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	writer, err := newImageStudioResponseWriter(context.Writer, task)
	require.NoError(t, err)
	defer writer.Close()
	_, err = writer.CaptureImageStudioResponse(&http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       io.NopCloser(bytes.NewReader(response)),
	})
	require.NoError(t, err)
	payload, _, err := writer.Process()
	require.NoError(t, err)
	imageData := payload.(map[string]any)["data"].([]any)[0].(map[string]any)
	assert.NotEmpty(t, imageData["storage_key"])
	assert.NotContains(t, imageData, "base64")
	cleanupImageStudioTaskAssets(context, task)
}

func TestImageStudioBase64NormalizerSupportsRawURLAndDataURL(t *testing.T) {
	expected := []byte{0xfb, 0xff, 0x01, 0x02}
	variants := []string{
		base64.StdEncoding.EncodeToString(expected),
		base64.RawStdEncoding.EncodeToString(expected),
		base64.RawURLEncoding.EncodeToString(expected),
		"data:image/png;base64," + base64.StdEncoding.EncodeToString(expected),
	}
	for _, variant := range variants {
		normalized, err := newImageStudioBase64Reader(strings.NewReader(variant))
		require.NoError(t, err)
		decoded, err := io.ReadAll(base64.NewDecoder(base64.StdEncoding, normalized))
		require.NoError(t, err)
		assert.Equal(t, expected, decoded)
	}
}

func TestImageStudioStreamingResponseRejectsUntrustedOrAmbiguousImages(t *testing.T) {
	setupImageStudioAssetDB(t)
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", t.TempDir())
	t.Setenv("IMAGE_STUDIO_MAX_IMAGE_MB", "1")
	var pngBuffer bytes.Buffer
	require.NoError(t, png.Encode(&pngBuffer, image.NewRGBA(image.Rect(0, 0, 2, 2))))
	encoded := base64.StdEncoding.EncodeToString(pngBuffer.Bytes())
	cases := []struct {
		name string
		data []any
	}{
		{name: "url only", data: []any{map[string]any{"url": "https://example.com/image.png"}}},
		{name: "multiple images", data: []any{map[string]any{"b64_json": encoded}, map[string]any{"b64_json": encoded}}},
		{name: "upstream storage key", data: []any{map[string]any{"b64_json": encoded, "storage_key": "user_1/forged.png"}}},
	}
	for index, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			response, err := common.Marshal(map[string]any{"data": testCase.data})
			require.NoError(t, err)
			task := &model.Task{TaskID: fmt.Sprintf("task_stream_reject_%d", index), UserId: 42, Platform: constant.TaskPlatformImageStudio}
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			writer, err := newImageStudioResponseWriter(context.Writer, task)
			require.NoError(t, err)
			defer writer.Close()
			_, err = writer.CaptureImageStudioResponse(&http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(bytes.NewReader(response)),
			})
			require.Error(t, err)
			var count int64
			require.NoError(t, model.DB.Model(&model.ImageStudioAsset{}).Where("task_id = ?", task.TaskID).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
}

func TestImageStudioStreamingResponseRejectsInvalidJSONAndExcessiveDepth(t *testing.T) {
	setupImageStudioAssetDB(t)
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", t.TempDir())
	t.Setenv("IMAGE_STUDIO_MAX_IMAGE_MB", "1")
	responses := []string{
		"{\"data\":[{\"b64_json\":\"AAAA\nBBBB\"}]}",
		"{\"meta\":" + strings.Repeat("[", imageStudioResponseMaxJSONDepth) + "0" + strings.Repeat("]", imageStudioResponseMaxJSONDepth) + ",\"data\":[{\"b64_json\":\"AAAA\"}]}",
	}
	for index, response := range responses {
		task := &model.Task{TaskID: fmt.Sprintf("task_stream_invalid_%d", index), UserId: 42, Platform: constant.TaskPlatformImageStudio}
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		writer, err := newImageStudioResponseWriter(context.Writer, task)
		require.NoError(t, err)
		_, err = writer.CaptureImageStudioResponse(&http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(response)),
		})
		writer.Close()
		require.Error(t, err)
	}
}

func TestPersistImageStudioBillingSnapshotBeforeChannelMetaInitialization(t *testing.T) {
	setupImageStudioAssetDB(t)
	task := &model.Task{
		TaskID:    "task_preconsume_snapshot",
		UserId:    42,
		Platform:  constant.TaskPlatformImageStudio,
		Status:    model.TaskStatusInProgress,
		ChannelId: 17,
		Group:     "image-group",
		Properties: model.Properties{
			UpstreamModelName: "queued-image-model",
		},
	}
	require.NoError(t, model.DB.Create(task).Error)
	info := &relaycommon.RelayInfo{
		UsingGroup:      "image-group",
		OriginModelName: "gpt-image-1",
		PriceData: types.PriceData{
			ModelPrice:     0.01,
			ModelRatio:     1,
			GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1.5},
		},
	}

	require.NotPanics(t, func() {
		persistImageStudioBillingSnapshot(task, info, 37500)
	})

	var stored model.Task
	require.NoError(t, model.DB.First(&stored, task.ID).Error)
	assert.Equal(t, 17, stored.ChannelId)
	assert.Equal(t, "image-group", stored.Group)
	assert.Equal(t, "gpt-image-1", stored.Properties.OriginModelName)
	assert.Equal(t, "queued-image-model", stored.Properties.UpstreamModelName)
	require.NotNil(t, stored.PrivateData.BillingContext)
	assert.Equal(t, 1.5, stored.PrivateData.BillingContext.GroupRatio)

	info.ChannelMeta = &relaycommon.ChannelMeta{
		ChannelId:         29,
		UpstreamModelName: "final-image-model",
	}
	persistImageStudioBillingSnapshot(task, info, 40000)
	require.NoError(t, model.DB.First(&stored, task.ID).Error)
	assert.Equal(t, 29, stored.ChannelId)
	assert.Equal(t, "final-image-model", stored.Properties.UpstreamModelName)
	assert.Equal(t, 40000, stored.Quota)
}

func TestLegacyImageStudioBase64RemainsAccessibleAfterSanitizing(t *testing.T) {
	t.Setenv("IMAGE_STUDIO_MAX_IMAGE_MB", "1")
	var pngBuffer bytes.Buffer
	require.NoError(t, png.Encode(&pngBuffer, image.NewRGBA(image.Rect(0, 0, 2, 2))))
	encoded := base64.StdEncoding.EncodeToString(pngBuffer.Bytes())
	task := &model.Task{
		TaskID:   "task_legacy_image",
		UserId:   42,
		Platform: constant.TaskPlatformImageStudio,
		Status:   model.TaskStatusSuccess,
	}
	task.Data = json.RawMessage(`{"response":{"data":[{"b64_json":"` + encoded + `"}]}}`)

	taskDTO := &dto.TaskDto{Data: task.Data}
	sanitizeImageStudioTaskDtoWithAssets(task, taskDTO, nil)
	var sanitized map[string]any
	require.NoError(t, common.Unmarshal(taskDTO.Data, &sanitized))
	response := sanitized["response"].(map[string]any)
	imageData := response["data"].([]any)[0].(map[string]any)
	assert.Equal(t, "/api/task/image-studio/task_legacy_image/images/1/content", imageData["url"])
	assert.NotContains(t, imageData, "b64_json")

	legacyImage, found := findImageStudioImage(task.Data, 1)
	require.True(t, found)
	decoded, mimeType, err := decodeLegacyImageStudioContent(legacyImage)
	require.NoError(t, err)
	assert.Equal(t, "image/png", mimeType)
	assert.Equal(t, pngBuffer.Bytes(), decoded)
}

func TestReadyImageStudioAssetUsesSignedContentURL(t *testing.T) {
	task := &model.Task{
		TaskID:   "task_signed_image",
		UserId:   42,
		Platform: constant.TaskPlatformImageStudio,
		Status:   model.TaskStatusSuccess,
		Data:     json.RawMessage(`{"response":{"data":[{"storage_key":"legacy-placeholder"}]}}`),
	}
	asset := &model.ImageStudioAsset{
		ID:         88,
		TaskID:     task.TaskID,
		ImageIndex: 1,
		Status:     model.ImageStudioAssetStatusReady,
		MimeType:   "image/png",
	}
	taskDTO := &dto.TaskDto{Data: task.Data}
	sanitizeImageStudioTaskDtoWithAssets(task, taskDTO, []*model.ImageStudioAsset{asset})

	var sanitized map[string]any
	require.NoError(t, common.Unmarshal(taskDTO.Data, &sanitized))
	response := sanitized["response"].(map[string]any)
	imageData := response["data"].([]any)[0].(map[string]any)
	assert.Contains(t, imageData["url"], "/api/image-studio/assets/88/")
	assert.Contains(t, imageData["download_url"], "/api/image-studio/assets/88/")
	assert.NotContains(t, imageData, "storage_key")

	asset.ExpiresAt = time.Now().Add(-time.Minute).Unix()
	taskDTO.Data = task.Data
	sanitizeImageStudioTaskDtoWithAssets(task, taskDTO, []*model.ImageStudioAsset{asset})
	require.NoError(t, common.Unmarshal(taskDTO.Data, &sanitized))
	response = sanitized["response"].(map[string]any)
	imageData = response["data"].([]any)[0].(map[string]any)
	assert.Equal(t, string(model.ImageStudioAssetStatusExpired), imageData["asset_status"])
	assert.NotContains(t, imageData, "url")
}

func TestGetImageStudioTaskImageStreamsReadyLocalAsset(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupImageStudioAssetDB(t)
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", t.TempDir())
	data := imageStudioTestPNG(t)
	stored, _ := publishReadyImageStudioTestAsset(t, 42, "task_stream_ready", data)
	task := &model.Task{
		TaskID:   "task_stream_ready",
		UserId:   42,
		Platform: constant.TaskPlatformImageStudio,
		Status:   model.TaskStatusSuccess,
	}
	require.NoError(t, model.DB.Create(task).Error)

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest("GET", "/api/task/image-studio/task_stream_ready/images/1/content", nil)
	context.Params = gin.Params{{Key: "task_id", Value: task.TaskID}, {Key: "index", Value: "1"}}
	context.Set("id", 42)
	GetImageStudioTaskImage(context)

	assert.Equal(t, 200, recorder.Code)
	assert.Equal(t, data, recorder.Body.Bytes())
	assert.Equal(t, "image/png", recorder.Header().Get("Content-Type"))
	assert.Equal(t, `"`+stored.SHA256+`"`, recorder.Header().Get("ETag"))
}

func TestGetImageStudioTaskImageReturnsGoneForExpiredAsset(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupImageStudioAssetDB(t)
	task := &model.Task{
		TaskID:   "task_stream_expired",
		UserId:   42,
		Platform: constant.TaskPlatformImageStudio,
		Status:   model.TaskStatusSuccess,
	}
	require.NoError(t, model.DB.Create(task).Error)
	require.NoError(t, model.DB.Create(&model.ImageStudioAsset{
		UserID:     42,
		TaskID:     task.TaskID,
		ImageIndex: 1,
		StorageKey: "user_42/task_stream_expired/001.png",
		MimeType:   "image/png",
		SizeBytes:  10,
		SHA256:     "expired",
		Status:     model.ImageStudioAssetStatusExpired,
	}).Error)

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest("GET", "/api/task/image-studio/task_stream_expired/images/1/content", nil)
	context.Params = gin.Params{{Key: "task_id", Value: task.TaskID}, {Key: "index", Value: "1"}}
	context.Set("id", 42)
	GetImageStudioTaskImage(context)

	assert.Equal(t, http.StatusGone, recorder.Code)
}

func TestGetPublicImageStudioAssetUsesSignedURLWithoutUserSession(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupImageStudioAssetDB(t)
	t.Setenv("IMAGE_STUDIO_STORAGE_PATH", t.TempDir())
	data := imageStudioTestPNG(t)
	_, asset := publishReadyImageStudioTestAsset(t, 42, "task_public_signed", data)
	now := time.Now().Unix()
	asset.ExpiresAt = now + 3600
	require.NoError(t, model.DB.Model(asset).Update("expires_at", asset.ExpiresAt).Error)

	contentURL, _ := service.ImageStudioAssetURL(asset.ID, time.Now())
	parsedURL, err := url.Parse(contentURL)
	require.NoError(t, err)
	parts := strings.Split(strings.Trim(parsedURL.Path, "/"), "/")
	require.Len(t, parts, 6)

	request := func(signature string, download bool) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		requestURL := contentURL
		if download {
			requestURL += "/download"
		}
		context.Request = httptest.NewRequest(http.MethodGet, requestURL, nil)
		context.Params = gin.Params{
			{Key: "asset_id", Value: parts[3]},
			{Key: "expires", Value: parts[4]},
			{Key: "signature", Value: signature},
		}
		GetPublicImageStudioAsset(context)
		return recorder
	}

	response := request(parts[5], false)
	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, data, response.Body.Bytes())
	assert.Contains(t, response.Header().Get("Cache-Control"), "public")
	assert.Equal(t, "cross-origin", response.Header().Get("Cross-Origin-Resource-Policy"))
	assert.Equal(t, "no-referrer", response.Header().Get("Referrer-Policy"))
	assert.Contains(t, request(parts[5], true).Header().Get("Content-Disposition"), "attachment")
	assert.Equal(t, http.StatusNotFound, request(parts[5]+"invalid", false).Code)

	require.NoError(t, model.DeleteImageStudioAssetRecord(asset.ID))
	assert.Equal(t, http.StatusNotFound, request(parts[5], false).Code)
}

func imageStudioTestPNG(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	require.NoError(t, png.Encode(&buffer, image.NewRGBA(image.Rect(0, 0, 2, 2))))
	return buffer.Bytes()
}

func publishReadyImageStudioTestAsset(t *testing.T, userID int, taskID string, data []byte) (*service.ImageStudioAsset, *model.ImageStudioAsset) {
	t.Helper()
	staged, err := service.StageImageStudioAsset(userID, taskID, 1, bytes.NewReader(data))
	require.NoError(t, err)
	t.Cleanup(staged.Discard)
	asset, err := staged.Publish()
	require.NoError(t, err)
	require.NoError(t, model.TransitionImageStudioTaskAssets(taskID, []model.ImageStudioAssetStatus{model.ImageStudioAssetStatusPending}, model.ImageStudioAssetStatusReady))
	record, exists, err := model.GetImageStudioAsset(userID, taskID, 1)
	require.NoError(t, err)
	require.True(t, exists)
	return asset, record
}
