package model

import (
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	json "github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/bytedance/gopkg/util/gopool"
	"gorm.io/gorm"
)

const UserNameMaxLength = 20

// User if you add sensitive fields, don't forget to clean them in setupLogin function.
// Otherwise, the sensitive information will be saved on local storage in plain text!
type User struct {
	Id               int            `json:"id"`
	Username         string         `json:"username" gorm:"unique;index" validate:"max=20"`
	Password         string         `json:"password" gorm:"not null;" validate:"min=8,max=20"`
	OriginalPassword string         `json:"original_password" gorm:"-:all"` // this field is only for Password change verification, don't save it to database!
	DisplayName      string         `json:"display_name" gorm:"index" validate:"max=20"`
	Role             int            `json:"role" gorm:"type:int;default:1"`   // admin, common
	Status           int            `json:"status" gorm:"type:int;default:1"` // enabled, disabled
	Email            string         `json:"email" gorm:"index" validate:"max=50"`
	GitHubId         string         `json:"github_id" gorm:"column:github_id;index"`
	DiscordId        string         `json:"discord_id" gorm:"column:discord_id;index"`
	OidcId           string         `json:"oidc_id" gorm:"column:oidc_id;index"`
	WeChatId         string         `json:"wechat_id" gorm:"column:wechat_id;index"`
	TelegramId       string         `json:"telegram_id" gorm:"column:telegram_id;index"`
	VerificationCode string         `json:"verification_code" gorm:"-:all"`                         // this field is only for Email verification, don't save it to database!
	AccessToken      *string        `json:"-" gorm:"type:char(32);column:access_token;uniqueIndex"` // this token is for system management
	Quota            int            `json:"quota" gorm:"type:int;default:0"`
	UsedQuota        int            `json:"used_quota" gorm:"type:int;default:0;column:used_quota"` // used quota
	RequestCount     int            `json:"request_count" gorm:"type:int;default:0;"`               // request number
	CreatedAt        int64          `json:"created_at" gorm:"bigint;default:0;column:created_at"`
	LastLoginAt      int64          `json:"last_login_at" gorm:"bigint;default:0;column:last_login_at"`
	LastRequestAt    int64          `json:"last_request_at" gorm:"bigint;default:0;column:last_request_at"`
	Group            string         `json:"group" gorm:"type:varchar(64);default:'default'"`
	AffCode          string         `json:"aff_code" gorm:"type:varchar(32);column:aff_code;uniqueIndex"`
	AffCount         int            `json:"aff_count" gorm:"type:int;default:0;column:aff_count"`
	AffQuota         int            `json:"aff_quota" gorm:"type:int;default:0;column:aff_quota"`           // 邀请剩余额度
	AffHistoryQuota  int            `json:"aff_history_quota" gorm:"type:int;default:0;column:aff_history"` // 邀请历史额度
	InviterId        int            `json:"inviter_id" gorm:"type:int;column:inviter_id;index"`
	DeletedAt        gorm.DeletedAt `gorm:"index"`
	LinuxDOId        string         `json:"linux_do_id" gorm:"column:linux_do_id;index"`
	YaohuoId         string         `json:"yaohuo_id" gorm:"column:yaohuo_id;index"`
	Setting          string         `json:"setting" gorm:"type:text;column:setting"`
	Remark           string         `json:"remark,omitempty" gorm:"type:varchar(255)" validate:"max=255"`
	StripeCustomer   string         `json:"stripe_customer" gorm:"type:varchar(64);column:stripe_customer;index"`
	HasSubscription  bool           `json:"has_subscription,omitempty" gorm:"-"`
	SubscriptionPlan string         `json:"subscription_plan,omitempty" gorm:"-"`
	HasTwoFA         bool           `json:"has_two_fa,omitempty" gorm:"-"`
	HasPasskey       bool           `json:"has_passkey,omitempty" gorm:"-"`
	BindingCount     int            `json:"binding_count,omitempty" gorm:"-"`
	IsRecentlyActive bool           `json:"is_recently_active,omitempty" gorm:"-"`
}

func (user *User) ToBaseUser() *UserBase {
	cache := &UserBase{
		Id:       user.Id,
		Group:    user.Group,
		Quota:    user.Quota,
		Status:   user.Status,
		Username: user.Username,
		Setting:  user.Setting,
		Email:    user.Email,
		YaohuoId: user.YaohuoId,
	}
	return cache
}

func (user *User) GetAccessToken() string {
	if user.AccessToken == nil {
		return ""
	}
	return *user.AccessToken
}

func (user *User) SetAccessToken(token string) {
	user.AccessToken = &token
}

func (user *User) GetSetting() dto.UserSetting {
	setting := dto.UserSetting{}
	if user.Setting != "" {
		err := json.Unmarshal([]byte(user.Setting), &setting)
		if err != nil {
			common.SysLog("failed to unmarshal setting: " + err.Error())
		}
	}
	return setting
}

func (user *User) SetSetting(setting dto.UserSetting) {
	settingBytes, err := json.Marshal(setting)
	if err != nil {
		common.SysLog("failed to marshal setting: " + err.Error())
		return
	}
	user.Setting = string(settingBytes)
}

// 根据用户角色生成默认的边栏配置
func generateDefaultSidebarConfigForRole(userRole int) string {
	defaultConfig := map[string]interface{}{}

	// 聊天区域 - 所有用户都可以访问
	defaultConfig["chat"] = map[string]interface{}{
		"enabled":    true,
		"playground": true,
		"chat":       true,
	}

	// 控制台区域 - 所有用户都可以访问
	defaultConfig["console"] = map[string]interface{}{
		"enabled":    true,
		"detail":     true,
		"token":      true,
		"log":        true,
		"midjourney": true,
		"task":       true,
	}

	// 个人中心区域 - 所有用户都可以访问
	defaultConfig["personal"] = map[string]interface{}{
		"enabled":  true,
		"topup":    true,
		"personal": true,
	}

	// 管理员区域 - 根据角色决定
	if userRole == common.RoleAdminUser {
		// 管理员可以访问管理员区域，但不能访问系统设置
		defaultConfig["admin"] = map[string]interface{}{
			"enabled":    true,
			"channel":    true,
			"models":     true,
			"redemption": true,
			"user":       true,
			"setting":    false, // 管理员不能访问系统设置
		}
	} else if userRole == common.RoleRootUser {
		// 超级管理员可以访问所有功能
		defaultConfig["admin"] = map[string]interface{}{
			"enabled":    true,
			"channel":    true,
			"models":     true,
			"redemption": true,
			"user":       true,
			"setting":    true,
		}
	}
	// 普通用户不包含admin区域

	// 转换为JSON字符串
	configBytes, err := json.Marshal(defaultConfig)
	if err != nil {
		common.SysLog("生成默认边栏配置失败: " + err.Error())
		return ""
	}

	return string(configBytes)
}

