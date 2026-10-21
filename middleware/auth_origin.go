package middleware

import (
	"crypto/subtle"
	"net/http"
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
)

// SessionCookieOriginGuard protects cookie-authenticated refresh/logout
// endpoints when secure cookie mode is enabled. In insecure local development
// mode it preserves the legacy behavior and intentionally performs no Origin
// validation. It never adds CORS response headers and must not be installed on
// relay routes.
func SessionCookieOriginGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !common.SessionCookieSecure {
			c.Next()
			return
		}
		origin, ok := requestBrowserOrigin(c.Request)
		if !ok || !isAllowedSessionOrigin(c.Request, origin) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"success": false,
				"code":    "AUTH_ORIGIN_FORBIDDEN",
				"message": "request origin is not allowed",
			})
			return
		}
		c.Next()
	}
}

func requestBrowserOrigin(request *http.Request) (string, bool) {
	originValues := request.Header.Values("Origin")
	if len(originValues) > 1 {
		return "", false
	}
	rawOrigin := ""
	if len(originValues) == 1 {
		if strings.Contains(originValues[0], ",") {
			return "", false
		}
		rawOrigin = originValues[0]
	} else {
		refererValues := request.Header.Values("Referer")
		if len(refererValues) != 1 {
			return "", false
		}
		rawReferer := strings.TrimSpace(refererValues[0])
		referer, err := url.Parse(rawReferer)
		if err != nil || referer.Scheme == "" || referer.Host == "" || referer.User != nil || strings.ContainsAny(rawReferer, "\\#\r\n") {
			return "", false
		}
		rawOrigin = referer.Scheme + "://" + referer.Host
	}
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(rawOrigin)), "https:") {
		origin, err := system_setting.NormalizeOAuthOrigin(rawOrigin)
		return origin, err == nil
	}
	origin, err := common.NormalizeOrigin(rawOrigin)
	return origin, err == nil
}

func isAllowedSessionOrigin(request *http.Request, origin string) bool {
	requestScheme := "http"
	if request.TLS != nil {
		requestScheme = "https"
	}
	requestOrigin, err := common.NormalizeOrigin(requestScheme + "://" + request.Host)
	if err == nil && subtle.ConstantTimeCompare([]byte(origin), []byte(requestOrigin)) == 1 {
		return true
	}
	for _, trustedOrigin := range common.SessionCookieTrustedURLs {
		if subtle.ConstantTimeCompare([]byte(origin), []byte(trustedOrigin)) == 1 {
			return true
		}
	}
	// A configured login origin may refresh its own host-only cookie behind TLS
	// termination. It gains no permission to operate on another host's cookies.
	httpsRequestOrigin, err := system_setting.NormalizeOAuthOrigin("https://" + request.Host)
	if err != nil || origin != httpsRequestOrigin {
		return false
	}
	common.OptionMapRWMutex.RLock()
	serverAddress := system_setting.ServerAddress
	common.OptionMapRWMutex.RUnlock()
	if configured, err := system_setting.NormalizeOAuthOrigin(serverAddress); err == nil && origin == configured {
		return true
	}
	settings := system_setting.OAuthSettingsSnapshot()
	configuredOrigins, err := system_setting.NormalizeOAuthTrustedOrigins(settings.TrustedOrigins)
	if err != nil {
		return false
	}
	for configured := range strings.SplitSeq(configuredOrigins, ",") {
		if origin == configured {
			return true
		}
	}
	return false
}
