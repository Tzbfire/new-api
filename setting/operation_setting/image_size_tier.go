package operation_setting

import (
	"strconv"
	"strings"
)

// 图片分辨率档位常量
const (
	ImageSizeTier1K = "1K"
	ImageSizeTier2K = "2K"
	ImageSizeTier4K = "4K"
)

// 已知 size 字符串 → 档位 白名单
// 设计原则：尽量与 sub2api / OpenAI 官方常用尺寸对齐，
// 未命中的尺寸会走「最大边 + 面积」兜底（见 ClassifyImageSizeTier）。
var imageSizeTierWhitelist = map[string]string{
	// 1K（最大边 ≤ 1792）
	"1024x1024": ImageSizeTier1K,
	"1024x1536": ImageSizeTier1K,
	"1536x1024": ImageSizeTier1K,
	"1024x1792": ImageSizeTier1K,
	"1792x1024": ImageSizeTier1K,
	// gptweb 实际产出的常见非标准尺寸
	"1254x1254": ImageSizeTier1K,
	"1023x1537": ImageSizeTier1K,

	// 2K（最大边 1793 ~ 2560）
	"1920x1920": ImageSizeTier2K,
	"2048x2048": ImageSizeTier2K,
	"2048x1152": ImageSizeTier2K,
	"1152x2048": ImageSizeTier2K,
	"2368x1576": ImageSizeTier2K,
	"1576x2368": ImageSizeTier2K,
	"2400x1600": ImageSizeTier2K,
	"1600x2400": ImageSizeTier2K,
	"2560x1440": ImageSizeTier2K,
	"1440x2560": ImageSizeTier2K,

	// 4K（最大边 2561 ~ 3840；总像素 ≤ 8.3MP ≈ 3840×2160）
	"2880x2880": ImageSizeTier4K,
	"3552x2368": ImageSizeTier4K,
	"2368x3552": ImageSizeTier4K,
	"3840x2160": ImageSizeTier4K,
	"2160x3840": ImageSizeTier4K,
}

// 档位最大边阈值（含端点），与白名单上界对齐。
// 1K 上界 1792 取自 OpenAI dall-e-3 的 1792x1024；2K 上界 2560 与 sub2api 一致。
const (
	imageSize1KMaxEdge = 1792
	imageSize2KMaxEdge = 2560
)

// ClassifyImageSizeTier 把任意 size 字符串归一为 1K / 2K / 4K 档位。
// 规则：
//  1. 空 / "auto" → 默认 1K（贴合 OpenAI 默认 1024x1024，且利于路由到 1K 渠道）
//  2. 命中 imageSizeTierWhitelist → 直接返回
//  3. 解析 "WxH" 字符串：以最大边为主信号
//     - max(w,h) ≤ 1792 → 1K
//     - max(w,h) ≤ 2560 → 2K
//     - 否则 → 4K
//  4. 完全无法解析 → 默认 1K
func ClassifyImageSizeTier(size string) string {
	trimmed := strings.TrimSpace(size)
	lower := strings.ToLower(trimmed)
	if lower == "" || lower == "auto" {
		return ImageSizeTier1K
	}
	if tier, ok := imageSizeTierWhitelist[lower]; ok {
		return tier
	}
	w, h, ok := parseImageSizeDimensions(lower)
	if !ok {
		return ImageSizeTier1K
	}
	maxEdge := w
	if h > maxEdge {
		maxEdge = h
	}
	switch {
	case maxEdge <= imageSize1KMaxEdge:
		return ImageSizeTier1K
	case maxEdge <= imageSize2KMaxEdge:
		return ImageSizeTier2K
	default:
		return ImageSizeTier4K
	}
}

func parseImageSizeDimensions(size string) (int, int, bool) {
	parts := strings.Split(size, "x")
	if len(parts) != 2 {
		return 0, 0, false
	}
	w, err := strconv.Atoi(strings.TrimSpace(parts[0]))
	if err != nil || w <= 0 {
		return 0, 0, false
	}
	h, err := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err != nil || h <= 0 {
		return 0, 0, false
	}
	return w, h, true
}
