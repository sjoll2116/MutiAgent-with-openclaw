package handlers

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"edict-go/models"
	"edict-go/services"
	"edict-go/store"
)

// TaskAction handles POST /api/task-action.
// 兼容 CLI 端的 done, block, progress 以及看板端的 stop, cancel, resume。
func TaskAction(c *gin.Context) {
	var body models.TaskActionReq
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "invalid JSON"})
		return
	}
	if body.TaskID == "" {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "task_id required"})
		return
	}

	err := store.WithTasks(func(tasks []models.Task) ([]models.Task, error) {
		task := store.FindTask(tasks, body.TaskID)
		if task == nil {
			return nil, fmt.Errorf("任务 %s 不存在", body.TaskID)
		}

		oldState := task.State
		store.EnsureScheduler(task)

		// 1. 处理状态变更 (done/block/stop/cancel/resume/dispatch)
		action := body.Action
		if body.State != "" {
			task.State = body.State
		}
		if action == "stop" {
			task.State = "Blocked"
		} else if action == "cancel" {
			task.State = "Cancelled"
		} else if action == "resume" {
			prev := task.PrevState
			if prev == "" {
				prev = "Executing"
			}
			task.State = prev
			task.Block = "无"
		} else if action == "dispatch" {
			task.State = "Dispatching"
		}

		// 2. 处理 Now 描述
		if body.Now != "" {
			task.Now = body.Now
		}

		// 处理 TargetDept
		if body.TargetDept != "" {
			task.TargetDept = body.TargetDept
		}

		// 3. 处理阻塞原因
		if body.Block != "" {
			task.Block = body.Block
		}
		if action == "stop" || action == "cancel" {
			task.PrevState = oldState
		}

		// 4. 处理输出
		if body.Output != "" {
			task.Output = body.Output
		}

		// 5. 处理 TodosPipe (如果是进展汇到)
		if body.TodosPipe != "" {
			task.Todos = ParseTodosPipe(body.TodosPipe)
		}

		// 6. 记录 ProgressLog (如果是 Agent 进展)
		if body.Now != "" || body.Tokens > 0 {
			task.ProgressLog = append(task.ProgressLog, models.ProgressEntry{
				At:      store.NowISO(),
				Text:    body.Now,
				State:   task.State,
				Org:     task.Org,
				Tokens:  body.Tokens,
				Cost:    body.Cost,
				Elapsed: body.Elapsed,
			})
		}

		// 7. 处理 FlowLog (包含手动指定的或状态变更引起的)
		if body.FromDept != "" && body.ToDept != "" {
			task.FlowLog = append(task.FlowLog, models.FlowEntry{
				At:     store.NowISO(),
				From:   body.FromDept,
				To:     body.ToDept,
				Remark: body.Remark,
			})
		} else if task.State != oldState {
			remark := "状态变更：" + oldState + " → " + task.State
			if body.Now != "" {
				remark = body.Now
			}
			task.FlowLog = append(task.FlowLog, models.FlowEntry{
				At:     store.NowISO(),
				From:   "系统",
				To:     task.Org,
				Remark: remark,
			})
		}

		task.UpdatedAt = store.NowISO()

		// --- 自动评估采样 Hook ---
		if (task.State == "Completed" || task.State == "ResultReview" || task.State == "PlanReview") && oldState != task.State {
			var traces []string
			for _, p := range task.ProgressLog {
				if p.Text != "" {
					traces = append(traces, fmt.Sprintf("[%s] %s", p.Agent, p.Text))
				}
			}
			context := strings.Join(traces, "\n\n")
			metadata := fmt.Sprintf(`{"org": "%s", "final_state": "%s"}`, task.Org, task.State)
			store.SaveEvalSample("agent", task.ID, task.Title, context, task.Output, metadata)
		}

		services.SyncTaskProgress(task)
		return tasks, nil
	})

	if err != nil {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResp{OK: true, Message: body.TaskID + " 更新成功"})
}

