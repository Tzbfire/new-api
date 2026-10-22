package router

import (
	"bytes"
	_ "embed"
	"html"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"unicode"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/oauth"
	"github.com/QuantumNous/new-api/setting/frontend_setting"
	"github.com/gin-gonic/gin"
	htmltoken "golang.org/x/net/html"
)

//go:embed frontend-preference.js
var frontendPreferenceScript []byte

var consumerPages = map[string]bool{
	"/": true, "/login": true, "/register": true, "/reset": true,
	"/explore": true, "/chat": true, "/studio": true, "/library": true,
	"/keys": true, "/usage": true, "/wallet": true, "/plans": true,
	"/orders": true, "/account": true, "/image-studio": true,
	"/profile": true, "/model-pricing": true,
}

// Only user pages with a consumer equivalent participate in version selection.
// Administrator tools and original callbacks continue to use their own routes.
var consumerAliases = map[string]string{
	"/index.html": "/", "/pricing": "/explore",
	"/dashboard": "/usage", "/dashboard/overview": "/usage",
	"/dashboard/models": "/usage", "/dashboard/flow": "/usage",
	"/playground": "/chat", "/usage-logs": "/usage", "/usage-logs/common": "/usage",
	"/security": "/account", "/profile": "/account", "/image-studio": "/studio",
	"/console": "/usage", "/console/token": "/keys", "/console/topup": "/wallet",
	"/console/personal": "/account", "/console/log": "/usage",
	"/console/playground": "/chat", "/console/chat": "/chat",
	"/sign-in": "/login", "/sign-up": "/register", "/forgot-password": "/reset",
}

func consumerRoute(p string) string {
	if target := consumerAliases[p]; target != "" {
		return target
	}
	if consumerPages[p] {
		return p
	}
	if model, ok := strings.CutPrefix(p, "/pricing/"); ok && model != "" {
		return "/explore"
	}
	return ""
}

// consumerLocation keeps ordinary bookmark context when translating page URLs.
// It is also used after the switch-return allowlist has removed callback secrets.
func consumerLocation(source *url.URL) string {
	target := consumerRoute(source.Path)
	if target == "" {
		return ""
	}
	query := source.Query()
	if model, ok := strings.CutPrefix(source.Path, "/pricing/"); ok {
		query.Set("model", model)
	}
	if target == "/usage" && query.Has("requestId") {
		if !query.Has("request_id") {
			query.Set("request_id", query.Get("requestId"))
		}
		query.Del("requestId")
	}
	result := url.URL{Path: target, RawQuery: query.Encode(), Fragment: source.Fragment}
	return result.String()
}

func consumerPage(p string) bool {
	return consumerPages[p] || (strings.HasPrefix(p, "/oauth/") && len(strings.Split(strings.Trim(p, "/"), "/")) == 2)
}

func legacyPage(p string) bool {
	if consumerRoute(p) != "" {
		return true
	}
	switch p {
	case "/sign-in", "/sign-up", "/forgot-password", "/otp", "/user/reset", "/oauth", "/pricing", "/rankings", "/about", "/setup", "/user-agreement", "/privacy-policy", "/401", "/403", "/404", "/500", "/503", "/forbidden", "/channels", "/system-info", "/task-plugins", "/redemption-codes", "/users", "/chat2link", "/dashboard", "/security", "/playground", "/usage-logs", "/models", "/system-settings", "/console", "/subscriptions":
		return true
	}
	parts := strings.Split(strings.Trim(p, "/"), "/")
	if len(parts) == 2 {
		switch parts[0] {
		case "oauth", "chat", "pricing", "dashboard", "usage-logs", "models", "errors":
			return parts[1] != ""
		}
	}
	if strings.HasPrefix(p, "/console/") {
		return !strings.Contains(p, ".")
	}
	if len(parts) >= 2 && len(parts) <= 3 && parts[0] == "system-settings" {
		switch parts[1] {
		case "auth", "billing", "content", "models", "operations", "request-policies", "security", "site":
			return true
		}
	}
	return false
}

