package handlers

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"edict-go/models"
	"edict-go/store"
)

// ── Constants ──

// AgentDept describes a department/agent's static metadata.
type AgentDept struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Emoji string `json:"emoji"`
	Role  string `json:"role"`
	Rank  string `json:"rank"`
}

var agentDepts = []AgentDept{
	{ID: "coordinator", Label: "协调中枢", Emoji: "🤴", Role: "协调中枢", Rank: "核心"},
	{ID: "planner", Label: "任务编排引擎", Emoji: "📜", Role: "规划引擎", Rank: "核心"},
	{ID: "reviewer", Label: "安全审查引擎", Emoji: "🔍", Role: "审核引擎", Rank: "核心"},
	{ID: "dispatcher", Label: "任务调度引擎", Emoji: "📮", Role: "调度引擎", Rank: "核心"},
	{ID: "data_analyst", Label: "数据分析师", Emoji: "💰", Role: "数据分析", Rank: "执行"},
	{ID: "doc_writer", Label: "文档编写员", Emoji: "📚", Role: "文档撰写", Rank: "执行"},
	{ID: "software_engineer", Label: "代码架构师", Emoji: "🔧", Role: "软件研发", Rank: "执行"},
	{ID: "qa_engineer", Label: "质量保证师", Emoji: "⚖️", Role: "质量保障", Rank: "执行"},
	{ID: "monitor", Label: "情报监控员", Emoji: "📰", Role: "系统监控", Rank: "外围"},
}

func oclawHome() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".openclaw")
}

// ── GET /api/agents-status ──

func GetAgentsStatus(c *gin.Context) {
	type agentStatus struct {
		AgentDept
		Status       string  `json:"status"`
		StatusLabel  string  `json:"statusLabel"`
		LastActive   *string `json:"lastActive"`
		LastActiveTs int64   `json:"lastActiveTs"`
		Sessions     int     `json:"sessions"`
		HasWorkspace bool    `json:"hasWorkspace"`
		ProcessAlive bool    `json:"processAlive"`
	}

	gatewayAlive := checkGatewayAlive()
	isDocker := os.Getenv("IS_DOCKER") == "true"
	if isDocker {
		gatewayAlive = true
	}

	gatewayProbe := false
	if gatewayAlive {
		gatewayProbe = checkGatewayProbe()
	}

	agents := make([]agentStatus, 0, len(agentDepts))
	seen := map[string]bool{}
	for _, dept := range agentDepts {
		if seen[dept.ID] {
			continue
		}
		seen[dept.ID] = true

		hasWorkspace := checkAgentWorkspace(dept.ID)
		lastTs, sessCount, isBusy := getAgentSessionStatus(dept.ID)
		processAlive := checkAgentProcess(dept.ID)

		var status, statusLabel string
		if !hasWorkspace {
			status, statusLabel = "unconfigured", "❌ 未配置"
		} else if !gatewayAlive {
			status, statusLabel = "offline", "🔴 Gateway 离线"
		} else if processAlive || isBusy {
			status, statusLabel = "running", "🟢 运行中"
		} else if lastTs > 0 {
			nowMs := time.Now().UnixMilli()
			ageMs := nowMs - lastTs
			switch {
			case ageMs <= 10*60*1000:
				status, statusLabel = "idle", "🟡 待命"
			case ageMs <= 3600*1000:
				status, statusLabel = "idle", "⚪ 空闲"
			default:
				status, statusLabel = "idle", "⚪ 休眠"
			}
		} else {
			status, statusLabel = "idle", "⚪ 无记录"
		}

		var lastActiveStr *string
		if lastTs > 0 {
			s := time.UnixMilli(lastTs).Format("01-02 15:04")
			lastActiveStr = &s
		}

		agents = append(agents, agentStatus{
			AgentDept:    dept,
			Status:       status,
			StatusLabel:  statusLabel,
			LastActive:   lastActiveStr,
			LastActiveTs: lastTs,
			Sessions:     sessCount,
			HasWorkspace: hasWorkspace,
			ProcessAlive: processAlive,
		})
	}

	gwStatus := "🔴 未启动"
	if gatewayProbe {
		gwStatus = "🟢 运行中"
	} else if gatewayAlive {
		gwStatus = "🟡 进程在但无响应"
	}

	if !gatewayProbe {
		log.Printf("⚠️ Agent Status Probe: Gateway unhealthy (PROBE=%v, ALIVE=%v)", gatewayProbe, gatewayAlive)
	}

	c.JSON(http.StatusOK, gin.H{
		"ok": true,
		"gateway": gin.H{
			"alive":  gatewayAlive,
			"probe":  gatewayProbe,
			"status": gwStatus,
		},
		"agents":    agents,
		"checkedAt": store.NowISO(),
	})
}

