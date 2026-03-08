package handlers

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"edict-go/models"
	"edict-go/store"
)

var (
	conversationInfoRe = regexp.MustCompile(`(?s)\n*Conversation info\s*\(.*`)
	codeBlockRe        = regexp.MustCompile("(?s)\n*```.*")
	prefixRe           = regexp.MustCompile(`^(任务|发起任务)[：:\x{ff1a}]\s*`)
)

// CreateTask handles POST /api/create-task.
func CreateTask(c *gin.Context) {
	var req models.CreateTaskReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "invalid JSON"})
		return
	}

	title := strings.TrimSpace(req.Title)
	if title == "" {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "任务标题不能为空"})
		return
	}

	// Strip metadata / code blocks / common prefixes
	title = conversationInfoRe.ReplaceAllString(title, "")
	title = codeBlockRe.ReplaceAllString(title, "")
	title = strings.TrimSpace(title)
	title = prefixRe.ReplaceAllString(title, "")

	// Truncate to 100 chars
	if utf8.RuneCountInString(title) > 100 {
		runes := []rune(title)
		title = string(runes[:100]) + "…"
	}

	// Quality checks
	if utf8.RuneCountInString(title) < models.MinTitleLen {
		c.JSON(http.StatusBadRequest, models.APIResp{
			OK:    false,
			Error: fmt.Sprintf("标题过短（%d<%d字），不像是有效任务", utf8.RuneCountInString(title), models.MinTitleLen),
		})
		return
	}
	if models.JunkTitles[strings.ToLower(title)] {
		c.JSON(http.StatusBadRequest, models.APIResp{
			OK:    false,
			Error: fmt.Sprintf("「%s」不是有效任务，请输入具体工作指令", title),
		})
		return
	}

	// Defaults
	org := req.Org
	if org == "" {
		org = "任务编排引擎"
	}
	official := req.Official
	if official == "" {
		official = "系统"
	}
	priority := req.Priority
	if priority == "" {
		priority = "normal"
	}

	var taskID string

	err := store.WithTasks(func(tasks []models.Task) ([]models.Task, error) {
		// Generate ID: MAS-YYYYMMDD-NNN
		today := time.Now().Format("20060102")
		prefix := "MAS-" + today + "-"
		maxSeq := 0
		for _, t := range tasks {
			if strings.HasPrefix(t.ID, prefix) {
				parts := strings.Split(t.ID, "-")
				if len(parts) == 3 {
					var n int
					if _, err := fmt.Sscanf(parts[2], "%d", &n); err == nil && n > maxSeq {
						maxSeq = n
					}
				}
			}
		}
		taskID = fmt.Sprintf("%s%03d", prefix, maxSeq+1)

		now := store.NowISO()
		newTask := models.Task{
			ID:       taskID,
			Title:    title,
			Official: official,
			Org:      "协调中枢",
			State:    "Queued",
			Now:      "等待协调中枢路由分配",
			ETA:      "-",
			Block:    "无",
			Output:   "",
			AC:       "",
			Priority: priority,
			FlowLog: []models.FlowEntry{{
				At:     now,
				From:   "用户",
				To:     "协调中枢",
				Remark: "发起任务：" + title,
			}},
			UpdatedAt: now,
		}
		if req.TemplateID != "" {
			newTask.TemplateID = req.TemplateID
		}
		if req.Params != nil {
			newTask.TemplateParams = req.Params
		}
		if req.TargetDept != "" {
			newTask.TargetDept = req.TargetDept
		}

		// Initialise scheduler
		store.EnsureScheduler(&newTask)
		store.SchedulerSnapshot(&newTask, "create-task-initial")
		store.SchedulerMarkProgress(&newTask, "任务创建")

		// Prepend (newest first)
		tasks = append([]models.Task{newTask}, tasks...)
		return tasks, nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResp{OK: false, Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, models.APIResp{
		OK:      true,
		TaskID:  taskID,
		Message: fmt.Sprintf("任务 %s 已创建，正交由协调中枢处理", taskID),
	})
}