// CheckUserExistOrDeleted check if user exist or deleted, if not exist, return false, nil, if deleted or exist, return true, nil
func CheckUserExistOrDeleted(username string, email string) (bool, error) {
	var user User

	// err := DB.Unscoped().First(&user, "username = ? or email = ?", username, email).Error
	// check email if empty
	var err error
	if email == "" {
		err = DB.Unscoped().First(&user, "username = ?", username).Error
	} else {
		err = DB.Unscoped().First(&user, "username = ? or email = ?", username, email).Error
	}
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// not exist, return false, nil
			return false, nil
		}
		// other error, return false, err
		return false, err
	}
	// exist, return true, nil
	return true, nil
}

func GetMaxUserId() int {
	var user User
	DB.Unscoped().Last(&user)
	return user.Id
}

type UserSearchFilters struct {
	Keyword          string
	Group            string
	Role             *int
	MinRole          *int
	Status           *int
	HasSubscription  *bool
	ActiveWithinDays *int
	QuotaHealth      string
	IncludeDeleted   bool
	DeletedOnly      bool
}

type UserSummary struct {
	Total               int64 `json:"total"`
	ActiveCount         int64 `json:"active_count"`
	DisabledCount       int64 `json:"disabled_count"`
	DeletedCount        int64 `json:"deleted_count"`
	AdminCount          int64 `json:"admin_count"`
	SubscribedCount     int64 `json:"subscribed_count"`
	RecentlyActiveCount int64 `json:"recently_active_count"`
}

type UserBindingSummaryItem struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Value       string `json:"value"`
	BindingType string `json:"binding_type"`
	ProviderId  *int   `json:"provider_id,omitempty"`
	IsCustom    bool   `json:"is_custom"`
}

type UserReviewSummary struct {
	User               *User                    `json:"user"`
	Subscriptions      []SubscriptionSummary    `json:"subscriptions"`
	Usage              map[string]interface{}   `json:"usage"`
	Security           map[string]interface{}   `json:"security"`
	Bindings           []UserBindingSummaryItem `json:"bindings"`
	AvailableGroups    map[string]string        `json:"available_groups"`
	HasSubscription    bool                     `json:"has_subscription"`
	SubscriptionPlan   string                   `json:"subscription_plan"`
	BillingPreference  string                   `json:"billing_preference"`
	HasTwoFA           bool                     `json:"has_two_fa"`
	HasPasskey         bool                     `json:"has_passkey"`
	BindingCount       int                      `json:"binding_count"`
	IsRecentlyActive   bool                     `json:"is_recently_active"`
	LastActivityAt     int64                    `json:"last_activity_at"`
	RecentlyActiveDays int                      `json:"recently_active_days"`
}

type AdminDashboardOverview struct {
	TotalUsers        int64 `json:"total_users"`
	EnabledUsers      int64 `json:"enabled_users"`
	DisabledUsers     int64 `json:"disabled_users"`
	DeletedUsers      int64 `json:"deleted_users"`
	AdminUsers        int64 `json:"admin_users"`
	TotalQuota        int64 `json:"total_quota"`
	TotalUsedQuota    int64 `json:"total_used_quota"`
	TotalRequestCount int64 `json:"total_request_count"`
	ActiveUsers24h    int64 `json:"active_users_24h"`
	ActiveUsers7d     int64 `json:"active_users_7d"`
	NewUsers24h       int64 `json:"new_users_24h"`
	NewUsers7d        int64 `json:"new_users_7d"`
}

type AdminUserRankingItem struct {
	Id            int    `json:"id"`
	Username      string `json:"username"`
	DisplayName   string `json:"display_name"`
	Group         string `json:"group"`
	RequestCount  int    `json:"request_count"`
	UsedQuota     int    `json:"used_quota"`
	LastRequestAt int64  `json:"last_request_at"`
}

type AdminUserRankings struct {
	ByRequestCount []AdminUserRankingItem `json:"by_request_count"`
	ByUsedQuota    []AdminUserRankingItem `json:"by_used_quota"`
	ByLastRequest  []AdminUserRankingItem `json:"by_last_request"`
}

func GetAllUsers(pageInfo *common.PageInfo) (users []*User, total int64, err error) {
	// Start transaction
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// Get total count within transaction
	err = tx.Unscoped().Model(&User{}).Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// Get paginated users within same transaction
	err = tx.Unscoped().Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Omit("password").Find(&users).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// Commit transaction
	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return users, total, nil
}

func buildUserSearchQuery(tx *gorm.DB, filters UserSearchFilters) *gorm.DB {
	query := tx.Model(&User{})
	if filters.DeletedOnly {
		query = query.Unscoped().Where("deleted_at IS NOT NULL")
	} else if filters.IncludeDeleted {
		query = query.Unscoped()
	} else {
		query = query.Where("deleted_at IS NULL")
	}
	if filters.Keyword != "" {
		likeCondition := "username LIKE ? OR email LIKE ? OR display_name LIKE ?"
		if keywordInt, err := strconv.Atoi(filters.Keyword); err == nil {
			likeCondition = "id = ? OR " + likeCondition
			query = query.Where(
				likeCondition,
				keywordInt,
				"%"+filters.Keyword+"%",
				"%"+filters.Keyword+"%",
				"%"+filters.Keyword+"%",
			)
		} else {
			query = query.Where(
				likeCondition,
				"%"+filters.Keyword+"%",
				"%"+filters.Keyword+"%",
				"%"+filters.Keyword+"%",
			)
		}
	}
	if filters.Group != "" {
		query = query.Where(commonGroupCol+" = ?", filters.Group)
	}
	if filters.Role != nil {
		query = query.Where("role = ?", *filters.Role)
	}
	if filters.MinRole != nil {
		query = query.Where("role >= ?", *filters.MinRole)
	}
	if filters.Status != nil {
		query = query.Where("status = ?", *filters.Status)
	}
	if filters.HasSubscription != nil {
		now := common.GetTimestamp()
		subQuery := DB.Model(&UserSubscription{}).
			Select("1").
			Where("user_id = users.id AND status = ? AND end_time > ?", "active", now)
		if *filters.HasSubscription {
			query = query.Where("EXISTS (?)", subQuery)
		} else {
			query = query.Where("NOT EXISTS (?)", subQuery)
		}
	}
	if filters.ActiveWithinDays != nil && *filters.ActiveWithinDays > 0 {
		threshold := common.GetTimestamp() - int64(*filters.ActiveWithinDays)*86400
		query = query.Where("last_request_at >= ?", threshold)
	}
	switch filters.QuotaHealth {
	case "exhausted":
		query = query.Where("quota <= 0")
	case "low":
		query = query.Where("quota > 0 AND quota <= ?", 500000)
	case "healthy":
		query = query.Where("quota > ?", 500000)
	}
	return query
}

