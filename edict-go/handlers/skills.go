package handlers

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"

	"edict-go/models"
	"edict-go/store"
)

// ── GET /api/skill-content/:agentId/:skillName ──

func GetSkillContent(c *gin.Context) {
	agentID := c.Param("agentId")
	skillName := c.Param("skillName")
	if !safeNameRe.MatchString(agentID) || !safeNameRe.MatchString(skillName) {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "参数含非法字符"})
		return
	}

	// Find skill path from agent_config.json
	var cfg map[string]any
	_ = store.ReadJSONFile("agent_config.json", &cfg)
	agents, _ := cfg["agents"].([]any)
	var skillPath string
	for _, raw := range agents {
		ag, _ := raw.(map[string]any)
		if ag["id"] != agentID {
			continue
		}
		skills, _ := ag["skills"].([]any)
		for _, s := range skills {
			sk, _ := s.(map[string]any)
			if sk["name"] == skillName {
				skillPath, _ = sk["path"].(string)
				break
			}
		}
		break
	}
	if skillPath == "" {
		// Fallback: check workspace directly
		skillPath = filepath.Join(oclawHome(), "workspace-"+agentID, "skills", skillName, "SKILL.md")
	}

	content, err := os.ReadFile(skillPath)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"ok": true, "name": skillName, "agent": agentID,
			"content": "(SKILL.md 文件不存在)", "path": skillPath,
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"ok": true, "name": skillName, "agent": agentID,
		"content": string(content), "path": skillPath,
	})
}

// ── POST /api/add-skill ──

func AddSkill(c *gin.Context) {
	var body struct {
		AgentID     string `json:"agentId"`
		SkillName   string `json:"skillName"`
		Description string `json:"description"`
		Trigger     string `json:"trigger"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "invalid JSON"})
		return
	}
	if !safeNameRe.MatchString(body.AgentID) {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "agentId 含非法字符"})
		return
	}
	if !safeNameRe.MatchString(body.SkillName) {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "skillName 含非法字符"})
		return
	}

	workspace := filepath.Join(oclawHome(), "workspace-"+body.AgentID, "skills", body.SkillName)
	if err := os.MkdirAll(workspace, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResp{OK: false, Error: "创建目录失败: " + err.Error()})
		return
	}

	desc := body.Description
	if desc == "" {
		desc = body.SkillName
	}
	triggerSection := ""
	if body.Trigger != "" {
		triggerSection = "\n## 触发条件\n" + body.Trigger + "\n"
	}
	template := fmt.Sprintf("---\nname: %s\ndescription: %s\n---\n\n# %s\n\n%s\n%s\n## 输入\n\n<!-- 说明此技能接收什么输入 -->\n\n## 处理流程\n\n1. 步骤一\n2. 步骤二\n\n## 输出规范\n\n<!-- 说明产出物格式与交付要求 -->\n\n## 注意事项\n\n- (在此补充约束、限制或特殊规则)\n",
		body.SkillName, desc, body.SkillName, desc, triggerSection)

	skillMd := filepath.Join(workspace, "SKILL.md")
	if err := os.WriteFile(skillMd, []byte(template), 0644); err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResp{OK: false, Error: "写入失败: " + err.Error()})
		return
	}

	// Async re-sync
	go syncAgentConfig()

	c.JSON(http.StatusOK, gin.H{
		"ok": true, "message": fmt.Sprintf("技能 %s 已添加到 %s", body.SkillName, body.AgentID),
		"path": skillMd,
	})
}

// ── POST /api/add-remote-skill ──

func AddRemoteSkill(c *gin.Context) {
	var body struct {
		AgentID     string `json:"agentId"`
		SkillName   string `json:"skillName"`
		SourceURL   string `json:"sourceUrl"`
		Description string `json:"description"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "invalid JSON"})
		return
	}
	if !safeNameRe.MatchString(body.AgentID) {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "agentId 含非法字符"})
		return
	}
	if !safeNameRe.MatchString(body.SkillName) {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "skillName 含非法字符"})
		return
	}
	if body.SourceURL == "" {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "sourceUrl 必须是有效的字符串"})
		return
	}

	url := strings.TrimSpace(body.SourceURL)

	// Download content
	var content string
	var fetchErr error
	if strings.HasPrefix(url, "https://") {
		content, fetchErr = downloadURL(url)
	} else if strings.HasPrefix(url, "file://") {
		var data []byte
		data, fetchErr = os.ReadFile(url[7:])
		content = string(data)
	} else if strings.HasPrefix(url, "/") || strings.HasPrefix(url, ".") {
		var data []byte
		data, fetchErr = os.ReadFile(url)
		content = string(data)
	} else {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "不支持的 URL 格式（仅支持 https://, file://, 或本地路径）"})
		return
	}
	if fetchErr != nil {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: "文件读取失败: " + truncStr(fetchErr.Error(), 100)})
		return
	}
	if !strings.HasPrefix(content, "---") {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: "文件格式无效（缺少 YAML frontmatter）"})
		return
	}

	// Write SKILL.md
	workspace := filepath.Join(oclawHome(), "workspace-"+body.AgentID, "skills", body.SkillName)
	if err := os.MkdirAll(workspace, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResp{OK: false, Error: "创建目录失败"})
		return
	}
	skillMd := filepath.Join(workspace, "SKILL.md")
	if err := os.WriteFile(skillMd, []byte(content), 0644); err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResp{OK: false, Error: "写入失败"})
		return
	}

	// Write .source.json
	now := store.NowISO()
	sourceInfo := map[string]any{
		"skillName":   body.SkillName,
		"sourceUrl":   url,
		"description": body.Description,
		"addedAt":     now,
		"lastUpdated": now,
		"checksum":    computeChecksum(content),
		"status":      "valid",
	}
	if data, err := json.MarshalIndent(sourceInfo, "", "  "); err == nil {
		_ = os.WriteFile(filepath.Join(workspace, ".source.json"), data, 0644)
	}

	go syncAgentConfig()

	c.JSON(http.StatusOK, gin.H{
		"ok": true, "message": fmt.Sprintf("技能 %s 已从远程源添加到 %s", body.SkillName, body.AgentID),
		"skillName": body.SkillName, "agentId": body.AgentID,
		"source": url, "localPath": skillMd,
		"size": len(content), "addedAt": now,
	})
}

