package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gin-gonic/gin"

	"edict-go/models"
	"edict-go/store"
)

// ── POST /api/morning-config (save) ──

func SaveMorningConfig(c *gin.Context) {
	var body map[string]any
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "invalid JSON"})
		return
	}
	if err := store.WriteJSONFile("morning_brief_config.json", body); err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResp{OK: false, Error: "保存配置失败: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResp{OK: true, Message: "配置已保存"})
}

// ── POST /api/morning-brief/refresh ──

func RefreshMorningBrief(c *gin.Context) {
	var body struct {
		Force bool `json:"force"`
	}
	_ = c.ShouldBindJSON(&body)

	python := findPython()
	scriptsDir := filepath.Join(store.DataDir(), "..", "scripts")
	scriptPath := filepath.Join(scriptsDir, "fetch_morning_news.py")

	if _, err := os.Stat(scriptPath); err != nil {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: "采集脚本不存在: " + scriptPath})
		return
	}

	// Async execution
	go func() {
		args := []string{scriptPath}
		if body.Force {
			args = append(args, "--force")
		}
		_ = exec.Command(python, args...).Run()
	}()

	c.JSON(http.StatusOK, models.APIResp{OK: true, Message: "刷新任务已触发，预计1-2分钟完成"})
}

// ── POST /api/repair-flow-order ──

func RepairFlowOrder(c *gin.Context) {
	var fixed int
	var fixedIDs []string

	err := store.WithTasks(func(tasks []models.Task) ([]models.Task, error) {
		for i := range tasks {
			t := &tasks[i]
			if len(t.ID) < 4 || t.ID[:4] != "MAS-" {
				continue
			}
			if len(t.FlowLog) == 0 {
				continue
			}
			first := &t.FlowLog[0]
			if first.From != "用户" || first.To != "任务编排引擎" {
				continue
			}
			first.To = "协调中枢"

			if t.State == "Planning" && t.Org == "任务编排引擎" && len(t.FlowLog) == 1 {
				t.State = "Queued"
				t.Org = "协调中枢"
				t.Now = "等待协调中枢路由分配"
			}
			t.UpdatedAt = store.NowISO()
			fixed++
			if len(fixedIDs) < 80 {
				fixedIDs = append(fixedIDs, t.ID)
			}
		}
		if fixed == 0 {
			return tasks, nil
		}
		return tasks, nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResp{OK: false, Error: err.Error()})
		return
	}

	more := 0
	if fixed > 80 {
		more = fixed - 80
	}
	c.JSON(http.StatusOK, gin.H{
		"ok":        true,
		"count":     fixed,
		"taskIds":   fixedIDs,
		"more":      more,
		"checkedAt": store.NowISO(),
	})
}

// ── POST /api/remote-skills-list (POST variant — same as GET) ──

func PostRemoteSkillsList(c *gin.Context) {
	GetRemoteSkillsList(c)
}

// ── unused: keep for JSON file write safety ──
func saveJSONSafe(filename string, data any) error {
	content, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(store.DataDir(), filename)
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, content, 0644); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

// findPython is defined in agents.go; re-export not needed since same package.
// syncAgentConfig is defined in skills.go
// truncStr is defined in agents.go
// safeNameRe is defined in static.go
// oclawHome is defined in agents.go
// checkGatewayAlive is defined in agents.go
// checkAgentWorkspace is defined in agents.go

// ── Ensure unused imports are handled ──
var (
	_ = fmt.Sprintf
)