func checkGatewayAlive() bool {
	return checkProcessRunning("openclaw")
}

func checkGatewayProbe() bool {
	url := os.Getenv("OPENCLAW_GATEWAY_URL")
	if url == "" {
		url = "http://127.0.0.1:18789"
	}
	url = strings.TrimSuffix(url, "/") + "/health"

	client := &http.Client{Timeout: 3 * time.Second}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return false
	}

	token := os.Getenv("OPENCLAW_TOKEN")
	if token != "" {
		req.Header.Set("X-OpenClaw-Token", token)
	}

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("❌ Gateway Probe Failed: GET %s -> %v", url, err)
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		log.Printf("⚠️ Gateway Probe: GET %s -> HTTP %d", url, resp.StatusCode)
	}
	return resp.StatusCode == 200
}

func checkAgentWorkspace(agentID string) bool {
	ws := filepath.Join(oclawHome(), "workspace-"+agentID)
	info, err := os.Stat(ws)
	return err == nil && info.IsDir()
}

func checkAgentProcess(agentID string) bool {
	return checkProcessRunning("openclaw-agent") || checkProcessRunning(agentID)
}

func checkProcessRunning(name string) bool {
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("tasklist", "/FI", fmt.Sprintf("IMAGENAME eq %s*", name), "/NH")
	} else {
		cmd = exec.Command("pgrep", "-f", name)
	}
	out, err := cmd.Output()
	if err != nil {
		return false
	}
	if runtime.GOOS == "windows" {
		return strings.Contains(string(out), name)
	}
	return len(strings.TrimSpace(string(out))) > 0
}

func getAgentSessionStatus(agentID string) (lastTs int64, sessions int, isBusy bool) {
	sessFile := filepath.Join(oclawHome(), "agents", agentID, "sessions", "sessions.json")
	data, err := os.ReadFile(sessFile)
	if err != nil {
		return 0, 0, false
	}
	var sessData []map[string]any
	if err := json.Unmarshal(data, &sessData); err != nil {
		return 0, 0, false
	}
	sessions = len(sessData)
	for _, s := range sessData {
		if ts, ok := s["last_active_ms"].(float64); ok && int64(ts) > lastTs {
			lastTs = int64(ts)
		}
		if active, ok := s["active"].(bool); ok && active {
			isBusy = true
		}
	}
	return
}

// ── POST /api/agent-wake ──

func AgentWake(c *gin.Context) {
	var body struct {
		AgentID string `json:"agentId"`
		Message string `json:"message"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "invalid JSON"})
		return
	}
	if body.AgentID == "" {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "agentId required"})
		return
	}
	if !safeNameRe.MatchString(body.AgentID) {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "agent_id 非法: " + body.AgentID})
		return
	}
	if !checkAgentWorkspace(body.AgentID) {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: body.AgentID + " 工作空间不存在，请先配置"})
		return
	}
	if !checkGatewayAlive() {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: "Gateway 未启动，请先运行 openclaw gateway start"})
		return
	}

	msg := body.Message
	if msg == "" {
		msg = "🔔 系统心跳检测 — 请回复 OK 确认在线。当前时间: " + store.NowISO()
	}

	// Async wake
	go func() {
		cmd := exec.Command("openclaw", "agent", "--agent", body.AgentID, "-m", msg, "--timeout", "120")
		for attempt := 1; attempt <= 2; attempt++ {
			out, err := cmd.CombinedOutput()
			if err == nil {
				log.Printf("✅ %s 已唤醒", body.AgentID)
				return
			}
			log.Printf("⚠️ %s 唤醒失败(第%d次): %s", body.AgentID, attempt, truncStr(string(out), 200))
			if attempt < 2 {
				time.Sleep(5 * time.Second)
			}
		}
		log.Printf("❌ %s 唤醒最终失败", body.AgentID)
	}()

	c.JSON(http.StatusOK, models.APIResp{OK: true, Message: body.AgentID + " 唤醒指令已发出，约10-30秒后生效"})
}

// ── POST /api/set-model ──

func SetModel(c *gin.Context) {
	var body struct {
		AgentID string `json:"agentId"`
		Model   string `json:"model"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "invalid JSON"})
		return
	}
	if body.AgentID == "" || body.Model == "" {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "agentId and model required"})
		return
	}

	// Write to pending_model_changes.json
	pendingPath := filepath.Join(store.DataDir(), "pending_model_changes.json")
	var pending []map[string]string
	if data, err := os.ReadFile(pendingPath); err == nil {
		_ = json.Unmarshal(data, &pending)
	}
	// Remove existing entry for this agent
	filtered := make([]map[string]string, 0, len(pending))
	for _, item := range pending {
		if item["agentId"] != body.AgentID {
			filtered = append(filtered, item)
		}
	}
	filtered = append(filtered, map[string]string{"agentId": body.AgentID, "model": body.Model})
	if data, err := json.MarshalIndent(filtered, "", "  "); err == nil {
		_ = os.WriteFile(pendingPath, data, 0644)
	}

	// Async apply
	go func() {
		scriptsDir := filepath.Join(store.DataDir(), "..", "scripts")
		python := findPython()
		_ = exec.Command(python, filepath.Join(scriptsDir, "apply_model_changes.py")).Run()
		_ = exec.Command(python, filepath.Join(scriptsDir, "sync_agent_config.py")).Run()
	}()

	c.JSON(http.StatusOK, models.APIResp{OK: true, Message: fmt.Sprintf("Queued: %s → %s", body.AgentID, body.Model)})
}