func enrichUsersForAdmin(users []*User, recentDays int) {
	if len(users) == 0 {
		return
	}
	now := common.GetTimestamp()
	threshold := now - int64(recentDays)*86400
	for _, user := range users {
		if user == nil {
			continue
		}
		user.HasTwoFA = IsTwoFAEnabled(user.Id)
		if _, err := GetPasskeyByUserID(user.Id); err == nil {
			user.HasPasskey = true
		}
		user.BindingCount = countUserBindings(user)
		user.IsRecentlyActive = user.LastRequestAt > 0 && user.LastRequestAt >= threshold
		subs, err := GetAllActiveUserSubscriptions(user.Id)
		if err == nil && len(subs) > 0 {
			user.HasSubscription = true
			if subs[0].Subscription != nil {
				plan, planErr := GetSubscriptionPlanById(subs[0].Subscription.PlanId)
				if planErr == nil && plan != nil {
					user.SubscriptionPlan = plan.Title
				}
			}
		}
	}
}

func countBuiltInBindings(user *User) int {
	if user == nil {
		return 0
	}
	count := 0
	bindings := []string{
		user.Email,
		user.GitHubId,
		user.DiscordId,
		user.OidcId,
		user.WeChatId,
		user.TelegramId,
		user.LinuxDOId,
		user.YaohuoId,
	}
	for _, binding := range bindings {
		if strings.TrimSpace(binding) != "" {
			count++
		}
	}
	return count
}

func countUserBindings(user *User) int {
	if user == nil {
		return 0
	}
	count := countBuiltInBindings(user)
	customCount, err := GetBindingCountByUserId(user.Id)
	if err != nil {
		return count
	}
	return count + int(customCount)
}

func buildUserBindingSummaryItems(user *User) []UserBindingSummaryItem {
	if user == nil {
		return nil
	}
	items := make([]UserBindingSummaryItem, 0, 12)
	appendIfValue := func(key string, label string, value string, bindingType string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		items = append(items, UserBindingSummaryItem{
			Key:         key,
			Label:       label,
			Value:       value,
			BindingType: bindingType,
			IsCustom:    false,
		})
	}
	appendIfValue("email", "邮箱", user.Email, "email")
	appendIfValue("github", "GitHub", user.GitHubId, "github")
	appendIfValue("wechat", "微信", user.WeChatId, "wechat")
	appendIfValue("telegram", "Telegram", user.TelegramId, "telegram")
	appendIfValue("oidc", "OIDC", user.OidcId, "oidc")
	appendIfValue("discord", "Discord", user.DiscordId, "discord")
	appendIfValue("linux_do", "Linux DO", user.LinuxDOId, "linux_do")
	appendIfValue("yaohuo", "妖火", user.YaohuoId, "yaohuo")

	customBindings, err := GetUserOAuthBindingReviewItemsByUserId(user.Id)
	if err == nil {
		for _, binding := range customBindings {
			providerId := binding.ProviderId
			items = append(items, UserBindingSummaryItem{
				Key:         fmt.Sprintf("custom_oauth_%d", binding.ProviderId),
				Label:       fmt.Sprintf("OAuth #%d", binding.ProviderId),
				Value:       binding.ProviderUserId,
				BindingType: "custom_oauth",
				ProviderId:  &providerId,
				IsCustom:    true,
			})
		}
	}
	return items
}

func SearchUsers(filters UserSearchFilters, startIdx int, num int) ([]*User, int64, error) {
	var users []*User
	var total int64

	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	query := buildUserSearchQuery(tx, filters).Session(&gorm.Session{})
	if err := query.Count(&total).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}
	listQuery := buildUserSearchQuery(tx, filters).Session(&gorm.Session{})
	if err := listQuery.Omit("password").Order("id desc").Limit(num).Offset(startIdx).Find(&users).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}
	if err := tx.Commit().Error; err != nil {
		return nil, 0, err
	}
	enrichUsersForAdmin(users, 7)
	return users, total, nil
}

func GetUserSummary(filters UserSearchFilters) (*UserSummary, error) {
	summary := &UserSummary{}
	if err := buildUserSearchQuery(DB, filters).Count(&summary.Total).Error; err != nil {
		return nil, err
	}
	if err := buildUserSearchQuery(DB, filters).Where("status = ?", common.UserStatusEnabled).Count(&summary.ActiveCount).Error; err != nil {
		return nil, err
	}
	if err := buildUserSearchQuery(DB, filters).Where("status = ?", common.UserStatusDisabled).Count(&summary.DisabledCount).Error; err != nil {
		return nil, err
	}
	deletedFilters := filters
	deletedFilters.IncludeDeleted = true
	if err := buildUserSearchQuery(DB, deletedFilters).Where("deleted_at IS NOT NULL").Count(&summary.DeletedCount).Error; err != nil {
		return nil, err
	}
	if err := buildUserSearchQuery(DB, filters).Where("role >= ?", common.RoleAdminUser).Count(&summary.AdminCount).Error; err != nil {
		return nil, err
	}
	if err := buildUserSearchQuery(DB, filters).Where("last_request_at >= ?", common.GetTimestamp()-7*86400).Count(&summary.RecentlyActiveCount).Error; err != nil {
		return nil, err
	}
	subscribedFilters := filters
	subscribedFilters.HasSubscription = boolPtr(true)
	if err := buildUserSearchQuery(DB, subscribedFilters).Count(&summary.SubscribedCount).Error; err != nil {
		return nil, err
	}
	return summary, nil
}

