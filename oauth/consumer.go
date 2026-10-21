package oauth

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"golang.org/x/oauth2"
)

const consumerOAuthContextKey = "consumer_oauth_callback"
const legacyOAuthRedirectContextKey = "legacy_oauth_redirect"

var consumerProviderSlug = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// ConsumerOAuthFlow 只保存服务器构造的回调地址与 PKCE 秘密，不接受客户端 URL。
type ConsumerOAuthFlow struct {
	Origin       string `json:"origin,omitempty"`
	RedirectURI  string `json:"redirect_uri"`
	CodeVerifier string `json:"code_verifier"`
	BrowserHash  string `json:"browser_hash"`
}

// ConsumerCallbackURI constructs a fixed callback on a currently trusted origin.
// Without an explicit origin it retains the configured server-address default.
func ConsumerCallbackURI(provider string, origins ...string) (string, error) {
	if len(provider) > 128 || !consumerProviderSlug.MatchString(provider) || len(origins) > 1 {
		return "", errors.New("invalid consumer OAuth provider")
	}
	common.OptionMapRWMutex.RLock()
	origin := system_setting.ServerAddress
	common.OptionMapRWMutex.RUnlock()
	if len(origins) == 1 {
		origin = origins[0]
	}
	origin, err := system_setting.NormalizeOAuthOrigin(origin)
	if err != nil || !consumerOAuthOriginTrusted(origin) {
		return "", errors.New("consumer OAuth requires a trusted HTTPS origin")
	}
	return origin + "/oauth/" + provider, nil
}

func consumerOAuthOriginTrusted(origin string) bool {
	if !strings.HasPrefix(origin, "https://") {
		return false
	}
	common.OptionMapRWMutex.RLock()
	serverAddress := system_setting.ServerAddress
	common.OptionMapRWMutex.RUnlock()
	if expected, err := system_setting.NormalizeOAuthOrigin(serverAddress); err == nil && origin == expected {
		return true
	}
	settings := system_setting.OAuthSettingsSnapshot()
	if normalized, err := system_setting.NormalizeOAuthTrustedOrigins(settings.TrustedOrigins); err == nil {
		for trusted := range strings.SplitSeq(normalized, ",") {
			if origin == trusted {
				return true
			}
		}
	}
	if common.SessionCookieSecure {
		for _, trusted := range common.SessionCookieTrustedURLs {
			if normalized, err := system_setting.NormalizeOAuthOrigin(trusted); err == nil && origin == normalized {
				return true
			}
		}
	}
	return false
}

// ConsumerOAuthRequestOrigin accepts only explicit browser metadata and an exact
// configured HTTPS origin. Proxy and Host headers cannot select a callback.
func ConsumerOAuthRequestOrigin(request *http.Request) (string, error) {
	if request == nil {
		return "", errors.New("missing consumer OAuth request")
	}
	values := request.Header.Values("Origin")
	raw := ""
	if len(values) > 0 {
		if len(values) != 1 || strings.Contains(values[0], ",") {
			return "", errors.New("invalid consumer OAuth origin")
		}
		raw = values[0]
	} else {
		values = request.Header.Values("Referer")
		if len(values) != 1 {
			return "", errors.New("missing consumer OAuth origin")
		}
		rawReferer := strings.TrimSpace(values[0])
		referer, err := url.Parse(rawReferer)
		if err != nil || referer.User != nil || referer.Scheme == "" || referer.Host == "" || strings.ContainsAny(rawReferer, "\\#\r\n") {
			return "", errors.New("invalid consumer OAuth referer")
		}
		raw = referer.Scheme + "://" + referer.Host
	}
	origin, err := system_setting.NormalizeOAuthOrigin(raw)
	if err != nil || !consumerOAuthOriginTrusted(origin) {
		return "", errors.New("untrusted consumer OAuth origin")
	}
	return origin, nil
}

func ConsumerOAuthOriginAllowed(request *http.Request) bool {
	_, err := ConsumerOAuthRequestOrigin(request)
	return err == nil
}

