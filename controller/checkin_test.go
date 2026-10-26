package controller

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type checkinResponse struct {
	Success    bool   `json:"success"`
	MessageKey string `json:"message_key"`
	Data       struct {
		Enabled      bool   `json:"enabled"`
		Today        string `json:"today"`
		ServerTime   int64  `json:"server_time"`
		NextResetAt  int64  `json:"next_reset_at"`
		Timezone     string `json:"timezone"`
		QuotaAwarded int    `json:"quota_awarded"`
		CheckinDate  string `json:"checkin_date"`
		Stats        struct {
			TotalQuota     int64                 `json:"total_quota"`
			TotalCheckins  int                   `json:"total_checkins"`
			CheckinCount   int                   `json:"checkin_count"`
			CheckedInToday bool                  `json:"checked_in_today"`
			Records        []model.CheckinRecord `json:"records"`
		} `json:"stats"`
	} `json:"data"`
}

func callCheckin(t *testing.T, userID int, method, query string) checkinResponse {
	t.Helper()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Set("id", userID)
	ctx.Request = httptest.NewRequest(method, "/api/user/checkin"+query, nil)
	if method == http.MethodPost {
		DoCheckin(ctx)
	} else {
		GetCheckinStatus(ctx)
	}
	var response checkinResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.Equal(t, http.StatusOK, recorder.Code)
	return response
}

func TestCheckinDayMetadataUsesServerCalendar(t *testing.T) {
	location, err := time.LoadLocation("America/New_York")
	require.NoError(t, err)
	for _, tc := range []struct {
		name, date, offset string
		hours              int
	}{
		{"spring day", "2026-03-08", "UTC-05:00", 23},
		{"autumn day", "2026-11-01", "UTC-04:00", 25},
	} {
		t.Run(tc.name, func(t *testing.T) {
			now, err := time.ParseInLocation("2006-01-02", tc.date, location)
			require.NoError(t, err)
			data := checkinDayMetadata(now)
			assert.Equal(t, tc.date, data["today"])
			assert.Equal(t, tc.offset, data["timezone"])
			assert.Equal(t, now.Unix(), data["server_time"])
			assert.Equal(t, int64(tc.hours*3600), data["next_reset_at"].(int64)-now.Unix())
		})
	}
}