// frontendReturnPath accepts only known UI locations and excludes callback secrets.
func frontendReturnPath(raw string) (string, bool) {
	if raw == "" {
		return "/", true
	}
	if !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") || strings.Contains(raw, "\\") || strings.IndexFunc(raw, unicode.IsControl) >= 0 {
		return "", false
	}
	decoded, decodeErr := url.PathUnescape(raw)
	if decodeErr != nil || strings.Contains(decoded, "\\") || strings.IndexFunc(decoded, unicode.IsControl) >= 0 {
		return "", false
	}
	u, err := url.Parse(raw)
	if err != nil || u.IsAbs() || u.Host != "" || u.Opaque != "" {
		return "", false
	}
	normalizedPath := strings.TrimRight(u.Path, "/")
	if normalizedPath == "" {
		normalizedPath = "/"
	}
	if strings.Contains(u.Path, "\\") || strings.IndexFunc(u.Path, unicode.IsControl) >= 0 || path.Clean(u.Path) != normalizedPath || !legacyPage(normalizedPath) {
		return "", false
	}
	// A version switch never resumes an authentication callback. Only ordinary
	// interface query fields survive; auth codes and tokens are never forwarded.
	if normalizedPath == "/reset" || normalizedPath == "/user/reset" || normalizedPath == "/oauth" || strings.HasPrefix(normalizedPath, "/oauth/") {
		return "", false
	}
	q := u.Query()
	for key := range q {
		switch key {
		case "tab", "page", "page_size", "q", "search", "keyword", "model", "group", "status", "type", "show_history", "coupon_code", "redemption_code", "request_id", "requestId", "from", "pay", "batch":
		default:
			q.Del(key)
		}
	}
	u.RawQuery = q.Encode()
	if strings.ContainsAny(u.Fragment, "=&?") {
		u.Fragment = ""
	}

	return u.String(), true
}

