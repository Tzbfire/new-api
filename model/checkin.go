package model

import (
	"math/rand"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
)

// Checkin 签到记录
type Checkin struct {
	Id           int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId       int    `json:"user_id" gorm:"not null;uniqueIndex:idx_user_checkin_date"`
	CheckinDate  string `json:"checkin_date" gorm:"type:varchar(10);not null;uniqueIndex:idx_user_checkin_date"` // 格式: YYYY-MM-DD
	QuotaAwarded int    `json:"quota_awarded" gorm:"not null"`
	CreatedAt    int64  `json:"created_at" gorm:"bigint"`
}

// CheckinRecord 用于API返回的签到记录（不包含敏感字段）
type CheckinRecord struct {
	CheckinDate  string `json:"checkin_date"`
	QuotaAwarded int    `json:"quota_awarded"`
}

func (Checkin) TableName() string {
	return "checkins"
}

// GetUserCheckinRecords 获取用户在指定日期范围内的签到记录
func GetUserCheckinRecords(userId int, startDate, endDate string) ([]Checkin, error) {
	var records []Checkin
	err := DB.Where("user_id = ? AND checkin_date >= ? AND checkin_date <= ?",
		userId, startDate, endDate).
		Order("checkin_date DESC").
		Find(&records).Error
	return records, err
}

// HasCheckedInToday 检查用户今天是否已签到
func HasCheckedInToday(userId int) (bool, error) {
	return hasCheckedInOn(userId, time.Now().Format("2006-01-02"))
}

func hasCheckedInOn(userId int, date string) (bool, error) {
	var count int64
	err := DB.Model(&Checkin{}).
		Where("user_id = ? AND checkin_date = ?", userId, date).
		Count(&count).Error
	return count > 0, err
}

// UserCheckin 执行用户签到
// 所有主数据库都在同一事务内写入签到记录和钱包额度。
func UserCheckin(userId int) (*Checkin, error) {
	setting := *operation_setting.GetCheckinSetting()
	if !setting.Enabled {
		return nil, common.NewMessage("Check-in feature is not enabled")
	}
	if setting.MinQuota < 0 || setting.MaxQuota < setting.MinQuota || common.ValidateWalletQuota(setting.MaxQuota) != nil {
		common.SysError("invalid check-in reward quota range")
		return nil, common.NewMessage("Check-in failed, please try again later")
	}

	// 检查今天是否已签到
	now := time.Now()
	today := now.Format("2006-01-02")
	hasChecked, err := hasCheckedInOn(userId, today)
	if err != nil {
		return nil, err
	}
	if hasChecked {
		return nil, common.NewMessage("Already checked in today")
	}

	// 计算随机额度奖励
	quotaAwarded := setting.MinQuota
	if setting.MaxQuota > setting.MinQuota {
		quotaAwarded = setting.MinQuota + rand.Intn(setting.MaxQuota-setting.MinQuota+1)
	}

	checkin := &Checkin{
		UserId:       userId,
		CheckinDate:  today,
		QuotaAwarded: quotaAwarded,
		CreatedAt:    now.Unix(),
	}

	err = DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id", "quota").First(&user, userId).Error; err != nil {
			return common.NewMessage("Check-in failed: quota update error")
		}
		if user.Quota > common.MaxWalletQuota-quotaAwarded {
			return ErrWalletQuotaLimitExceeded
		}
		// 步骤1: 创建签到记录
		// 数据库有唯一约束 (user_id, checkin_date)，可以防止并发重复签到
		if err := tx.Create(checkin).Error; err != nil {
			return common.NewMessage("Check-in failed, please try again later")
		}

		// 步骤2: 在事务中增加用户额度
		if IsQuotaBucketBillingEnabled() {
			if err := creditUserQuotaBucketTx(tx, userId, quotaAwarded, QuotaBucketSourceCheckin, checkin.CheckinDate, QuotaBucketBillingGroupDefault, true); err != nil {
				return common.NewMessage("Check-in failed: quota update error")
			}
		} else if quotaAwarded > 0 {
			// Zero rewards must still create the daily record on MySQL.
			result := tx.Model(&User{}).Where("id = ? AND quota <= ?", userId, common.MaxWalletQuota-quotaAwarded).
				Update("quota", gorm.Expr("quota + ?", quotaAwarded))
			if result.Error != nil || result.RowsAffected != 1 {
				return common.NewMessage("Check-in failed: quota update error")
			}
		}

		return nil
	})

	if err != nil {
		// A concurrent request may have committed the unique daily record while
		// this request waited for the wallet lock. Return the same useful result
		// as a sequential duplicate without issuing another reward.
		if checked, checkErr := hasCheckedInOn(userId, today); checkErr == nil && checked {
			return nil, common.NewMessage("Already checked in today")
		}
		return nil, err
	}

	// 与充值、兑换使用相同的提交后缓存同步，余额立即可用于后续请求。
	syncCreditUserQuotaCache(userId, quotaAwarded, "check-in")

	return checkin, nil
}

// GetUserCheckinStats 获取用户签到统计信息
func GetUserCheckinStats(userId int, month string, now time.Time) (map[string]any, error) {
	// 获取指定月份的所有签到记录
	startDate := month + "-01"
	endDate := month + "-31"

	records, err := GetUserCheckinRecords(userId, startDate, endDate)
	if err != nil {
		return nil, err
	}

	// 转换为不包含敏感字段的记录
	checkinRecords := make([]CheckinRecord, len(records))
	for i, r := range records {
		checkinRecords[i] = CheckinRecord{
			CheckinDate:  r.CheckinDate,
			QuotaAwarded: r.QuotaAwarded,
		}
	}

	// 检查今天是否已签到
	hasCheckedToday, err := hasCheckedInOn(userId, now.Format("2006-01-02"))
	if err != nil {
		return nil, err
	}

	// 获取用户所有时间的签到统计
	var totalCheckins int64
	var totalQuota int64
	if err := DB.Model(&Checkin{}).Where("user_id = ?", userId).Count(&totalCheckins).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&Checkin{}).Where("user_id = ?", userId).Select("COALESCE(SUM(quota_awarded), 0)").Scan(&totalQuota).Error; err != nil {
		return nil, err
	}

	return map[string]any{
		"total_quota":      totalQuota,      // 所有时间累计获得的额度
		"total_checkins":   totalCheckins,   // 所有时间累计签到次数
		"checkin_count":    len(records),    // 本月签到次数
		"checked_in_today": hasCheckedToday, // 今天是否已签到
		"records":          checkinRecords,  // 本月签到记录详情（不含id和user_id）
	}, nil
}