func TestCheckinDatabaseMatrix(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, database := range []struct {
		kind, env string
		typ       common.DatabaseType
	}{
		{"sqlite", "", common.DatabaseTypeSQLite},
		{"mysql", "AUDIT_MYSQL_DSN", common.DatabaseTypeMySQL},
		{"postgres", "AUDIT_POSTGRES_DSN", common.DatabaseTypePostgreSQL},
	} {
		t.Run(database.kind, func(t *testing.T) {
			dsn := os.Getenv(database.env)
			if database.env != "" && dsn == "" {
				t.Skip(database.env + " is not configured")
			}
			db, _ := newAuditTestDatabase(t, database.kind, dsn)
			useLogExportDatabases(t, db, db, database.typ, database.typ)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			// Serialize SQLite's single writer while still sending simultaneous
			// application requests; server databases exercise separate connections.
			if database.kind == "sqlite" {
				sqlDB.SetMaxOpenConns(1)
			}
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			require.NoError(t, db.AutoMigrate(&model.User{}, &model.Checkin{}, &model.Log{}))
			versionSQL := "SELECT version()"
			if database.kind == "sqlite" {
				versionSQL = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionSQL).Scan(&version).Error)
			t.Logf("check-in database: %s %s", database.kind, version)

			setting := operation_setting.GetCheckinSetting()
			previousSetting := *setting
			t.Cleanup(func() { *setting = previousSetting })
			*setting = operation_setting.CheckinSetting{Enabled: true, MinQuota: 25, MaxQuota: 25}
			users := []model.User{
				{Username: "checkin-owner", AffCode: "owner", Quota: 100},
				{Username: "checkin-other", AffCode: "other", Quota: 200},
				{Username: "checkin-overflow", AffCode: "overflow", Quota: common.MaxWalletQuota - 10},
				{Username: "checkin-failure", AffCode: "failure", Quota: 100},
				{Username: "checkin-zero", AffCode: "zero", Quota: 100},
			}
			require.NoError(t, db.Create(&users).Error)
			owner, other, overflow, failure, zero := users[0], users[1], users[2], users[3], users[4]
			yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
			require.NoError(t, db.Create(&model.Checkin{UserId: owner.Id, CheckinDate: yesterday, QuotaAwarded: 12}).Error)
			require.NoError(t, db.Create(&model.Checkin{UserId: other.Id, CheckinDate: yesterday, QuotaAwarded: 999}).Error)

			before := callCheckin(t, owner.Id, http.MethodGet, "")
			require.True(t, before.Success)
			assert.True(t, before.Data.Enabled)
			assert.False(t, before.Data.Stats.CheckedInToday)
			assert.Equal(t, int64(12), before.Data.Stats.TotalQuota, "foreign rewards are excluded")
			assert.Equal(t, time.Now().Format("2006-01-02"), before.Data.Today)
			assert.Positive(t, before.Data.NextResetAt-before.Data.ServerTime)
			assert.LessOrEqual(t, before.Data.NextResetAt-before.Data.ServerTime, int64(25*3600))
			assert.Equal(t, time.Now().Format("UTC-07:00"), before.Data.Timezone)
			for _, month := range []string{"2026-13", "2026-1", "invalid"} {
				response := callCheckin(t, owner.Id, http.MethodGet, "?month="+month)
				assert.False(t, response.Success)
				assert.Equal(t, "Invalid parameters", response.MessageKey)
			}

			posted := callCheckin(t, owner.Id, http.MethodPost, "")
			require.True(t, posted.Success)
			assert.Equal(t, 25, posted.Data.QuotaAwarded)
			assert.Equal(t, posted.Data.CheckinDate, posted.Data.Today)
			assert.Equal(t, before.Data.NextResetAt, posted.Data.NextResetAt)
			repeated := callCheckin(t, owner.Id, http.MethodPost, "")
			assert.False(t, repeated.Success)
			assert.Equal(t, "Already checked in today", repeated.MessageKey)
			after := callCheckin(t, owner.Id, http.MethodGet, "")
			require.True(t, after.Success)
			assert.True(t, after.Data.Stats.CheckedInToday)
			assert.Equal(t, 2, after.Data.Stats.TotalCheckins)
			assert.Equal(t, int64(37), after.Data.Stats.TotalQuota)
			var saved model.User
			require.NoError(t, db.First(&saved, owner.Id).Error)
			assert.Equal(t, 125, saved.Quota)

			t.Run("concurrent requests credit once", func(t *testing.T) {
				start := make(chan struct{})
				results := make([]error, 2)
				var workers sync.WaitGroup
				for i := range len(results) {
					workers.Go(func() {
						<-start
						_, results[i] = model.UserCheckin(other.Id)
					})
				}
				close(start)
				workers.Wait()
				successes := 0
				for _, err := range results {
					if err == nil {
						successes++
					}
				}
				assert.Equal(t, 1, successes)
				var user model.User
				require.NoError(t, db.First(&user, other.Id).Error)
				assert.Equal(t, 225, user.Quota)
			})

			t.Run("wallet overflow leaves no reward record", func(t *testing.T) {
				_, err := model.UserCheckin(overflow.Id)
				assert.ErrorIs(t, err, model.ErrWalletQuotaLimitExceeded)
				var count int64
				require.NoError(t, db.Model(&model.Checkin{}).Where("user_id = ?", overflow.Id).Count(&count).Error)
				assert.Zero(t, count)
				var user model.User
				require.NoError(t, db.First(&user, overflow.Id).Error)
				assert.Equal(t, overflow.Quota, user.Quota)
			})

			t.Run("failed wallet write rolls back daily record", func(t *testing.T) {
				callback := "checkin:test-wallet-failure"
				require.NoError(t, db.Callback().Update().Before("gorm:update").Register(callback, func(tx *gorm.DB) {
					if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "User" {
						tx.AddError(errors.New("injected wallet write failure"))
					}
				}))
				_, err := model.UserCheckin(failure.Id)
				require.NoError(t, db.Callback().Update().Remove(callback))
				require.Error(t, err)
				var count int64
				require.NoError(t, db.Model(&model.Checkin{}).Where("user_id = ?", failure.Id).Count(&count).Error)
				assert.Zero(t, count)
				var user model.User
				require.NoError(t, db.First(&user, failure.Id).Error)
				assert.Equal(t, 100, user.Quota)
				_, err = model.UserCheckin(failure.Id)
				require.NoError(t, err, "retry can complete after rollback")
			})

			t.Run("invalid reward settings never debit a wallet", func(t *testing.T) {
				for _, quotaRange := range [][2]int{{-1, 25}, {26, 25}, {0, common.MaxWalletQuota + 1}} {
					setting.MinQuota, setting.MaxQuota = quotaRange[0], quotaRange[1]
					_, err := model.UserCheckin(zero.Id)
					require.Error(t, err)
				}
				setting.MinQuota, setting.MaxQuota = 0, 0
				record, err := model.UserCheckin(zero.Id)
				require.NoError(t, err)
				assert.Zero(t, record.QuotaAwarded)
				var user model.User
				require.NoError(t, db.First(&user, zero.Id).Error)
				assert.Equal(t, 100, user.Quota)
			})

			setting.Enabled = false
			assert.False(t, callCheckin(t, owner.Id, http.MethodGet, "").Success)
			assert.False(t, callCheckin(t, owner.Id, http.MethodPost, "").Success)
		})
	}
}