func serveConsumerFrontend(legacyIndex []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			return
		}
		p := c.Request.URL.Path
		if p == "/frontend/preference.js" {
			preference, _ := c.Cookie("factory_frontend")
			if preference != "consumer" && preference != "legacy" {
				preference = ""
			}
			common.OptionMapRWMutex.RLock()
			enabled := frontend_setting.GetFrontendSetting().Enabled
			common.OptionMapRWMutex.RUnlock()
			config, err := common.Marshal(map[string]any{
				"preference": preference, "consumerAvailable": enabled && frontend_setting.Available(),
				"consumerPages": consumerPages, "consumerAliases": consumerAliases,
			})
			if err != nil {
				c.AbortWithStatus(http.StatusInternalServerError)
				return
			}
			c.Header("Cache-Control", "no-store")
			c.Writer.Header().Add("Vary", "Cookie")
			c.Header("X-Content-Type-Options", "nosniff")
			if preference != "" {
				// Replace historical HttpOnly preference cookies. Authentication
				// cookies are unrelated and remain inaccessible to this script.
				c.SetSameSite(http.SameSiteLaxMode)
				c.SetCookie("factory_frontend", preference, 31536000, "/", "", c.Request.TLS != nil, false)
			}
			body := strings.Replace(string(frontendPreferenceScript), "/* factory frontend config */", string(config), 1)
			c.Data(http.StatusOK, "application/javascript; charset=utf-8", []byte(body))
			c.Abort()
			return
		}
		if p != "/" && strings.HasSuffix(p, "/") {
			canonical := strings.TrimRight(p, "/")
			appPath := strings.TrimPrefix(canonical, "/app")
			if legacyPage(canonical) || strings.HasPrefix(canonical, "/app/") && (consumerPage(appPath) || appPath == "/reset" || appPath == "/subscriptions") {
				if c.Request.URL.RawQuery != "" {
					canonical += "?" + c.Request.URL.RawQuery
				}
				c.Header("Cache-Control", "no-store")
				c.Redirect(http.StatusTemporaryRedirect, canonical)
				c.Abort()
				return
			}
		}
		if p == "/frontend/switch" {
			version := c.Query("version")
			target, ok := frontendReturnPath(c.Query("return_to"))
			if !ok || (version != "legacy" && version != "consumer") {
				c.AbortWithStatus(http.StatusBadRequest)
				return
			}
			c.Header("Cache-Control", "no-store")
			c.SetSameSite(http.SameSiteLaxMode)
			c.SetCookie("factory_frontend", version, 31536000, "/", "", c.Request.TLS != nil, false)
			c.Redirect(http.StatusSeeOther, target)
			c.Abort()
			return
		}
		if strings.HasPrefix(p, "/_factory/") || strings.HasPrefix(p, "/app/static/") || strings.HasPrefix(p, "/app/assets/") || (strings.HasPrefix(p, "/app/") && !strings.Contains(strings.TrimPrefix(p, "/app/"), "/") && path.Ext(p) != "") {
			relative := strings.TrimPrefix(p, "/_factory/")
			if strings.HasPrefix(p, "/app/") {
				relative = strings.TrimPrefix(p, "/app/")
			}
			dirs := []string{os.Getenv("CONSUMER_FRONTEND_DIR")}
			dirs = append(dirs, filepath.SplitList(os.Getenv("CONSUMER_FRONTEND_PREVIOUS_DIRS"))...)
			if !serveFrontendAsset(c, relative, dirs) {
				c.AbortWithStatus(http.StatusNotFound)
			}
			return
		}
		// Keep provider-registered callbacks (including external adapter relays)
		// unchanged. Only a valid server flow can select the consumer callback;
		// frontend preferences and query flags are not authorization evidence.
		if provider, callback := strings.CutPrefix(p, "/oauth/"); callback && provider != "" && !strings.Contains(provider, "/") && c.Query("state") != "" {
			if target, err := oauth.ConsumerCallbackPath(provider, c.Query("state")); err == nil && target != "" {
				c.Header("Cache-Control", "no-store")
				c.Header("Referrer-Policy", "no-referrer")
				location := url.URL{Path: target, RawQuery: c.Request.URL.RawQuery}
				c.Redirect(http.StatusTemporaryRedirect, location.String())
				c.Abort()
				return
			}
		}
		callbackProvider, callback := strings.CutPrefix(p, "/app/oauth/")
		validProvider := callback && callbackProvider != "" && strings.IndexFunc(callbackProvider, func(r rune) bool {
			return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_')
		}) < 0
		if p == "/app/reset" || validProvider {
			c.Header("Cache-Control", "no-store")
			c.Header("Referrer-Policy", "no-referrer")
			if !frontend_setting.Available() {
				c.AbortWithStatus(http.StatusServiceUnavailable)
				return
			}
			index, err := os.ReadFile(filepath.Join(os.Getenv("CONSUMER_FRONTEND_DIR"), "index.html"))
			if err != nil || len(index) == 0 {
				c.AbortWithStatus(http.StatusServiceUnavailable)
				return
			}
			c.Header("X-Factory-Frontend", "consumer")
			c.Data(http.StatusOK, "text/html; charset=utf-8", renderFrontendIndex(index))
			c.Abort()
			return
		}
		if p == "/app" || strings.HasPrefix(p, "/app/") {
			target := strings.TrimPrefix(p, "/app")
			if target == "/subscriptions" {
				// Historical consumer bookmarks used this alias; the unprefixed
				// route belongs exclusively to the legacy administrator interface.
				target = "/plans"
			}
			if target == "" {
				target = "/"
			}
			if !consumerPage(target) {
				c.AbortWithStatus(http.StatusNotFound)
				return
			}
			if c.Request.URL.RawQuery != "" {
				target += "?" + c.Request.URL.RawQuery
			}
			c.Header("Cache-Control", "no-store")
			c.Redirect(http.StatusTemporaryRedirect, target)
			c.Abort()
			return
		}
		if !legacyPage(p) {
			return
		}
		common.OptionMapRWMutex.RLock()
		enabled := frontend_setting.GetFrontendSetting().Enabled
		common.OptionMapRWMutex.RUnlock()
		preference, _ := c.Cookie("factory_frontend")
		target := consumerLocation(c.Request.URL)
		// Legacy login links can carry a destination for an administrator or a
		// legacy-only feature. Finish those logins in the original application;
		// ordinary user destinations are validated and translated for consumer.
		authEntry := p == "/sign-in" || p == "/sign-up" || p == "/login" || p == "/register"
		if authEntry {
			query := c.Request.URL.Query()
			rawNext := query.Get("next")
			if rawNext == "" {
				rawNext = query.Get("redirect")
			}
			query.Del("next")
			query.Del("redirect")
			if rawNext != "" {
				if safeNext, ok := frontendReturnPath(rawNext); ok {
					next, _ := url.Parse(safeNext)
					next.Path = strings.TrimRight(next.Path, "/")
					if next.Path == "" {
						next.Path = "/"
					}
					destination := consumerLocation(next)
					if destination == "" {
						target = ""
					}
					if destination != "" && next.Path != "/sign-in" && next.Path != "/sign-up" && next.Path != "/login" && next.Path != "/register" && next.Path != "/forgot-password" {
						query.Set("next", destination)
					}
				}
			}
			if target != "" {
				location := url.URL{Path: consumerRoute(p), RawQuery: query.Encode()}
				target = location.String()
			}
		}
		// The original interface remains the default until the user opts in.
		useConsumer := enabled && preference == "consumer" && target != ""
		var consumerIndex []byte
		if useConsumer && os.Getenv("CONSUMER_FRONTEND_DIR") != "" {
			consumerIndex, _ = os.ReadFile(filepath.Join(os.Getenv("CONSUMER_FRONTEND_DIR"), "index.html"))
		}
		available := len(consumerIndex) > 0
		if useConsumer && available && (consumerRoute(p) != p || authEntry && target != c.Request.URL.RequestURI()) {
			c.Header("Cache-Control", "no-store")
			c.Writer.Header().Add("Vary", "Cookie")
			c.Redirect(http.StatusTemporaryRedirect, target)
			c.Abort()
			return
		}
		if !useConsumer || !available {
			target := ""
			switch p {
			case "/reset":
				// The consumer combines recovery request and confirmation in one
				// page; the legacy application has a separate request form.
				if c.Query("email") == "" && c.Query("token") == "" {
					target = "/forgot-password"
				}
			case "/studio", "/library":
				target = "/image-studio"
			case "/account":
				target = "/profile"
			case "/usage":
				target = "/usage-logs"
			case "/plans":
				target = "/wallet"
			case "/explore", "/model-pricing":
				target = "/pricing"
			case "/chat":
				target = "/playground"
			case "/orders":
				target = "/wallet"
			}
			if target != "" {
				query := c.Request.URL.RawQuery
				if p == "/orders" {
					if query != "" {
						query += "&"
					}
					query += "show_history=true"
				}
				if query != "" {
					target += "?" + query
				}
				c.Header("Cache-Control", "no-store")
				c.Redirect(http.StatusTemporaryRedirect, target)
				c.Abort()
				return
			}
		}
		body := legacyIndex
		version := "legacy"
		if useConsumer && available {
			body = consumerIndex
			version = "consumer"
		}
		c.Header("X-Factory-Frontend", version)
		c.Header("Cache-Control", "no-store")
		c.Writer.Header().Add("Vary", "Cookie")
		c.Data(http.StatusOK, "text/html; charset=utf-8", renderFrontendIndex(body))
		c.Abort()
	}
}

