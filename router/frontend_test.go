package router

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/oauth"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/glebarez/sqlite"
	"golang.org/x/oauth2"
	"gorm.io/gorm"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/setting/frontend_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFrontendRouting(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "index.html"), []byte("consumer"), 0600))
	require.NoError(t, os.Mkdir(filepath.Join(dir, "assets"), 0700))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "assets", "build.js"), []byte("javascript"), 0600))
	t.Setenv("CONSUMER_FRONTEND_DIR", dir)
	original := frontend_setting.GetFrontendSetting().Enabled
	t.Cleanup(func() { frontend_setting.GetFrontendSetting().Enabled = original })
	frontend_setting.GetFrontendSetting().Enabled = true
	r := gin.New()
	r.NoRoute(serveConsumerFrontend([]byte("legacy")), serveRetainedLegacyAssets, func(c *gin.Context) { c.Status(http.StatusNotFound) })
	for _, tc := range []struct {
		path, cookie string
		status       int
		body         string
	}{
		{"/", "", 200, "consumer"}, {"/keys", "legacy", 200, "legacy"}, {"/keys", "consumer", 200, "consumer"},
		{"/model-pricing?group=vip&model=gpt", "", 200, "consumer"},
		{"/model-pricing", "consumer", 200, "consumer"},
		{"/system-settings/billing/payment", "", 200, "legacy"},
		{"/subscriptions", "", 200, "legacy"}, {"/subscriptions", "consumer", 200, "legacy"},
		{"/subscriptions", "legacy", 200, "legacy"},
		{"/console/subscription", "consumer", 200, "legacy"},
		{"/console/chat/saved", "", 200, "legacy"},
		{"/usage-logs/task", "", 200, "legacy"}, {"/oauth/github?code=valid", "", 200, "legacy"},
		{"/unknown", "", 404, ""}, {"/api/unknown", "", 404, ""}, {"/_factory/assets/missing.js", "", 404, ""},
		{"/_factory/assets/build.js", "legacy", 200, "javascript"}, {"/_factory/index.html", "", 404, ""},
	} {
		t.Run(tc.path+tc.cookie, func(t *testing.T) {
			req := httptest.NewRequest("GET", tc.path, nil)
			if tc.cookie != "" {
				req.AddCookie(&http.Cookie{Name: "factory_frontend", Value: tc.cookie})
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			assert.Equal(t, tc.status, w.Code)
			if tc.status == http.StatusNotFound {
				assert.NotContains(t, w.Body.String(), "consumer")
				assert.NotContains(t, w.Body.String(), "legacy")
			} else {
				assert.Equal(t, tc.body, w.Body.String())
			}
			if tc.status == 200 && tc.body != "javascript" {
				assert.Equal(t, "no-store", w.Header().Get("Cache-Control"))
				assert.Equal(t, tc.body, w.Header().Get("X-Factory-Frontend"))
			}
		})
	}
	for _, tc := range []struct{ source, target string }{
		{"/pricing", "/explore"},
		{"/pricing?group=vip&search=image", "/explore?group=vip&search=image"},
		{"/pricing/gpt-image-2?group=vip", "/explore?group=vip&model=gpt-image-2"},
		{"/pricing/vendor%2Fmodel?model=other", "/explore?model=vendor%2Fmodel"},
		{"/dashboard", "/usage"}, {"/dashboard/overview", "/usage"},
		{"/dashboard/models", "/usage"}, {"/dashboard/flow", "/usage"},
		{"/playground?group=vip&model=gpt", "/chat?group=vip&model=gpt"},
		{"/usage-logs/common?requestId=req-1", "/usage?request_id=req-1"},
		{"/usage-logs", "/usage"}, {"/security", "/account"},
		{"/image-studio", "/studio"}, {"/profile", "/account"},
		{"/console", "/usage"}, {"/console/token", "/keys"},
		{"/console/topup?show_history=true&pay=success", "/wallet?pay=success&show_history=true"},
		{"/console/personal", "/account"}, {"/console/log?requestId=req-2", "/usage?request_id=req-2"},
		{"/console/playground", "/chat"}, {"/console/chat", "/chat"},
		{"/index.html", "/"}, {"/sign-in", "/login"}, {"/sign-up", "/register"},
		{"/login?redirect=%2Fkeys", "/login?next=%2Fkeys"},
		{"/forgot-password", "/reset"},
		{"/sign-in?redirect=%2Fconsole%2Ftoken%3Fgroup%3Dvip", "/login?next=%2Fkeys%3Fgroup%3Dvip"},
		{"/sign-in?redirect=https%3A%2F%2Fevil.test", "/login"},
		{"/sign-in?redirect=%2F%2Fevil.test", "/login"},
		{"/sign-in?redirect=%2Fkeys%3Ftoken%3Dsecret%26group%3Dvip", "/login?next=%2Fkeys%3Fgroup%3Dvip"},
	} {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			for _, preference := range []string{"", "consumer", "legacy"} {
				t.Run(method+tc.source+preference, func(t *testing.T) {
					req := httptest.NewRequest(method, tc.source, nil)
					if preference != "" {
						req.AddCookie(&http.Cookie{Name: "factory_frontend", Value: preference})
					}
					w := httptest.NewRecorder()
					r.ServeHTTP(w, req)
					assert.Empty(t, w.Result().Cookies())
					if preference == "legacy" {
						assert.Equal(t, http.StatusOK, w.Code)
						assert.Equal(t, "legacy", w.Body.String())
						return
					}
					assert.Equal(t, http.StatusTemporaryRedirect, w.Code)
					assert.Equal(t, tc.target, w.Header().Get("Location"))
					assert.Equal(t, "no-store", w.Header().Get("Cache-Control"))
					assert.Contains(t, w.Header().Get("Vary"), "Cookie")
				})
			}
		}
	}
	for _, source := range []string{"/login?redirect=%2Fsystem-settings", "/login?next=%2Fsubscriptions", "/sign-in?redirect=%2Fsystem-settings", "/sign-in?redirect=%2Fsubscriptions", "/sign-in?redirect=%2Fchat%2Fsaved", "/user/reset?token=original"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", source, nil))
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "legacy", w.Body.String())
		assert.Empty(t, w.Result().Cookies())
	}
	for _, mode := range []string{"disabled", "missing build"} {
		t.Run("old bookmarks use legacy fallback when "+mode, func(t *testing.T) {
			frontend_setting.GetFrontendSetting().Enabled = mode != "disabled"
			if mode == "missing build" {
				t.Setenv("CONSUMER_FRONTEND_DIR", t.TempDir())
			}
			t.Cleanup(func() { frontend_setting.GetFrontendSetting().Enabled = true })
			for _, source := range []string{"/pricing", "/console/token", "/sign-in", "/index.html"} {
				req := httptest.NewRequest("GET", source, nil)
				req.AddCookie(&http.Cookie{Name: "factory_frontend", Value: "consumer"})
				w := httptest.NewRecorder()
				r.ServeHTTP(w, req)
				assert.Equal(t, http.StatusOK, w.Code)
				assert.Equal(t, "legacy", w.Body.String())
				assert.Empty(t, w.Result().Cookies())
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest("GET", "/model-pricing?group=vip&model=gpt", nil))
			assert.Equal(t, http.StatusTemporaryRedirect, w.Code)
			assert.Equal(t, "/pricing?group=vip&model=gpt", w.Header().Get("Location"))
		})
	}
	for _, tc := range []struct {
		query    string
		status   int
		location string
	}{
		{"version=legacy&return_to=%2Fkeys%3Ftab%3Dmine%23section", 303, "/keys?tab=mine#section"},
		{"version=consumer&return_to=%2Fmodel-pricing%3Fgroup%3Dvip%26model%3Dgpt", 303, "/model-pricing?group=vip&model=gpt"},
		{"version=consumer&return_to=%2Fwallet%3Fcode%3Dsecret%26token%3Dsecret%26tab%3Done", 303, "/wallet?tab=one"},
		{"version=consumer&return_to=%2Fwallet%3Frequest_id%3Dreq-1%26from%3Dorders%26pay%3Dsuccess%26batch%3Dbatch-1%26keyword%3Dbookmark%26state%3Dsecret", 303, "/wallet?batch=batch-1&from=orders&keyword=bookmark&pay=success&request_id=req-1"},
		{"version=consumer&return_to=%2Foauth%2Fgithub%3Fcode%3Dsecret", 400, ""},
		{"version=consumer&return_to=%2Freset%2F%3Ftoken%3Dsecret", 400, ""},
		{"version=consumer&return_to=%2Fwallet%2F%3Fcoupon_code%3DSAVE%26redemption_code%3DGIFT", 303, "/wallet/?coupon_code=SAVE&redemption_code=GIFT"},
		{"version=wrong", 400, ""}, {"version=legacy&return_to=https%3A%2F%2Fevil.test", 400, ""},
		{"version=consumer&return_to=%2F%2Fevil.test", 400, ""}, {"version=consumer&return_to=%2Fapi%2Fstatus", 400, ""},
		{"version=consumer&return_to=%2Fkeys%5Cevil", 400, ""}, {"version=consumer&return_to=%2Fkeys%250a", 400, ""},
		{"version=consumer&return_to=%2F%252Fevil.test", 400, ""},
	} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", "/frontend/switch?"+tc.query, nil))
		assert.Equal(t, tc.status, w.Code)
		assert.Equal(t, tc.location, w.Header().Get("Location"))
		if tc.status == 303 {
			require.Len(t, w.Result().Cookies(), 1)
			cookie := w.Result().Cookies()[0]
			assert.False(t, cookie.HttpOnly)
			assert.Equal(t, http.SameSiteLaxMode, cookie.SameSite)
		}
	}
	for _, preference := range []string{"", "consumer", "legacy", "invalid"} {
		t.Run("bootstrap preference "+preference, func(t *testing.T) {
			req := httptest.NewRequest("GET", "https://gateway.test/frontend/preference.js", nil)
			if preference != "" {
				req.AddCookie(&http.Cookie{Name: "factory_frontend", Value: preference})
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			require.Equal(t, http.StatusOK, w.Code)
			assert.Equal(t, "application/javascript; charset=utf-8", w.Header().Get("Content-Type"))
			assert.Equal(t, "no-store", w.Header().Get("Cache-Control"))
			assert.Contains(t, w.Header().Get("Vary"), "Cookie")
			assert.Contains(t, w.Body.String(), `"consumerAvailable":true`)
			assert.NotContains(t, w.Body.String(), `"/subscriptions":true`)
			if preference == "consumer" || preference == "legacy" {
				assert.Contains(t, w.Body.String(), `"preference":"`+preference+`"`)
				require.Len(t, w.Result().Cookies(), 1)
				cookie := w.Result().Cookies()[0]
				assert.Equal(t, preference, cookie.Value)
				assert.False(t, cookie.HttpOnly)
				assert.True(t, cookie.Secure)
				assert.Equal(t, http.SameSiteLaxMode, cookie.SameSite)
			} else {
				assert.Contains(t, w.Body.String(), `"preference":""`)
				assert.Empty(t, w.Result().Cookies())
			}
		})
	}
	for _, tc := range []struct{ path, preference, version string }{
		{"/keys", "consumer", "consumer"}, {"/keys", "legacy", "legacy"},
		{"/model-pricing", "consumer", "consumer"},
		{"/app/reset", "legacy", "consumer"},
		{"/subscriptions", "consumer", "legacy"},
		{"/index.html", "legacy", "legacy"},
	} {
		req := httptest.NewRequest("HEAD", tc.path, nil)
		req.AddCookie(&http.Cookie{Name: "factory_frontend", Value: tc.preference})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, tc.version, w.Header().Get("X-Factory-Frontend"), tc.path)
	}
	for _, mode := range []string{"legacy preference", "disabled", "missing build"} {
		t.Run("authentication pages preserve original URLs with "+mode, func(t *testing.T) {
			frontend_setting.GetFrontendSetting().Enabled = mode != "disabled"
			if mode == "missing build" {
				t.Setenv("CONSUMER_FRONTEND_DIR", t.TempDir())
			}
			t.Cleanup(func() { frontend_setting.GetFrontendSetting().Enabled = true })
			for _, source := range []string{"/login?next=%2Fkeys", "/register?next=%2Fwallet", "/reset?email=user%40example.test&token=original", "/reset?email=user%40example.test", "/reset?token=original"} {
				req := httptest.NewRequest("GET", source, nil)
				if mode == "legacy preference" {
					req.AddCookie(&http.Cookie{Name: "factory_frontend", Value: "legacy"})
				}
				w := httptest.NewRecorder()
				r.ServeHTTP(w, req)
				assert.Equal(t, http.StatusOK, w.Code, source)
				assert.Equal(t, "legacy", w.Body.String(), source)
				assert.Empty(t, w.Header().Get("Location"), source)
				assert.Equal(t, source, req.URL.RequestURI())
			}
			req := httptest.NewRequest("GET", "/reset", nil)
			if mode == "legacy preference" {
				req.AddCookie(&http.Cookie{Name: "factory_frontend", Value: "legacy"})
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			assert.Equal(t, http.StatusTemporaryRedirect, w.Code)
			assert.Equal(t, "/forgot-password", w.Header().Get("Location"))
		})
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/app/reset?token=legitimate", nil))
	assert.Equal(t, 200, w.Code)
	assert.Equal(t, "consumer", w.Body.String())
	for _, tc := range []struct{ source, target string }{
		{"/studio?model=sample", "/image-studio?model=sample"},
		{"/library", "/image-studio"}, {"/orders?tab=all", "/wallet?tab=all&show_history=true"},
		{"/chat", "/playground"}, {"/account", "/profile"},
		{"/plans?from=orders", "/wallet?from=orders"},
		{"/model-pricing?group=vip&model=gpt", "/pricing?group=vip&model=gpt"},
	} {
		req := httptest.NewRequest("GET", tc.source, nil)
		req.AddCookie(&http.Cookie{Name: "factory_frontend", Value: "legacy"})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		assert.Equal(t, http.StatusTemporaryRedirect, w.Code)
		assert.Equal(t, tc.target, w.Header().Get("Location"))
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/app/keys?tab=all", nil))
	assert.Equal(t, http.StatusTemporaryRedirect, w.Code)
	assert.Equal(t, "/keys?tab=all", w.Header().Get("Location"))
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/app/model-pricing?group=vip", nil))
	assert.Equal(t, http.StatusTemporaryRedirect, w.Code)
	assert.Equal(t, "/model-pricing?group=vip", w.Header().Get("Location"))
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/app/subscriptions?from=bookmark", nil))
	assert.Equal(t, http.StatusTemporaryRedirect, w.Code)
	assert.Equal(t, "/plans?from=bookmark", w.Header().Get("Location"))
	req := httptest.NewRequest("GET", "/app/oauth/github?code=legitimate&state=original", nil)
	req.AddCookie(&http.Cookie{Name: "factory_frontend", Value: "legacy"})
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "consumer", w.Body.String())
	previous := t.TempDir()
	require.NoError(t, os.Mkdir(filepath.Join(previous, "assets"), 0700))
	require.NoError(t, os.WriteFile(filepath.Join(previous, "assets", "old.js"), []byte("old-build"), 0600))
	t.Setenv("CONSUMER_FRONTEND_PREVIOUS_DIRS", previous)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/_factory/assets/old.js", nil))
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "old-build", w.Body.String())
	for _, source := range []string{"/wallet/", "/studio/", "/system-settings/", "/channels///", "/console/topup/", "/app/subscriptions/"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", source+"?tab=one", nil))
		assert.Equal(t, http.StatusTemporaryRedirect, w.Code)
		assert.Equal(t, strings.TrimRight(source, "/")+"?tab=one", w.Header().Get("Location"))
	}
	require.NoError(t, os.Mkdir(filepath.Join(previous, "static"), 0700))
	require.NoError(t, os.WriteFile(filepath.Join(previous, "static", "old.js"), []byte("old-static"), 0600))
	require.NoError(t, os.WriteFile(filepath.Join(previous, "favicon.ico"), []byte("old-icon"), 0600))
	t.Setenv("LEGACY_FRONTEND_PREVIOUS_DIRS", previous)
	for _, tc := range []struct{ source, body string }{
		{"/app/static/old.js", "old-static"}, {"/app/favicon.ico", "old-icon"},
		{"/static/old.js", "old-static"}, {"/favicon.ico", "old-icon"},
	} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", tc.source, nil))
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, tc.body, w.Body.String())
	}
	secret := filepath.Join(t.TempDir(), "secret.js")
	require.NoError(t, os.WriteFile(secret, []byte("secret"), 0600))
	require.NoError(t, os.Symlink(secret, filepath.Join(previous, "static", "escape.js")))
	for _, source := range []string{"/static/escape.js", "/app/static/escape.js", "/app/static/missing.js", "/static/missing.js", "/app/index.html", "/api/secret.js", "/_factory/assets/../index.html"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", source, nil))
		assert.Equal(t, http.StatusNotFound, w.Code)
		assert.NotContains(t, w.Body.String(), "consumer")
		assert.NotContains(t, w.Body.String(), "secret")
	}
	// An empty index is stat-able, but cannot be served as a usable UI.
	require.NoError(t, os.WriteFile(filepath.Join(dir, "index.html"), nil, 0600))
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/studio?model=sample", nil))
	assert.Equal(t, http.StatusTemporaryRedirect, w.Code)
	assert.Equal(t, "/image-studio?model=sample", w.Header().Get("Location"))
	require.NoError(t, os.Remove(filepath.Join(dir, "index.html")))
	require.NoError(t, os.Mkdir(filepath.Join(dir, "index.html"), 0700))
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/studio", nil))
	assert.Equal(t, http.StatusTemporaryRedirect, w.Code)
	assert.Equal(t, "/image-studio", w.Header().Get("Location"))
	require.NoError(t, os.Remove(filepath.Join(dir, "index.html")))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "index.html"), []byte("consumer"), 0600))
	for _, entry := range []string{"/system-settings", "/system-settings/site/system-info", "/console/subscription", "/console/channel", "/dashboard/users"} {
		t.Run("management preserves user preference "+entry, func(t *testing.T) {
			req := httptest.NewRequest("GET", entry, nil)
			req.AddCookie(&http.Cookie{Name: "factory_frontend", Value: "consumer"})
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			assert.Equal(t, "legacy", w.Body.String())
			assert.Empty(t, w.Result().Cookies())
		})
	}
	t.Run("return from management explicitly selects the complete legacy console", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/frontend/switch?version=legacy&return_to=%2Fdashboard%2Foverview", nil)
		req.AddCookie(&http.Cookie{Name: "factory_frontend", Value: "consumer"})
		response := httptest.NewRecorder()
		r.ServeHTTP(response, req)
		require.Equal(t, http.StatusSeeOther, response.Code)
		assert.Equal(t, "/dashboard/overview", response.Header().Get("Location"))
		require.Len(t, response.Result().Cookies(), 1)
		preference := response.Result().Cookies()[0]
		assert.Equal(t, "factory_frontend", preference.Name)
		assert.Equal(t, "legacy", preference.Value)
		assert.Greater(t, preference.MaxAge, 0)
		for _, entry := range []string{"/dashboard/overview", "/pricing", "/keys", "/system-settings"} {
			req := httptest.NewRequest(http.MethodGet, entry, nil)
			req.AddCookie(preference)
			response := httptest.NewRecorder()
			r.ServeHTTP(response, req)
			assert.Equal(t, http.StatusOK, response.Code, entry)
			assert.Equal(t, "legacy", response.Body.String(), entry)
		}
		// Simply opening management still preserves the consumer preference;
		// ordinary old bookmarks keep their existing translation behavior.
		req = httptest.NewRequest(http.MethodGet, "/dashboard/overview", nil)
		req.AddCookie(&http.Cookie{Name: "factory_frontend", Value: "consumer"})
		response = httptest.NewRecorder()
		r.ServeHTTP(response, req)
		assert.Equal(t, http.StatusTemporaryRedirect, response.Code)
		assert.Equal(t, "/usage", response.Header().Get("Location"))
		assert.Empty(t, response.Result().Cookies())
	})
	for _, entry := range []string{"/", "/app/keys", "/app/oauth/github?code=callback"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", entry, nil))
		assert.Empty(t, w.Result().Cookies(), entry)
	}
	frontend_setting.GetFrontendSetting().Enabled = false
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	assert.Equal(t, "legacy", w.Body.String())
	assert.Equal(t, "legacy", w.Header().Get("X-Factory-Frontend"))
	assert.Empty(t, w.Result().Cookies())
	w = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "/frontend/preference.js", nil)
	req.AddCookie(&http.Cookie{Name: "factory_frontend", Value: "consumer"})
	r.ServeHTTP(w, req)
	assert.Contains(t, w.Body.String(), `"consumerAvailable":false`)
	assert.Contains(t, w.Body.String(), `"preference":"consumer"`)
	w = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "/console/token", nil)
	req.AddCookie(&http.Cookie{Name: "factory_frontend", Value: "consumer"})
	r.ServeHTTP(w, req)
	assert.Equal(t, "legacy", w.Body.String())
	assert.Empty(t, w.Result().Cookies())
	frontend_setting.GetFrontendSetting().Enabled = true
	require.NoError(t, os.Remove(filepath.Join(dir, "index.html")))
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	assert.Equal(t, "legacy", w.Body.String())
	assert.Equal(t, "legacy", w.Header().Get("X-Factory-Frontend"))
	assert.Empty(t, w.Result().Cookies())
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/frontend/preference.js", nil))
	assert.Contains(t, w.Body.String(), `"consumerAvailable":false`)
	w = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "/system-settings", nil)
	req.AddCookie(&http.Cookie{Name: "factory_frontend", Value: "consumer"})
	r.ServeHTTP(w, req)
	assert.Equal(t, "legacy", w.Body.String())
	assert.Empty(t, w.Result().Cookies())
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/app/reset?token=legitimate", nil))
	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	assert.NotContains(t, w.Body.String(), "legacy")
}

