package controller

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const (
	imageStudioMaxPromptPresets = 12
	imageStudioMaxPresetID      = 64
	imageStudioMaxPresetTitle   = 60
	imageStudioMaxPresetPrompt  = 4000
	imageStudioMaxSizePresets   = 64
	imageStudioMaxSizeEdge      = 8192
	imageStudioMaxSizePixels    = 32 * 1024 * 1024
)

type imageStudioPromptPreset struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Prompt      string `json:"prompt"`
	AspectRatio string `json:"aspect_ratio,omitempty"`
	Tier        string `json:"tier,omitempty"`
}

type imageStudioSizePreset struct {
	ID           string `json:"id"`
	GroupPattern string `json:"group_pattern"`
	ModelPattern string `json:"model_pattern"`
	AspectRatio  string `json:"aspect_ratio"`
	Tier         string `json:"tier"`
	TierLabel    string `json:"tier_label"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	Enabled      bool   `json:"enabled"`
	Experimental bool   `json:"experimental"`
}

func parseImageStudioPromptPresets(raw string) ([]imageStudioPromptPreset, error) {
	if strings.TrimSpace(raw) == "" {
		raw = "[]"
	}
	var presets []imageStudioPromptPreset
	if err := common.UnmarshalJsonStr(raw, &presets); err != nil {
		return nil, fmt.Errorf("AI 画室提示词预设必须是有效的 JSON 数组")
	}
	if len(presets) > imageStudioMaxPromptPresets {
		return nil, fmt.Errorf("AI 画室提示词预设不能超过 %d 条", imageStudioMaxPromptPresets)
	}
	seen := make(map[string]struct{}, len(presets))
	for index := range presets {
		presets[index].ID = strings.TrimSpace(presets[index].ID)
		presets[index].Title = strings.TrimSpace(presets[index].Title)
		presets[index].Prompt = strings.TrimSpace(presets[index].Prompt)
		presets[index].AspectRatio = strings.TrimSpace(presets[index].AspectRatio)
		presets[index].Tier = strings.TrimSpace(presets[index].Tier)
		if presets[index].ID == "" || len([]rune(presets[index].ID)) > imageStudioMaxPresetID {
			return nil, fmt.Errorf("第 %d 条提示词预设的 ID 无效", index+1)
		}
		if _, exists := seen[presets[index].ID]; exists {
			return nil, fmt.Errorf("提示词预设 ID %s 重复", presets[index].ID)
		}
		seen[presets[index].ID] = struct{}{}
		if presets[index].Title == "" || len([]rune(presets[index].Title)) > imageStudioMaxPresetTitle {
			return nil, fmt.Errorf("第 %d 条提示词预设标题必须为 1-%d 个字符", index+1, imageStudioMaxPresetTitle)
		}
		if presets[index].Prompt == "" || len([]rune(presets[index].Prompt)) > imageStudioMaxPresetPrompt {
			return nil, fmt.Errorf("第 %d 条提示词必须为 1-%d 个字符", index+1, imageStudioMaxPresetPrompt)
		}
		if len([]rune(presets[index].AspectRatio)) > 32 || len([]rune(presets[index].Tier)) > 32 {
			return nil, fmt.Errorf("第 %d 条提示词预设的推荐比例或清晰度无效", index+1)
		}
	}
	return presets, nil
}

func parseImageStudioSizePresets(raw string) ([]imageStudioSizePreset, error) {
	if strings.TrimSpace(raw) == "" {
		raw = "[]"
	}
	var presets []imageStudioSizePreset
	if err := common.UnmarshalJsonStr(raw, &presets); err != nil {
		return nil, fmt.Errorf("AI 画室尺寸方案必须是有效的 JSON 数组")
	}
	if len(presets) > imageStudioMaxSizePresets {
		return nil, fmt.Errorf("AI 画室尺寸方案不能超过 %d 条", imageStudioMaxSizePresets)
	}
	seen := make(map[string]struct{}, len(presets))
	combinations := make(map[string]struct{}, len(presets))
	for index := range presets {
		preset := &presets[index]
		preset.ID = strings.TrimSpace(preset.ID)
		preset.GroupPattern = strings.TrimSpace(preset.GroupPattern)
		if preset.GroupPattern == "" {
			preset.GroupPattern = "*"
		}
		preset.ModelPattern = strings.TrimSpace(preset.ModelPattern)
		preset.AspectRatio = strings.TrimSpace(preset.AspectRatio)
		preset.Tier = strings.TrimSpace(preset.Tier)
		preset.TierLabel = strings.TrimSpace(preset.TierLabel)
		if preset.ID == "" || len([]rune(preset.ID)) > imageStudioMaxPresetID {
			return nil, fmt.Errorf("第 %d 条尺寸方案的 ID 无效", index+1)
		}
		if _, exists := seen[preset.ID]; exists {
			return nil, fmt.Errorf("尺寸方案 ID %s 重复", preset.ID)
		}
		seen[preset.ID] = struct{}{}
		if len([]rune(preset.GroupPattern)) > 128 || strings.Count(preset.GroupPattern, "*") > 1 {
			return nil, fmt.Errorf("第 %d 条尺寸方案的分组匹配规则无效", index+1)
		}
		if preset.ModelPattern == "" || len([]rune(preset.ModelPattern)) > 128 || strings.Count(preset.ModelPattern, "*") > 1 {
			return nil, fmt.Errorf("第 %d 条尺寸方案的模型匹配规则无效", index+1)
		}
		if preset.AspectRatio == "" || len([]rune(preset.AspectRatio)) > 32 || preset.Tier == "" || len([]rune(preset.Tier)) > 32 || preset.TierLabel == "" || len([]rune(preset.TierLabel)) > 32 {
			return nil, fmt.Errorf("第 %d 条尺寸方案的比例或清晰度无效", index+1)
		}
		combination := strings.ToLower(preset.GroupPattern) + "\x00" + strings.ToLower(preset.ModelPattern) + "\x00" + preset.AspectRatio + "\x00" + preset.Tier
		if _, exists := combinations[combination]; exists {
			return nil, fmt.Errorf("第 %d 条尺寸方案的分组、模型、比例和清晰度组合重复", index+1)
		}
		combinations[combination] = struct{}{}
		if preset.Width < 64 || preset.Width > imageStudioMaxSizeEdge || preset.Height < 64 || preset.Height > imageStudioMaxSizeEdge || int64(preset.Width)*int64(preset.Height) > imageStudioMaxSizePixels {
			return nil, fmt.Errorf("第 %d 条尺寸方案超出安全尺寸范围", index+1)
		}
	}
	return presets, nil
}

func getImageStudioSizePresets() ([]imageStudioSizePreset, error) {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap["ImageStudioSizePresets"]
	common.OptionMapRWMutex.RUnlock()
	if strings.TrimSpace(raw) == "" {
		raw = constant.ImageStudioDefaultSizePresets
	}
	presets, err := parseImageStudioSizePresets(raw)
	if err == nil {
		return presets, nil
	}
	return parseImageStudioSizePresets(constant.ImageStudioDefaultSizePresets)
}

func GetImageStudioConfig(c *gin.Context) {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap["ImageStudioPromptPresets"]
	common.OptionMapRWMutex.RUnlock()
	presets, err := parseImageStudioPromptPresets(raw)
	if err != nil {
		logger.LogError(c.Request.Context(), "invalid ImageStudioPromptPresets option: "+err.Error())
		presets, err = parseImageStudioPromptPresets(constant.ImageStudioDefaultPromptPresets)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "AI Studio prompt presets are unavailable"})
			return
		}
	}
	sizePresets, err := getImageStudioSizePresets()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "AI Studio size presets are unavailable"})
		return
	}
	enabledSizePresets := make([]imageStudioSizePreset, 0, len(sizePresets))
	for _, preset := range sizePresets {
		if preset.Enabled {
			enabledSizePresets = append(enabledSizePresets, preset)
		}
	}
	common.ApiSuccess(c, gin.H{
		"prompt_presets": presets,
		"size_presets":   enabledSizePresets,
		"retention_days": service.ImageStudioRetentionDays(),
	})
}
