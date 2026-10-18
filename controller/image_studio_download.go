package controller

import (
	"crypto/hmac"
	"encoding/base64"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

const imageStudioDownloadTicketTTL = 5 * time.Minute

// imageStudioDownloadTicket 将下载权限限定到一个用户和不可扩大的资源范围。
// 票据使用独立签名用途，不能充当登录令牌或公共资产签名。
type imageStudioDownloadTicket struct {
	UserID     int      `json:"user_id"`
	Scope      string   `json:"scope"`
	BatchID    string   `json:"batch_id,omitempty"`
	TaskIDs    []string `json:"task_ids,omitempty"`
	ImageIndex int      `json:"image_index,omitempty"`
	Download   bool     `json:"download,omitempty"`
	ExpiresAt  int64    `json:"expires_at"`
}

func imageStudioDownloadTicketURL(ticket imageStudioDownloadTicket) (string, error) {
	payload, err := common.Marshal(ticket)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	signature := common.GenerateHMAC("new-api/image-studio/download/v1:" + encoded)
	return "/api/image-studio/download?ticket=" + encoded + "." + signature, nil
}

// CreateImageStudioDownloadTicket 在认证请求中签发短期只读下载权限，浏览器随后原生流式下载。
func CreateImageStudioDownloadTicket(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	userID := c.GetInt("id")
	if userID <= 0 {
		imageStudioContentError(c, http.StatusUnauthorized, "authentication is required")
		return
	}
	var ticket imageStudioDownloadTicket
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 16*1024), &ticket); err != nil {
		imageStudioContentError(c, http.StatusBadRequest, "invalid image studio download scope")
		return
	}
	ticket.UserID = userID
	ticket.ExpiresAt = time.Now().Add(imageStudioDownloadTicketTTL).Unix()
	if ticket.Scope == "image" || !ticket.validScope() {
		imageStudioContentError(c, http.StatusBadRequest, "invalid image studio download scope")
		return
	}
	if ticket.Scope != "tasks" && !imageStudioDownloadAllEnabled() {
		imageStudioContentError(c, http.StatusForbidden, "image studio download-all is disabled")
		return
	}
	if ticket.Scope == "batch" {
		_, exists, err := model.GetImageStudioBatch(userID, ticket.BatchID)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if !exists {
			imageStudioContentError(c, http.StatusNotFound, "image studio batch not found")
			return
		}
	}
	if ticket.Scope == "tasks" {
		tasks, err := model.GetByTaskIdsForPlatforms(userID, []constant.TaskPlatform{imageStudioTaskPlatform}, ticket.TaskIDs)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if len(tasks) != len(ticket.TaskIDs) {
			imageStudioContentError(c, http.StatusNotFound, "one or more tasks were not found")
			return
		}
		for _, task := range tasks {
			if task.Platform != imageStudioTaskPlatform || task.Status != model.TaskStatusSuccess {
				imageStudioContentError(c, http.StatusConflict, "all tasks must be completed image studio tasks")
				return
			}
		}
	}
	downloadURL, err := imageStudioDownloadTicketURL(ticket)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"url": downloadURL, "expires_at": ticket.ExpiresAt})
}

func (ticket imageStudioDownloadTicket) validScope() bool {
	if ticket.UserID <= 0 {
		return false
	}
	if ticket.Scope != "image" && (ticket.ImageIndex != 0 || ticket.Download) {
		return false
	}
	switch ticket.Scope {
	case "library":
		return ticket.BatchID == "" && len(ticket.TaskIDs) == 0
	case "batch":
		return ticket.BatchID != "" && len(ticket.BatchID) <= 128 && strings.TrimSpace(ticket.BatchID) == ticket.BatchID && len(ticket.TaskIDs) == 0
	case "tasks", "image":
		if ticket.BatchID != "" || len(ticket.TaskIDs) == 0 || len(ticket.TaskIDs) > maxImageStudioPageDownloadTasks {
			return false
		}
		if ticket.Scope == "image" && (len(ticket.TaskIDs) != 1 || ticket.ImageIndex <= 0) {
			return false
		}
		seen := make(map[string]bool, len(ticket.TaskIDs))
		for _, id := range ticket.TaskIDs {
			if id == "" || len(id) > 128 || strings.TrimSpace(id) != id || strings.Contains(id, ",") || seen[id] {
				return false
			}
			seen[id] = true
		}
		return true
	default:
		return false
	}
}

// DownloadImageStudioWithTicket 只使用已签名范围，禁止查询参数覆盖用户、任务或批次。
func DownloadImageStudioWithTicket(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	c.Header("Referrer-Policy", "no-referrer")
	query := c.Request.URL.Query()
	raw := query.Get("ticket")
	encoded, signature, found := strings.Cut(raw, ".")
	if len(query) != 1 || len(query["ticket"]) != 1 || len(raw) > 16*1024 || !found ||
		!hmac.Equal([]byte(signature), []byte(common.GenerateHMAC("new-api/image-studio/download/v1:"+encoded))) {
		imageStudioContentError(c, http.StatusForbidden, "invalid or expired image studio download ticket")
		return
	}
	payload, err := base64.RawURLEncoding.DecodeString(encoded)
	var ticket imageStudioDownloadTicket
	now := time.Now()
	if err != nil || common.Unmarshal(payload, &ticket) != nil || !ticket.validScope() ||
		ticket.ExpiresAt <= now.Unix() || ticket.ExpiresAt > now.Add(imageStudioDownloadTicketTTL).Unix() {
		imageStudioContentError(c, http.StatusForbidden, "invalid or expired image studio download ticket")
		return
	}
	user, err := model.GetUserById(ticket.UserID, false)
	if err != nil || user == nil || user.Status != common.UserStatusEnabled {
		imageStudioContentError(c, http.StatusForbidden, "invalid or expired image studio download ticket")
		return
	}
	c.Set("id", ticket.UserID)
	c.Set("image_studio_download_ticket", true)
	switch ticket.Scope {
	case "library":
		c.Request.URL.RawQuery = ""
		DownloadImageStudioLibrary(c)
	case "batch":
		c.Params = gin.Params{{Key: "batch_id", Value: ticket.BatchID}}
		c.Request.URL.RawQuery = ""
		DownloadImageStudioBatch(c)
	case "tasks":
		c.Request.URL.RawQuery = url.Values{"task_ids": {strings.Join(ticket.TaskIDs, ",")}}.Encode()
		DownloadImageStudioTaskImages(c)
	case "image":
		c.Params = gin.Params{{Key: "task_id", Value: ticket.TaskIDs[0]}, {Key: "index", Value: strconv.Itoa(ticket.ImageIndex)}}
		c.Request.URL.RawQuery = ""
		if ticket.Download {
			c.Request.URL.RawQuery = "download=1"
		}
		GetImageStudioTaskImage(c)
	}
}