func TestOAuthCallbackKeepsRegisteredURIAndOriginalFrontend(t *testing.T) {
	originalDB := model.DB
	originalAddress := system_setting.ServerAddress
	originalEnabled := frontend_setting.GetFrontendSetting().Enabled
	t.Cleanup(func() {
		model.DB = originalDB
		system_setting.ServerAddress = originalAddress
		frontend_setting.GetFrontendSetting().Enabled = originalEnabled
	})
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	require.NoError(t, db.AutoMigrate(&model.AuthFlow{}))
	model.DB = db
	system_setting.ServerAddress = "https://factory.example"
	frontend_setting.GetFrontendSetting().Enabled = true
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "index.html"), []byte("consumer"), 0600))
	t.Setenv("CONSUMER_FRONTEND_DIR", dir)
	r := gin.New()
	r.NoRoute(serveConsumerFrontend([]byte("legacy")))
	payload, err := common.Marshal(map[string]any{"consumer": &oauth.ConsumerOAuthFlow{RedirectURI: "https://factory.example/oauth/yaohuo", CodeVerifier: oauth2.GenerateVerifier(), BrowserHash: "synthetic-browser-hash"}})
	require.NoError(t, err)
	for _, consumer := range []bool{true, false} {
		body := "{}"
		if consumer {
			body = string(payload)
		}
		state, _, err := model.CreateAuthFlow(model.AuthFlowCreate{Purpose: model.AuthFlowPurposeOAuth, Provider: "yaohuo", Intent: model.AuthFlowIntentLogin, Payload: body, ExpiresAt: time.Now().Add(time.Minute)})
		require.NoError(t, err)
		for _, preference := range []string{"consumer", "legacy"} {
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				req := httptest.NewRequest(method, "/oauth/yaohuo?code=adapter-code&state="+state+"&adapter_relay=1", nil)
				req.AddCookie(&http.Cookie{Name: "factory_frontend", Value: preference})
				w := httptest.NewRecorder()
				r.ServeHTTP(w, req)
				if consumer {
					assert.Equal(t, http.StatusTemporaryRedirect, w.Code)
					assert.Equal(t, "/app/oauth/yaohuo?code=adapter-code&state="+state+"&adapter_relay=1", w.Header().Get("Location"))
					assert.Equal(t, "no-referrer", w.Header().Get("Referrer-Policy"))
				} else {
					assert.Equal(t, http.StatusOK, w.Code)
					assert.Equal(t, "legacy", w.Body.String())
				}
				assert.Equal(t, "no-store", w.Header().Get("Cache-Control"))
				_, err = model.GetAuthFlow(state, model.AuthFlowMatch{Purpose: model.AuthFlowPurposeOAuth, Provider: "yaohuo"})
				require.NoError(t, err, "rendering must not consume authorization")
			}
		}
	}
	for _, query := range []string{"code=synthetic&state=forged&adapter_relay=1", "code=synthetic&adapter_relay=1"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/oauth/yaohuo?"+query, nil))
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "legacy", w.Body.String())
		assert.Empty(t, w.Header().Get("Location"))
	}
}
