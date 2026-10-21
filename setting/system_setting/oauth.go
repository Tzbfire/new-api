package system_setting

import (
	"errors"
	"net/url"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

type OAuthSettings struct {
	TrustedOrigins string `json:"trusted_origins"`
}

var defaultOAuthSettings OAuthSettings

func init() {
	config.GlobalConfig.Register("oauth", &defaultOAuthSettings)
}

func GetOAuthSettings() *OAuthSettings {
	return &defaultOAuthSettings
}

func OAuthSettingsSnapshot() OAuthSettings {
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	return defaultOAuthSettings
}

// NormalizeOAuthOrigin validates an exact HTTPS browser origin. URL paths,
// credentials, query/fragment delimiters and invalid ports are never trusted.
func NormalizeOAuthOrigin(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if strings.ContainsAny(raw, "\\?#%\r\n\t ") {
		return "", errors.New("invalid trusted OAuth origin")
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || (parsed.Path != "" && parsed.Path != "/") || parsed.Opaque != "" {
		return "", errors.New("invalid trusted OAuth origin")
	}
	if strings.HasSuffix(parsed.Host, ":") {
		return "", errors.New("invalid trusted OAuth origin")
	}
	if port := parsed.Port(); port != "" {
		number, err := strconv.Atoi(port)
		if err != nil || number < 1 || number > 65535 {
			return "", errors.New("invalid trusted OAuth origin")
		}
	}
	return common.NormalizeOrigin(raw)
}

// NormalizeOAuthTrustedOrigins accepts exact HTTPS origins, never host suffixes
// or redirect URLs. A blank value retains only the existing trusted defaults.
func NormalizeOAuthTrustedOrigins(value string) (string, error) {
	origins := []string{}
	for _, entry := range strings.FieldsFunc(value, func(c rune) bool { return c == ',' || c == '\n' || c == '\r' }) {
		origin, err := NormalizeOAuthOrigin(entry)
		if err != nil || !strings.HasPrefix(origin, "https://") {
			return "", errors.New("invalid trusted OAuth origin")
		}
		if !slices.Contains(origins, origin) {
			origins = append(origins, origin)
		}
	}
	return strings.Join(origins, ","), nil
}