// renderFrontendIndex fills the initial title from the same cached settings as
// /api/status. The public snapshot prevents client code from restoring stale titles.
func renderFrontendIndex(index []byte) []byte {
	common.OptionMapRWMutex.RLock()
	name := strings.TrimSpace(common.SystemName)
	common.OptionMapRWMutex.RUnlock()
	if name == "" {
		return index
	}
	escapedName := html.EscapeString(name)
	tokens := htmltoken.NewTokenizer(bytes.NewReader(index))
	var rendered bytes.Buffer
	rendered.Grow(len(index) + len(escapedName))
	inTitle := false
	offset := 0
	for {
		kind := tokens.Next()
		if kind == htmltoken.ErrorToken {
			return index
		}
		// Token parsing can unescape attributes in the tokenizer's buffer.
		raw := string(tokens.Raw())
		offset += len(raw)
		if kind == htmltoken.StartTagToken || kind == htmltoken.SelfClosingTagToken || kind == htmltoken.EndTagToken {
			token := tokens.Token()
			if token.Data == "meta" && kind != htmltoken.EndTagToken {
				for _, attr := range token.Attr {
					if attr.Key == "name" && attr.Val == "title" {
						raw = `<meta name="title" content="` + escapedName + `">`
						break
					}
				}
			}
			if token.Data == "title" {
				inTitle = kind == htmltoken.StartTagToken
				rendered.WriteString(raw)
				if inTitle {
					rendered.WriteString(escapedName)
				}
				continue
			}
			if token.Data == "head" && kind == htmltoken.EndTagToken || token.Data == "body" {
				rendered.WriteString(`<meta name="new-api-system-name" content="` + escapedName + `">`)
				rendered.WriteString(raw)
				rendered.Write(index[offset:])
				return rendered.Bytes()
			}
		}
		if !inTitle {
			rendered.WriteString(raw)
		}
	}
}

