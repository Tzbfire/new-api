package channel

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
)

// A channel's Content-Encoding: gzip override opts into request compression.
// Small, non-JSON, or non-replayable bodies are sent without that encoding.
// Responses, including SSE, are not changed.
func compressUpstreamJSONRequest(req *http.Request) error {
	if !strings.EqualFold(strings.TrimSpace(req.Header.Get("Content-Encoding")), "gzip") {
		return nil
	}
	if req.Body == nil {
		req.Header.Del("Content-Encoding")
		return nil
	}
	if req.GetBody == nil {
		var prefix [2]byte
		n, err := io.ReadFull(req.Body, prefix[:])
		req.Body = struct {
			io.Reader
			io.Closer
		}{io.MultiReader(bytes.NewReader(prefix[:n]), req.Body), req.Body}
		if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
			return fmt.Errorf("read upstream request for gzip: %w", err)
		}
		if !bytes.Equal(prefix[:n], []byte{0x1f, 0x8b}) {
			req.Header.Del("Content-Encoding")
		}
		return nil
	}
	replay, err := req.GetBody()
	if err != nil {
		return fmt.Errorf("open upstream request for gzip: %w", err)
	}
	defer replay.Close()
	reader := bufio.NewReader(replay)
	magic, err := reader.Peek(2)
	if err != nil && err != io.EOF {
		return fmt.Errorf("read upstream request for gzip: %w", err)
	}
	// Preserve genuinely encoded bodies instead of compressing them twice.
	if bytes.Equal(magic, []byte{0x1f, 0x8b}) {
		return nil
	}
	req.Header.Del("Content-Encoding")
	contentType, _, _ := mime.ParseMediaType(req.Header.Get("Content-Type"))
	if req.ContentLength < 64<<10 || (contentType != "application/json" && !strings.HasSuffix(contentType, "+json")) {
		return nil
	}

	var encoded bytes.Buffer
	writer, err := gzip.NewWriterLevel(&encoded, gzip.BestSpeed)
	if err != nil {
		return err
	}
	if _, err := io.Copy(writer, reader); err != nil {
		_ = writer.Close()
		return fmt.Errorf("gzip upstream request: %w", err)
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("finish upstream request gzip: %w", err)
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
	req.Header.Set("Content-Encoding", "gzip")
	return nil
}