// ── GET /api/agent-activity/:agentId ──

func GetAgentActivity(c *gin.Context) {
	agentID := c.Param("agentId")
	if agentID == "" || !safeNameRe.MatchString(agentID) {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "invalid agent_id"})
		return
	}

	sessionsDir := filepath.Join(oclawHome(), "agents", agentID, "sessions")
	entries, err := os.ReadDir(sessionsDir)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": true, "agentId": agentID, "activity": []any{}})
		return
	}

	// Find latest .jsonl files
	var jsonlFiles []string
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".jsonl" {
			jsonlFiles = append(jsonlFiles, filepath.Join(sessionsDir, e.Name()))
		}
	}
	sort.Slice(jsonlFiles, func(i, j int) bool { return jsonlFiles[i] > jsonlFiles[j] })
	if len(jsonlFiles) > 3 {
		jsonlFiles = jsonlFiles[:3]
	}

	var activity []map[string]any
	for _, fp := range jsonlFiles {
		items := parseSessionJSONL(fp, agentID, 30)
		activity = append(activity, items...)
	}

	// Sort by "at" descending, limit to 30
	sort.Slice(activity, func(i, j int) bool {
		ai, _ := activity[i]["at"].(string)
		aj, _ := activity[j]["at"].(string)
		return ai > aj
	})
	if len(activity) > 30 {
		activity = activity[:30]
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "agentId": agentID, "activity": activity})
}

func parseSessionJSONL(path, agentID string, limit int) []map[string]any {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	session := filepath.Base(path)
	var items []map[string]any
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 1024*1024), 2*1024*1024)

	for scanner.Scan() && len(items) < limit {
		var entry map[string]any
		if err := json.Unmarshal(scanner.Bytes(), &entry); err != nil {
			continue
		}
		parsed := parseActivityEntry(entry, agentID, session)
		if parsed != nil {
			items = append(items, parsed)
		}
	}
	return items
}

func parseActivityEntry(item map[string]any, agentID, session string) map[string]any {
	msg, _ := item["message"].(map[string]any)
	if msg == nil {
		return nil
	}
	role, _ := msg["role"].(string)
	ts, _ := item["timestamp"].(string)
	if ts == "" {
		ts = store.NowISO()
	}

	var kind, text string
	switch role {
	case "assistant":
		// Extract thinking from content
		content, _ := msg["content"].(string)
		if content == "" {
			return nil
		}
		kind = "thinking"
		text = truncStr(content, 500)
	case "tool":
		kind = "tool_result"
		content, _ := msg["content"].(string)
		text = truncStr(content, 300)
	case "user":
		kind = "user"
		content, _ := msg["content"].(string)
		text = truncStr(content, 300)
	default:
		return nil
	}

	if text == "" {
		return nil
	}

	return map[string]any{
		"at":      ts,
		"kind":    kind,
		"text":    text,
		"agent":   agentID,
		"session": session,
	}
}

// ── Helpers ──

var reValidateName = regexp.MustCompile(`^[a-zA-Z0-9_\-\x{4e00}-\x{9fff}]+$`)

func findPython() string {
	if p, err := exec.LookPath("python3"); err == nil {
		return p
	}
	if p, err := exec.LookPath("python"); err == nil {
		return p
	}
	return "python3"
}

func truncStr(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen]
}
