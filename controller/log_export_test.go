package controller

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// callLogHandler runs a log handler as the given user and returns the JSON
// lines of the response.
func callLogHandler(t *testing.T, handler gin.HandlerFunc, userId int, role int, query string) []map[string]any {
	t.Helper()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/log?"+query, nil)
	ctx.Set("id", userId)
	ctx.Set("role", role)
	handler(ctx)
	var lines []map[string]any
	for line := range strings.SplitSeq(strings.TrimSpace(recorder.Body.String()), "\n") {
		var value map[string]any
		require.NoError(t, common.UnmarshalJsonStr(line, &value))
		lines = append(lines, value)
	}
	return lines
}

func exportedRequestIds(lines []map[string]any) []any {
	ids := make([]any, 0, len(lines))
	for _, line := range lines[:len(lines)-1] {
		ids = append(ids, line["request_id"])
	}
	return ids
}

// seedExportLogs stores logs of two users: three in the last hour and one
// from 400 days ago.
func seedExportLogs(t *testing.T, mainDB *gorm.DB, logDB *gorm.DB, now int64) {
	t.Helper()
	require.NoError(t, mainDB.Create(&model.Channel{Id: 9, Name: "primary"}).Error)
	logs := []model.Log{
		{UserId: 1, Username: "alice", CreatedAt: now - 3600, Type: model.LogTypeConsume, ModelName: "gpt-a", ChannelId: 9, Quota: 10, RequestId: "a-1", Other: `{"admin_info":{"use_channel":["9"]}}`},
		{UserId: 2, Username: "bob", CreatedAt: now - 1800, Type: model.LogTypeConsume, ModelName: "gpt-b", ChannelId: 9, Quota: 20, RequestId: "b-1"},
		{UserId: 1, Username: "alice", CreatedAt: now - 60, Type: model.LogTypeError, ModelName: "gpt-a", RequestId: "a-2"},
		{UserId: 1, Username: "alice", CreatedAt: now - 400*24*3600, Type: model.LogTypeConsume, ModelName: "gpt-a", RequestId: "a-old"},
	}
	for i := range logs {
		require.NoError(t, logDB.Create(&logs[i]).Error)
	}
}

func useLogExportDatabases(t *testing.T, mainDB *gorm.DB, logDB *gorm.DB, mainType common.DatabaseType, logType common.DatabaseType) {
	t.Helper()
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
	previousRedis, previousMemory := common.RedisEnabled, common.MemoryCacheEnabled
	model.DB, model.LOG_DB = mainDB, logDB
	common.SetDatabaseTypes(mainType, logType)
	common.RedisEnabled, common.MemoryCacheEnabled = false, false
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMain, previousLog)
		common.RedisEnabled, common.MemoryCacheEnabled = previousRedis, previousMemory
	})
}