func GetAdminDashboardOverview() (*AdminDashboardOverview, error) {
	now := common.GetTimestamp()
	overview := &AdminDashboardOverview{}
	baseQuery := func() *gorm.DB {
		return DB.Model(&User{}).Where("deleted_at IS NULL")
	}

	if err := baseQuery().Count(&overview.TotalUsers).Error; err != nil {
		return nil, err
	}
	if err := baseQuery().Where("status = ?", common.UserStatusEnabled).Count(&overview.EnabledUsers).Error; err != nil {
		return nil, err
	}
	if err := baseQuery().Where("status = ?", common.UserStatusDisabled).Count(&overview.DisabledUsers).Error; err != nil {
		return nil, err
	}
	if err := DB.Unscoped().Model(&User{}).Where("deleted_at IS NOT NULL").Count(&overview.DeletedUsers).Error; err != nil {
		return nil, err
	}
	if err := baseQuery().Where("role >= ?", common.RoleAdminUser).Count(&overview.AdminUsers).Error; err != nil {
		return nil, err
	}
	if err := baseQuery().Select("COALESCE(SUM(quota), 0)").Scan(&overview.TotalQuota).Error; err != nil {
		return nil, err
	}
	if err := baseQuery().Select("COALESCE(SUM(used_quota), 0)").Scan(&overview.TotalUsedQuota).Error; err != nil {
		return nil, err
	}
	if err := baseQuery().Select("COALESCE(SUM(request_count), 0)").Scan(&overview.TotalRequestCount).Error; err != nil {
		return nil, err
	}
	if err := baseQuery().Where("last_request_at >= ?", now-86400).Count(&overview.ActiveUsers24h).Error; err != nil {
		return nil, err
	}
	if err := baseQuery().Where("last_request_at >= ?", now-7*86400).Count(&overview.ActiveUsers7d).Error; err != nil {
		return nil, err
	}
	if err := baseQuery().Where("created_at >= ?", now-86400).Count(&overview.NewUsers24h).Error; err != nil {
		return nil, err
	}
	if err := baseQuery().Where("created_at >= ?", now-7*86400).Count(&overview.NewUsers7d).Error; err != nil {
		return nil, err
	}
	return overview, nil
}

func getAdminRankingQuery() *gorm.DB {
	return DB.Model(&User{}).
		Select("id, username, display_name, " + commonGroupCol + ", request_count, used_quota, last_request_at").
		Where("deleted_at IS NULL")
}

func GetAdminUserRankings(limit int) (*AdminUserRankings, error) {
	if limit <= 0 {
		limit = 10
	}
	if limit > 20 {
		limit = 20
	}
	result := &AdminUserRankings{}
	if err := getAdminRankingQuery().Where("request_count > 0").Order("request_count DESC, id DESC").Limit(limit).Scan(&result.ByRequestCount).Error; err != nil {
		return nil, err
	}
	if err := getAdminRankingQuery().Where("used_quota > 0").Order("used_quota DESC, id DESC").Limit(limit).Scan(&result.ByUsedQuota).Error; err != nil {
		return nil, err
	}
	if err := getAdminRankingQuery().Where("last_request_at > 0").Order("last_request_at DESC, id DESC").Limit(limit).Scan(&result.ByLastRequest).Error; err != nil {
		return nil, err
	}
	return result, nil
}

func GetUserReviewSummary(userId int) (*UserReviewSummary, error) {
	user, err := GetUserById(userId, false)
	if err != nil {
		return nil, err
	}
	enrichUsersForAdmin([]*User{user}, 7)
	subscriptions, err := GetAllUserSubscriptions(userId)
	if err != nil {
		return nil, err
	}
	lastActivityAt := user.LastRequestAt
	if lastActivityAt <= 0 {
		lastActivityAt = user.LastLoginAt
	}
	settingMap := user.GetSetting()
	availableGroups := make(map[string]string)
	for groupName := range ratio_setting.GetGroupRatioCopy() {
		availableGroups[groupName] = fmt.Sprintf("%.2f", ratio_setting.GetGroupRatio(groupName))
	}
	review := &UserReviewSummary{
		User:          user,
		Subscriptions: subscriptions,
		Usage: map[string]interface{}{
			"request_count":   user.RequestCount,
			"used_quota":      user.UsedQuota,
			"last_request_at": user.LastRequestAt,
		},
		Security: map[string]interface{}{
			"has_2fa":       user.HasTwoFA,
			"has_passkey":   user.HasPasskey,
			"binding_count": user.BindingCount,
		},
		Bindings:           buildUserBindingSummaryItems(user),
		AvailableGroups:    availableGroups,
		HasSubscription:    user.HasSubscription,
		SubscriptionPlan:   user.SubscriptionPlan,
		BillingPreference:  common.NormalizeBillingPreference(settingMap.BillingPreference),
		HasTwoFA:           user.HasTwoFA,
		HasPasskey:         user.HasPasskey,
		BindingCount:       user.BindingCount,
		IsRecentlyActive:   user.IsRecentlyActive,
		LastActivityAt:     lastActivityAt,
		RecentlyActiveDays: 7,
	}
	return review, nil
}

func boolPtr(value bool) *bool {
	return &value
}

func GetUserById(id int, selectAll bool) (*User, error) {
	if id == 0 {
		return nil, errors.New("id 为空！")
	}
	user := User{Id: id}
	var err error = nil
	if selectAll {
		err = DB.First(&user, "id = ?", id).Error
	} else {
		err = DB.Omit("password").First(&user, "id = ?", id).Error
	}
	return &user, err
}

func GetUserIdByAffCode(affCode string) (int, error) {
	if affCode == "" {
		return 0, errors.New("affCode 为空！")
	}
	var user User
	err := DB.Select("id").First(&user, "aff_code = ?", affCode).Error
	return user.Id, err
}

func DeleteUserById(id int) (err error) {
	if id == 0 {
		return errors.New("id 为空！")
	}
	user := User{Id: id}
	return user.Delete()
}

func HardDeleteUserById(id int) error {
	if id == 0 {
		return errors.New("id 为空！")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := deleteUserOAuthBindingsByUserId(tx, id); err != nil {
			return err
		}
		return tx.Unscoped().Delete(&User{}, "id = ?", id).Error
	})
}

