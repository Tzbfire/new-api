package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/bytedance/gopkg/util/gopool"
)

const imageStudioRecoveryInterval = time.Minute

var imageStudioRecoveryOnce sync.Once

// StartImageStudioRecoveryTask fails timed-out IN_PROGRESS studio jobs and
// refunds incomplete charges. QUEUED jobs are not failed here: durable workers
// claim them after restart.
func StartImageStudioRecoveryTask() {
	imageStudioRecoveryOnce.Do(func() {
		gopool.Go(func() {
			RunImageStudioRecoveryOnce(context.Background())
			ticker := time.NewTicker(imageStudioRecoveryInterval)
			defer ticker.Stop()
			for range ticker.C {
				RunImageStudioRecoveryOnce(context.Background())
			}
		})
	})
}

func RunImageStudioRecoveryOnce(ctx context.Context) {
	if ctx == nil {
		ctx = context.Background()
	}
	ReclaimOrphanedImageStudioTasks(ctx)
	timeoutMinutes := ImageStudioTaskTimeoutMinutes()
	cutoff := time.Now().Add(-time.Duration(timeoutMinutes) * time.Minute).Unix()
	now := time.Now().Unix()
	for _, task := range model.GetTimedOutImageStudioTasks(cutoff, 100) {
		// Only force-fail IN_PROGRESS. QUEUED work is owned by the durable worker.
		if task.Status != model.TaskStatusInProgress {
			continue
		}
		fromStatus := task.Status
		task.Status = model.TaskStatusFailure
		task.Progress = "100%"
		task.FailReason = fmt.Sprintf("AI 画室任务超时（%d分钟），可能因服务重启或上游无响应中断", timeoutMinutes)
		task.FinishTime = now
		task.UpdatedAt = now
		won, err := task.UpdateWithStatus(fromStatus)
		if err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("image studio recovery timeout task %s failed: %s", task.TaskID, err.Error()))
			continue
		}
		if !won {
			continue
		}
		RemoveImageStudioJobBody(task.PrivateData.StudioBodyKey)
		backfillAndRefundImageStudioTask(ctx, task)
	}

	for _, task := range model.GetUnrefundedFailedImageStudioTasks(100) {
		backfillAndRefundImageStudioTask(ctx, task)
	}
}

// ReclaimOrphanedImageStudioTasks recovers IN_PROGRESS jobs left behind when
// this node restarted (air reload, crash, SIGINT). Jobs with a staged body are
// re-queued; otherwise they fail and refund. Tasks owned by another node are
// left for that node or the global timeout sweeper.
func ReclaimOrphanedImageStudioTasks(ctx context.Context) {
	if ctx == nil {
		ctx = context.Background()
	}
	tasks, err := model.ListInProgressImageStudioTasks(100)
	if err != nil {
		logger.LogWarn(ctx, "image studio list in-progress failed: "+err.Error())
		return
	}
	node := common.NodeName
	for _, task := range tasks {
		if task == nil {
			continue
		}
		owner := strings.TrimSpace(task.PrivateData.NodeName)
		if owner != "" && node != "" && owner != node {
			continue
		}
		bodyKey := strings.TrimSpace(task.PrivateData.StudioBodyKey)
		if bodyKey != "" {
			if _, _, loadErr := LoadImageStudioJobBody(bodyKey); loadErr == nil {
				won, requeueErr := model.RequeueImageStudioTask(task.TaskID)
				if requeueErr != nil {
					logger.LogWarn(ctx, fmt.Sprintf("image studio requeue %s failed: %s", task.TaskID, requeueErr.Error()))
					continue
				}
				if won {
					logger.LogInfo(ctx, fmt.Sprintf("image studio requeued orphan task %s after process restart", task.TaskID))
				}
				continue
			}
		}
		// No executable body: fail fast and refund hold.
		fromStatus := task.Status
		now := time.Now().Unix()
		task.Status = model.TaskStatusFailure
		task.Progress = "100%"
		task.FailReason = "AI 画室任务在服务重启时中断，且无法恢复请求体"
		task.FinishTime = now
		task.UpdatedAt = now
		won, updateErr := task.UpdateWithStatus(fromStatus)
		if updateErr != nil {
			logger.LogWarn(ctx, fmt.Sprintf("image studio fail orphan %s failed: %s", task.TaskID, updateErr.Error()))
			continue
		}
		if !won {
			continue
		}
		RemoveImageStudioJobBody(bodyKey)
		backfillAndRefundImageStudioTask(ctx, task)
		logger.LogInfo(ctx, fmt.Sprintf("image studio failed unrecoverable orphan task %s after process restart", task.TaskID))
	}
}

func ImageStudioTaskTimeoutMinutes() int {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap["ImageStudioTaskTimeoutMinutes"]
	common.OptionMapRWMutex.RUnlock()
	timeoutMinutes, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || timeoutMinutes < constant.ImageStudioMinTimeoutMinutes || timeoutMinutes > constant.ImageStudioMaxTimeoutMinutes {
		return constant.ImageStudioDefaultTimeoutMinutes
	}
	return timeoutMinutes
}

func backfillAndRefundImageStudioTask(ctx context.Context, task *model.Task) {
	if task == nil {
		return
	}
	if task.Quota <= 0 && task.PrivateData.RequestId != "" {
		if BackfillTaskBillingFromConsumeLog(ctx, task, task.PrivateData.RequestId) {
			task.UpdatedAt = time.Now().Unix()
			if _, err := task.UpdateBillingSnapshot(model.TaskStatusFailure); err != nil {
				logger.LogWarn(ctx, fmt.Sprintf("persist image studio recovery billing task %s failed: %s", task.TaskID, err.Error()))
			}
		}
	}
	_, _ = RefundImageStudioTaskQuotaOnce(ctx, task, task.FailReason)
}