func TestLogExportDatabaseMatrix(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousMaster := common.IsMasterNode
	common.IsMasterNode = true
	t.Cleanup(func() { common.IsMasterNode = previousMaster })
	for _, tc := range []struct {
		kind, env string
		typ       common.DatabaseType
	}{
		{"sqlite", "", common.DatabaseTypeSQLite},
		{"mysql", "AUDIT_MYSQL_DSN", common.DatabaseTypeMySQL},
		{"postgres", "AUDIT_POSTGRES_DSN", common.DatabaseTypePostgreSQL},
		{"clickhouse", "AUDIT_CLICKHOUSE_DSN", common.DatabaseTypeClickHouse},
	} {
		t.Run(tc.kind, func(t *testing.T) {
			dsn := os.Getenv(tc.env)
			if tc.env != "" && dsn == "" {
				t.Skip(tc.env + " is not configured")
			}
			db, isolatedDSN := newAuditTestDatabase(t, tc.kind, dsn)
			mainDB, mainType := db, tc.typ
			if tc.kind == "clickhouse" {
				mainDB, _ = newAuditTestDatabase(t, "sqlite", "")
				mainType = common.DatabaseTypeSQLite
			}
			useLogExportDatabases(t, mainDB, db, mainType, tc.typ)
			require.NoError(t, mainDB.AutoMigrate(&model.Channel{}))
			if tc.kind == "clickhouse" {
				t.Setenv("LOG_SQL_DSN", isolatedDSN)
				require.NoError(t, model.InitLogDB())
			} else {
				require.NoError(t, db.AutoMigrate(&model.Log{}))
			}
			versionSQL := "SELECT version()"
			if tc.kind == "sqlite" {
				versionSQL = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, model.LOG_DB.Raw(versionSQL).Scan(&version).Error)
			t.Logf("log database: %s %s", tc.kind, version)
			now := time.Now().Unix()
			seedExportLogs(t, mainDB, model.LOG_DB, now)
			query := fmt.Sprintf("start_timestamp=%d&end_timestamp=%d", now-2*24*3600, now+3600)

			listed := callLogHandler(t, GetUserLogs, 1, common.RoleCommonUser, query)[0]
			require.Equal(t, true, listed["success"])
			assert.EqualValues(t, 2, listed["data"].(map[string]any)["total"])
			listed = callLogHandler(t, GetAllLogs, 3, common.RoleAdminUser, query+"&username=alice")[0]
			require.Equal(t, true, listed["success"])
			assert.EqualValues(t, 2, listed["data"].(map[string]any)["total"])

			own := callLogHandler(t, ExportUserLogs, 1, common.RoleCommonUser, query)
			require.Len(t, own, 3)
			assert.Equal(t, []any{"a-2", "a-1"}, exportedRequestIds(own))
			assert.Equal(t, map[string]any{"success": true, "message": "", "data": map[string]any{"count": float64(2)}}, own[2])
			assert.Equal(t, float64(1), own[0]["id"], "user exports carry list positions, not row ids")
			assert.Empty(t, own[1]["channel_name"])
			assert.NotContains(t, own[1]["other"], "admin_info")

			all := callLogHandler(t, ExportAllLogs, 3, common.RoleAdminUser, query+"&model_name=gpt-%25")
			require.Len(t, all, 4)
			assert.Equal(t, []any{"a-2", "b-1", "a-1"}, exportedRequestIds(all))
			assert.Equal(t, "primary", all[2]["channel_name"])
			assert.Contains(t, all[2]["other"], "admin_info")
			assert.Equal(t, true, all[3]["success"])
		})
	}
}

func TestLogExportRules(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, _ := newAuditTestDatabase(t, "sqlite", "")
	useLogExportDatabases(t, db, db, common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Log{}, &model.QuotaData{}))
	now := time.Now().Unix()
	seedExportLogs(t, db, db, now)
	logSetting := operation_setting.GetLogSetting()
	previousSetting := *logSetting
	t.Cleanup(func() { *logSetting = previousSetting })
	recent := fmt.Sprintf("start_timestamp=%d&end_timestamp=%d", now-2*24*3600, now)
	tooLong := fmt.Sprintf("start_timestamp=%d&end_timestamp=%d", now-366*24*3600, now)

	t.Run("time range", func(t *testing.T) {
		rejected := callLogHandler(t, ExportAllLogs, 3, common.RoleAdminUser, tooLong)
		require.Len(t, rejected, 1)
		assert.Equal(t, false, rejected[0]["success"])
		assert.Equal(t, "The time range cannot exceed {{days}} days", rejected[0]["message_key"])
		assert.Equal(t, map[string]any{"days": float64(365)}, rejected[0]["message_params"])

		assert.Equal(t, false, callLogHandler(t, GetUserLogs, 1, common.RoleCommonUser, tooLong)[0]["success"])
		assert.Equal(t, false, callLogHandler(t, GetLogsSelfStat, 1, common.RoleCommonUser, tooLong)[0]["success"])
		assert.Equal(t, true, callLogHandler(t, GetUserLogs, 3, common.RoleAdminUser, tooLong)[0]["success"], "administrators search their own logs without a limit")

		// The dashboard follows the same range instead of its old one-month limit.
		fortyDays := fmt.Sprintf("start_timestamp=%d&end_timestamp=%d", now-40*24*3600, now)
		for _, handler := range []gin.HandlerFunc{GetUserQuotaDates, GetUserFlowQuotaDates} {
			assert.Equal(t, "The time range cannot exceed {{days}} days", callLogHandler(t, handler, 1, common.RoleCommonUser, tooLong)[0]["message_key"])
			assert.Equal(t, true, callLogHandler(t, handler, 1, common.RoleCommonUser, fortyDays)[0]["success"])
		}

		// Without a start, a user's search reaches back the whole range.
		listed := callLogHandler(t, GetUserLogs, 1, common.RoleCommonUser, "")[0]
		assert.Equal(t, true, listed["success"])
		assert.EqualValues(t, 2, listed["data"].(map[string]any)["total"])

		logSetting.MaxRangeDays = 400
		assert.Equal(t, true, callLogHandler(t, GetUserLogs, 1, common.RoleCommonUser, tooLong)[0]["success"])
		logSetting.MaxRangeDays = previousSetting.MaxRangeDays
	})

	t.Run("user export switch", func(t *testing.T) {
		logSetting.UserExportEnabled = false
		t.Cleanup(func() { logSetting.UserExportEnabled = previousSetting.UserExportEnabled })
		disabled := callLogHandler(t, ExportUserLogs, 1, common.RoleCommonUser, recent)
		require.Len(t, disabled, 1)
		assert.Equal(t, "Log export is disabled", disabled[0]["message_key"])
		assert.Equal(t, true, callLogHandler(t, ExportUserLogs, 3, common.RoleAdminUser, recent)[0]["success"], "administrators export their own logs even when users cannot")
	})

	t.Run("one export per user", func(t *testing.T) {
		release, ok, err := service.AcquireLogExportLock(1)
		require.NoError(t, err)
		require.True(t, ok)
		busy := callLogHandler(t, ExportUserLogs, 1, common.RoleCommonUser, recent)
		require.Len(t, busy, 1)
		assert.Equal(t, "Another log export is running. Try again after it finishes.", busy[0]["message_key"])
		other := callLogHandler(t, ExportUserLogs, 2, common.RoleCommonUser, recent)
		assert.Equal(t, true, other[len(other)-1]["success"], "other users are not blocked")
		release()
		assert.Len(t, callLogHandler(t, ExportUserLogs, 1, common.RoleCommonUser, recent), 3)
	})
}

