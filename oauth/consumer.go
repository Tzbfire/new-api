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

var consumerProviderSlug = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// ConsumerOAuthFlow 只保存服务器构造的回调地址与 PKCE 秘密，不接受客户端 URL。
type ConsumerOAuthFlow struct {
	RedirectURI  string `json:"redirect_uri"`
	CodeVerifier string `json:"code_verifier"`
	BrowserHash  string `json:"browser_hash"`
}

// ConsumerCallbackURI 保持原控制台回调不变，为独立用户前端生成固定同源路径。
func ConsumerCallbackURI(provider string) (string, error) {
	if len(provider) > 128 || !consumerProviderSlug.MatchString(provider) {
		return "", errors.New("invalid consumer OAuth provider")
	}
	origin, err := common.NormalizeOrigin(system_setting.ServerAddress)
	if err != nil || !strings.HasPrefix(origin, "https://") {
		return "", errors.New("consumer OAuth requires a configured HTTPS server address")
	}
	return origin + "/oauth/" + provider, nil
}

// ConsumerOAuthOriginAllowed 将消费者认证请求绑定到配置的精确 HTTPS 源。
func ConsumerOAuthOriginAllowed(request *http.Request) bool {
	expected, err := common.NormalizeOrigin(system_setting.ServerAddress)
	if err != nil || !strings.HasPrefix(expected, "https://") {
		return false
	}
	values := request.Header.Values("Origin")
	if len(values) > 0 {
		if len(values) != 1 {
			return false
		}
		actual, err := common.NormalizeOrigin(values[0])
		return err == nil && actual == expected
	}
	values = request.Header.Values("Referer")
	if len(values) != 1 {
		return false
	}
	referer, err := url.Parse(values[0])
	if err != nil || referer.User != nil {
		return false
	}
	actual, err := common.NormalizeOrigin(referer.Scheme + "://" + referer.Host)
	return err == nil && actual == expected
}

func (flow *ConsumerOAuthFlow) validForProvider(provider string) bool {
	expected, err := ConsumerCallbackURI(provider)
	return err == nil && flow != nil &&
		(flow.RedirectURI == expected || flow.RedirectURI == strings.Replace(expected, "/oauth/", "/app/oauth/", 1)) &&
		len(flow.CodeVerifier) >= 43 && flow.BrowserHash != ""
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

// ApplyConsumerOAuthExchange 将已验证 flow 的回调和 PKCE 绑定到 token 交换。
func ApplyConsumerOAuthExchange(c *gin.Context, values url.Values) {
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
