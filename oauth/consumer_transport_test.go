package oauth

import (
	"context"
	"crypto/x509"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fixtureOAuthResolver []net.IPAddr

func (r fixtureOAuthResolver) LookupIPAddr(context.Context, string) ([]net.IPAddr, error) {
	return r, nil
}

func TestConsumerOAuthPrivateTransport(t *testing.T) {
	for _, tc := range []struct {
		name    string
		ips     []string
		allowed bool
	}{
		{"private hostname", []string{"10.0.0.2"}, true},
		{"IPv4 loopback", []string{"127.0.0.1"}, true},
		{"IPv6 private", []string{"fd00::1"}, true},
		{"IPv6 loopback", []string{"::1"}, true},
		{"public", []string{"8.8.8.8"}, false},
		{"mixed DNS", []string{"10.0.0.2", "8.8.8.8"}, false},
		{"metadata", []string{"169.254.169.254"}, false},
		{"unspecified", []string{"0.0.0.0"}, false},
		{"multicast", []string{"224.0.0.1"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var resolver fixtureOAuthResolver
			for _, ip := range tc.ips {
				resolver = append(resolver, net.IPAddr{IP: net.ParseIP(ip)})
			}
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("private fixture")) }))
			defer server.Close()
			target := server.Listener.Addr().String()
			client := newConsumerOAuthClient("http://adapter.internal/token", resolver, func(ctx context.Context, network, address string) (net.Conn, error) {
				calls++
				assert.Equal(t, net.JoinHostPort(tc.ips[0], "80"), address)
				return (&net.Dialer{}).DialContext(ctx, network, target)
			})
			defer client.CloseIdleConnections()
			response, err := client.Get("http://adapter.internal/token")
			if !tc.allowed {
				require.Error(t, err)
				assert.Zero(t, calls)
				return
			}
			require.NoError(t, err)
			defer response.Body.Close()
			assert.Equal(t, 1, calls)
			assert.Equal(t, 200, response.StatusCode)
		})
	}
}

func TestConsumerOAuthRejectsRedirectsAndUnconfiguredTargets(t *testing.T) {
	leaked := 0
	trap := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { leaked++ }))
	defer trap.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, trap.URL, http.StatusTemporaryRedirect)
	}))
	defer origin.Close()
	t.Setenv("HTTP_PROXY", trap.URL)
	t.Setenv("http_proxy", trap.URL)
	client := newConsumerOAuthClient("http://adapter.internal/token", fixtureOAuthResolver{{IP: net.ParseIP("10.0.0.2")}}, func(ctx context.Context, network, address string) (net.Conn, error) {
		assert.Equal(t, "10.0.0.2:80", address)
		return (&net.Dialer{}).DialContext(ctx, network, origin.Listener.Addr().String())
	})
	defer client.CloseIdleConnections()
	response, err := client.Get("http://adapter.internal/token")
	if response != nil {
		response.Body.Close()
	}
	require.Error(t, err)
	assert.Zero(t, leaked)
	_, err = client.Get(trap.URL + "/token")
	require.Error(t, err)
	assert.Zero(t, leaked)
}

func TestConsumerOAuthHTTPSRedirectsStayOnConfiguredSecureOrigin(t *testing.T) {
	leaked := 0
	trap := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { leaked++ }))
	defer trap.Close()
	tlsServer := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/same-origin":
			http.Redirect(w, r, "/success", http.StatusTemporaryRedirect)
		case "/success":
			w.WriteHeader(http.StatusOK)
		case "/other-origin":
			http.Redirect(w, r, "https://other.example/token", http.StatusTemporaryRedirect)
		default:
			http.Redirect(w, r, trap.URL, http.StatusTemporaryRedirect)
		}
	}))
	defer tlsServer.Close()
	roots := x509.NewCertPool()
	roots.AddCert(tlsServer.Certificate())
	original := http.DefaultTransport
	transport := original.(*http.Transport).Clone()
	transport.TLSClientConfig = transport.TLSClientConfig.Clone()
	transport.TLSClientConfig.RootCAs = roots
	http.DefaultTransport = transport
	defer func() { http.DefaultTransport = original; transport.CloseIdleConnections() }()
	endpoint, err := url.Parse(tlsServer.URL)
	require.NoError(t, err)
	ctx := context.WithValue(context.Background(), consumerOAuthRequestKey{}, true)
	for _, method := range []string{http.MethodPost, http.MethodGet} {
		req, err := http.NewRequestWithContext(ctx, method, tlsServer.URL, nil)
		require.NoError(t, err)
		req.Header.Set("Authorization", "Bearer synthetic-only")
		response, err := genericOAuthClient(ctx, endpoint).Do(req)
		if response != nil {
			response.Body.Close()
		}
		require.ErrorContains(t, err, "consumer OAuth redirect must remain on the configured HTTPS origin")
		assert.Zero(t, leaked)
	}
	for _, path := range []string{"/same-origin", "/other-origin"} {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, tlsServer.URL+path, nil)
		require.NoError(t, err)
		response, err := genericOAuthClient(ctx, endpoint).Do(req)
		if response != nil {
			response.Body.Close()
		}
		if path == "/same-origin" {
			require.NoError(t, err)
			assert.Equal(t, http.StatusOK, response.StatusCode)
		} else {
			require.ErrorContains(t, err, "consumer OAuth redirect must remain on the configured HTTPS origin")
		}
	}
}
