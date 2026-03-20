package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"edict-go/models"
	"edict-go/store"
	"gorm.io/gorm"
)

// StartRuntimeSync starts the background goroutine for syncing OpenClaw sessions.
func StartRuntimeSync(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	go func() {
		log.Printf("🧵 Runtime Sync service started (Interval: 30s)")
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := SyncRuntime(); err != nil {
					log.Printf("⚠️ Runtime sync error: %v", err)
				}
			}
		}
	}()
}

// SyncRuntime implements the logic to scan .openclaw/agents and update DB.
func SyncRuntime() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	sessionsRoot := filepath.Join(home, ".openclaw", "agents")
	if _, err := os.Stat(sessionsRoot); os.IsNotExist(err) {
		return nil // No OpenClaw installed
	}

	dirs, err := ioutil.ReadDir(sessionsRoot)
	if err != nil {
		return err
	}

	nowMs := time.Now().UnixMilli()
	var tasks []models.Task

	for _, d := range dirs {
		if !d.IsDir() {
			continue
		}
		agentID := d.Name()
		sessionsFile := filepath.Join(sessionsRoot, agentID, "sessions", "sessions.json")
		
		data, err := ioutil.ReadFile(sessionsFile)
		if err != nil {
			continue
		}

		var raw map[string]interface{}
		if err := json.Unmarshal(data, &raw); err != nil {
			continue
		}

		for sessionKey, rowVal := range raw {
			row, ok := rowVal.(map[string]interface{})
			if !ok {
				continue
			}
			task := buildTaskFromSession(agentID, sessionKey, row, nowMs)
			tasks = append(tasks, task)
		}
	}

	// Filter tasks to avoid noise (similar to Python logic)
	filtered := filterTasks(tasks, nowMs)

	// Update DB
	for _, t := range filtered {
		if err := updateDBTask(t); err != nil {
			log.Printf("Failed to update task %s: %v", t.ID, err)
		}
	}

	return nil
}

func buildTaskFromSession(agentID, sessionKey string, row map[string]interface{}, nowMs int64) models.Task {
	sessionID, _ := row["sessionId"].(string)
	if sessionID == "" {
		sessionID = sessionKey
	}
	updatedAtMs := int64(0)
	if val, ok := row["updatedAt"].(float64); ok {
		updatedAtMs = int64(val)
	}

	ageMs := nowMs - updatedAtMs
	if ageMs < 0 {
		ageMs = 0
	}
	aborted, _ := row["abortedLastRun"].(bool)

	state := stateFromAge(ageMs, aborted)
	official, org := detectOfficial(agentID)
	sessionFile, _ := row["sessionFile"].(string)

	activity := loadActivity(sessionFile, 10)
	nowText := "等待指令"
	if len(activity) > 0 {
		first := activity[0]
		if first.Kind == "tool" && len(activity) > 1 {
			for _, next := range activity[1:] {
				if next.Kind == "assistant" {
					nowText = "正在执行: " + truncate(next.Text, 80)
					break
				}
			}
		} else if first.Kind == "assistant" {
			nowText = "思考中: " + truncate(first.Text, 80)
		} else {
			nowText = truncate(first.Text, 60)
		}
	}

	titleLabel := sessionKey
	if origin, ok := row["origin"].(map[string]interface{}); ok {
		if lbl, ok := origin["label"].(string); ok && lbl != "" {
			titleLabel = lbl
		}
	}

	title := titleLabel
	reCron := regexp.MustCompile(`agent:\w+:cron:`)
	reSub := regexp.MustCompile(`agent:\w+:subagent:`)
	if reCron.MatchString(titleLabel) {
		title = org + "定时任务"
	} else if reSub.MatchString(titleLabel) {
		title = org + "子任务"
	} else if titleLabel == sessionKey || len(titleLabel) > 40 {
		title = org + "会话"
	}

	id := fmt.Sprintf("OC-%s-%s", agentID, truncate(sessionID, 8))
	nowISO := time.UnixMilli(updatedAtMs).UTC().Format(time.RFC3339)

	return models.Task{
		ID:        id,
		Title:     title,
		Official:  official,
		Org:       org,
		State:     state,
		Now:       nowText,
		ETA:       nowISO,
		Block:     ifThenElse(aborted, "上次运行中断", "无").(string),
		Output:    sessionFile,
		UpdatedAt: nowISO,
		CreatedAt: nowISO, // Fallback
		AC:        "来自 OpenClaw runtime sessions 的实时映射",
		ProgressLog: mapActivityToProgress(activity),
	}
}

func stateFromAge(ageMs int64, aborted bool) string {
	if aborted {
		return "Blocked"
	}
	if ageMs <= 2*60*1000 {
		return "Executing"
	}
	if ageMs <= 60*60*1000 {
		return "ResultReview"
	}
	return "Next"
}

