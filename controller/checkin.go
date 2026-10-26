package controller

import (
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

// GetCheckinStatus 获取用户签到状态和历史记录
func GetCheckinStatus(c *gin.Context) {
	setting := operation_setting.GetCheckinSetting()
	if !setting.Enabled {
		common.ApiErrorT(c, "Check-in feature is not enabled")
		return
	}
	userId := c.GetInt("id")
	// 获取月份参数，默认为当前月份
	now := time.Now()
	month := c.DefaultQuery("month", now.Format("2006-01"))
	if _, err := time.Parse("2006-01", month); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}

	stats, err := model.GetUserCheckinStats(userId, month, now)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	data := checkinDayMetadata(now)
	data["enabled"] = setting.Enabled
	data["min_quota"] = setting.MinQuota
	data["max_quota"] = setting.MaxQuota
	data["stats"] = stats
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

// DoCheckin 执行用户签到
func DoCheckin(c *gin.Context) {
	setting := operation_setting.GetCheckinSetting()
	if !setting.Enabled {
		common.ApiErrorT(c, "Check-in feature is not enabled")
		return
	}

	userId := c.GetInt("id")

	checkin, err := model.UserCheckin(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.RecordLog(userId, model.LogTypeSystem, common.NewMessage("Daily check-in, received {{quota}}", map[string]any{"quota": logger.FormatQuota(checkin.QuotaAwarded)}))
	data := checkinDayMetadata(time.Unix(checkin.CreatedAt, 0).In(time.Local))
	data["quota_awarded"] = checkin.QuotaAwarded
	data["checkin_date"] = checkin.CheckinDate
	common.ApiSuccessT(c, "Check-in successful", data)
}

// checkinDayMetadata keeps the displayed day and refresh deadline on the same
// server calendar used to issue rewards. The UTC offset is display text, not
// an IANA timezone identifier; time.Local may otherwise be named only "Local".
func checkinDayMetadata(now time.Time) gin.H {
	return gin.H{
		"today":         now.Format("2006-01-02"),
		"server_time":   now.Unix(),
		"next_reset_at": time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, now.Location()).Unix(),
		"timezone":      now.Format("UTC-07:00"),
	}
}