func ParseTodosPipe(pipe string) []models.TodoItem {
	parts := strings.Split(pipe, "|")
	var todos []models.TodoItem
	for i, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		status := "not-started"
		title := p
		if strings.HasSuffix(p, "✅") {
			status = "completed"
			title = strings.TrimSuffix(p, "✅")
		} else if strings.HasSuffix(p, "🔄") {
			status = "in-progress"
			title = strings.TrimSuffix(p, "🔄")
		}
		todos = append(todos, models.TodoItem{
			ID:     fmt.Sprintf("%d", i+1),
			Title:  title,
			Status: status,
		})
	}
	return todos
}

// ArchiveTask handles POST /api/archive-task.
func ArchiveTask(c *gin.Context) {
	var body models.ArchiveTaskReq
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "invalid JSON"})
		return
	}
	if body.TaskID == "" && !body.ArchiveAllDone {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "task_id or archive_all_done required"})
		return
	}

	archived := true
	if body.Archived != nil {
		archived = *body.Archived
	}

	var resultMsg string
	var count int
	err := store.WithTasks(func(tasks []models.Task) ([]models.Task, error) {
		if body.ArchiveAllDone {
			for i := range tasks {
				s := tasks[i].State
				if (s == "Completed" || s == "Cancelled") && !tasks[i].Archived {
					tasks[i].Archived = true
					tasks[i].ArchivedAt = store.NowISO()
					count++
				}
			}
			resultMsg = fmt.Sprintf("%d 个任务已归档", count)
			return tasks, nil
		}
		task := store.FindTask(tasks, body.TaskID)
		if task == nil {
			return nil, fmt.Errorf("任务 %s 不存在", body.TaskID)
		}
		task.Archived = archived
		if archived {
			task.ArchivedAt = store.NowISO()
		} else {
			task.ArchivedAt = ""
		}
		task.UpdatedAt = store.NowISO()
		label := "已归档"
		if !archived {
			label = "已取消归档"
		}
		resultMsg = body.TaskID + " " + label
		return tasks, nil
	})
	if err != nil {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: err.Error()})
		return
	}
	resp := models.APIResp{OK: true, Message: resultMsg}
	if body.ArchiveAllDone {
		resp.Count = count
	}
	c.JSON(http.StatusOK, resp)
}

// UpdateTaskTodos handles POST /api/task-todos.
func UpdateTaskTodos(c *gin.Context) {
	var body models.TodoUpdateReq
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "invalid JSON"})
		return
	}
	if body.TaskID == "" {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "task_id required"})
		return
	}

	err := store.WithTasks(func(tasks []models.Task) ([]models.Task, error) {
		task := store.FindTask(tasks, body.TaskID)
		if task == nil {
			return nil, fmt.Errorf("任务 %s 不存在", body.TaskID)
		}

		// 1. 如果提供了批量列表
		if len(body.Todos) > 0 {
			task.Todos = body.Todos
		} else if body.TodoID != "" {
			// 2. 如果是更新单条
			found := false
			for i := range task.Todos {
				if task.Todos[i].ID == body.TodoID {
					if body.Title != "" {
						task.Todos[i].Title = body.Title
					}
					if body.Status != "" {
						task.Todos[i].Status = body.Status
					}
					if body.Detail != "" {
						task.Todos[i].Detail = body.Detail
					}
					if body.Stage != 0 {
						task.Todos[i].Stage = body.Stage
					}
					if body.Agent != "" {
						task.Todos[i].Agent = body.Agent
					}
					found = true
					break
				}
			}
			if !found {
				task.Todos = append(task.Todos, models.TodoItem{
					ID:     body.TodoID,
					Title:  body.Title,
					Status: body.Status,
					Detail: body.Detail,
					Stage:  body.Stage,
					Agent:  body.Agent,
				})
			}
		}

		task.UpdatedAt = store.NowISO()
		return tasks, nil
	})
	if err != nil {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResp{OK: true, Message: body.TaskID + " todos 已更新"})
}

