package channel

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/andybalholm/brotli"
	"github.com/klauspost/compress/zstd"
)

const requestCompressionMinBytesHeader = "X-New-Api-Compression-Min-Bytes"

// A channel's Content-Encoding override opts into gzip, zstd or Brotli compression.
// The optional local-only minimum defaults to 64 KiB; zero tries every JSON size.
// Small, non-JSON, or non-replayable bodies are sent without that encoding.
// Responses, including SSE, are not changed.
func compressUpstreamJSONRequest(req *http.Request) error {
	minimum := req.Header.Get(requestCompressionMinBytesHeader)
	req.Header.Del(requestCompressionMinBytesHeader)
	encoding := strings.ToLower(strings.TrimSpace(req.Header.Get("Content-Encoding")))
	if encoding != "gzip" && encoding != "zstd" && encoding != "br" {
		return nil
	}
	minBytes := int64(64 << 10)
	if minimum != "" {
		var err error
		minBytes, err = strconv.ParseInt(strings.TrimSpace(minimum), 10, 64)
		if err != nil || minBytes < 0 {
			return fmt.Errorf("invalid upstream request compression minimum")
		}
	}
	if req.Body == nil {
		req.Header.Del("Content-Encoding")
		return nil
	}
	if req.GetBody == nil {
		var prefix [4]byte
		n, err := io.ReadFull(req.Body, prefix[:])
		req.Body = struct {
			io.Reader
			io.Closer
		}{io.MultiReader(bytes.NewReader(prefix[:n]), req.Body), req.Body}
		if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
			return fmt.Errorf("read upstream request for compression: %w", err)
		}
		if !hasRequestCompressionMagic(encoding, prefix[:n]) {
			req.Header.Del("Content-Encoding")
		}
		return nil
	}
	replay, err := req.GetBody()
	if err != nil {
		return fmt.Errorf("open upstream request for compression: %w", err)
	}
	defer replay.Close()
	reader := bufio.NewReader(replay)
	magic, peekErr := reader.Peek(4)
	if peekErr != nil && peekErr != io.EOF {
		return fmt.Errorf("read upstream request for compression: %w", peekErr)
	}
	// Preserve genuinely encoded bodies instead of compressing them twice.
	if hasRequestCompressionMagic(encoding, magic) {
		return nil
	}
	req.Header.Del("Content-Encoding")
	contentType, _, _ := mime.ParseMediaType(req.Header.Get("Content-Type"))
	if req.ContentLength <= 0 || req.ContentLength < minBytes || (contentType != "application/json" && !strings.HasSuffix(contentType, "+json")) {
		return nil
	}

	var encoded bytes.Buffer
	var writer io.WriteCloser
	switch encoding {
	case "gzip":
		writer, err = gzip.NewWriterLevel(&encoded, gzip.BestSpeed)
	case "zstd":
		writer, err = zstd.NewWriter(&encoded, zstd.WithEncoderLevel(zstd.SpeedDefault), zstd.WithEncoderConcurrency(1))
	case "br":
		writer = brotli.NewWriterOptions(&encoded, brotli.WriterOptions{Quality: 4, LGWin: 22})
	}
	if err != nil {
		return err
	}
	if _, err := io.Copy(writer, reader); err != nil {
		_ = writer.Close()
		return fmt.Errorf("compress upstream request with %s: %w", encoding, err)
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("finish upstream request compression with %s: %w", encoding, err)
	}
	if int64(encoded.Len()) >= req.ContentLength {
		return nil
	}

	data := encoded.Bytes()
	_ = req.Body.Close()
	req.Body = io.NopCloser(bytes.NewReader(data))
	req.GetBody = func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(data)), nil
	}
	req.ContentLength = int64(len(data))
	req.TransferEncoding = nil
	req.Header.Del("Content-Length")
	req.Header.Set("Content-Encoding", encoding)
	return nil
}

func hasRequestCompressionMagic(encoding string, prefix []byte) bool {
	switch encoding {
	case "gzip":
		return bytes.HasPrefix(prefix, []byte{0x1f, 0x8b})
	case "zstd":
		return bytes.HasPrefix(prefix, []byte{0x28, 0xb5, 0x2f, 0xfd})
	default:
		// Brotli has no reliable magic; inbound requests have already been decoded.
		return false
	}
}