// callbackOrigin also supports server-owned flows issued before Origin was saved.
// Only the two fixed consumer callback paths are valid for those legacy flows.
func (flow *ConsumerOAuthFlow) callbackOrigin(provider string) (string, error) {
	if flow == nil {
		return "", errors.New("invalid consumer OAuth flow")
	}
	callback, err := url.Parse(flow.RedirectURI)
	if err != nil || callback.User != nil || callback.RawQuery != "" || callback.Fragment != "" {
		return "", errors.New("invalid consumer OAuth callback")
	}
	origin, err := system_setting.NormalizeOAuthOrigin(callback.Scheme + "://" + callback.Host)
	if err != nil || !consumerOAuthOriginTrusted(origin) {
		return "", errors.New("untrusted consumer OAuth callback")
	}
	if flow.Origin != "" && flow.Origin != origin {
		return "", errors.New("mismatched consumer OAuth origin")
	}
	expected, err := ConsumerCallbackURI(provider, origin)
	if err != nil || (flow.RedirectURI != expected && flow.RedirectURI != origin+"/app/oauth/"+provider) {
		return "", errors.New("invalid consumer OAuth callback")
	}
	return origin, nil
}

func (flow *ConsumerOAuthFlow) MatchesRequestOrigin(request *http.Request) bool {
	origin, err := ConsumerOAuthRequestOrigin(request)
	if err != nil || flow == nil {
		return false
	}
	callback, err := url.Parse(flow.RedirectURI)
	if err != nil {
		return false
	}
	storedOrigin, err := system_setting.NormalizeOAuthOrigin(callback.Scheme + "://" + callback.Host)
	return err == nil && origin == storedOrigin && (flow.Origin == "" || flow.Origin == storedOrigin)
}

func (flow *ConsumerOAuthFlow) validForProvider(provider string) bool {
	_, err := flow.callbackOrigin(provider)
	return err == nil && len(flow.CodeVerifier) >= 43 && flow.BrowserHash != ""
}

// SetConsumerOAuthFlow 只能在验证服务器 flow 和浏览器绑定后调用。
func SetConsumerOAuthFlow(c *gin.Context, provider string, flow *ConsumerOAuthFlow) error {
	if !flow.validForProvider(provider) {
		return errors.New("invalid consumer OAuth flow")
	}
	c.Set(consumerOAuthContextKey, flow)
	c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), consumerOAuthRequestKey{}, true))
	return nil
}