func TestAcquireLogExportLock(t *testing.T) {
	for _, useRedis := range []bool{false, true} {
		t.Run(fmt.Sprintf("redis=%v", useRedis), func(t *testing.T) {
			previousRedis, previousClient := common.RedisEnabled, common.RDB
			common.RedisEnabled = useRedis
			if useRedis {
				server := miniredis.RunT(t)
				common.RDB = redis.NewClient(&redis.Options{Addr: server.Addr()})
				require.NoError(t, common.RDB.Ping(context.Background()).Err())
			}
			t.Cleanup(func() { common.RedisEnabled, common.RDB = previousRedis, previousClient })

			release, ok, err := service.AcquireLogExportLock(1)
			require.NoError(t, err)
			require.True(t, ok)
			_, ok, err = service.AcquireLogExportLock(1)
			require.NoError(t, err)
			assert.False(t, ok, "a second export of the same user must wait")
			releaseOther, ok, err := service.AcquireLogExportLock(2)
			require.NoError(t, err)
			assert.True(t, ok)
			releaseOther()
			release()
			releaseAgain, ok, err := service.AcquireLogExportLock(1)
			require.NoError(t, err)
			assert.True(t, ok, "a finished export frees the user")
			releaseAgain()
		})
	}
}

func TestLogTokenFilterDatabaseMatrix(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousMaster := common.IsMasterNode
	common.IsMasterNode = true
	t.Cleanup(func() { common.IsMasterNode = previousMaster })
	for _, database := range []struct {
		kind, env string
		typ       common.DatabaseType
	}{
		{"sqlite", "", common.DatabaseTypeSQLite},
		{"mysql", "AUDIT_MYSQL_DSN", common.DatabaseTypeMySQL},
		{"postgres", "AUDIT_POSTGRES_DSN", common.DatabaseTypePostgreSQL},
		{"clickhouse", "AUDIT_CLICKHOUSE_DSN", common.DatabaseTypeClickHouse},
	} {
		t.Run(database.kind, func(t *testing.T) {
			dsn := os.Getenv(database.env)
			if database.env != "" && dsn == "" {
				t.Skip(database.env + " is not configured")
			}
			mainDB, _ := newAuditTestDatabase(t, "sqlite", "")
			logDB, isolatedDSN := newAuditTestDatabase(t, database.kind, dsn)
			useLogExportDatabases(t, mainDB, logDB, common.DatabaseTypeSQLite, database.typ)
			if database.kind == "clickhouse" {
				t.Setenv("LOG_SQL_DSN", isolatedDSN)
				require.NoError(t, model.InitLogDB())
			} else {
				require.NoError(t, logDB.AutoMigrate(&model.Log{}))
			}
			versionSQL := "SELECT version()"
			if database.kind == "sqlite" {
				versionSQL = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, model.LOG_DB.Raw(versionSQL).Scan(&version).Error)
			t.Logf("separate log database: %s %s", database.kind, version)
			now := time.Now().Unix()
			logs := []model.Log{
				{UserId: 1, Username: "old-user-name", TokenId: 11, TokenName: "Before rename", CreatedAt: now - 3600, Type: model.LogTypeConsume, RequestId: "renamed-old", Quota: 10, PromptTokens: 2, CompletionTokens: 3},
				{UserId: 1, Username: "alice", TokenId: 11, TokenName: "Editor", CreatedAt: now - 5, Type: model.LogTypeConsume, RequestId: "renamed-current", Quota: 20, PromptTokens: 5, CompletionTokens: 7},
				{UserId: 1, Username: "alice", TokenId: 11, TokenName: "Editor", CreatedAt: now - 1, Type: model.LogTypeError, RequestId: "key-error"},
				{UserId: 1, Username: "alice", TokenId: 12, TokenName: "Editor", CreatedAt: now - 2, Type: model.LogTypeConsume, RequestId: "same-name-other-key", Quota: 50},
				{UserId: 2, Username: "alice", TokenId: 21, TokenName: "Editor", CreatedAt: now - 3, Type: model.LogTypeConsume, RequestId: "other-user", Quota: 100},
			}
			for i := range logs {
				require.NoError(t, model.LOG_DB.Create(&logs[i]).Error)
			}
			period := fmt.Sprintf("start_timestamp=%d&end_timestamp=%d", now-7200, now)
			for _, tc := range []struct {
				name, query string
				total       int
				requests    []string
			}{
				{"stable ID includes old names and errors", "token_id=11", 3, []string{"key-error", "renamed-current", "renamed-old"}},
				{"pagination uses key-specific total", "token_id=11&p=2&page_size=2", 3, []string{"renamed-old"}},
				{"same name stays a separate key", "token_id=12", 1, []string{"same-name-other-key"}},
				{"foreign key cannot escape user scope", "token_id=21", 0, []string{}},
				{"unknown key is empty", "token_id=99", 0, []string{}},
				{"error filter combines with key", "token_id=11&type=5", 1, []string{"key-error"}},
				{"legacy name filter remains supported", "token_name=Before%20rename", 1, []string{"renamed-old"}},
			} {
				t.Run(tc.name, func(t *testing.T) {
					response := callLogHandler(t, GetUserLogs, 1, common.RoleCommonUser, period+"&"+tc.query)[0]
					require.Equal(t, true, response["success"])
					data := response["data"].(map[string]any)
					assert.EqualValues(t, tc.total, data["total"])
					requests := make([]string, 0)
					for _, item := range data["items"].([]any) {
						requests = append(requests, item.(map[string]any)["request_id"].(string))
					}
					assert.Equal(t, tc.requests, requests)
				})
			}
			for _, tc := range []struct {
				query string
				quota int
				rpm   int
				tpm   int
			}{
				{"token_id=11", 30, 1, 12},
				{"token_id=11&request_id=missing&upstream_request_id=missing", 30, 1, 12},
				{"token_id=11&channel=99", 0, 0, 0},
				{"token_id=11&token_name=Before%20rename", 10, 0, 0},
				{"token_id=12", 50, 1, 0},
				{"token_id=21", 0, 0, 0},
				{"token_id=99", 0, 0, 0},
				{"", 80, 2, 12},
			} {
				response := callLogHandler(t, GetLogsSelfStat, 1, common.RoleCommonUser, period+"&"+tc.query)[0]
				require.Equal(t, true, response["success"])
				assert.Equal(t, map[string]any{"quota": float64(tc.quota), "rpm": float64(tc.rpm), "tpm": float64(tc.tpm)}, response["data"], tc.query)
			}
			ownExport := callLogHandler(t, ExportUserLogs, 1, common.RoleCommonUser, period+"&token_id=11")
			assert.Equal(t, []any{"key-error", "renamed-current", "renamed-old"}, exportedRequestIds(ownExport))
			foreignExport := callLogHandler(t, ExportUserLogs, 1, common.RoleCommonUser, period+"&token_id=21")
			require.Len(t, foreignExport, 1)
			assert.EqualValues(t, 0, foreignExport[0]["data"].(map[string]any)["count"])
			for _, invalid := range []string{"", "0", "-1", "x", "1.5", "99999999999999999999999", "11&token_id=12", "11%20OR%201=1"} {
				for _, handler := range []gin.HandlerFunc{GetUserLogs, GetLogsSelfStat, ExportUserLogs, GetAllLogs, GetLogsStat} {
					response := callLogHandler(t, handler, 1, common.RoleAdminUser, period+"&token_id="+invalid)[0]
					assert.Equal(t, false, response["success"], invalid)
					assert.Equal(t, "Invalid parameters", response["message_key"], invalid)
				}
			}
		})
	}
}

