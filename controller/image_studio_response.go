package controller

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const (
	imageStudioResponseMetadataLimit = 1024 * 1024
	imageStudioResponseMaxJSONDepth  = 64
)

type imageStudioResponseWriter struct {
	gin.ResponseWriter
	task           *model.Task
	file           *os.File
	limit          int64
	written        int64
	status         int
	exceeded       bool
	processed      bool
	payload        any
	usage          *dto.Usage
	processErr     error
	releaseStorage func()
}

func newImageStudioResponseWriter(writer gin.ResponseWriter, task *model.Task) (*imageStudioResponseWriter, error) {
	reserveBytes := imageStudioMaxResponseBytes() + service.ImageStudioMaxAssetBytes()
	file, releaseStorage, err := service.CreateImageStudioResponseSpool(reserveBytes)
	if err != nil {
		return nil, err
	}
	return &imageStudioResponseWriter{ResponseWriter: writer, task: task, file: file, limit: imageStudioMaxResponseBytes(), releaseStorage: releaseStorage}, nil
}

func (writer *imageStudioResponseWriter) Header() http.Header {
	return writer.ResponseWriter.Header()
}

func (writer *imageStudioResponseWriter) WriteHeader(statusCode int) {
	if writer.status != 0 && writer.status != statusCode {
		if err := writer.resetAttempt(); err != nil {
			writer.exceeded = true
		}
	}
	writer.status = statusCode
}

func (writer *imageStudioResponseWriter) WriteHeaderNow() {
	if writer.status == 0 {
		writer.status = http.StatusOK
	}
}

func (writer *imageStudioResponseWriter) Status() int {
	if writer.status == 0 {
		return http.StatusOK
	}
	return writer.status
}

func (writer *imageStudioResponseWriter) Written() bool {
	return writer.status != 0 || writer.written > 0
}

func (writer *imageStudioResponseWriter) Size() int {
	return int(writer.written)
}

func (writer *imageStudioResponseWriter) Write(data []byte) (int, error) {
	writer.WriteHeaderNow()
	if writer.exceeded {
		return len(data), nil
	}
	remaining := writer.limit - writer.written
	if remaining <= 0 {
		writer.exceeded = true
		return len(data), nil
	}
	toWrite := data
	if int64(len(toWrite)) > remaining {
		toWrite = toWrite[:remaining]
		writer.exceeded = true
	}
	if _, err := writer.file.Write(toWrite); err != nil {
		return 0, err
	}
	writer.written += int64(len(toWrite))
	return len(data), nil
}

func (writer *imageStudioResponseWriter) WriteString(data string) (int, error) {
	return writer.Write([]byte(data))
}

func (writer *imageStudioResponseWriter) resetAttempt() error {
	writer.payload = nil
	writer.usage = nil
	writer.processErr = nil
	writer.processed = false
	writer.exceeded = false
	writer.written = 0
	writer.status = 0
	for key := range writer.Header() {
		writer.Header().Del(key)
	}
	if err := writer.file.Truncate(0); err != nil {
		return err
	}
	_, err := writer.file.Seek(0, io.SeekStart)
	return err
}

func (writer *imageStudioResponseWriter) BeginImageStudioResponseAttempt() error {
	return writer.resetAttempt()
}

// CaptureImageStudioResponse is discovered structurally by the OpenAI image
// adaptor. It bypasses io.ReadAll and streams the upstream JSON into a spool,
// then returns only the small sanitized response needed for usage billing.
func (writer *imageStudioResponseWriter) CaptureImageStudioResponse(response *http.Response) ([]byte, error) {
	if response == nil || response.Body == nil {
		return nil, errors.New("invalid image response")
	}
	if err := writer.resetAttempt(); err != nil {
		return nil, err
	}
	for key, values := range response.Header {
		if strings.EqualFold(key, "Content-Length") || len(values) == 0 {
			continue
		}
		writer.Header().Set(key, values[0])
	}
	writer.WriteHeader(response.StatusCode)
	if _, err := io.Copy(writer, response.Body); err != nil {
		return nil, err
	}
	if writer.exceeded {
		return nil, errors.New("upstream image response exceeds AI Studio size limit")
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return writer.readSmallResponse()
	}
	payload, _, err := writer.Process()
	if err != nil {
		return nil, err
	}
	return common.Marshal(payload)
}

