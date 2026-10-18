package middleware

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAuthHelperUsesCurrentGroupAfterUpgrade(t *testing.T) {
	setupDashboardAuthMiddlewareTest(t)
	user := createMiddlewarePATUser(t, "upgrade-user", "test-group-token")
	bundle, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "group-test")
	require.NoError(t, err)
	require.NoError(t, model.DB.Model(user).Update("group", "codeplan").Error)
	require.NoError(t, model.PublishUserAuthCache(user.Id))
	router := gin.New()
	router.GET("/probe", UserAuth(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"group": common.GetContextKeyString(c, constant.ContextKeyUsingGroup), "user_group": common.GetContextKeyString(c, constant.ContextKeyUserGroup)})
	})
	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	req.Header.Set("Authorization", "Bearer "+bundle.AccessToken)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"group":"codeplan","user_group":"codeplan"}`, rec.Body.String())
}