func TestUserLogIndexMigrationDatabaseMatrix(t *testing.T) {
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
			for _, upgrade := range []bool{false, true} {
				for _, separateLogDB := range []bool{false, true} {
					t.Run(fmt.Sprintf("upgrade=%v/separate-log=%v", upgrade, separateLogDB), func(t *testing.T) {
						logDB, _ := newAuditTestDatabase(t, database.kind, dsn)
						mainDB, mainType := logDB, database.typ
						if separateLogDB {
							mainDB, _ = newAuditTestDatabase(t, "sqlite", "")
							mainType = common.DatabaseTypeSQLite
						}
						useLogExportDatabases(t, mainDB, logDB, mainType, database.typ)
						versionSQL := "SELECT version()"
						if database.kind == "sqlite" {
							versionSQL = "SELECT sqlite_version()"
						}
						var version string
						require.NoError(t, logDB.Raw(versionSQL).Scan(&version).Error)
						t.Logf("log index migration database: %s %s", database.kind, version)
						if upgrade {
							require.NoError(t, logDB.AutoMigrate(&releasedAuditLog{}))
							assert.False(t, logDB.Migrator().HasIndex(&model.Log{}, "idx_logs_user_created_type"))
						} else {
							require.NoError(t, logDB.AutoMigrate(&model.Log{}))
						}
						previousIndexes, err := logDB.Migrator().GetIndexes(&model.Log{})
						require.NoError(t, err)
						now := time.Now().Unix()
						logs := []model.Log{
							{UserId: 1, CreatedAt: now - 3600, Type: model.LogTypeConsume, TokenId: 11, ModelName: "chat-a", Quota: 10, RequestId: "migration-first"},
							{UserId: 1, CreatedAt: now - 1800, Type: model.LogTypeError, TokenId: 11, ModelName: "chat-a", RequestId: "migration-failed"},
							{UserId: 2, CreatedAt: now - 1200, Type: model.LogTypeConsume, TokenId: 21, Quota: 100, RequestId: "migration-foreign"},
							{UserId: 1, CreatedAt: now - 600, Type: model.LogTypeConsume, TokenId: 12, ModelName: "chat-b", Quota: 20, RequestId: "migration-last"},
							{UserId: 1, CreatedAt: now - 10*86400, Type: model.LogTypeConsume, Quota: 50, RequestId: "migration-old"},
							{UserId: 1, CreatedAt: now - 500, Type: model.LogTypeTopup, Quota: 1000, RequestId: "migration-topup"},
							{UserId: 1, CreatedAt: now - 400, Type: model.LogTypeManage, RequestId: "migration-manage"},
							{UserId: 1, CreatedAt: now - 300, Type: model.LogTypeSystem, RequestId: "migration-system"},
							{UserId: 1, CreatedAt: now - 200, Type: model.LogTypeLogin, RequestId: "migration-login"},
							{UserId: 1, CreatedAt: now - 100, Type: model.LogTypeRefund, RequestId: "migration-refund"},
						}
						require.NoError(t, logDB.Create(&logs).Error)
						for range 2 {
							require.NoError(t, logDB.AutoMigrate(&model.Log{}))
							indexes, err := logDB.Migrator().GetIndexes(&model.Log{})
							require.NoError(t, err)
							byName := make(map[string]gorm.Index, len(indexes))
							for _, index := range indexes {
								byName[index.Name()] = index
								if index.Name() == "idx_logs_user_created_type" {
									if database.typ == common.DatabaseTypePostgreSQL {
										// The PostgreSQL driver's GetIndexes does not preserve column order.
										var definition string
										require.NoError(t, logDB.Raw("SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ? AND indexname = ?", "logs", index.Name()).Scan(&definition).Error)
										assert.Contains(t, definition, "(user_id, created_at, type)")
									} else {
										assert.Equal(t, []string{"user_id", "created_at", "type"}, index.Columns())
									}
								}
							}
							require.Contains(t, byName, "idx_logs_user_created_type")
							for _, index := range previousIndexes {
								require.Contains(t, byName, index.Name())
								assert.ElementsMatch(t, index.Columns(), byName[index.Name()].Columns())
								before, beforeOK := index.Unique()
								after, afterOK := byName[index.Name()].Unique()
								assert.Equal(t, beforeOK, afterOK)
								assert.Equal(t, before, after)
							}
							var preserved []model.Log
							require.NoError(t, logDB.Order("id").Find(&preserved).Error)
							assert.Equal(t, logs, preserved)
						}
						period := fmt.Sprintf("start_timestamp=%d&end_timestamp=%d", now-7200, now)
						for _, tc := range []struct {
							query string
							total int
							ids   []string
						}{
							{"&p=2&page_size=2", 8, []string{"migration-system", "migration-manage"}},
							{"&request_only=false", 8, []string{"migration-refund", "migration-login", "migration-system", "migration-manage", "migration-topup", "migration-last", "migration-failed", "migration-first"}},
							{"&request_only=true", 4, []string{"migration-refund", "migration-last", "migration-failed", "migration-first"}},
							{"&request_only=true&p=2&page_size=2", 4, []string{"migration-failed", "migration-first"}},
							{"&request_only=true&type=5", 1, []string{"migration-failed"}},
							{"&request_only=true&type=6", 1, []string{"migration-refund"}},
							{"&request_only=true&type=1", 0, []string{}},
							{"&type=2", 2, []string{"migration-last", "migration-first"}},
							{"&type=5", 1, []string{"migration-failed"}},
							{"&token_id=11&model_name=chat-a", 2, []string{"migration-failed", "migration-first"}},
							{"&token_id=21", 0, []string{}},
						} {
							response := callLogHandler(t, GetUserLogs, 1, common.RoleCommonUser, period+tc.query)[0]
							require.Equal(t, true, response["success"])
							data := response["data"].(map[string]any)
							assert.EqualValues(t, tc.total, data["total"])
							ids := make([]string, 0)
							for _, item := range data["items"].([]any) {
								ids = append(ids, item.(map[string]any)["request_id"].(string))
							}
							assert.Equal(t, tc.ids, ids)
						}
						for _, value := range []string{"", "invalid", "true&request_only=false"} {
							response := callLogHandler(t, GetUserLogs, 1, common.RoleCommonUser, period+"&request_only="+value)[0]
							assert.Equal(t, false, response["success"], value)
							assert.Equal(t, "Invalid parameters", response["message_key"], value)
						}
						stat := callLogHandler(t, GetLogsSelfStat, 1, common.RoleCommonUser, period)[0]
						require.Equal(t, true, stat["success"])
						assert.EqualValues(t, 30, stat["data"].(map[string]any)["quota"])
						ctx, cancel := context.WithCancel(context.Background())
						cancel()
						_, _, err = model.GetUserLogsWithContext(ctx, 1, model.LogFilter{}, 0, 20)
						require.Error(t, err, "canceled records queries must reach the database context")
						_, err = model.SumUsedQuotaWithContext(ctx, model.LogFilter{}, 1)
						require.Error(t, err, "canceled statistics queries must reach the database context")
						for _, handler := range []gin.HandlerFunc{GetUserLogs, GetLogsSelfStat} {
							recorder := httptest.NewRecorder()
							requestContext, _ := gin.CreateTestContext(recorder)
							requestContext.Request = httptest.NewRequest(http.MethodGet, "/api/log/self?"+period, nil).WithContext(ctx)
							requestContext.Set("id", 1)
							requestContext.Set("role", common.RoleCommonUser)
							handler(requestContext)
							var response map[string]any
							require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
							assert.Equal(t, false, response["success"], "HTTP request cancellation must propagate to database queries")
						}
						_, total, err := model.GetUserLogs(1, model.LogFilter{}, 0, 20)
						require.NoError(t, err)
						assert.EqualValues(t, 9, total, "cancellation must not poison later requests")
					})
				}
			}
		})
	}
}
