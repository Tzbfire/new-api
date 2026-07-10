package controller

import (
	"context"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

var (
	imageStudioWorkerOnce sync.Once
	imageStudioWake       = make(chan struct{}, 1)
	imageStudioStopCh     = make(chan struct{})
	imageStudioStopOnce   sync.Once
	imageStudioShutdown   atomic.Bool
	imageStudioInFlight   sync.WaitGroup
)

// ImageStudioAcceptingJobs reports whether new studio jobs may be enqueued.
func ImageStudioAcceptingJobs() bool {
	return !imageStudioShutdown.Load()
}

// StartImageStudioWorker runs a fixed pool that claims durable QUEUED jobs.
// Restart-safe: bodies are on disk and claim is CAS in the database.
func StartImageStudioWorker() {
	imageStudioWorkerOnce.Do(func() {
		if err := service.EnsureImageStudioStorageReady(); err != nil {
			logger.LogError(context.Background(), "image studio storage not ready: "+err.Error())
		}
		workers := imageStudioBatchConcurrency()
		for i := 0; i < workers; i++ {
			gopool.Go(imageStudioWorkerLoop)
		}
		gopool.Go(func() {
			time.Sleep(time.Second)
			// Recovery already requeues orphans; wake workers to claim them.
			WakeImageStudioWorkers()
		})
	})
}

// BeginImageStudioShutdown stops claiming/enqueuing new studio jobs.
func BeginImageStudioShutdown() {
	if imageStudioShutdown.Swap(true) {
		return
	}
	imageStudioStopOnce.Do(func() { close(imageStudioStopCh) })
	// Wake every idle worker so they observe the stop signal promptly.
	for i := 0; i < imageStudioBatchConcurrency()+2; i++ {
		WakeImageStudioWorkers()
	}
	common.SysLog("image studio: stopped accepting new jobs")
}

// WaitImageStudioInFlight waits for in-flight studio generations up to ctx.
// Timed-out work stays IN_PROGRESS and is reclaimed on the next process start.
func WaitImageStudioInFlight(ctx context.Context) {
	if ctx == nil {
		ctx = context.Background()
	}
	done := make(chan struct{})
	go func() {
		imageStudioInFlight.Wait()
		close(done)
	}()
	select {
	case <-done:
		common.SysLog("image studio: in-flight jobs finished")
	case <-ctx.Done():
		common.SysLog("image studio: drain timed out; remaining jobs will be reclaimed on restart")
	}
}

// WakeImageStudioWorkers nudges idle workers after new jobs are inserted.
func WakeImageStudioWorkers() {
	select {
	case imageStudioWake <- struct{}{}:
	default:
	}
}

func imageStudioWorkerLoop() {
	for {
		if imageStudioShutdown.Load() {
			return
		}
		task, err := model.ClaimNextImageStudioTask()
		if err != nil {
			logger.LogError(context.Background(), "image studio claim failed: "+err.Error())
			select {
			case <-imageStudioStopCh:
				return
			case <-time.After(time.Second):
			}
			continue
		}
		if task != nil {
			// Race: shutdown started after claim — put the job back for restart.
			if imageStudioShutdown.Load() {
				if _, requeueErr := model.RequeueImageStudioTask(task.TaskID); requeueErr != nil {
					logger.LogError(context.Background(), "image studio requeue on shutdown failed: "+requeueErr.Error())
				}
				return
			}
			imageStudioInFlight.Add(1)
			func() {
				defer imageStudioInFlight.Done()
				runImageStudioClaimedTask(task)
			}()
			continue
		}
		select {
		case <-imageStudioStopCh:
			return
		case <-imageStudioWake:
		case <-time.After(3 * time.Second):
		}
	}
}

// rejectImageStudioIfShuttingDown aborts submit/estimate when draining.
func rejectImageStudioIfShuttingDown(c *gin.Context) bool {
	if ImageStudioAcceptingJobs() {
		return false
	}
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"error": gin.H{
			"message": "AI 画室正在关停，暂不接受新任务",
			"type":    "server_error",
		},
	})
	return true
}