// ── GET /api/remote-skills-list ──

func GetRemoteSkillsList(c *gin.Context) {
	var remoteSkills []map[string]any
	home := oclawHome()

	entries, err := os.ReadDir(home)
	if err == nil {
		for _, e := range entries {
			if !e.IsDir() || !strings.HasPrefix(e.Name(), "workspace-") {
				continue
			}
			agentID := strings.TrimPrefix(e.Name(), "workspace-")
			skillsDir := filepath.Join(home, e.Name(), "skills")
			skillEntries, err := os.ReadDir(skillsDir)
			if err != nil {
				continue
			}
			for _, se := range skillEntries {
				if !se.IsDir() {
					continue
				}
				sourceJSON := filepath.Join(skillsDir, se.Name(), ".source.json")
				data, err := os.ReadFile(sourceJSON)
				if err != nil {
					continue // local skill, skip
				}
				var info map[string]any
				if json.Unmarshal(data, &info) != nil {
					continue
				}
				skillMd := filepath.Join(skillsDir, se.Name(), "SKILL.md")
				status := "not-found"
				if _, err := os.Stat(skillMd); err == nil {
					status = "valid"
				}
				remoteSkills = append(remoteSkills, map[string]any{
					"skillName":   se.Name(),
					"agentId":     agentID,
					"sourceUrl":   info["sourceUrl"],
					"description": info["description"],
					"localPath":   skillMd,
					"addedAt":     info["addedAt"],
					"lastUpdated": info["lastUpdated"],
					"status":      status,
				})
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"ok":           true,
		"remoteSkills": remoteSkills,
		"count":        len(remoteSkills),
		"listedAt":     store.NowISO(),
	})
}

// ── POST /api/update-remote-skill ──

func UpdateRemoteSkill(c *gin.Context) {
	var body struct {
		AgentID   string `json:"agentId"`
		SkillName string `json:"skillName"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || !safeNameRe.MatchString(body.AgentID) || !safeNameRe.MatchString(body.SkillName) {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "agentId and skillName required"})
		return
	}

	sourceJSON := filepath.Join(oclawHome(), "workspace-"+body.AgentID, "skills", body.SkillName, ".source.json")
	data, err := os.ReadFile(sourceJSON)
	if err != nil {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: body.SkillName + " 不是远程 skill（无 .source.json）"})
		return
	}
	var info map[string]any
	if json.Unmarshal(data, &info) != nil {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: "源信息损坏"})
		return
	}
	sourceURL, _ := info["sourceUrl"].(string)
	if sourceURL == "" {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: "源 URL 不存在"})
		return
	}
	desc, _ := info["description"].(string)

	// Re-download by calling AddRemoteSkill logic inline
	c.Request.Body = io.NopCloser(strings.NewReader(
		fmt.Sprintf(`{"agentId":"%s","skillName":"%s","sourceUrl":"%s","description":"%s"}`,
			body.AgentID, body.SkillName, sourceURL, desc)))
	AddRemoteSkill(c)
}

// ── POST /api/remove-remote-skill ──

func RemoveRemoteSkill(c *gin.Context) {
	var body struct {
		AgentID   string `json:"agentId"`
		SkillName string `json:"skillName"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || !safeNameRe.MatchString(body.AgentID) || !safeNameRe.MatchString(body.SkillName) {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "agentId and skillName required"})
		return
	}

	workspace := filepath.Join(oclawHome(), "workspace-"+body.AgentID, "skills", body.SkillName)
	if _, err := os.Stat(workspace); err != nil {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: "技能不存在: " + body.SkillName})
		return
	}
	sourceJSON := filepath.Join(workspace, ".source.json")
	if _, err := os.Stat(sourceJSON); err != nil {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: body.SkillName + " 不是远程 skill，无法通过此 API 移除"})
		return
	}

	if err := os.RemoveAll(workspace); err != nil {
		c.JSON(http.StatusOK, models.APIResp{OK: false, Error: "移除失败: " + truncStr(err.Error(), 100)})
		return
	}

	go syncAgentConfig()

	c.JSON(http.StatusOK, models.APIResp{OK: true, Message: fmt.Sprintf("技能 %s 已从 %s 移除", body.SkillName, body.AgentID)})
}

// ── Helpers ──

func downloadURL(url string) (string, error) {
	client := &http.Client{Timeout: 10 * 1000 * 1000 * 1000} // 10s
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "OpenClaw-SkillManager/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("URL 无法访问: %s", truncStr(err.Error(), 100))
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func computeChecksum(content string) string {
	h := sha256.Sum256([]byte(content))
	return fmt.Sprintf("%x", h)[:16]
}

func syncAgentConfig() {
	python := findPython()
	scriptsDir := filepath.Join(store.DataDir(), "..", "scripts")
	_ = exec.Command(python, filepath.Join(scriptsDir, "sync_agent_config.py")).Run()
}
