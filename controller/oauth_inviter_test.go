package controller

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/oauth"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupOAuthInviterTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	previousDB := model.DB
	previousMainDatabaseType := common.MainDatabaseType()
	previousLogDatabaseType := common.LogDatabaseType()
	previousRedisEnabled := common.RedisEnabled
	previousRegisterEnabled := common.RegisterEnabled
	previousQuotaForNewUser := common.QuotaForNewUser
	previousGinMode := gin.Mode()
	paymentSetting := operation_setting.GetPaymentSetting()
	previousComplianceConfirmed := paymentSetting.ComplianceConfirmed
	t.Cleanup(func() {
		model.DB = previousDB
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
		common.RedisEnabled = previousRedisEnabled
		common.RegisterEnabled = previousRegisterEnabled
		common.QuotaForNewUser = previousQuotaForNewUser
		gin.SetMode(previousGinMode)
		paymentSetting.ComplianceConfirmed = previousComplianceConfirmed
	})
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	common.RegisterEnabled = true
	common.QuotaForNewUser = 0
	gin.SetMode(gin.TestMode)
	// Referral attribution must work even when invitation rewards are disabled.
	paymentSetting.ComplianceConfirmed = false

	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "oauth.db")), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	model.DB = db
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserOAuthBinding{}))
	return db
}

func TestOAuthRegistrationInvitationAttribution(t *testing.T) {
	providers := []struct {
		name     string
		provider oauth.Provider
	}{
		{name: "built-in", provider: &oauth.GitHubProvider{}},
		{name: "custom", provider: oauth.NewGenericOAuthProvider(&model.CustomOAuthProvider{
			Id: 1, Name: "Custom", Slug: "custom", Enabled: true,
		})},
	}
	cases := []struct {
		name             string
		affCode          string
		existingUser     bool
		existingReferral bool
		wantReferral     bool
	}{
		{name: "new user with invitation", affCode: "invite", wantReferral: true},
		{name: "new user without invitation"},
		{name: "new user with invalid invitation", affCode: "invalid"},
		{name: "existing user keeps original inviter", affCode: "other", existingUser: true, existingReferral: true, wantReferral: true},
		{name: "existing user without inviter is not attributed later", affCode: "invite", existingUser: true},
	}

	for _, providerCase := range providers {
		for _, testCase := range cases {
			t.Run(providerCase.name+"/"+testCase.name, func(t *testing.T) {
				db := setupOAuthInviterTestDB(t)
				inviter := model.User{Username: "inviter", AffCode: "invite"}
				otherInviter := model.User{Username: "other-inviter", AffCode: "other"}
				require.NoError(t, db.Create(&inviter).Error)
				require.NoError(t, db.Create(&otherInviter).Error)
				oauthUser := &oauth.OAuthUser{ProviderUserID: "12345", Username: "invitee"}
				provider := providerCase.provider
				var existingUser model.User
				if testCase.existingUser {
					existingUser = model.User{Username: oauthUser.Username, AffCode: "own-code"}
					if testCase.existingReferral {
						existingUser.InviterId = inviter.Id
					}
					provider.SetProviderUserID(&existingUser, oauthUser.ProviderUserID)
					require.NoError(t, db.Create(&existingUser).Error)
					if genericProvider, ok := provider.(*oauth.GenericOAuthProvider); ok {
						require.NoError(t, model.CreateUserOAuthBinding(&model.UserOAuthBinding{
							UserId: existingUser.Id, ProviderId: genericProvider.GetProviderId(), ProviderUserId: oauthUser.ProviderUserID,
						}))
					}
				}

				router := gin.New()
				router.Use(sessions.Sessions("session", cookie.NewStore([]byte("oauth-inviter-test-secret"))))
				router.GET("/api/oauth/state", GenerateOAuthCode)
				var user *model.User
				var registrationErr error
				router.GET("/callback", func(c *gin.Context) {
					user, registrationErr = findOrCreateOAuthUser(c, provider, oauthUser, sessions.Default(c))
				})

				stateRecorder := httptest.NewRecorder()
				statePath := "/api/oauth/state?" + url.Values{"aff": {testCase.affCode}}.Encode()
				router.ServeHTTP(stateRecorder, httptest.NewRequest(http.MethodGet, statePath, nil))
				require.Equal(t, http.StatusOK, stateRecorder.Code)
				cookies := stateRecorder.Result().Cookies()
				require.NotEmpty(t, cookies)
				callbackRequest := httptest.NewRequest(http.MethodGet, "/callback", nil)
				for _, sessionCookie := range cookies {
					callbackRequest.AddCookie(sessionCookie)
				}
				router.ServeHTTP(httptest.NewRecorder(), callbackRequest)
				require.NoError(t, registrationErr)
				require.NotNil(t, user)
				if testCase.existingUser {
					assert.Equal(t, existingUser.Id, user.Id)
				}

				wantInviterId := 0
				if testCase.wantReferral {
					wantInviterId = inviter.Id
				}
				assert.Equal(t, wantInviterId, user.InviterId)
				var stored model.User
				require.NoError(t, db.First(&stored, user.Id).Error)
				assert.Equal(t, wantInviterId, stored.InviterId)
				if genericProvider, ok := provider.(*oauth.GenericOAuthProvider); ok {
					boundUser, err := model.GetUserByOAuthBinding(genericProvider.GetProviderId(), oauthUser.ProviderUserID)
					require.NoError(t, err)
					assert.Equal(t, user.Id, boundUser.Id)
				} else {
					assert.Equal(t, oauthUser.ProviderUserID, stored.GitHubId)
				}
			})
		}
	}
}