func (writer *imageStudioResponseWriter) readSmallResponse() ([]byte, error) {
	if writer.written > imageStudioResponseMetadataLimit {
		return nil, errors.New("upstream image error response is too large")
	}
	data := make([]byte, writer.written)
	if _, err := writer.file.ReadAt(data, 0); err != nil && err != io.EOF {
		return nil, err
	}
	return data, nil
}

func (writer *imageStudioResponseWriter) Process() (any, *dto.Usage, error) {
	if writer.processed {
		return writer.payload, writer.usage, writer.processErr
	}
	writer.processed = true
	if writer.exceeded {
		writer.processErr = errors.New("upstream image response exceeds AI Studio size limit")
		return nil, nil, writer.processErr
	}
	if writer.Status() < http.StatusOK || writer.Status() >= http.StatusMultipleChoices {
		data, err := writer.readSmallResponse()
		if err != nil {
			writer.processErr = err
		} else {
			writer.processErr = parseImageStudioRelayError(writer.Status(), data)
		}
		return nil, nil, writer.processErr
	}
	if err := writer.file.Sync(); err != nil {
		writer.processErr = err
		return nil, nil, err
	}
	sanitized, capture, err := scanImageStudioResponse(writer.file)
	if err != nil {
		writer.processErr = err
		return nil, nil, err
	}
	var payload map[string]any
	if err := common.Unmarshal(sanitized, &payload); err != nil {
		writer.processErr = fmt.Errorf("parse sanitized image response: %w", err)
		return nil, nil, writer.processErr
	}
	if payload["error"] != nil {
		writer.processErr = parseImageStudioRelayError(http.StatusOK, sanitized)
		return nil, nil, writer.processErr
	}
	data, ok := payload["data"].([]any)
	if !ok || len(data) != 1 {
		writer.processErr = errors.New("image response must contain exactly one image")
		return nil, nil, writer.processErr
	}
	image, ok := data[0].(map[string]any)
	if !ok || strings.TrimSpace(imageStudioString(image["storage_key"])) != "" {
		writer.processErr = errors.New("upstream image response contains invalid image data")
		return nil, nil, writer.processErr
	}

	section := io.NewSectionReader(writer.file, capture.start, capture.length)
	normalized, err := newImageStudioBase64Reader(section)
	if err != nil {
		writer.processErr = err
		return nil, nil, err
	}
	staged, err := service.StageImageStudioAsset(writer.task.UserId, writer.task.TaskID, 1, base64.NewDecoder(base64.StdEncoding, normalized))
	if err != nil {
		writer.processErr = err
		return nil, nil, err
	}
	defer staged.Discard()
	asset, err := staged.Publish()
	if err != nil {
		writer.processErr = err
		return nil, nil, err
	}
	image["storage_key"] = asset.StorageKey
	image["mime_type"] = asset.MimeType
	image["size_bytes"] = asset.SizeBytes
	image["sha256"] = asset.SHA256
	for _, key := range imageStudioBase64Keys {
		delete(image, key)
	}
	delete(image, "url")
	delete(image, "upstream_url")

	if usageValue := payload["usage"]; usageValue != nil {
		usageBytes, marshalErr := common.Marshal(usageValue)
		if marshalErr == nil {
			usage := &dto.Usage{}
			if common.Unmarshal(usageBytes, usage) == nil {
				writer.usage = usage
			}
		}
	}
	writer.payload = payload
	return writer.payload, writer.usage, nil
}

func (writer *imageStudioResponseWriter) Close() {
	if writer == nil || writer.file == nil {
		return
	}
	name := writer.file.Name()
	_ = writer.file.Close()
	_ = os.Remove(name)
	writer.file = nil
	if writer.releaseStorage != nil {
		writer.releaseStorage()
		writer.releaseStorage = nil
	}
}

type imageStudioBase64Capture struct {
	start  int64
	length int64
}

