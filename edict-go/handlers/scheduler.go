package handlers

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"edict-go/models"
	"edict-go/store"
)

// SchedulerScan 处理 POST /api/scheduler-scan。
func SchedulerScan(c *gin.Context) {
	var body struct {
		ThresholdSec int `json:"thresholdSec"`
	}
	_ = c.ShouldBindJSON(&body)
	if body.ThresholdSec <= 0 {
		body.ThresholdSec = 180
	}

	tasks, err := store.LoadTasks()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResp{OK: false, Error: err.Error()})
		return
	}

	type stalledInfo struct {
		TaskID     string `json:"taskId"`
		State      string `json:"state"`
		StalledFor int    `json:"stalledFor"`
		Action     string `json:"action"`
	}

	var stalled []stalledInfo
	now := store.NowISO()

	for i := range tasks {
		t := &tasks[i]
		if models.TerminalStates[t.State] || t.Archived {
			continue
		}
		sched := store.EnsureScheduler(t)
		lastProgress, _ := sched["lastProgressAt"].(string)
		if lastProgress == "" {
			continue
		}
		elapsed := parseTimeDiffSeconds(lastProgress, now)
		if elapsed >= body.ThresholdSec {
			retryCount := 0
			if rc, ok := sched["retryCount"].(float64); ok {
				retryCount = int(rc)
			}
			maxRetry := 1
			if mr, ok := sched["maxRetry"].(float64); ok {
				maxRetry = int(mr)
			}
			action := "retry"
			if retryCount >= maxRetry {
				action = "escalate"
			}
			stalled = append(stalled, stalledInfo{
				TaskID:     t.ID,
				State:      t.State,
				StalledFor: elapsed,
				Action:     action,
			})
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"ok":           true,
		"scanned":      len(tasks),
		"stalledTasks": stalled,
	})
}

// SchedulerRetry 处理 POST /api/scheduler-retry。
func SchedulerRetry(c *gin.Context) {
	var body struct {
		TaskID string `json:"taskId"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.TaskID == "" {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "taskId required"})
		return
	}

	var resultMsg string
	err := store.WithTasks(func(tasks []models.Task) ([]models.Task, error) {
		task := store.FindTask(tasks, body.TaskID)
		if task == nil {
			return nil, fmt.Errorf("任务 %s 不存在", body.TaskID)
		}
		sched := store.EnsureScheduler(task)
		retryCount := 0
		if rc, ok := sched["retryCount"].(float64); ok {
			retryCount = int(rc)
		}
		sched["retryCount"] = retryCount + 1
		sched["lastRetryAt"] = store.NowISO()
		sched["stallSince"] = nil
		reason := body.Reason
		if reason == "" {
			reason = "调度器自动重试"
		}
		store.SchedulerAddFlow(task, fmt.Sprintf("重试(第%d次)：%s", retryCount+1, reason))
		task.UpdatedAt = store.NowISO()
		resultMsg = fmt.Sprintf("%s 重试(第%d次)", body.TaskID, retryCount+1)
		return tasks, nil
	})
	if err != nil {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResp{OK: true, Message: resultMsg})
}

// SchedulerEscalate 处理 POST /api/scheduler-escalate。
func SchedulerEscalate(c *gin.Context) {
	var body struct {
		TaskID string `json:"taskId"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.TaskID == "" {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "taskId required"})
		return
	}

	var resultMsg string
	err := store.WithTasks(func(tasks []models.Task) ([]models.Task, error) {
		task := store.FindTask(tasks, body.TaskID)
		if task == nil {
			return nil, fmt.Errorf("任务 %s 不存在", body.TaskID)
		}
		sched := store.EnsureScheduler(task)
		level := 0
		if lv, ok := sched["escalationLevel"].(float64); ok {
			level = int(lv)
		}
		sched["escalationLevel"] = level + 1
		sched["lastEscalatedAt"] = store.NowISO()
		reason := body.Reason
		if reason == "" {
			reason = "任务停滞，升级处理"
		}
		store.SchedulerAddFlow(task, fmt.Sprintf("升级(Level %d)：%s", level+1, reason))
		task.UpdatedAt = store.NowISO()
		resultMsg = fmt.Sprintf("%s 已升级到 Level %d", body.TaskID, level+1)
		return tasks, nil
	})
	if err != nil {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResp{OK: true, Message: resultMsg})
}

// SchedulerRollback 处理 POST /api/scheduler-rollback。
func SchedulerRollback(c *gin.Context) {
	var body struct {
		TaskID string `json:"taskId"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.TaskID == "" {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "taskId required"})
		return
	}

	var resultMsg string
	err := store.WithTasks(func(tasks []models.Task) ([]models.Task, error) {
		task := store.FindTask(tasks, body.TaskID)
		if task == nil {
			return nil, fmt.Errorf("任务 %s 不存在", body.TaskID)
		}
		sched := store.EnsureScheduler(task)
		snapshot, ok := sched["snapshot"].(map[string]any)
		if !ok || snapshot == nil {
			return nil, fmt.Errorf("任务 %s 没有可用的快照", body.TaskID)
		}
		// 从快照恢复
		if v, ok := snapshot["state"].(string); ok && v != "" {
			task.State = v
		}
		if v, ok := snapshot["org"].(string); ok && v != "" {
			task.Org = v
		}
		if v, ok := snapshot["now"].(string); ok {
			task.Now = v
		}
		reason := body.Reason
		if reason == "" {
			reason = "调度器回滚到上一快照"
		}
		store.SchedulerAddFlow(task, "回滚："+reason)
		store.SchedulerMarkProgress(task, "已回滚")
		task.UpdatedAt = store.NowISO()
		resultMsg = fmt.Sprintf("%s 已回滚到 %s", body.TaskID, task.State)
		return tasks, nil
	})
	if err != nil {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResp{OK: true, Message: resultMsg})
}
