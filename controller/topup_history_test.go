package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestTopUpHistoryStatusFiltersBeforePagination(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.TopUp{}))
	previousDB := model.DB
	model.DB = db
	t.Cleanup(func() {
		model.DB = previousDB
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	now := common.GetTimestamp()
	records := []model.TopUp{
		{UserId: 61, TradeNo: "receipt-one", Status: common.TopUpStatusSuccess, CreateTime: now},
		{UserId: 61, TradeNo: "receipt-pending", Status: common.TopUpStatusPending, CreateTime: now},
		{UserId: 61, TradeNo: "receipt-two", Status: common.TopUpStatusSuccess, CreateTime: now},
		{UserId: 61, TradeNo: "failed", Status: common.TopUpStatusFailed, CreateTime: now},
		{UserId: 61, TradeNo: "expired", Status: common.TopUpStatusExpired, CreateTime: now},
		{UserId: 61, TradeNo: "extra-success", Status: common.TopUpStatusSuccess, CreateTime: now},
		{UserId: 62, TradeNo: "receipt-other", Status: common.TopUpStatusSuccess, CreateTime: now},
		{UserId: 61, TradeNo: "receipt-old", Status: common.TopUpStatusSuccess, CreateTime: now - 31*24*60*60},
	}
	require.NoError(t, db.Create(&records).Error)
	for _, tc := range []struct {
		name    string
		query   string
		admin   bool
		total   int
		orders  []string
		invalid bool
	}{
		{name: "completed first page excludes incomplete foreign and old orders", query: "status=success&p=1&page_size=2", total: 3, orders: []string{"extra-success", "receipt-two"}},
		{name: "completed last page uses filtered total", query: "status=success&p=2&page_size=2", total: 3, orders: []string{"receipt-one"}},
		{name: "search combines completed status before paging", query: "status=success&keyword=receipt%25&p=2&page_size=1", total: 2, orders: []string{"receipt-one"}},
		{name: "search for pending order returns empty completed history", query: "status=success&keyword=receipt-pending", orders: []string{}},
		{name: "legacy request includes all recent statuses", query: "p=1&page_size=10", total: 6, orders: []string{"extra-success", "expired", "failed", "receipt-two", "receipt-pending", "receipt-one"}},
		{name: "legacy search includes pending orders", query: "keyword=receipt%25", total: 3, orders: []string{"receipt-two", "receipt-pending", "receipt-one"}},
		{name: "pending filter", query: "status=pending", total: 1, orders: []string{"receipt-pending"}},
		{name: "failed filter", query: "status=failed", total: 1, orders: []string{"failed"}},
		{name: "expired filter", query: "status=expired", total: 1, orders: []string{"expired"}},
		{name: "unknown status rejected", query: "status=complete", invalid: true},
		{name: "status is not interpreted as SQL", query: "status=success%27%20OR%201=1", invalid: true},
		{name: "admin history unaffected", admin: true, query: "status=success&page_size=10", total: 8, orders: []string{"receipt-old", "receipt-other", "extra-success", "expired", "failed", "receipt-two", "receipt-pending", "receipt-one"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Set("id", 61)
			ctx.Request = httptest.NewRequest(http.MethodGet, "/api/user/topup/self?"+tc.query, nil)
			if tc.admin {
				GetAllTopUps(ctx)
			} else {
				GetUserTopUps(ctx)
			}
			var response struct {
				Success bool `json:"success"`
				Data    struct {
					Items []model.TopUp `json:"items"`
					Total int           `json:"total"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			if tc.invalid {
				assert.False(t, response.Success)
				assert.Empty(t, response.Data.Items)
				return
			}
			require.True(t, response.Success, recorder.Body.String())
			assert.Equal(t, tc.total, response.Data.Total)
			actual := make([]string, 0, len(response.Data.Items))
			for _, order := range response.Data.Items {
				actual = append(actual, order.TradeNo)
			}
			assert.Equal(t, tc.orders, actual)
		})
	}
}
