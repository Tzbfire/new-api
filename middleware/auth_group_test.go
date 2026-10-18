package middleware

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestMain(m *testing.M) {
	gin.SetMode(gin.TestMode)
	common.RedisEnabled = false
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		panic(err)
	}
	model.DB = db
	if err := db.AutoMigrate(&model.User{}); err != nil {
		panic(err)
	}
	os.Exit(m.Run())
}

func TestAuthHelperUsesCachedGroupAfterUpgrade(t *testing.T) {
	require.NoError(t, model.DB.Exec("DELETE FROM users").Error)

	user := &model.User{
		Id:       501,
		Username: "upgrade-user",
		Password: "x",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "codeplan",
	}
	require.NoError(t, model.DB.Create(user).Error)

	router := gin.New()
	store := cookie.NewStore([]byte("auth-group-test"))
	router.Use(sessions.Sessions("session", store))
	router.GET("/probe", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("id", user.Id)
		session.Set("username", user.Username)
		session.Set("role", user.Role)
		session.Set("status", user.Status)
		session.Set("group", "default") // stale session group before upgrade
		require.NoError(t, session.Save())

		c.Request.Header.Set("New-Api-User", "501")
		authHelper(c, common.RoleCommonUser)
		if c.IsAborted() {
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"group":      common.GetContextKeyString(c, constant.ContextKeyUsingGroup),
			"user_group": common.GetContextKeyString(c, constant.ContextKeyUserGroup),
		})
	})

	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	req.Header.Set("New-Api-User", "501")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"group":"codeplan"`)
	assert.Contains(t, rec.Body.String(), `"user_group":"codeplan"`)
}
