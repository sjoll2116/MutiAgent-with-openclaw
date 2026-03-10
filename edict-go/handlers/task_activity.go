package handlers

import (
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"edict-go/models"
	"edict-go/store"
)

// GetTaskActivity 处理 GET /api/task-activity/:taskId
func GetTaskActivity(c *gin.Context) {
	taskID := c.Param("taskId")
	if taskID == "" {
		c.JSON(http.StatusBadRequest, models.TaskActivityResp{OK: false, Error: "task_id required"})
		return
	}

	tasks, err := store.LoadTasks()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.TaskActivityResp{OK: false, Error: err.Error()})
		return
	}

	task := store.FindTask(tasks, taskID)
	if task == nil {
		c.JSON(http.StatusOK, models.TaskActivityResp{OK: false, Error: fmt.Sprintf("任务 %s 不存在", taskID)})
		return
	}

	state := task.State
	org := task.Org
	updatedAt := task.UpdatedAt

	// 任务元数据
	meta := &models.TaskMeta{
		Title:       task.Title,
		State:       state,
		Org:         org,
		Output:      task.Output,
		Block:       task.Block,
		Priority:    task.Priority,
		ReviewRound: task.ReviewRound,
		Archived:    task.Archived,
	}

	// 确定负责的 agent
	agentID := models.StateAgentMap[state]
	if agentID == "" && (state == "Doing" || state == "Next") {
		agentID = models.OrgAgentMap[org]
	}

	// 构建活动列表
	var activity []models.ActivityEntry
	relatedAgents := map[string]bool{}

	// 1. flow_log → kind=flow
	for _, fl := range task.FlowLog {
		activity = append(activity, models.ActivityEntry{
			At:     fl.At,
			Kind:   "flow",
			From:   fl.From,
			To:     fl.To,
			Remark: fl.Remark,
		})
	}

	// 2. progress_log → kind=progress + kind=todos
	var totalTokens, totalElapsed int
	var totalCost float64
	hasResource := false
	var prevTodos []models.TodoItem

	if len(task.ProgressLog) > 0 {
		for _, pl := range task.ProgressLog {
			if pl.Agent != "" {
				relatedAgents[pl.Agent] = true
			}
			// 累积资源
			if pl.Tokens > 0 {
				totalTokens += pl.Tokens
				hasResource = true
			}
			if pl.Cost > 0 {
				totalCost += pl.Cost
				hasResource = true
			}
			if pl.Elapsed > 0 {
				totalElapsed += pl.Elapsed
				hasResource = true
			}
			// 进度文本条目
			if pl.Text != "" {
				entry := models.ActivityEntry{
					At:         pl.At,
					Kind:       "progress",
					Text:       pl.Text,
					Agent:      pl.Agent,
					AgentLabel: pl.AgentLabel,
					State:      pl.State,
					Org:        pl.Org,
				}
				if pl.Tokens > 0 {
					entry.Tokens = pl.Tokens
				}
				if pl.Cost > 0 {
					entry.Cost = pl.Cost
				}
				if pl.Elapsed > 0 {
					entry.Elapsed = pl.Elapsed
				}
				activity = append(activity, entry)
			}
			// Todos 条目
			if len(pl.Todos) > 0 {
				todosEntry := models.ActivityEntry{
					At:         pl.At,
					Kind:       "todos",
					Items:      pl.Todos,
					Agent:      pl.Agent,
					AgentLabel: pl.AgentLabel,
					State:      pl.State,
					Org:        pl.Org,
				}
				diff := computeTodosDiff(prevTodos, pl.Todos)
				if diff != nil {
					todosEntry.Diff = diff
				}
				activity = append(activity, todosEntry)
				prevTodos = pl.Todos
			}
		}
		// 最后一个进度条的 agent
		if agentID == "" {
			last := task.ProgressLog[len(task.ProgressLog)-1]
			if last.Agent != "" {
				agentID = last.Agent
			}
		}
	} else {
		// 兼容旧数据：直接使用 now/todos
		if task.Now != "" {
			activity = append(activity, models.ActivityEntry{
				At:    updatedAt,
				Kind:  "progress",
				Text:  task.Now,
				Agent: agentID,
				State: state,
				Org:   org,
			})
		}
		if len(task.Todos) > 0 {
			activity = append(activity, models.ActivityEntry{
				At:    updatedAt,
				Kind:  "todos",
				Items: task.Todos,
				Agent: agentID,
				State: state,
				Org:   org,
			})
		}
	}

	// 按时间戳排序
	sort.Slice(activity, func(i, j int) bool {
		return activity[i].At < activity[j].At
	})

	if agentID != "" {
		relatedAgents[agentID] = true
	}

	// 阶段时长
	phaseDurations := computePhaseDurations(task.FlowLog, state)

	// Todos 摘要
	var todosSummary *models.TodosSummary
	if len(task.Todos) > 0 {
		todosSummary = computeTodosSummary(task.Todos)
	}

	// 总时长
	totalDuration := computeTotalDuration(task.FlowLog, state)

	// 构建响应
	resp := models.TaskActivityResp{
		OK:             true,
		TaskID:         taskID,
		TaskMeta:       meta,
		AgentID:        agentID,
		AgentLabel:     models.StateLabels[state],
		ActivitySource: "progress",
		PhaseDurations: phaseDurations,
		TotalDuration:  totalDuration,
	}

	if updatedAt != "" {
		la := updatedAt
		if len(la) >= 19 {
			la = strings.ReplaceAll(la[:19], "T", " ")
		}
		resp.LastActive = la
	}

	if len(activity) > 0 {
		resp.Activity = activity
	}

	// 排序后的相关 agent
	if len(relatedAgents) > 0 {
		agents := make([]string, 0, len(relatedAgents))
		for a := range relatedAgents {
			agents = append(agents, a)
		}
		sort.Strings(agents)
		resp.RelatedAgents = agents
	}

	if todosSummary != nil {
		resp.TodosSummary = todosSummary
	}
	if hasResource {
		resp.ResourceSummary = &models.ResourceSummary{
			TotalTokens:     totalTokens,
			TotalCost:       math.Round(totalCost*10000) / 10000,
			TotalElapsedSec: totalElapsed,
		}
	}

	c.JSON(http.StatusOK, resp)
}

