package helper

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/types"
	"github.com/samber/lo"

	"github.com/gin-gonic/gin"
)

func GetAndValidateRequest(c *gin.Context, format types.RelayFormat) (request dto.Request, err error) {
	relayMode := relayconstant.Path2RelayMode(c.Request.URL.Path)

	switch format {
	case types.RelayFormatOpenAI:
		request, err = GetAndValidateTextRequest(c, relayMode)
	case types.RelayFormatGemini:
		if strings.Contains(c.Request.URL.Path, ":embedContent") {
			request, err = GetAndValidateGeminiEmbeddingRequest(c)
		} else if strings.Contains(c.Request.URL.Path, ":batchEmbedContents") {
			request, err = GetAndValidateGeminiBatchEmbeddingRequest(c)
		} else {
			request, err = GetAndValidateGeminiRequest(c)
		}
	case types.RelayFormatClaude:
		request, err = GetAndValidateClaudeRequest(c)
	case types.RelayFormatOpenAIResponses:
		request, err = GetAndValidateResponsesRequest(c)
	case types.RelayFormatOpenAIResponsesCompaction:
		request, err = GetAndValidateResponsesCompactionRequest(c)

	case types.RelayFormatOpenAIImage:
		request, err = GetAndValidOpenAIImageRequest(c, relayMode)
	case types.RelayFormatEmbedding:
		request, err = GetAndValidateEmbeddingRequest(c, relayMode)
	case types.RelayFormatRerank:
		request, err = GetAndValidateRerankRequest(c)
	case types.RelayFormatOpenAIAudio:
		request, err = GetAndValidAudioRequest(c, relayMode)
	case types.RelayFormatOpenAIRealtime:
		request = &dto.BaseRequest{}
	default:
		return nil, fmt.Errorf("unsupported relay format: %s", format)
	}
	return request, err
}

func GetAndValidAudioRequest(c *gin.Context, relayMode int) (*dto.AudioRequest, error) {
	audioRequest := &dto.AudioRequest{}
	err := common.UnmarshalBodyReusable(c, audioRequest)
	if err != nil {
		return nil, err
	}
	switch relayMode {
	case relayconstant.RelayModeAudioSpeech:
		if audioRequest.Model == "" {
			return nil, errors.New("model is required")
		}
	default:
		if audioRequest.Model == "" {
			return nil, errors.New("model is required")
		}
		if audioRequest.ResponseFormat == "" {
			audioRequest.ResponseFormat = "json"
		}
	}
	return audioRequest, nil
}

