package controller

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupWeChatInviterTest(t *testing.T) (*gin.Engine, *gorm.DB) {
	t.Helper()
	db := openPublicSubscriptionPlanTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Log{}))
	setPublicPlanCompliance(t, false)

	previousEnabled := common.WeChatAuthEnabled
	previousRegisterEnabled := common.RegisterEnabled
	previousAddress := common.WeChatServerAddress
	previousToken := common.WeChatServerToken
	previousNewUserQuota := common.QuotaForNewUser
	previousInviterQuota := common.QuotaForInviter
	previousInviteeQuota := common.QuotaForInvitee
	t.Cleanup(func() {
		common.WeChatAuthEnabled = previousEnabled
		common.RegisterEnabled = previousRegisterEnabled
		common.WeChatServerAddress = previousAddress
		common.WeChatServerToken = previousToken
		common.QuotaForNewUser = previousNewUserQuota
		common.QuotaForInviter = previousInviterQuota
		common.QuotaForInvitee = previousInviteeQuota
	})
	common.WeChatAuthEnabled = true
	common.RegisterEnabled = true
	common.WeChatServerToken = "wechat_test_token"
	common.QuotaForNewUser = 0
	common.QuotaForInviter = 0
	common.QuotaForInvitee = 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		assert.Equal(t, "/api/wechat/user", req.URL.Path)
		assert.Equal(t, "code+test&1", req.URL.Query().Get("code"))
		assert.Equal(t, "wechat_test_token", req.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, err := w.Write([]byte(`{"success":true,"data":"wechat_test_identity"}`))
		assert.NoError(t, err)
	}))
	t.Cleanup(provider.Close)
	common.WeChatServerAddress = provider.URL

	router := gin.New()
	router.Use(sessions.Sessions("wechat_test_session", cookie.NewStore([]byte("wechat-test-session-secret"))))
	router.GET("/api/oauth/wechat", WeChatAuth)
	return router, db
}

func TestWeChatAuthInviterOnlyAppliesOnRegistration(t *testing.T) {
	for _, tc := range []struct {
		name          string
		affiliateCode string
		existingUser  bool
		wantInviterID int
		wantUserCount int64
	}{
		{name: "new user with valid code", affiliateCode: "join1234", wantInviterID: 1, wantUserCount: 3},
		{name: "new user without code", wantInviterID: 0, wantUserCount: 3},
		{name: "new user with invalid code", affiliateCode: "missing", wantInviterID: 0, wantUserCount: 3},
		{name: "existing user keeps inviter", affiliateCode: "join1234", existingUser: true, wantInviterID: 2, wantUserCount: 3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			router, db := setupWeChatInviterTest(t)
			inviters := []model.User{
				{Id: 1, Username: "inviter", AffCode: "join1234", Status: common.UserStatusEnabled},
				{Id: 2, Username: "original-inviter", AffCode: "original", Status: common.UserStatusEnabled},
			}
			require.NoError(t, db.Create(&inviters).Error)
			if tc.existingUser {
				existing := model.User{Username: "existing-wechat", AffCode: "existing", WeChatId: "wechat_test_identity", InviterId: 2, Status: common.UserStatusEnabled}
				require.NoError(t, db.Create(&existing).Error)
			}
			query := url.Values{"code": {"code+test&1"}}
			if tc.affiliateCode != "" {
				query.Set("aff", tc.affiliateCode)
			}
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/oauth/wechat?"+query.Encode(), nil))
			require.Equal(t, http.StatusOK, recorder.Code)
			var response struct {
				Success bool   `json:"success"`
				Message string `json:"message"`
				Data    struct {
					ID int `json:"id"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			require.True(t, response.Success, response.Message)
			assert.NotEmpty(t, recorder.Result().Cookies())
			var user model.User
			require.NoError(t, db.Where("wechat_id = ?", "wechat_test_identity").First(&user).Error)
			assert.Equal(t, response.Data.ID, user.Id)
			assert.Equal(t, tc.wantInviterID, user.InviterId)
			var userCount int64
			require.NoError(t, db.Model(&model.User{}).Count(&userCount).Error)
			assert.Equal(t, tc.wantUserCount, userCount)
		})
	}
}

func TestWeChatBindKeepsExistingInviter(t *testing.T) {
	router, db := setupWeChatInviterTest(t)
	users := []model.User{
		{Id: 1, Username: "original-inviter", AffCode: "original", Status: common.UserStatusEnabled},
		{Id: 2, Username: "other-inviter", AffCode: "other", Status: common.UserStatusEnabled},
		{Id: 3, Username: "existing-user", AffCode: "existing", InviterId: 1, Status: common.UserStatusEnabled},
	}
	require.NoError(t, db.Create(&users).Error)
	router.POST("/api/oauth/wechat/bind", func(c *gin.Context) {
		sessions.Default(c).Set("id", 3)
		WeChatBind(c)
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/oauth/wechat/bind?aff=other", strings.NewReader(`{"code":"code+test&1"}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, response.Message)
	var user model.User
	require.NoError(t, db.First(&user, 3).Error)
	assert.Equal(t, "wechat_test_identity", user.WeChatId)
	assert.Equal(t, 1, user.InviterId)
}