type imageStudioJSONFrame struct {
	kind            byte
	state           int
	key             string
	imageDataArray  bool
	imageDataObject bool
}

const (
	imageStudioJSONKeyOrEnd = iota
	imageStudioJSONColon
	imageStudioJSONValue
	imageStudioJSONCommaOrEnd
)

type imageStudioCountingReader struct {
	reader *bufio.Reader
	offset int64
}

func (reader *imageStudioCountingReader) ReadByte() (byte, error) {
	value, err := reader.reader.ReadByte()
	if err == nil {
		reader.offset++
	}
	return value, err
}

func (reader *imageStudioCountingReader) UnreadByte() error {
	if err := reader.reader.UnreadByte(); err != nil {
		return err
	}
	reader.offset--
	return nil
}

func scanImageStudioResponse(file *os.File) ([]byte, imageStudioBase64Capture, error) {
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, imageStudioBase64Capture{}, err
	}
	reader := &imageStudioCountingReader{reader: bufio.NewReaderSize(file, 64*1024)}
	var output bytes.Buffer
	frames := make([]imageStudioJSONFrame, 0, 4)
	capture := imageStudioBase64Capture{}
	captures := 0
	writeByte := func(value byte) error {
		if output.Len() >= imageStudioResponseMetadataLimit {
			return errors.New("upstream image metadata exceeds AI Studio limit")
		}
		return output.WriteByte(value)
	}

	for {
		value, err := reader.ReadByte()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, capture, err
		}
		if len(frames) == 0 {
			if isImageStudioJSONSpace(value) {
				if err := writeByte(value); err != nil {
					return nil, capture, err
				}
				continue
			}
			if value != '{' || output.Len() > 0 && strings.TrimSpace(output.String()) != "" {
				return nil, capture, errors.New("invalid image response JSON")
			}
			if err := writeByte(value); err != nil {
				return nil, capture, err
			}
			frames = append(frames, imageStudioJSONFrame{kind: '{', state: imageStudioJSONKeyOrEnd})
			continue
		}

		frame := &frames[len(frames)-1]
		if isImageStudioJSONSpace(value) {
			if err := writeByte(value); err != nil {
				return nil, capture, err
			}
			continue
		}
		if frame.kind == '{' {
			switch frame.state {
			case imageStudioJSONKeyOrEnd:
				if value == '}' {
					if err := writeByte(value); err != nil {
						return nil, capture, err
					}
					frames = frames[:len(frames)-1]
					continue
				}
				if value != '"' {
					return nil, capture, errors.New("invalid image response object key")
				}
				key, err := copyImageStudioJSONString(reader, &output, true)
				if err != nil {
					return nil, capture, err
				}
				frame.key = key
				frame.state = imageStudioJSONColon
			case imageStudioJSONColon:
				if value != ':' {
					return nil, capture, errors.New("invalid image response object separator")
				}
				if err := writeByte(value); err != nil {
					return nil, capture, err
				}
				frame.state = imageStudioJSONValue
			case imageStudioJSONValue:
				if frame.imageDataObject && isImageStudioBase64Key(frame.key) {
					if value != '"' || captures > 0 {
						return nil, capture, errors.New("image response must contain exactly one base64 image")
					}
					if err := writeByte('"'); err != nil {
						return nil, capture, err
					}
					start := reader.offset
					end, err := skipImageStudioJSONString(reader)
					if err != nil {
						return nil, capture, err
					}
					if err := writeByte('"'); err != nil {
						return nil, capture, err
					}
					capture = imageStudioBase64Capture{start: start, length: end - start}
					captures++
					frame.state = imageStudioJSONCommaOrEnd
					continue
				}
				if err := startImageStudioJSONValue(value, reader, &output, &frames); err != nil {
					return nil, capture, err
				}
			case imageStudioJSONCommaOrEnd:
				if value == ',' {
					if err := writeByte(value); err != nil {
						return nil, capture, err
					}
					frame.state = imageStudioJSONKeyOrEnd
				} else if value == '}' {
					if err := writeByte(value); err != nil {
						return nil, capture, err
					}
					frames = frames[:len(frames)-1]
				} else {
					return nil, capture, errors.New("invalid image response object")
				}
			}
			continue
		}

		switch frame.state {
		case imageStudioJSONValue:
			if value == ']' {
				if err := writeByte(value); err != nil {
					return nil, capture, err
				}
				frames = frames[:len(frames)-1]
				continue
			}
			if err := startImageStudioJSONValue(value, reader, &output, &frames); err != nil {
				return nil, capture, err
			}
		case imageStudioJSONCommaOrEnd:
			if value == ',' {
				if err := writeByte(value); err != nil {
					return nil, capture, err
				}
				frame.state = imageStudioJSONValue
			} else if value == ']' {
				if err := writeByte(value); err != nil {
					return nil, capture, err
				}
				frames = frames[:len(frames)-1]
			} else {
				return nil, capture, errors.New("invalid image response array")
			}
		}
	}
	if len(frames) != 0 || captures != 1 || capture.length <= 0 {
		return nil, capture, errors.New("image response must contain exactly one base64 image")
	}
	return output.Bytes(), capture, nil
}