func inviteUser(inviterId int) (err error) {
	user, err := GetUserById(inviterId, true)
	if err != nil {
		return err
	}
	user.AffCount++
	user.AffQuota += common.QuotaForInviter
	user.AffHistoryQuota += common.QuotaForInviter
	return DB.Save(user).Error
}

func (user *User) TransferAffQuotaToQuota(quota int) error {
	// 检查quota是否小于最小额度
	if float64(quota) < common.QuotaPerUnit {
		return fmt.Errorf("转移额度最小为%s！", logger.LogQuota(int(common.QuotaPerUnit)))
	}

	// 开始数据库事务
	tx := DB.Begin()
	if tx.Error != nil {
		return tx.Error
	}
	defer tx.Rollback() // 确保在函数退出时事务能回滚

	// 加锁查询用户以确保数据一致性
	err := tx.Set("gorm:query_option", "FOR UPDATE").First(&user, user.Id).Error
	if err != nil {
		return err
	}

	// 再次检查用户的AffQuota是否足够
	if user.AffQuota < quota {
		return errors.New("邀请额度不足！")
	}

	// 更新用户额度
	user.AffQuota -= quota
	user.Quota += quota

	// 保存用户状态
	if err := tx.Save(user).Error; err != nil {
		return err
	}

	// 提交事务
	return tx.Commit().Error
}

func (user *User) Insert(inviterId int) error {
	var err error
	if user.Password != "" {
		user.Password, err = common.Password2Hash(user.Password)
		if err != nil {
			return err
		}
	}
	user.Quota = common.QuotaForNewUser
	user.CreatedAt = common.GetTimestamp()
	//user.SetAccessToken(common.GetUUID())
	user.AffCode = common.GetRandomString(4)

	// 初始化用户设置，包括默认的边栏配置
	if user.Setting == "" {
		defaultSetting := dto.UserSetting{}
		// 这里暂时不设置SidebarModules，因为需要在用户创建后根据角色设置
		user.SetSetting(defaultSetting)
	}

	result := DB.Create(user)
	if result.Error != nil {
		return result.Error
	}

	// 用户创建成功后，根据角色初始化边栏配置
	// 需要重新获取用户以确保有正确的ID和Role
	var createdUser User
	if err := DB.Where("username = ?", user.Username).First(&createdUser).Error; err == nil {
		// 生成基于角色的默认边栏配置
		defaultSidebarConfig := generateDefaultSidebarConfigForRole(createdUser.Role)
		if defaultSidebarConfig != "" {
			currentSetting := createdUser.GetSetting()
			currentSetting.SidebarModules = defaultSidebarConfig
			createdUser.SetSetting(currentSetting)
			createdUser.Update(false)
			common.SysLog(fmt.Sprintf("为新用户 %s (角色: %d) 初始化边栏配置", createdUser.Username, createdUser.Role))
		}
	}

	if common.QuotaForNewUser > 0 {
		RecordLog(user.Id, LogTypeSystem, fmt.Sprintf("新用户注册赠送 %s", logger.LogQuota(common.QuotaForNewUser)))
	}
	if inviterId != 0 && operation_setting.IsPaymentComplianceConfirmed() {
		if common.QuotaForInvitee > 0 {
			_ = IncreaseUserQuota(user.Id, common.QuotaForInvitee, true)
			RecordLog(user.Id, LogTypeSystem, fmt.Sprintf("使用邀请码赠送 %s", logger.LogQuota(common.QuotaForInvitee)))
		}
		if common.QuotaForInviter > 0 {
			//_ = IncreaseUserQuota(inviterId, common.QuotaForInviter)
			RecordLog(inviterId, LogTypeSystem, fmt.Sprintf("邀请用户赠送 %s", logger.LogQuota(common.QuotaForInviter)))
			_ = inviteUser(inviterId)
		}
	}
	return nil
}

// InsertWithTx inserts a new user within an existing transaction.
// This is used for OAuth registration where user creation and binding need to be atomic.
// Post-creation tasks (sidebar config, logs, inviter rewards) are handled after the transaction commits.
func (user *User) InsertWithTx(tx *gorm.DB, inviterId int) error {
	var err error
	if user.Password != "" {
		user.Password, err = common.Password2Hash(user.Password)
		if err != nil {
			return err
		}
	}
	user.Quota = common.QuotaForNewUser
	user.CreatedAt = common.GetTimestamp()
	user.AffCode = common.GetRandomString(4)

	// 初始化用户设置
	if user.Setting == "" {
		defaultSetting := dto.UserSetting{}
		user.SetSetting(defaultSetting)
	}

	result := tx.Create(user)
	if result.Error != nil {
		return result.Error
	}

	return nil
}

// FinalizeOAuthUserCreation performs post-transaction tasks for OAuth user creation.
// This should be called after the transaction commits successfully.
func (user *User) FinalizeOAuthUserCreation(inviterId int) {
	// 用户创建成功后，根据角色初始化边栏配置
	var createdUser User
	if err := DB.Where("id = ?", user.Id).First(&createdUser).Error; err == nil {
		defaultSidebarConfig := generateDefaultSidebarConfigForRole(createdUser.Role)
		if defaultSidebarConfig != "" {
			currentSetting := createdUser.GetSetting()
			currentSetting.SidebarModules = defaultSidebarConfig
			createdUser.SetSetting(currentSetting)
			createdUser.Update(false)
			common.SysLog(fmt.Sprintf("为新用户 %s (角色: %d) 初始化边栏配置", createdUser.Username, createdUser.Role))
		}
	}

	if common.QuotaForNewUser > 0 {
		RecordLog(user.Id, LogTypeSystem, fmt.Sprintf("新用户注册赠送 %s", logger.LogQuota(common.QuotaForNewUser)))
	}
	if inviterId != 0 && operation_setting.IsPaymentComplianceConfirmed() {
		if common.QuotaForInvitee > 0 {
			_ = IncreaseUserQuota(user.Id, common.QuotaForInvitee, true)
			RecordLog(user.Id, LogTypeSystem, fmt.Sprintf("使用邀请码赠送 %s", logger.LogQuota(common.QuotaForInvitee)))
		}
		if common.QuotaForInviter > 0 {
			RecordLog(inviterId, LogTypeSystem, fmt.Sprintf("邀请用户赠送 %s", logger.LogQuota(common.QuotaForInviter)))
			_ = inviteUser(inviterId)
		}
	}
}