// UpdateTaskScheduler handles POST /api/task-scheduler.
func UpdateTaskScheduler(c *gin.Context) {
	var body models.SchedulerUpdateReq
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "invalid JSON"})
		return
	}
	if body.TaskID == "" {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "task_id required"})
		return
	}

	err := store.WithTasks(func(tasks []models.Task) ([]models.Task, error) {
		task := store.FindTask(tasks, body.TaskID)
		if task == nil {
			return nil, fmt.Errorf("任务 %s 不存在", body.TaskID)
		}

		store.EnsureScheduler(task)
		for k, v := range body.Scheduler {
			task.Scheduler[k] = v
		}

		task.UpdatedAt = store.NowISO()
		return tasks, nil
	})
	if err != nil {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResp{OK: true, Message: body.TaskID + " scheduler 已更新"})
}

// ReviewAction handles POST /api/review-action (approve / reject).
func ReviewAction(c *gin.Context) {
	var body models.ReviewActionReq
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "invalid JSON"})
		return
	}
	if body.TaskID == "" || (body.Action != "approve" && body.Action != "reject") {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "task_id and action(approve/reject) required"})
		return
	}

	var resultMsg string
	var newState string
	var newOrg string
	err := store.WithTasks(func(tasks []models.Task) ([]models.Task, error) {
		task := store.FindTask(tasks, body.TaskID)
		if task == nil {
			return nil, fmt.Errorf("任务 %s 不存在", body.TaskID)
		}
		if task.State != "ResultReview" && task.State != "PlanReview" {
			return nil, fmt.Errorf("任务 %s 当前状态为 %s，无法审核", body.TaskID, task.State)
		}

		store.EnsureScheduler(task)
		store.SchedulerSnapshot(task, "review-before-"+body.Action)

		var remark, toDept, fromDept string
		if body.Action == "approve" {
			if task.State == "PlanReview" {
				task.State = "Dispatching"
				task.Now = "安全审查通过，移交调度引擎派发"
				comment := body.Comment
				if comment == "" {
					comment = "安全审查通过"
				}
				remark = "✅ 批准：" + comment
				toDept = "任务调度引擎"
				fromDept = "安全审查引擎"
			} else { // 结果审查
				task.State = "Completed"
				task.Now = "验收通过，任务完成"
				comment := body.Comment
				if comment == "" {
					comment = "审查通过"
				}
				remark = "✅ 验收通过：" + comment
				toDept = "用户"
				fromDept = "系统"
			}
		} else { // 驳回
			round := task.ReviewRound + 1
			task.ReviewRound = round
			task.State = "Planning"
			task.Now = fmt.Sprintf("被驳回，退回编排引擎修订（第%d轮）", round)
			comment := body.Comment
			if comment == "" {
				comment = "需要修改"
			}
			remark = "🚫 驳回：" + comment
			toDept = "任务编排引擎"
			fromDept = task.Org
		}

		task.FlowLog = append(task.FlowLog, models.FlowEntry{
			At:     store.NowISO(),
			From:   fromDept,
			To:     toDept,
			Remark: remark,
		})
		store.SchedulerMarkProgress(task, "审议动作 "+body.Action+" -> "+task.State)
		task.UpdatedAt = store.NowISO()

		newState = task.State
		newOrg = task.Org

		label := "已审查通过"
		if body.Action == "reject" {
			label = "已审查驳回"
		}
		dispatched := ""
		if task.State != "Completed" {
			dispatched = " (已自动派发 Agent)"
		}
		resultMsg = body.TaskID + " " + label + dispatched
		return tasks, nil
	})
	if err != nil {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: err.Error()})
		return
	}

	if newState != "" && newState != "Completed" && newState != "Cancelled" {
		go services.PublishEvent(services.TopicTaskStatus, body.TaskID, "task.status", "api", services.EventPayload{
			"task_id":      body.TaskID,
			"to":           newState,
			"assignee_org": newOrg,
		})
	}

	c.JSON(http.StatusOK, models.APIResp{OK: true, Message: resultMsg})
}

