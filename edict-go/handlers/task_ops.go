package handlers

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"edict-go/models"
	"edict-go/store"
)

// TaskAction handles POST /api/task-action (stop / cancel / resume).
func TaskAction(c *gin.Context) {
	var body struct {
		TaskID string `json:"taskId"`
		Action string `json:"action"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "invalid JSON"})
		return
	}
	if body.TaskID == "" || (body.Action != "stop" && body.Action != "cancel" && body.Action != "resume") {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "taskId and action(stop/cancel/resume) required"})
		return
	}
	reason := body.Reason
	if reason == "" {
		reason = "用户从看板" + body.Action
	}

	var resultMsg string
	err := store.WithTasks(func(tasks []models.Task) ([]models.Task, error) {
		task := store.FindTask(tasks, body.TaskID)
		if task == nil {
			return nil, fmt.Errorf("任务 %s 不存在", body.TaskID)
		}
		oldState := task.State
		store.EnsureScheduler(task)
		store.SchedulerSnapshot(task, "task-action-before-"+body.Action)

		switch body.Action {
		case "stop":
			task.State = "Blocked"
			task.Block = reason
			task.Now = "⏸️ 已暂停：" + reason
		case "cancel":
			task.State = "Cancelled"
			task.Block = reason
			task.Now = "🚫 已取消：" + reason
		case "resume":
			prev := task.PrevState
			if prev == "" {
				prev = "Executing"
			}
			task.State = prev
			task.Block = "无"
			task.Now = "▶️ 已恢复执行"
		}

		if body.Action == "stop" || body.Action == "cancel" {
			task.PrevState = oldState
		}

		var remarkPrefix string
		switch body.Action {
		case "stop":
			remarkPrefix = "⏸️ 叫停"
		case "cancel":
			remarkPrefix = "🚫 取消"
		case "resume":
			remarkPrefix = "▶️ 恢复"
		}
		task.FlowLog = append(task.FlowLog, models.FlowEntry{
			At:     store.NowISO(),
			From:   "用户",
			To:     task.Org,
			Remark: remarkPrefix + "：" + reason,
		})

		if body.Action == "resume" {
			store.SchedulerMarkProgress(task, "恢复到 "+task.State)
		} else {
			store.SchedulerAddFlow(task, "用户"+body.Action+"："+reason)
		}
		task.UpdatedAt = store.NowISO()

		labels := map[string]string{"stop": "已叫停", "cancel": "已取消", "resume": "已恢复"}
		resultMsg = body.TaskID + " " + labels[body.Action]
		return tasks, nil
	})
	if err != nil {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResp{OK: true, Message: resultMsg})
}

// ArchiveTask handles POST /api/archive-task.
func ArchiveTask(c *gin.Context) {
	var body struct {
		TaskID         string `json:"taskId"`
		Archived       *bool  `json:"archived"`
		ArchiveAllDone bool   `json:"archiveAllDone"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "invalid JSON"})
		return
	}
	if body.TaskID == "" && !body.ArchiveAllDone {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "taskId or archiveAllDone required"})
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
	var body struct {
		TaskID string            `json:"taskId"`
		Todos  []models.TodoItem `json:"todos"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "invalid JSON"})
		return
	}
	if body.TaskID == "" {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "taskId required"})
		return
	}
	if len(body.Todos) > 200 {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "todos must be a list (max 200 items)"})
		return
	}
	validStatuses := map[string]bool{"not-started": true, "in-progress": true, "completed": true}
	for i := range body.Todos {
		if body.Todos[i].ID == "" || body.Todos[i].Title == "" {
			c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "each todo must have id and title"})
			return
		}
		if !validStatuses[body.Todos[i].Status] {
			body.Todos[i].Status = "not-started"
		}
	}

	err := store.WithTasks(func(tasks []models.Task) ([]models.Task, error) {
		task := store.FindTask(tasks, body.TaskID)
		if task == nil {
			return nil, fmt.Errorf("任务 %s 不存在", body.TaskID)
		}
		task.Todos = body.Todos
		task.UpdatedAt = store.NowISO()
		return tasks, nil
	})
	if err != nil {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResp{OK: true, Message: body.TaskID + " todos 已更新"})
}

// ReviewAction handles POST /api/review-action (approve / reject).
func ReviewAction(c *gin.Context) {
	var body struct {
		TaskID  string `json:"taskId"`
		Action  string `json:"action"`
		Comment string `json:"comment"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "invalid JSON"})
		return
	}
	if body.TaskID == "" || (body.Action != "approve" && body.Action != "reject") {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "taskId and action(approve/reject) required"})
		return
	}

	var resultMsg string
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
			} else { // ResultReview
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
		} else { // reject
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
	c.JSON(http.StatusOK, models.APIResp{OK: true, Message: resultMsg})
}

// AdvanceState handles POST /api/advance-state.
func AdvanceState(c *gin.Context) {
	var body struct {
		TaskID  string `json:"taskId"`
		Comment string `json:"comment"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "invalid JSON"})
		return
	}
	if body.TaskID == "" {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "taskId required"})
		return
	}

	var resultMsg string
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

		fromLabel := models.StateLabels[cur]
		toLabel := models.StateLabels[flow.Next]
		dispatched := ""
		if flow.Next != "Completed" {
			dispatched = " (已自动派发 Agent)"
		}
		resultMsg = body.TaskID + " " + fromLabel + " → " + toLabel + dispatched
		return tasks, nil
	})
	if err != nil {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResp{OK: true, Message: resultMsg})
}
