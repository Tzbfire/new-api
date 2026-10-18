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

// StartImageStudioRecoveryTask reclaims this node's orphaned IN_PROGRESS jobs
// once at process start, then periodically fails timed-out work and refunds.
// QUEUED jobs are not failed here: durable workers claim them after restart.
func StartImageStudioRecoveryTask() {
	imageStudioRecoveryOnce.Do(func() {
		gopool.Go(func() {
			// Startup only: requeue/fail jobs left IN_PROGRESS by a previous
			// process. Must not run on the periodic tick or live workers would
			// be interrupted every minute.
			ReclaimOrphanedImageStudioTasks(context.Background())
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
	timeoutMinutes := ImageStudioTaskTimeoutMinutes()
	cutoff := time.Now().Add(-time.Duration(timeoutMinutes) * time.Minute).Unix()
	RecoverStaleSubmittingImageStudioBatches(ctx, cutoff)
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
		ReleaseImageStudioJobBodyForTask(task)
		backfillAndRefundImageStudioTask(ctx, task)
	}

	for _, task := range model.GetUnrefundedFailedImageStudioTasks(100) {
		backfillAndRefundImageStudioTask(ctx, task)
	}
}

// RecoverStaleSubmittingImageStudioBatches closes the commit gate for a batch
// that was interrupted while the HTTP submit path was still creating children.
// A fully materialized batch is safe to activate; a partial batch is terminally
// failed and refunded so no QUEUED child can become executable later.
func RecoverStaleSubmittingImageStudioBatches(ctx context.Context, cutoff int64) {
	if ctx == nil {
		ctx = context.Background()
	}
	batches, err := model.ListStaleSubmittingImageStudioBatches(cutoff, 20)
	if err != nil {
		logger.LogWarn(ctx, "image studio list stale submitting batches failed: "+err.Error())
		return
	}
	for _, batch := range batches {
		if batch == nil {
			continue
		}
		tasks, err := model.ListImageStudioBatchTasksAll(batch.UserID, batch.BatchID)
		if err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("image studio inspect submitting batch %s failed: %s", batch.BatchID, err.Error()))
			continue
		}
		fullyQueued := len(tasks) == batch.TotalCount
		if fullyQueued {
			for _, task := range tasks {
				if task == nil || task.Status != model.TaskStatusQueued {
					fullyQueued = false
					break
				}
			}
		}
		if fullyQueued {
			if err := model.ActivateImageStudioBatch(batch.ID); err != nil {
				logger.LogWarn(ctx, fmt.Sprintf("image studio activate recovered batch %s failed: %s", batch.BatchID, err.Error()))
				continue
			}
			logger.LogInfo(ctx, fmt.Sprintf("image studio activated fully submitted batch %s after interrupted submit", batch.BatchID))
			continue
		}

		reason := "AI 画室批次提交中断，未完整落库，已取消并退回预占额度"
		now := time.Now().Unix()
		allTerminal := true
		for _, task := range tasks {
			if task == nil || task.Status == model.TaskStatusSuccess || task.Status == model.TaskStatusFailure {
				continue
			}
			fromStatus := task.Status
			task.Status = model.TaskStatusFailure
			task.Progress = "100%"
			task.FailReason = reason
			task.FinishTime = now
			task.UpdatedAt = now
			won, updateErr := task.UpdateWithStatus(fromStatus)
			if updateErr != nil {
				allTerminal = false
				logger.LogWarn(ctx, fmt.Sprintf("image studio fail partial submitting task %s failed: %s", task.TaskID, updateErr.Error()))
				continue
			}
			if !won {
				allTerminal = false
				continue
			}
			backfillAndRefundImageStudioTask(ctx, task)
		}
		if !allTerminal {
			continue
		}
		if err := model.FailSubmittingImageStudioBatch(batch.ID); err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("image studio fail stale submitting batch %s failed: %s", batch.BatchID, err.Error()))
			continue
		}
		RemoveImageStudioJobBody(batch.BodyKey)
		logger.LogInfo(ctx, fmt.Sprintf("image studio failed partial batch %s after interrupted submit", batch.BatchID))
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
		ReleaseImageStudioJobBodyForTask(task)
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