func (user *User) Update(updatePassword bool) error {
	var err error
	if updatePassword {
		user.Password, err = common.Password2Hash(user.Password)
		if err != nil {
			return err
		}
	}
	newUser := *user
	DB.First(&user, user.Id)
	if err = DB.Model(user).Updates(newUser).Error; err != nil {
		return err
	}

	// Update cache
	return updateUserCache(*user)
}

func (user *User) Edit(updatePassword bool) error {
	var err error
	if updatePassword {
		user.Password, err = common.Password2Hash(user.Password)
		if err != nil {
			return err
		}
	}

	newUser := *user
	updates := map[string]interface{}{
		"username":     newUser.Username,
		"display_name": newUser.DisplayName,
		"group":        newUser.Group,
		"remark":       newUser.Remark,
	}
	if updatePassword {
		updates["password"] = newUser.Password
	}

	DB.First(&user, user.Id)
	if err = DB.Model(user).Updates(updates).Error; err != nil {
		return err
	}

	// Update cache
	return updateUserCache(*user)
}

func (user *User) ClearBinding(bindingType string) error {
	if user.Id == 0 {
		return errors.New("user id is empty")
	}

	bindingColumnMap := map[string]string{
		"email":    "email",
		"github":   "github_id",
		"discord":  "discord_id",
		"oidc":     "oidc_id",
		"wechat":   "wechat_id",
		"telegram": "telegram_id",
		"linuxdo":  "linux_do_id",
		"yaohuo":   "yaohuo_id",
	}

	column, ok := bindingColumnMap[bindingType]
	if !ok {
		return errors.New("invalid binding type")
	}

	if err := DB.Model(&User{}).Where("id = ?", user.Id).Update(column, "").Error; err != nil {
		return err
	}

	if err := DB.Where("id = ?", user.Id).First(user).Error; err != nil {
		return err
	}

	return updateUserCache(*user)
}

func (user *User) Delete() error {
	if user.Id == 0 {
		return errors.New("id 为空！")
	}
	if err := DB.Delete(user).Error; err != nil {
		return err
	}

	// 清除缓存
	return invalidateUserCache(user.Id)
}

func (user *User) HardDelete() error {
	if user.Id == 0 {
		return errors.New("id 为空！")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := deleteUserOAuthBindingsByUserId(tx, user.Id); err != nil {
			return err
		}
		return tx.Unscoped().Delete(user).Error
	})
}

// ValidateAndFill check password & user status
func (user *User) ValidateAndFill() (err error) {
	// When querying with struct, GORM will only query with non-zero fields,
	// that means if your field's value is 0, '', false or other zero values,
	// it won't be used to build query conditions
	password := user.Password
	username := strings.TrimSpace(user.Username)
	if username == "" || password == "" {
		return ErrUserEmptyCredentials
	}
	// find by username or email
	err = DB.Where("username = ? OR email = ?", username, username).First(user).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrInvalidCredentials
		}
		return fmt.Errorf("%w: %v", ErrDatabase, err)
	}
	okay := common.ValidatePasswordAndHash(password, user.Password)
	if !okay || user.Status != common.UserStatusEnabled {
		return ErrInvalidCredentials
	}
	return nil
}

func (user *User) FillUserById() error {
	if user.Id == 0 {
		return errors.New("id 为空！")
	}
	DB.Where(User{Id: user.Id}).First(user)
	return nil
}

func (user *User) FillUserByEmail() error {
	if user.Email == "" {
		return errors.New("email 为空！")
	}
	DB.Where(User{Email: user.Email}).First(user)
	return nil
}

func (user *User) FillUserByGitHubId() error {
	if user.GitHubId == "" {
		return errors.New("GitHub id 为空！")
	}
	DB.Where(User{GitHubId: user.GitHubId}).First(user)
	return nil
}

// UpdateGitHubId updates the user's GitHub ID (used for migration from login to numeric ID)
func (user *User) UpdateGitHubId(newGitHubId string) error {
	if user.Id == 0 {
		return errors.New("user id is empty")
	}
	return DB.Model(user).Update("github_id", newGitHubId).Error
}

func (user *User) FillUserByDiscordId() error {
	if user.DiscordId == "" {
		return errors.New("discord id 为空！")
	}
	DB.Where(User{DiscordId: user.DiscordId}).First(user)
	return nil
}

func (user *User) FillUserByOidcId() error {
	if user.OidcId == "" {
		return errors.New("oidc id 为空！")
	}
	DB.Where(User{OidcId: user.OidcId}).First(user)
	return nil
}

func (user *User) FillUserByWeChatId() error {
	if user.WeChatId == "" {
		return errors.New("WeChat id 为空！")
	}
	DB.Where(User{WeChatId: user.WeChatId}).First(user)
	return nil
}

func (user *User) FillUserByTelegramId() error {
	if user.TelegramId == "" {
		return errors.New("Telegram id 为空！")
	}
	err := DB.Where(User{TelegramId: user.TelegramId}).First(user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return errors.New("该 Telegram 账户未绑定")
	}
	return nil
}

func IsEmailAlreadyTaken(email string) bool {
	return DB.Unscoped().Where("email = ?", email).Find(&User{}).RowsAffected == 1
}

func IsWeChatIdAlreadyTaken(wechatId string) bool {
	return DB.Unscoped().Where("wechat_id = ?", wechatId).Find(&User{}).RowsAffected == 1
}

func IsGitHubIdAlreadyTaken(githubId string) bool {
	return DB.Unscoped().Where("github_id = ?", githubId).Find(&User{}).RowsAffected == 1
}

func IsDiscordIdAlreadyTaken(discordId string) bool {
	return DB.Unscoped().Where("discord_id = ?", discordId).Find(&User{}).RowsAffected == 1
}

func IsOidcIdAlreadyTaken(oidcId string) bool {
	return DB.Where("oidc_id = ?", oidcId).Find(&User{}).RowsAffected == 1
}

func IsTelegramIdAlreadyTaken(telegramId string) bool {
	return DB.Unscoped().Where("telegram_id = ?", telegramId).Find(&User{}).RowsAffected == 1
}

func ResetUserPasswordByEmail(email string, password string) error {
	if email == "" || password == "" {
		return errors.New("邮箱地址或密码为空！")
	}
	hashedPassword, err := common.Password2Hash(password)
	if err != nil {
		return err
	}
	err = DB.Model(&User{}).Where("email = ?", email).Update("password", hashedPassword).Error
	return err
}