func GetAndValidateRerankRequest(c *gin.Context) (*dto.RerankRequest, error) {
	var rerankRequest *dto.RerankRequest
	err := common.UnmarshalBodyReusable(c, &rerankRequest)
	if err != nil {
		logger.LogError(c, fmt.Sprintf("getAndValidateTextRequest failed: %s", err.Error()))
		return nil, types.NewError(err, types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}

	if rerankRequest.Query == "" {
		return nil, types.NewError(fmt.Errorf("query is empty"), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}
	if len(rerankRequest.Documents) == 0 {
		return nil, types.NewError(fmt.Errorf("documents is empty"), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}
	return rerankRequest, nil
}

func GetAndValidateEmbeddingRequest(c *gin.Context, relayMode int) (*dto.EmbeddingRequest, error) {
	var embeddingRequest *dto.EmbeddingRequest
	err := common.UnmarshalBodyReusable(c, &embeddingRequest)
	if err != nil {
		logger.LogError(c, fmt.Sprintf("getAndValidateTextRequest failed: %s", err.Error()))
		return nil, types.NewError(err, types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}

	if embeddingRequest.Input == nil {
		return nil, fmt.Errorf("input is empty")
	}
	if relayMode == relayconstant.RelayModeModerations && embeddingRequest.Model == "" {
		embeddingRequest.Model = "omni-moderation-latest"
	}
	if relayMode == relayconstant.RelayModeEmbeddings && embeddingRequest.Model == "" {
		embeddingRequest.Model = c.Param("model")
	}
	return embeddingRequest, nil
}

func GetAndValidateResponsesRequest(c *gin.Context) (*dto.OpenAIResponsesRequest, error) {
	request := &dto.OpenAIResponsesRequest{}
	err := common.UnmarshalBodyReusable(c, request)
	if err != nil {
		return nil, err
	}
	if request.Model == "" {
		return nil, errors.New("model is required")
	}
	if request.Input == nil {
		return nil, errors.New("input is required")
	}
	return request, nil
}

func GetAndValidateResponsesCompactionRequest(c *gin.Context) (*dto.OpenAIResponsesCompactionRequest, error) {
	request := &dto.OpenAIResponsesCompactionRequest{}
	if err := common.UnmarshalBodyReusable(c, request); err != nil {
		return nil, err
	}
	if request.Model == "" {
		return nil, errors.New("model is required")
	}
	return request, nil
}

func GetAndValidOpenAIImageRequest(c *gin.Context, relayMode int) (*dto.ImageRequest, error) {
	imageRequest := &dto.ImageRequest{}

	switch relayMode {
	case relayconstant.RelayModeImagesEdits:
		if strings.Contains(c.Request.Header.Get("Content-Type"), "multipart/form-data") {
			form, err := common.ParseMultipartFormReusable(c)
			if err != nil {
				return nil, fmt.Errorf("failed to parse image edit form request: %w", err)
			}
			formData := url.Values(form.Value)
			c.Request.MultipartForm = form
			c.Request.PostForm = formData
			imageRequest.Prompt = formData.Get("prompt")
			imageRequest.Model = formData.Get("model")
			imageRequest.N = common.GetPointer(uint(common.String2Int(formData.Get("n"))))
			imageRequest.Quality = formData.Get("quality")
			imageRequest.Size = formData.Get("size")
			if streamValue := strings.TrimSpace(formData.Get("stream")); streamValue != "" {
				stream, err := strconv.ParseBool(streamValue)
				if err != nil {
					return nil, fmt.Errorf("invalid stream value: %w", err)
				}
				imageRequest.Stream = common.GetPointer(stream)
			}
			if imageValue := formData.Get("image"); imageValue != "" {
				imageRequest.Image, _ = common.Marshal(imageValue)
			}

			if imageRequest.Model == "gpt-image-1" {
				if imageRequest.Quality == "" {
					imageRequest.Quality = "standard"
				}
			}
			if imageRequest.N == nil || *imageRequest.N == 0 {
				imageRequest.N = common.GetPointer(uint(1))
			}

			hasWatermark := formData.Has("watermark")
			if hasWatermark {
				watermark := formData.Get("watermark") == "true"
				imageRequest.Watermark = &watermark
			}
			break
		}
		fallthrough
	default:
		err := common.UnmarshalBodyReusable(c, imageRequest)
		if err != nil {
			return nil, err
		}

		if imageRequest.Model == "" {
			//imageRequest.Model = "dall-e-3"
			return nil, errors.New("model is required")
		}

		if strings.Contains(imageRequest.Size, "×") {
			return nil, errors.New("size an unexpected error occurred in the parameter, please use 'x' instead of the multiplication sign '×'")
		}

		// Not "256x256", "512x512", or "1024x1024"
		if imageRequest.Model == "dall-e-2" || imageRequest.Model == "dall-e" {
			if imageRequest.Size != "" && imageRequest.Size != "256x256" && imageRequest.Size != "512x512" && imageRequest.Size != "1024x1024" {
				return nil, errors.New("size must be one of 256x256, 512x512, or 1024x1024 for dall-e-2 or dall-e")
			}
			if imageRequest.Size == "" {
				imageRequest.Size = "1024x1024"
			}
		} else if imageRequest.Model == "dall-e-3" {
			if imageRequest.Size != "" && imageRequest.Size != "1024x1024" && imageRequest.Size != "1024x1792" && imageRequest.Size != "1792x1024" {
				return nil, errors.New("size must be one of 1024x1024, 1024x1792 or 1792x1024 for dall-e-3")
			}
			if imageRequest.Quality == "" {
				imageRequest.Quality = "standard"
			}
			if imageRequest.Size == "" {
				imageRequest.Size = "1024x1024"
			}
		} else if imageRequest.Model == "gpt-image-1" {
			if imageRequest.Quality == "" {
				imageRequest.Quality = "auto"
			}
		}

		//if imageRequest.Prompt == "" {
		//	return nil, errors.New("prompt is required")
		//}

		if imageRequest.N == nil || *imageRequest.N == 0 {
			imageRequest.N = common.GetPointer(uint(1))
		}
	}

	return imageRequest, nil
}

func GetAndValidateClaudeRequest(c *gin.Context) (textRequest *dto.ClaudeRequest, err error) {
	textRequest = &dto.ClaudeRequest{}
	err = common.UnmarshalBodyReusable(c, textRequest)
	if err != nil {
		return nil, err
	}
	if textRequest.Messages == nil || len(textRequest.Messages) == 0 {
		return nil, errors.New("field messages is required")
	}
	if textRequest.Model == "" {
		return nil, errors.New("field model is required")
	}

	//if textRequest.Stream {
	//	relayInfo.IsStream = true
	//}

	return textRequest, nil
}

func GetAndValidateTextRequest(c *gin.Context, relayMode int) (*dto.GeneralOpenAIRequest, error) {
	textRequest := &dto.GeneralOpenAIRequest{}
	err := common.UnmarshalBodyReusable(c, textRequest)
	if err != nil {
		return nil, err
	}
	if err := applyResponsesCompatForChatCompletions(c, relayMode, textRequest); err != nil {
		return nil, err
	}

	if relayMode == relayconstant.RelayModeModerations && textRequest.Model == "" {
		textRequest.Model = "text-moderation-latest"
	}
	if relayMode == relayconstant.RelayModeEmbeddings && textRequest.Model == "" {
		textRequest.Model = c.Param("model")
	}

	if lo.FromPtrOr(textRequest.MaxTokens, uint(0)) > math.MaxInt32/2 {
		return nil, errors.New("max_tokens is invalid")
	}
	if textRequest.Model == "" {
		return nil, errors.New("model is required")
	}
	if textRequest.WebSearchOptions != nil {
		if textRequest.WebSearchOptions.SearchContextSize != "" {
			validSizes := map[string]bool{
				"high":   true,
				"medium": true,
				"low":    true,
			}
			if !validSizes[textRequest.WebSearchOptions.SearchContextSize] {
				return nil, errors.New("invalid search_context_size, must be one of: high, medium, low")
			}
		} else {
			textRequest.WebSearchOptions.SearchContextSize = "medium"
		}
	}
	switch relayMode {
	case relayconstant.RelayModeCompletions:
		if textRequest.Prompt == "" {
			return nil, errors.New("field prompt is required")
		}
	case relayconstant.RelayModeChatCompletions:
		// For FIM (Fill-in-the-middle) requests with prefix/suffix, messages is optional
		// It will be filled by provider-specific adaptors if needed (e.g., SiliconFlow)。Or it is allowed by model vendor(s) (e.g., DeepSeek)
		if len(textRequest.Messages) == 0 && textRequest.Prefix == nil && textRequest.Suffix == nil {
			return nil, errors.New("field messages is required")
		}
	case relayconstant.RelayModeEmbeddings:
	case relayconstant.RelayModeModerations:
		if textRequest.Input == nil || textRequest.Input == "" {
			return nil, errors.New("field input is required")
		}
	case relayconstant.RelayModeEdits:
		if textRequest.Instruction == "" {
			return nil, errors.New("field instruction is required")
		}
	}
	return textRequest, nil
}

func applyResponsesCompatForChatCompletions(c *gin.Context, relayMode int, textRequest *dto.GeneralOpenAIRequest) error {
	if relayMode != relayconstant.RelayModeChatCompletions || textRequest == nil {
		return nil
	}
	if len(textRequest.Messages) > 0 || textRequest.Prefix != nil || textRequest.Suffix != nil {
		return nil
	}

	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return err
	}
	requestBody, err := storage.Bytes()
	if err != nil {
		return err
	}
	if len(strings.TrimSpace(string(requestBody))) == 0 {
		return nil
	}

	responsesRequest := &dto.OpenAIResponsesRequest{}
	if err := common.Unmarshal(requestBody, responsesRequest); err != nil {
		return nil
	}
	if responsesRequest.Input == nil && len(responsesRequest.Instructions) == 0 {
		return nil
	}

	converted, err := convertResponsesCompatToChatCompletionsRequest(responsesRequest)
	if err != nil {
		return err
	}
	*textRequest = *converted
	return nil
}

func convertResponsesCompatToChatCompletionsRequest(request *dto.OpenAIResponsesRequest) (*dto.GeneralOpenAIRequest, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}

	reasoningEffort := ""
	if request.Reasoning != nil {
		reasoningEffort = strings.TrimSpace(request.Reasoning.Effort)
	}
	promptCacheKey := ""
	if len(request.PromptCacheKey) > 0 {
		if text, err := responsesCompatJSONString(request.PromptCacheKey); err == nil {
			promptCacheKey = text
		}
	}
	var serviceTier json.RawMessage
	if request.ServiceTier != "" {
		serviceTier, _ = common.Marshal(request.ServiceTier)
	}

	chatRequest := &dto.GeneralOpenAIRequest{
		Model:                request.Model,
		Stream:               request.Stream,
		StreamOptions:        request.StreamOptions,
		MaxTokens:            request.MaxOutputTokens,
		ReasoningEffort:      reasoningEffort,
		Temperature:          request.Temperature,
		TopP:                 request.TopP,
		User:                 request.User,
		Store:                request.Store,
		Metadata:             request.Metadata,
		PromptCacheKey:       promptCacheKey,
		PromptCacheRetention: request.PromptCacheRetention,
		SafetyIdentifier:     request.SafetyIdentifier,
		ServiceTier:          serviceTier,
	}
	if len(request.ParallelToolCalls) > 0 {
		var parallelToolCalls bool
		if err := common.Unmarshal(request.ParallelToolCalls, &parallelToolCalls); err == nil {
			chatRequest.ParallelTooCalls = common.GetPointer(parallelToolCalls)
		}
	}
	if len(request.ToolChoice) > 0 {
		toolChoice, err := convertResponsesCompatToolChoice(request.ToolChoice)
		if err != nil {
			return nil, err
		}
		chatRequest.ToolChoice = toolChoice
	}
	if len(request.Tools) > 0 {
		tools, err := convertResponsesCompatTools(request.Tools)
		if err != nil {
			return nil, err
		}
		chatRequest.Tools = tools
	}

	messages := make([]dto.Message, 0)
	if len(request.Instructions) > 0 {
		instructionText, err := responsesCompatJSONString(request.Instructions)
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(instructionText) != "" {
			messages = append(messages, dto.Message{
				Role:    chatRequest.GetSystemRoleName(),
				Content: instructionText,
			})
		}
	}

	inputMessages, err := convertResponsesCompatInputToMessages(request.Input, chatRequest.GetSystemRoleName())
	if err != nil {
		return nil, err
	}
	messages = append(messages, inputMessages...)
	chatRequest.Messages = messages
	return chatRequest, nil
}

func convertResponsesCompatToolChoice(raw json.RawMessage) (any, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	jsonType := common.GetJsonType(raw)
	if jsonType == "string" {
		var toolChoice string
		if err := common.Unmarshal(raw, &toolChoice); err != nil {
			return nil, err
		}
		return toolChoice, nil
	}

	var toolChoice map[string]any
	if err := common.Unmarshal(raw, &toolChoice); err != nil {
		return nil, err
	}
	if common.Interface2String(toolChoice["type"]) != "function" {
		return toolChoice, nil
	}
	name := common.Interface2String(toolChoice["name"])
	if name == "" {
		return toolChoice, nil
	}
	return map[string]any{
		"type": "function",
		"function": map[string]any{
			"name": name,
		},
	}, nil
}

func convertResponsesCompatTools(raw json.RawMessage) ([]dto.ToolCallRequest, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var toolsMap []map[string]any
	if err := common.Unmarshal(raw, &toolsMap); err != nil {
		return nil, err
	}
	tools := make([]dto.ToolCallRequest, 0, len(toolsMap))
	for _, toolMap := range toolsMap {
		toolType := strings.TrimSpace(common.Interface2String(toolMap["type"]))
		if toolType != "" && toolType != "function" {
			continue
		}
		name := strings.TrimSpace(common.Interface2String(toolMap["name"]))
		if name == "" {
			continue
		}
		tools = append(tools, dto.ToolCallRequest{
			Type: "function",
			Function: dto.FunctionRequest{
				Name:        name,
				Description: common.Interface2String(toolMap["description"]),
				Parameters:  toolMap["parameters"],
			},
		})
	}
	return tools, nil
}

func convertResponsesCompatInputToMessages(raw json.RawMessage, systemRole string) ([]dto.Message, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	jsonType := common.GetJsonType(raw)
	if jsonType == "string" {
		text, err := responsesCompatJSONString(raw)
		if err != nil {
			return nil, err
		}
		return []dto.Message{{Role: "user", Content: text}}, nil
	}
	if jsonType != "array" {
		return nil, nil
	}

	var items []map[string]any
	if err := common.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	messages := make([]dto.Message, 0, len(items))
	for _, item := range items {
		itemType := strings.TrimSpace(common.Interface2String(item["type"]))
		if itemType == "" && strings.TrimSpace(common.Interface2String(item["role"])) != "" {
			itemType = "message"
		}

		switch itemType {
		case "message", "":
			message, ok, err := convertResponsesCompatMessage(item, systemRole)
			if err != nil {
				return nil, err
			}
			if ok {
				messages = append(messages, message)
			}
		case "function_call":
			message, ok := convertResponsesCompatFunctionCall(item)
			if ok {
				messages = append(messages, message)
			}
		case "function_call_output":
			message, ok, err := convertResponsesCompatFunctionCallOutput(item)
			if err != nil {
				return nil, err
			}
			if ok {
				messages = append(messages, message)
			}
		}
	}
	return messages, nil
}

func convertResponsesCompatMessage(item map[string]any, systemRole string) (dto.Message, bool, error) {
	role := strings.TrimSpace(common.Interface2String(item["role"]))
	if role == "" {
		role = "user"
	}
	if role == "developer" || role == "system" {
		role = systemRole
	}

	message := dto.Message{Role: role}
	content, ok := item["content"]
	if !ok || content == nil {
		message.Content = ""
		return message, true, nil
	}
	if contentStr, ok := content.(string); ok {
		message.Content = contentStr
		return message, true, nil
	}

	contentList, ok := content.([]any)
	if !ok {
		return dto.Message{}, false, nil
	}
	parts := make([]dto.MediaContent, 0, len(contentList))
	for _, contentItem := range contentList {
		partMap, ok := contentItem.(map[string]any)
		if !ok {
			continue
		}
		partType := strings.TrimSpace(common.Interface2String(partMap["type"]))
		if partType == "" {
			partType = "input_text"
		}
		switch partType {
		case "input_text", "output_text":
			parts = append(parts, dto.MediaContent{Type: dto.ContentTypeText, Text: common.Interface2String(partMap["text"])})
		case "input_image":
			imageURL := partMap["image_url"]
			if imageURL == nil {
				continue
			}
			parts = append(parts, dto.MediaContent{Type: dto.ContentTypeImageURL, ImageUrl: imageURL})
		}
	}
	if len(parts) == 0 {
		return dto.Message{}, false, nil
	}
	message.SetMediaContent(parts)
	return message, true, nil
}

func convertResponsesCompatFunctionCall(item map[string]any) (dto.Message, bool) {
	callID := strings.TrimSpace(common.Interface2String(item["call_id"]))
	name := strings.TrimSpace(common.Interface2String(item["name"]))
	if callID == "" || name == "" {
		return dto.Message{}, false
	}
	arguments := common.Interface2String(item["arguments"])
	message := dto.Message{
		Role:    "assistant",
		Content: "",
	}
	message.SetToolCalls([]dto.ToolCallRequest{{
		ID:   callID,
		Type: "function",
		Function: dto.FunctionRequest{
			Name:      name,
			Arguments: arguments,
		},
	}})
	return message, true
}

func convertResponsesCompatFunctionCallOutput(item map[string]any) (dto.Message, bool, error) {
	callID := strings.TrimSpace(common.Interface2String(item["call_id"]))
	if callID == "" {
		return dto.Message{}, false, nil
	}
	output := item["output"]
	if output == nil {
		output = ""
	}
	content, err := responsesCompatAnyToString(output)
	if err != nil {
		return dto.Message{}, false, err
	}
	return dto.Message{
		Role:       "tool",
		ToolCallId: callID,
		Content:    content,
	}, true, nil
}

func responsesCompatJSONString(raw json.RawMessage) (string, error) {
	var text string
	if err := common.Unmarshal(raw, &text); err != nil {
		return "", err
	}
	return text, nil
}

func responsesCompatAnyToString(value any) (string, error) {
	if value == nil {
		return "", nil
	}
	if text, ok := value.(string); ok {
		return text, nil
	}
	data, err := common.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func GetAndValidateGeminiRequest(c *gin.Context) (*dto.GeminiChatRequest, error) {
	request := &dto.GeminiChatRequest{}
	err := common.UnmarshalBodyReusable(c, request)
	if err != nil {
		return nil, err
	}
	if len(request.Contents) == 0 && len(request.Requests) == 0 {
		return nil, errors.New("contents is required")
	}

	//if c.Query("alt") == "sse" {
	//	relayInfo.IsStream = true
	//}

	return request, nil
}

func GetAndValidateGeminiEmbeddingRequest(c *gin.Context) (*dto.GeminiEmbeddingRequest, error) {
	request := &dto.GeminiEmbeddingRequest{}
	err := common.UnmarshalBodyReusable(c, request)
	if err != nil {
		return nil, err
	}
	return request, nil
}

func GetAndValidateGeminiBatchEmbeddingRequest(c *gin.Context) (*dto.GeminiBatchEmbeddingRequest, error) {
	request := &dto.GeminiBatchEmbeddingRequest{}
	err := common.UnmarshalBodyReusable(c, request)
	if err != nil {
		return nil, err
	}
	return request, nil
}