// serveFrontendAsset serves only regular public build resources. os.Root keeps
// both traversal and symlinks inside each explicitly configured build directory.
func serveFrontendAsset(c *gin.Context, relative string, dirs []string) bool {
	if relative == "" || path.Clean(relative) != relative || strings.HasPrefix(relative, "/") || strings.Contains(relative, "\\") {
		return false
	}
	for segment := range strings.SplitSeq(relative, "/") {
		if strings.HasPrefix(segment, ".") {
			return false
		}
	}
	switch strings.ToLower(path.Ext(relative)) {
	case ".js", ".mjs", ".css", ".map", ".svg", ".png", ".ico", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".woff", ".woff2", ".ttf", ".eot", ".txt", ".webmanifest":
	case ".json":
		if relative != "manifest.json" {
			return false
		}
	default:
		return false
	}
	for _, dir := range dirs {
		if dir == "" {
			continue
		}
		root, err := os.OpenRoot(dir)
		if err != nil {
			continue
		}
		file, err := root.Open(filepath.FromSlash(relative))
		root.Close()
		if err != nil {
			continue
		}
		info, err := file.Stat()
		if err != nil || !info.Mode().IsRegular() {
			file.Close()
			continue
		}
		c.Header("Cache-Control", "public, max-age=604800")
		http.ServeContent(c.Writer, c.Request, relative, info.ModTime(), file)
		file.Close()
		c.Abort()
		return true
	}
	return false
}

func serveRetainedLegacyAssets(c *gin.Context) {
	if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
		return
	}
	p := c.Request.URL.Path
	relative := strings.TrimPrefix(p, "/")
	// Legacy builds use /static, and some older builds use /assets. Other
	// public resources must be root files, never management or API paths.
	if !strings.HasPrefix(p, "/static/") && !strings.HasPrefix(p, "/assets/") && strings.Contains(relative, "/") {
		return
	}
	if legacyPage(p) {
		return
	}
	serveFrontendAsset(c, relative, filepath.SplitList(os.Getenv("LEGACY_FRONTEND_PREVIOUS_DIRS")))
}