// ConsumerCallbackPath selects the consumer UI from a valid server-owned flow.
// Navigation does not consume the flow; the API still verifies the browser binding.
func ConsumerCallbackPath(provider, state string) (string, error) {
	if len(provider) > 128 || !consumerProviderSlug.MatchString(provider) || len(state) != base64.RawURLEncoding.EncodedLen(model.AuthFlowTokenBytes) {
		return "", model.ErrAuthFlowInvalid
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(state)
	if err != nil || len(decoded) != model.AuthFlowTokenBytes {
		return "", model.ErrAuthFlowInvalid
	}
	flow, err := model.GetAuthFlow(state, model.AuthFlowMatch{Purpose: model.AuthFlowPurposeOAuth, Provider: provider})
	if err != nil {
		return "", err
	}
	var payload struct {
		Consumer *ConsumerOAuthFlow `json:"consumer"`
	}
	if err := common.UnmarshalJsonStr(flow.Payload, &payload); err != nil {
		return "", err
	}
	if payload.Consumer == nil {
		return "", nil
	}
	if !payload.Consumer.validForProvider(provider) {
		return "", errors.New("invalid consumer OAuth flow")
	}
	return "/app/oauth/" + provider, nil
}

// LegacyOAuthUsesBrowserRedirect identifies dashboard providers whose existing
// authorization builders use the browser origin rather than ServerAddress.
func LegacyOAuthUsesBrowserRedirect(provider string) bool {
	switch GetProvider(provider).(type) {
	case *GenericOAuthProvider, *DiscordProvider, *OIDCProvider:
		return true
	default:
		return false
	}
}

// SetLegacyOAuthRedirect validates a stored dashboard callback before exchange.
// It intentionally does not mark the flow as a consumer popup login.
func SetLegacyOAuthRedirect(c *gin.Context, provider, redirectURI string) error {
	if !LegacyOAuthUsesBrowserRedirect(provider) {
		return errors.New("invalid dashboard OAuth provider")
	}
	flow := &ConsumerOAuthFlow{RedirectURI: redirectURI}
	if _, err := flow.callbackOrigin(provider); err != nil {
		return err
	}
	if !flow.MatchesRequestOrigin(c.Request) {
		return errors.New("mismatched dashboard OAuth origin")
	}
	c.Set(legacyOAuthRedirectContextKey, redirectURI)
	return nil
}

// ApplyConsumerOAuthExchange 将已验证 flow 的回调和 PKCE 绑定到 token 交换。
func ApplyConsumerOAuthExchange(c *gin.Context, values url.Values) {
	if value, exists := c.Get(legacyOAuthRedirectContextKey); exists {
		if redirectURI, ok := value.(string); ok {
			values.Set("redirect_uri", redirectURI)
		}
	}
	if value, exists := c.Get(consumerOAuthContextKey); exists {
		if flow, ok := value.(*ConsumerOAuthFlow); ok {
			values.Set("redirect_uri", flow.RedirectURI)
			values.Set("code_verifier", flow.CodeVerifier)
		}
	}
}

// ConsumerAuthorizationURL 由已配置的服务商和固定回调构造授权 URL。
func ConsumerAuthorizationURL(providerName, state string, flow *ConsumerOAuthFlow) (string, error) {
	provider := GetProvider(providerName)
	if provider == nil || !provider.IsEnabled() || flow == nil {
		return "", errors.New("consumer OAuth provider is unavailable")
	}
	var endpoint, clientID, scopes string
	var backendEndpoints []string
	allowPrivateHTTP := false
	switch provider := provider.(type) {
	case *GitHubProvider:
		endpoint, clientID, scopes = "https://github.com/login/oauth/authorize", common.GitHubClientId, "read:user user:email"
	case *DiscordProvider:
		endpoint, clientID, scopes = "https://discord.com/oauth2/authorize", system_setting.GetDiscordSettings().ClientId, "identify openid"
	case *OIDCProvider:
		settings := system_setting.GetOIDCSettings()
		endpoint, clientID, scopes = settings.AuthorizationEndpoint, settings.ClientId, "openid profile email"
		backendEndpoints = []string{settings.TokenEndpoint, settings.UserInfoEndpoint}
	case *LinuxDOProvider:
		endpoint, clientID = "https://connect.linux.do/oauth2/authorize", common.LinuxDOClientId
		backendEndpoints = []string{common.GetEnvOrDefaultString("LINUX_DO_TOKEN_ENDPOINT", "https://connect.linux.do/oauth2/token"), common.GetEnvOrDefaultString("LINUX_DO_USER_ENDPOINT", "https://connect.linux.do/api/user")}
	case *GenericOAuthProvider:
		allowPrivateHTTP = true
		endpoint, clientID, scopes = provider.config.AuthorizationEndpoint, provider.config.ClientId, provider.config.Scopes
		backendEndpoints = []string{provider.config.TokenEndpoint, provider.config.UserInfoEndpoint}
	case *TelegramProvider:
		endpoint, clientID, scopes = TelegramIssuer+"/auth", strings.TrimSpace(system_setting.GetTelegramSettings().ClientID), "openid profile"
	default:
		return "", errors.New("consumer OAuth provider is unsupported")
	}
	authorization, err := url.Parse(endpoint)
	if err != nil || authorization.Scheme != "https" || authorization.Host == "" || authorization.User != nil || clientID == "" {
		return "", errors.New("consumer OAuth authorization is not configured")
	}
	for _, endpoint := range backendEndpoints {
		parsed, err := url.Parse(endpoint)
		if err != nil || (parsed.Scheme != "https" && !(allowPrivateHTTP && parsed.Scheme == "http")) || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
			return "", errors.New("consumer OAuth requires HTTPS provider endpoints")
		}
	}
	values := authorization.Query()
	values.Set("client_id", clientID)
	values.Set("redirect_uri", flow.RedirectURI)
	values.Set("response_type", "code")
	values.Set("state", state)
	values.Set("code_challenge", oauth2.S256ChallengeFromVerifier(flow.CodeVerifier))
	values.Set("code_challenge_method", "S256")
	if scopes != "" {
		values.Set("scope", scopes)
	}
	authorization.RawQuery = values.Encode()
	return authorization.String(), nil
}