func detectOfficial(agentID string) (string, string) {
	mapping := map[string][2]string{
		"main":              {"总协调", "协调中枢"},
		"coordinator":       {"总协调", "协调中枢"},
		"planner":           {"编配专家", "任务编排引擎"},
		"reviewer":          {"审查专家", "安全审查引擎"},
		"dispatcher":        {"调度主管", "任务调度引擎"},
		"data_analyst":      {"数据分析师", "执行部门"},
		"doc_writer":        {"文档编写员", "执行部门"},
		"software_engineer": {"代码架构师", "执行部门"},
		"qa_engineer":       {"质量保证师", "执行部门"},
		"hr_manager":        {"资源调配员", "人力支撑"},
		"monitor":           {"监控主管", "系统监控员"},
	}
	res, ok := mapping[agentID]
	if ok {
		return res[0], res[1]
	}
	return "调度主管", "任务调度引擎"
}

func loadActivity(sessionFile string, limit int) []models.ActivityEntry {
	if sessionFile == "" {
		return nil
	}
	data, err := ioutil.ReadFile(sessionFile)
	if err != nil {
		return nil
	}

	lines := strings.Split(string(data), "\n")
	var entries []models.ActivityEntry
	// Process from latest to oldest
	for i := len(lines) - 1; i >= 0; i-- {
		ln := strings.TrimSpace(lines[i])
		if ln == "" {
			continue
		}
		var item map[string]interface{}
		if err := json.Unmarshal([]byte(ln), &item); err != nil {
			continue
		}

		msg, _ := item["message"].(map[string]interface{})
		role, _ := msg["role"].(string)
		ts, _ := item["timestamp"].(string)

		if role == "toolResult" {
			tool, _ := msg["toolName"].(string)
			content := ""
			if contentList, ok := msg["content"].([]interface{}); ok && len(contentList) > 0 {
				if first, ok := contentList[0].(map[string]interface{}); ok {
					content, _ = first["text"].(string)
				}
			}
			text := ""
			if len(content) < 50 {
				text = fmt.Sprintf("Tool '%s' returned: %s", tool, content)
			} else {
				text = fmt.Sprintf("Tool '%s' finished", tool)
			}
			entries = append(entries, models.ActivityEntry{At: ts, Kind: "tool", Text: text})
		} else if role == "assistant" {
			text := ""
			if contentList, ok := msg["content"].([]interface{}); ok {
				for _, cVal := range contentList {
					if c, ok := cVal.(map[string]interface{}); ok && c["type"] == "text" {
						raw, _ := c["text"].(string)
						text = strings.TrimSpace(strings.ReplaceAll(raw, "[[reply_to_current]]", ""))
						break
					}
				}
			}
			if text != "" {
				summary := strings.Split(text, "\n")[0]
				entries = append(entries, models.ActivityEntry{At: ts, Kind: "assistant", Text: truncate(summary, 200)})
			}
		} else if role == "user" {
			text := ""
			if contentList, ok := msg["content"].([]interface{}); ok && len(contentList) > 0 {
				if first, ok := contentList[0].(map[string]interface{}); ok {
					text, _ = first["text"].(string)
				}
			}
			if text != "" {
				entries = append(entries, models.ActivityEntry{At: ts, Kind: "user", Text: "User: " + truncate(text, 100)})
			}
		}

		if len(entries) >= limit {
			break
		}
	}
	return entries
}

func filterTasks(tasks []models.Task, nowMs int64) []models.Task {
	var filtered []models.Task
	oneDayAgo := nowMs - 24*3600*1000
	for _, t := range tasks {
		// MAS/JJC 始终保留（虽然通常不在这里产生）
		if strings.HasPrefix(t.ID, "MAS-") || strings.HasPrefix(t.ID, "JJC-") {
			filtered = append(filtered, t)
			continue
		}

		// OC 任务过滤
		updatedAt, _ := time.Parse(time.RFC3339, t.UpdatedAt)
		updatedMs := updatedAt.UnixMilli()

		if updatedMs < oneDayAgo {
			continue
		}

		if strings.Contains(t.Title, "定时任务") || strings.Contains(t.Title, "子任务") {
			if t.State != "Blocked" {
				continue
			}
		}

		if t.State != "Executing" && t.State != "Blocked" {
			continue
		}

		filtered = append(filtered, t)
	}
	return filtered
}

func updateDBTask(task models.Task) error {
	// Check if exists and is newer
	var existing models.GormTask
	err := store.DB.First(&existing, "id = ?", task.ID).Error
	if err == nil {
		// If existing is newer, don't update from sync
		updatedAt, _ := time.Parse(time.RFC3339, task.UpdatedAt)
		if existing.UpdatedAt.After(updatedAt) || existing.UpdatedAt.Equal(updatedAt) {
			return nil
		}
	} else if err != gorm.ErrRecordNotFound {
		return err
	}

	// Save
	return store.SaveTasks([]models.Task{task})
}

func mapActivityToProgress(activity []models.ActivityEntry) []models.ProgressEntry {
	var progs []models.ProgressEntry
	for _, a := range activity {
		progs = append(progs, models.ProgressEntry{
			At:    a.At,
			Text:  a.Text,
			Agent: ifThenElse(a.Kind == "tool", "Tool", a.Kind).(string),
		})
	}
	// Sort by At ascending for GORM
	sort.Slice(progs, func(i, j int) bool {
		return progs[i].At < progs[j].At
	})
	return progs
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

func ifThenElse(condition bool, a, b interface{}) interface{} {
	if condition {
		return a
	}
	return b
}