// AdvanceState handles POST /api/advance-state.
func AdvanceState(c *gin.Context) {
	var body models.AdvanceStateReq
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "invalid JSON"})
		return
	}
	if body.TaskID == "" {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "task_id required"})
		return
	}

	var resultMsg string
	var newState string
	var newOrg string
	err := store.WithTasks(func(tasks []models.Task) ([]models.Task, error) {
		task := store.FindTask(tasks, body.TaskID)
		if task == nil {
			return nil, fmt.Errorf("任务 %s 不存在", body.TaskID)
		}
		cur := task.State
		flow, ok := models.StateFlow[cur]
		if !ok {
			return nil, fmt.Errorf("任务 %s 状态为 %s，无法推进", body.TaskID, cur)
		}

		store.EnsureScheduler(task)
		store.SchedulerSnapshot(task, "advance-before-"+cur)

		remark := body.Comment
		if remark == "" {
			remark = flow.Remark
		}
		task.State = flow.Next
		task.Now = "⬇️ 手动推进：" + remark
		task.FlowLog = append(task.FlowLog, models.FlowEntry{
			At:     store.NowISO(),
			From:   flow.FromDept,
			To:     flow.ToDept,
			Remark: "⬇️ 手动推进：" + remark,
		})
		store.SchedulerMarkProgress(task, "手动推进 "+cur+" -> "+flow.Next)
		task.UpdatedAt = store.NowISO()

		newState = task.State
		newOrg = task.Org

		fromLabel := models.StateLabels[cur]
		toLabel := models.StateLabels[flow.Next]
		dispatched := ""
		if flow.Next != "Completed" {
			dispatched = " (已自动派发 Agent)"
		}
		resultMsg = body.TaskID + " " + fromLabel + " → " + toLabel + dispatched
		services.SyncTaskProgress(task)
		return tasks, nil
	})
	if err != nil {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: err.Error()})
		return
	}

	if newState != "" && newState != "Completed" && newState != "Cancelled" {
		go services.PublishEvent(services.TopicTaskStatus, body.TaskID, "task.status", "api", services.EventPayload{
			"task_id":      body.TaskID,
			"to":           newState,
			"assignee_org": newOrg,
		})
	}

	c.JSON(http.StatusOK, models.APIResp{OK: true, Message: resultMsg})
}
// ListTasks handles GET /api/tasks.
func ListTasks(c *gin.Context) {
	state := c.Query("state")
	org := c.Query("assignee_org")
	priority := c.Query("priority")
	// 这里可以扩展 limit/offset 分页逻辑
	
	tasks, err := store.QueryTasks(state, org, priority, 100, 0)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResp{OK: false, Error: err.Error()})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{
		"tasks": tasks,
		"count": len(tasks),
	})
}

// GetLiveStatus handles GET /api/live-status
func GetLiveStatus(c *gin.Context) {
	// 获取最近的活跃任务列表
	tasks, err := store.QueryTasks("", "", "", 300, 0)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResp{OK: false, Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"tasks":      tasks,
		"syncStatus": gin.H{"ok": true},
	})
}

// GetTask handles GET /api/tasks/:taskId.
func GetTask(c *gin.Context) {
	taskID := c.Param("taskId")
	task, err := store.GetTaskByID(taskID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResp{OK: false, Error: err.Error()})
		return
	}
	if task == nil {
		c.JSON(http.StatusNotFound, models.APIResp{OK: false, Error: "task not found"})
		return
	}
	c.JSON(http.StatusOK, task)
}

// GetTaskStats handles GET /api/tasks-stats.
func GetTaskStats(c *gin.Context) {
	stats, err := store.GetTaskStats()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResp{OK: false, Error: err.Error()})
		return
	}
	
	var total int64
	for _, v := range stats {
		total += v
	}
	
	c.JSON(http.StatusOK, gin.H{
		"total":    total,
		"by_state": stats,
	})
}