func startImageStudioJSONValue(value byte, reader *imageStudioCountingReader, output *bytes.Buffer, frames *[]imageStudioJSONFrame) error {
	parent := &(*frames)[len(*frames)-1]
	parent.state = imageStudioJSONCommaOrEnd
	if value == '"' {
		_, err := copyImageStudioJSONString(reader, output, false)
		return err
	}
	if output.Len() >= imageStudioResponseMetadataLimit {
		return errors.New("upstream image metadata exceeds AI Studio limit")
	}
	if err := output.WriteByte(value); err != nil {
		return err
	}
	switch value {
	case '{':
		if len(*frames) >= imageStudioResponseMaxJSONDepth {
			return errors.New("upstream image response exceeds maximum JSON depth")
		}
		*frames = append(*frames, imageStudioJSONFrame{
			kind:            '{',
			state:           imageStudioJSONKeyOrEnd,
			imageDataObject: parent.kind == '[' && parent.imageDataArray,
		})
	case '[':
		if len(*frames) >= imageStudioResponseMaxJSONDepth {
			return errors.New("upstream image response exceeds maximum JSON depth")
		}
		*frames = append(*frames, imageStudioJSONFrame{
			kind:           '[',
			state:          imageStudioJSONValue,
			imageDataArray: parent.kind == '{' && len(*frames) == 1 && parent.key == "data",
		})
	default:
		return copyImageStudioJSONPrimitive(reader, output)
	}
	return nil
}

func copyImageStudioJSONString(reader *imageStudioCountingReader, output *bytes.Buffer, decode bool) (string, error) {
	raw := []byte{'"'}
	if err := output.WriteByte('"'); err != nil {
		return "", err
	}
	escaped := false
	for {
		value, err := reader.ReadByte()
		if err != nil {
			return "", errors.New("unterminated image response string")
		}
		if output.Len() >= imageStudioResponseMetadataLimit {
			return "", errors.New("upstream image metadata exceeds AI Studio limit")
		}
		if err := output.WriteByte(value); err != nil {
			return "", err
		}
		if decode && len(raw) < 1024 {
			raw = append(raw, value)
		}
		if escaped {
			escaped = false
			continue
		}
		if value == '\\' {
			escaped = true
			continue
		}
		if value == '"' {
			break
		}
	}
	if !decode {
		return "", nil
	}
	if len(raw) >= 1024 {
		return "", errors.New("image response key is too long")
	}
	var decoded string
	if err := common.Unmarshal(raw, &decoded); err != nil {
		return "", err
	}
	return decoded, nil
}

func skipImageStudioJSONString(reader *imageStudioCountingReader) (int64, error) {
	escaped := false
	for {
		value, err := reader.ReadByte()
		if err != nil {
			return 0, errors.New("unterminated image base64 string")
		}
		if escaped {
			escaped = false
			continue
		}
		if value < 0x20 {
			return 0, errors.New("unescaped control character in image base64 string")
		}
		if value == '\\' {
			escaped = true
			continue
		}
		if value == '"' {
			return reader.offset - 1, nil
		}
	}
}

