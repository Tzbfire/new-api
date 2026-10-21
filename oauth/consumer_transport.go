package oauth

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

type consumerOAuthRequestKey struct{}
type consumerOAuthResolver interface {
	LookupIPAddr(context.Context, string) ([]net.IPAddr, error)
}

type consumerOAuthTransport struct {
	transport *http.Transport
	endpoint  *url.URL
}

func (t *consumerOAuthTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	endpoint := t.endpoint
	if endpoint != nil && req.URL.Scheme == endpoint.Scheme && req.URL.Host == endpoint.Host && req.URL.Path == endpoint.Path && req.URL.RawQuery == endpoint.RawQuery {
		return t.transport.RoundTrip(req)
	}
	return nil, errors.New("consumer OAuth request does not match configured endpoint")
}
func (t *consumerOAuthTransport) CloseIdleConnections() { t.transport.CloseIdleConnections() }

// Consumer HTTP is restricted to administrator-configured internal adapters.
// Resolve and validate every address before dialing a pinned IP, without proxies.
func newConsumerOAuthClient(endpoint string, resolver consumerOAuthResolver, dial func(context.Context, string, string) (net.Conn, error)) *http.Client {
	if resolver == nil {
		resolver = net.DefaultResolver
	}
	if dial == nil {
		d := &net.Dialer{Timeout: 20 * time.Second}
		dial = d.DialContext
	}
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "http" || u.Host == "" || u.User != nil || u.Fragment != "" || strings.Contains(u.Hostname(), "%") {
		u = nil
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		if u == nil {
			return nil, errors.New("invalid consumer OAuth HTTP endpoint")
		}
		endpointPort := u.Port()
		if endpointPort == "" {
			endpointPort = "80"
		}
		if u.Hostname() != host || endpointPort != port {
			return nil, errors.New("unexpected consumer OAuth target")
		}
		addresses, err := resolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, err
		}
		if len(addresses) == 0 {
			return nil, errors.New("consumer OAuth endpoint has no addresses")
		}
		for _, resolved := range addresses {
			ip, ok := netip.AddrFromSlice(resolved.IP)
			ip = ip.Unmap()
			if !ok || resolved.Zone != "" || !(ip.IsPrivate() || ip.IsLoopback()) {
				return nil, errors.New("consumer OAuth HTTP endpoint must resolve only to private or loopback addresses")
			}
		}
		var last error
		for _, resolved := range addresses {
			conn, err := dial(ctx, network, net.JoinHostPort(resolved.IP.String(), port))
			if err == nil {
				return conn, nil
			}
			last = err
		}
		return nil, last
	}
	return &http.Client{Timeout: 20 * time.Second, Transport: &consumerOAuthTransport{transport: transport, endpoint: u}, CheckRedirect: func(*http.Request, []*http.Request) error {
		return errors.New("consumer OAuth redirects are not allowed")
	}}
}

// Consumer HTTPS retains the normal verified TLS/proxy transport, but cannot
// downgrade credentials to plaintext through an upstream redirect.
func genericOAuthClient(ctx context.Context, endpoint *url.URL) *http.Client {
	client := &http.Client{Timeout: 20 * time.Second}
	consumer, _ := ctx.Value(consumerOAuthRequestKey{}).(bool)
	if !consumer {
		return client
	}
	if endpoint.Scheme == "http" {
		return newConsumerOAuthClient(endpoint.String(), nil, nil)
	}
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if req.URL.Scheme != "https" || req.URL.User != nil || req.URL.Host != endpoint.Host {
			return errors.New("consumer OAuth redirect must remain on the configured HTTPS origin")
		}
		if len(via) >= 10 {
			return errors.New("too many consumer OAuth redirects")
		}
		return nil
	}
	return client
}