func IsAdmin(userId int) bool {
	if userId == 0 {
		return false
	}
	var user User
	err := DB.Where("id = ?", userId).Select("role").Find(&user).Error
	if err != nil {
		common.SysLog("no such user " + err.Error())
		return false
	}
	return user.Role >= common.RoleAdminUser
}

//// IsUserEnabled checks user status from Redis first, falls back to DB if needed
//func IsUserEnabled(id int, fromDB bool) (status bool, err error) {
//	defer func() {
//		// Update Redis cache asynchronously on successful DB read
//		if shouldUpdateRedis(fromDB, err) {
//			gopool.Go(func() {
//				if err := updateUserStatusCache(id, status); err != nil {
//					common.SysError("failed to update user status cache: " + err.Error())
//				}
//			})
//		}
//	}()
//	if !fromDB && common.RedisEnabled {
//		// Try Redis first
//		status, err := getUserStatusCache(id)
//		if err == nil {
//			return status == common.UserStatusEnabled, nil
//		}
//		// Don't return error - fall through to DB
//	}
//	fromDB = true
//	var user User
//	err = DB.Where("id = ?", id).Select("status").Find(&user).Error
//	if err != nil {
//		return false, err
//	}
//
//	return user.Status == common.UserStatusEnabled, nil
//}

func ValidateAccessToken(token string) (*User, error) {
	if token == "" {
		return nil, nil
	}
	token = strings.Replace(token, "Bearer ", "", 1)
	user := &User{}
	err := DB.Where("access_token = ?", token).First(user).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("%w: %v", ErrDatabase, err)
	}
	return user, nil
}

// GetUserQuota gets quota from Redis first, falls back to DB if needed
func GetUserQuota(id int, fromDB bool) (quota int, err error) {
	defer func() {
		// Update Redis cache asynchronously on successful DB read
		if shouldUpdateRedis(fromDB, err) {
			gopool.Go(func() {
				if err := updateUserQuotaCache(id, quota); err != nil {
					common.SysLog("failed to update user quota cache: " + err.Error())
				}
			})
		}
	}()
	if !fromDB && common.RedisEnabled {
		quota, err := getUserQuotaCache(id)
		if err == nil {
			return quota, nil
		}
		// Don't return error - fall through to DB
	}
	fromDB = true
	err = DB.Model(&User{}).Where("id = ?", id).Select("quota").Find(&quota).Error
	if err != nil {
		return 0, err
	}

	return quota, nil
}

func GetUserUsedQuota(id int) (quota int, err error) {
	err = DB.Model(&User{}).Where("id = ?", id).Select("used_quota").Find(&quota).Error
	return quota, err
}

func GetUserEmail(id int) (email string, err error) {
	err = DB.Model(&User{}).Where("id = ?", id).Select("email").Find(&email).Error
	return email, err
}

// GetUserGroup gets group from Redis first, falls back to DB if needed
func GetUserGroup(id int, fromDB bool) (group string, err error) {
	defer func() {
		// Update Redis cache asynchronously on successful DB read
		if shouldUpdateRedis(fromDB, err) {
			gopool.Go(func() {
				if err := updateUserGroupCache(id, group); err != nil {
					common.SysLog("failed to update user group cache: " + err.Error())
				}
			})
		}
	}()
	if !fromDB && common.RedisEnabled {
		group, err := getUserGroupCache(id)
		if err == nil {
			return group, nil
		}
		// Don't return error - fall through to DB
	}
	fromDB = true
	err = DB.Model(&User{}).Where("id = ?", id).Select(commonGroupCol).Find(&group).Error
	if err != nil {
		return "", err
	}

	return group, nil
}

// GetUserSetting gets setting from Redis first, falls back to DB if needed
func GetUserSetting(id int, fromDB bool) (settingMap dto.UserSetting, err error) {
	var setting string
	defer func() {
		// Update Redis cache asynchronously on successful DB read
		if shouldUpdateRedis(fromDB, err) {
			gopool.Go(func() {
				if err := updateUserSettingCache(id, setting); err != nil {
					common.SysLog("failed to update user setting cache: " + err.Error())
				}
			})
		}
	}()
	if !fromDB && common.RedisEnabled {
		setting, err := getUserSettingCache(id)
		if err == nil {
			return setting, nil
		}
		// Don't return error - fall through to DB
	}
	fromDB = true
	// can be nil setting
	var safeSetting sql.NullString
	err = DB.Model(&User{}).Where("id = ?", id).Select("setting").Find(&safeSetting).Error
	if err != nil {
		return settingMap, err
	}
	if safeSetting.Valid {
		setting = safeSetting.String
	} else {
		setting = ""
	}
	userBase := &UserBase{
		Setting: setting,
	}
	return userBase.GetSetting(), nil
}

func IncreaseUserQuota(id int, quota int, db bool) (err error) {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	gopool.Go(func() {
		err := cacheIncrUserQuota(id, int64(quota))
		if err != nil {
			common.SysLog("failed to increase user quota: " + err.Error())
		}
	})
	if !db && common.BatchUpdateEnabled {
		addNewRecord(BatchUpdateTypeUserQuota, id, quota)
		return nil
	}
	return increaseUserQuota(id, quota)
}

func increaseUserQuota(id int, quota int) (err error) {
	err = DB.Model(&User{}).Where("id = ?", id).Update("quota", gorm.Expr("quota + ?", quota)).Error
	if err != nil {
		return err
	}
	return err
}

func DecreaseUserQuota(id int, quota int, db bool) (err error) {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	gopool.Go(func() {
		err := cacheDecrUserQuota(id, int64(quota))
		if err != nil {
			common.SysLog("failed to decrease user quota: " + err.Error())
		}
	})
	if !db && common.BatchUpdateEnabled {
		addNewRecord(BatchUpdateTypeUserQuota, id, -quota)
		return nil
	}
	return decreaseUserQuota(id, quota)
}

func decreaseUserQuota(id int, quota int) (err error) {
	err = DB.Model(&User{}).Where("id = ?", id).Update("quota", gorm.Expr("quota - ?", quota)).Error
	if err != nil {
		return err
	}
	return err
}