func copyImageStudioJSONPrimitive(reader *imageStudioCountingReader, output *bytes.Buffer) error {
	for {
		value, err := reader.ReadByte()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if value == ',' || value == '}' || value == ']' {
			return reader.UnreadByte()
		}
		if output.Len() >= imageStudioResponseMetadataLimit {
			return errors.New("upstream image metadata exceeds AI Studio limit")
		}
		if err := output.WriteByte(value); err != nil {
			return err
		}
	}
}

func isImageStudioJSONSpace(value byte) bool {
	return value == ' ' || value == '\n' || value == '\r' || value == '\t'
}

func isImageStudioBase64Key(key string) bool {
	for _, candidate := range imageStudioBase64Keys {
		if key == candidate {
			return true
		}
	}
	return false
}

func newImageStudioBase64Reader(source io.Reader) (io.Reader, error) {
	reader := bufio.NewReaderSize(source, 32*1024)
	prefix, _ := reader.Peek(5)
	if strings.EqualFold(string(prefix), "data:") {
		var header strings.Builder
		for header.Len() <= 512 {
			value, err := reader.ReadByte()
			if err != nil {
				return nil, errors.New("invalid image data URL")
			}
			if value == ',' {
				break
			}
			header.WriteByte(value)
		}
		if header.Len() > 512 || !strings.Contains(strings.ToLower(header.String()), ";base64") {
			return nil, errors.New("invalid image data URL")
		}
	}
	return &imageStudioBase64Normalizer{reader: reader}, nil
}

type imageStudioBase64Normalizer struct {
	reader       *bufio.Reader
	count        int
	padding      int
	reachedEOF   bool
	pendingError error
}

func (reader *imageStudioBase64Normalizer) Read(output []byte) (int, error) {
	written := 0
	for written < len(output) {
		if reader.padding > 0 {
			output[written] = '='
			written++
			reader.padding--
			reader.count++
			continue
		}
		if reader.reachedEOF {
			if reader.pendingError != nil {
				err := reader.pendingError
				reader.pendingError = nil
				if written > 0 {
					return written, nil
				}
				return 0, err
			}
			if written > 0 {
				return written, nil
			}
			return 0, io.EOF
		}
		value, err := reader.nextCharacter()
		if err == io.EOF {
			mod := reader.count % 4
			if mod == 1 {
				reader.pendingError = errors.New("invalid base64 image length")
				reader.reachedEOF = true
				continue
			}
			if mod > 1 {
				reader.padding = 4 - mod
				continue
			}
			reader.reachedEOF = true
			continue
		}
		if err != nil {
			reader.pendingError = err
			reader.reachedEOF = true
			continue
		}
		output[written] = value
		written++
		reader.count++
	}
	return written, nil
}

func (reader *imageStudioBase64Normalizer) nextCharacter() (byte, error) {
	for {
		value, err := reader.reader.ReadByte()
		if err != nil {
			return 0, err
		}
		if isImageStudioJSONSpace(value) {
			continue
		}
		if value == '\\' {
			escaped, err := reader.reader.ReadByte()
			if err != nil {
				return 0, errors.New("invalid escaped base64 image")
			}
			switch escaped {
			case '/':
				value = '/'
			case 'n', 'r', 't':
				continue
			case 'u':
				var encoded [4]byte
				if _, err := io.ReadFull(reader.reader, encoded[:]); err != nil {
					return 0, errors.New("invalid unicode escape in base64 image")
				}
				switch string(encoded[:]) {
				case "002f", "002F":
					value = '/'
				case "002b", "002B":
					value = '+'
				case "003d", "003D":
					value = '='
				default:
					return 0, errors.New("unsupported unicode escape in base64 image")
				}
			default:
				return 0, errors.New("unsupported escape in base64 image")
			}
		}
		if value == '-' {
			value = '+'
		} else if value == '_' {
			value = '/'
		}
		if value != '+' && value != '/' && value != '=' && !(value >= 'A' && value <= 'Z') && !(value >= 'a' && value <= 'z') && !(value >= '0' && value <= '9') {
			return 0, errors.New("invalid character in base64 image")
		}
		return value, nil
	}
}