// 辅助函数

func computePhaseDurations(flowLog []models.FlowEntry, state string) []models.PhaseDuration {
	if len(flowLog) == 0 {
		return nil
	}
	var phases []models.PhaseDuration
	isTerminal := models.TerminalStates[state]

	for i, fl := range flowLog {
		startAt := fl.At
		toDept := fl.To
		remark := fl.Remark

		var endAt string
		ongoing := false

		if i+1 < len(flowLog) {
			endAt = flowLog[i+1].At
		} else {
			// 如果是最后一条流转记录，且任务已处于终态，则不继续计时
			if isTerminal {
				endAt = startAt // 结束状态的驻留时间为0
			} else {
				endAt = store.NowISO()
				ongoing = true
			}
		}

		durSec := parseTimeDiffSeconds(startAt, endAt)
		phases = append(phases, models.PhaseDuration{
			Phase:        toDept,
			From:         startAt,
			To:           endAt,
			DurationSec:  durSec,
			DurationText: formatDuration(durSec),
			Ongoing:      ongoing,
			Remark:       remark,
		})
	}
	return phases
}

func computeTodosSummary(todos []models.TodoItem) *models.TodosSummary {
	total := len(todos)
	if total == 0 {
		return nil
	}
	completed := 0
	inProgress := 0
	for _, t := range todos {
		switch t.Status {
		case "completed":
			completed++
		case "in-progress":
			inProgress++
		}
	}
	notStarted := total - completed - inProgress
	percent := 0
	if total > 0 {
		percent = int(math.Round(float64(completed) / float64(total) * 100))
	}
	return &models.TodosSummary{
		Total:      total,
		Completed:  completed,
		InProgress: inProgress,
		NotStarted: notStarted,
		Percent:    percent,
	}
}

func computeTodosDiff(prev, curr []models.TodoItem) *models.TodosDiff {
	prevMap := make(map[string]models.TodoItem, len(prev))
	for _, t := range prev {
		prevMap[t.ID] = t
	}
	currMap := make(map[string]models.TodoItem, len(curr))
	for _, t := range curr {
		currMap[t.ID] = t
	}

	var changed, added, removed []models.TodoDiffItem
	for id, ct := range currMap {
		if pt, ok := prevMap[id]; ok {
			if pt.Status != ct.Status {
				changed = append(changed, models.TodoDiffItem{
					ID: id, Title: ct.Title, From: pt.Status, To: ct.Status,
				})
			}
		} else {
			added = append(added, models.TodoDiffItem{ID: id, Title: ct.Title})
		}
	}
	for id, pt := range prevMap {
		if _, ok := currMap[id]; !ok {
			removed = append(removed, models.TodoDiffItem{ID: id, Title: pt.Title})
		}
	}
	if len(changed) == 0 && len(added) == 0 && len(removed) == 0 {
		return nil
	}
	return &models.TodosDiff{Changed: changed, Added: added, Removed: removed}
}

func computeTotalDuration(flowLog []models.FlowEntry, state string) string {
	if len(flowLog) == 0 {
		return ""
	}
	firstAt := flowLog[0].At
	var lastAt string
	if (state == "Done" || state == "Cancelled") && len(flowLog) >= 2 {
		lastAt = flowLog[len(flowLog)-1].At
	} else {
		lastAt = store.NowISO()
	}
	dur := parseTimeDiffSeconds(firstAt, lastAt)
	if dur <= 0 {
		return ""
	}
	return formatDuration(dur)
}

// 解析两个 ISO 时间戳并返回秒差
func parseTimeDiffSeconds(from, to string) int {
	layouts := []string{
		"2006-01-02T15:04:05.000Z",
		"2006-01-02T15:04:05Z",
		"2006-01-02T15:04:05.000+00:00",
		"2006-01-02T15:04:05+00:00",
		time.RFC3339Nano,
		time.RFC3339,
	}
	var fromT, toT time.Time
	var err error
	for _, lay := range layouts {
		fromT, err = time.Parse(lay, from)
		if err == nil {
			break
		}
	}
	if err != nil {
		return 0
	}
	for _, lay := range layouts {
		toT, err = time.Parse(lay, to)
		if err == nil {
			break
		}
	}
	if err != nil {
		return 0
	}
	sec := int(toT.Sub(fromT).Seconds())
	if sec < 0 {
		return 0
	}
	return sec
}

// 将秒数转换为中文
func formatDuration(sec int) string {
	switch {
	case sec < 60:
		return fmt.Sprintf("%d秒", sec)
	case sec < 3600:
		return fmt.Sprintf("%d分%d秒", sec/60, sec%60)
	case sec < 86400:
		h := sec / 3600
		rem := sec % 3600
		return fmt.Sprintf("%d小时%d分", h, rem/60)
	default:
		d := sec / 86400
		rem := sec % 86400
		return fmt.Sprintf("%d天%d小时", d, rem/3600)
	}
}