func DeltaUpdateUserQuota(id int, delta int) (err error) {
	if delta == 0 {
		return nil
	}
	if delta > 0 {
		return IncreaseUserQuota(id, delta, false)
	} else {
		return DecreaseUserQuota(id, -delta, false)
	}
}

//func GetRootUserEmail() (email string) {
//	DB.Model(&User{}).Where("role = ?", common.RoleRootUser).Select("email").Find(&email)
//	return email
//}

func GetRootUser() (user *User) {
	DB.Where("role = ?", common.RoleRootUser).First(&user)
	return user
}

func UpdateUserLastLoginAt(id int, timestamp int64) error {
	if id <= 0 || timestamp <= 0 {
		return nil
	}
	err := DB.Model(&User{}).Where("id = ?", id).Update("last_login_at", timestamp).Error
	if err != nil {
		return err
	}
	return invalidateUserCache(id)
}

func UpdateUserStatusByIds(ids []int, status int) error {
	if len(ids) == 0 {
		return nil
	}
	err := DB.Model(&User{}).Where("id IN ?", ids).Update("status", status).Error
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := invalidateUserCache(id); err != nil {
			common.SysLog("failed to invalidate user cache: " + err.Error())
		}
	}
	return nil
}

func UpdateUserUsedQuotaAndRequestCount(id int, quota int) {
	if common.BatchUpdateEnabled {
		addNewRecord(BatchUpdateTypeUsedQuota, id, quota)
		addNewRecord(BatchUpdateTypeRequestCount, id, 1)
		addNewRecord(BatchUpdateTypeLastRequestAt, id, int(common.GetTimestamp()))
		return
	}
	updateUserUsedQuotaAndRequestCount(id, quota, 1)
}

func updateUserUsedQuotaAndRequestCount(id int, quota int, count int) {
	err := DB.Model(&User{}).Where("id = ?", id).Updates(
		map[string]interface{}{
			"used_quota":      gorm.Expr("used_quota + ?", quota),
			"request_count":   gorm.Expr("request_count + ?", count),
			"last_request_at": common.GetTimestamp(),
		},
	).Error
	if err != nil {
		common.SysLog("failed to update user used quota and request count: " + err.Error())
		return
	}

	//// 更新缓存
	//if err := invalidateUserCache(id); err != nil {
	//	common.SysError("failed to invalidate user cache: " + err.Error())
	//}
}

func updateUserQuotaUsedQuotaRequestCountAndLastRequestAt(id int, quota int, usedQuota int, requestCount int, lastRequestAt int64) {
	if quota == 0 && usedQuota == 0 && requestCount == 0 && lastRequestAt <= 0 {
		return
	}

	updates := map[string]interface{}{}
	if quota != 0 {
		updates["quota"] = gorm.Expr("quota + ?", quota)
	}
	if usedQuota != 0 {
		updates["used_quota"] = gorm.Expr("used_quota + ?", usedQuota)
	}
	if requestCount != 0 {
		updates["request_count"] = gorm.Expr("request_count + ?", requestCount)
	}
	if lastRequestAt > 0 {
		updates["last_request_at"] = lastRequestAt
	}

	err := DB.Model(&User{}).Where("id = ?", id).Updates(updates).Error
	if err != nil {
		common.SysLog("failed to batch update user quota, used quota, request count and last request time: " + err.Error())
	}
}

func updateUserQuotaUsedQuotaAndRequestCount(id int, quota int, usedQuota int, requestCount int) {
	updateUserQuotaUsedQuotaRequestCountAndLastRequestAt(id, quota, usedQuota, requestCount, 0)
}

func updateUserUsedQuota(id int, quota int) {
	err := DB.Model(&User{}).Where("id = ?", id).Updates(
		map[string]interface{}{
			"used_quota": gorm.Expr("used_quota + ?", quota),
		},
	).Error
	if err != nil {
		common.SysLog("failed to update user used quota: " + err.Error())
	}
}

func updateUserRequestCount(id int, count int) {
	err := DB.Model(&User{}).Where("id = ?", id).Update("request_count", gorm.Expr("request_count + ?", count)).Error
	if err != nil {
		common.SysLog("failed to update user request count: " + err.Error())
	}
}

func updateUserLastRequestAt(id int, timestamp int64) {
	err := DB.Model(&User{}).Where("id = ?", id).Update("last_request_at", timestamp).Error
	if err != nil {
		common.SysLog("failed to update user last request time: " + err.Error())
	}
}

// GetUsernameById gets username from Redis first, falls back to DB if needed
func GetUsernameById(id int, fromDB bool) (username string, err error) {
	defer func() {
		// Update Redis cache asynchronously on successful DB read
		if shouldUpdateRedis(fromDB, err) {
			gopool.Go(func() {
				if err := updateUserNameCache(id, username); err != nil {
					common.SysLog("failed to update user name cache: " + err.Error())
				}
			})
		}
	}()
	if !fromDB && common.RedisEnabled {
		username, err := getUserNameCache(id)
		if err == nil {
			return username, nil
		}
		// Don't return error - fall through to DB
	}
	fromDB = true
	err = DB.Model(&User{}).Where("id = ?", id).Select("username").Find(&username).Error
	if err != nil {
		return "", err
	}

	return username, nil
}

func IsLinuxDOIdAlreadyTaken(linuxDOId string) bool {
	var user User
	err := DB.Unscoped().Where("linux_do_id = ?", linuxDOId).First(&user).Error
	return !errors.Is(err, gorm.ErrRecordNotFound)
}

func (user *User) FillUserByLinuxDOId() error {
	if user.LinuxDOId == "" {
		return errors.New("linux do id is empty")
	}
	err := DB.Where("linux_do_id = ?", user.LinuxDOId).First(user).Error
	return err
}

func RootUserExists() bool {
	var user User
	err := DB.Where("role = ?", common.RoleRootUser).First(&user).Error
	if err != nil {
		return false
	}
	return true
}

func IsYaohuoIdAlreadyTaken(yaohuoId string) bool {
	var user User
	err := DB.Unscoped().Where("yaohuo_id = ?", yaohuoId).First(&user).Error
	return !errors.Is(err, gorm.ErrRecordNotFound)
}

func (user *User) FillUserByYaohuoId() error {
	if user.YaohuoId == "" {
		return errors.New("yaohuo id is empty")
	}
	err := DB.Where("yaohuo_id = ?", user.YaohuoId).First(user).Error
	return err
}
