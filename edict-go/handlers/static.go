package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"

	"edict-go/models"
	"edict-go/store"
)

var (
	distDir    string
	safeNameRe = regexp.MustCompile(`^[a-zA-Z0-9_\-\x{4e00}-\x{9fff}]+$`)
)

// SetDistDir configures the static file serving directory.
func SetDistDir(dir string) { distDir = dir }

// ── Generic JSON file readers ──

// JSONFile returns a handler that serves a JSON file from the data directory.
func JSONFile(filename string) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw, err := store.ReadJSONRaw(filename)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.APIResp{OK: false, Error: err.Error()})
			return
		}
		c.Data(http.StatusOK, "application/json; charset=utf-8", raw)
	}
}

// JSONFileArray returns a handler that reads a JSON array file (defaults to []).
func JSONFileArray(filename string) gin.HandlerFunc {
	return func(c *gin.Context) {
		data, err := os.ReadFile(filepath.Join(store.DataDir(), filename))
		if err != nil {
			c.Data(http.StatusOK, "application/json; charset=utf-8", []byte("[]"))
			return
		}
		c.Data(http.StatusOK, "application/json; charset=utf-8", data)
	}
}

// Stub returns a handler that responds with "not implemented".
func Stub(name string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusNotImplemented, models.APIResp{
			OK:    false,
			Error: name + " not implemented yet in Go layer",
		})
	}
}

// ── Specific GET handlers ──

// Healthz handles GET /healthz.
func Healthz(c *gin.Context) {
	dataDir := store.DataDir()
	dirInfo, dirErr := os.Stat(dataDir)
	tasksExist := false
	if _, err := os.Stat(filepath.Join(dataDir, "tasks_source.json")); err == nil {
		tasksExist = true
	}
	writable := false
	if tmpFile, err := os.CreateTemp(dataDir, ".healthz-*"); err == nil {
		tmpFile.Close()
		os.Remove(tmpFile.Name())
		writable = true
	}

	allOK := dirErr == nil && dirInfo.IsDir() && tasksExist && writable
	status := "ok"
	if !allOK {
		status = "degraded"
	}
	c.JSON(http.StatusOK, gin.H{
		"status": status,
		"ts":     store.NowISO(),
		"checks": gin.H{
			"dataDir":       dirErr == nil && dirInfo.IsDir(),
			"tasksReadable": tasksExist,
			"dataWritable":  writable,
		},
	})
}

// GetMorningConfig handles GET /api/morning-config.
func GetMorningConfig(c *gin.Context) {
	var cfg map[string]any
	if err := store.ReadJSONFile("morning_brief_config.json", &cfg); err != nil || cfg == nil {
		cfg = map[string]any{
			"categories": []map[string]any{
				{"name": "政治", "enabled": true},
				{"name": "军事", "enabled": true},
				{"name": "经济", "enabled": true},
				{"name": "AI大模型", "enabled": true},
			},
			"keywords":       []any{},
			"custom_feeds":   []any{},
			"feishu_webhook": "",
		}
	}
	c.JSON(http.StatusOK, cfg)
}

// GetMorningBriefByDate handles GET /api/morning-brief/:date.
func GetMorningBriefByDate(c *gin.Context) {
	date := c.Param("date")
	dateClean := strings.ReplaceAll(date, "-", "")
	if len(dateClean) != 8 {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "日期格式无效: " + date + "，请使用 YYYYMMDD"})
		return
	}
	for _, ch := range dateClean {
		if ch < '0' || ch > '9' {
			c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "日期格式无效: " + date})
			return
		}
	}
	raw, err := store.ReadJSONRaw("morning_brief_" + dateClean + ".json")
	if err != nil {
		c.JSON(http.StatusOK, json.RawMessage("{}"))
		return
	}
	c.Data(http.StatusOK, "application/json; charset=utf-8", raw)
}

// GetSchedulerState handles GET /api/scheduler-state/:taskId.
func GetSchedulerState(c *gin.Context) {
	taskID := c.Param("taskId")
	if taskID == "" {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "task_id required"})
		return
	}
	tasks, err := store.LoadTasks()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResp{OK: false, Error: err.Error()})
		return
	}
	task := store.FindTask(tasks, taskID)
	if task == nil {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": "任务 " + taskID + " 不存在"})
		return
	}
	sched := store.EnsureScheduler(task)
	c.JSON(http.StatusOK, gin.H{
		"ok":        true,
		"taskId":    taskID,
		"scheduler": sched,
	})
}

// ── Static file serving + SPA fallback ──

var mimeTypes = map[string]string{
	".html":  "text/html; charset=utf-8",
	".js":    "application/javascript; charset=utf-8",
	".css":   "text/css; charset=utf-8",
	".json":  "application/json",
	".png":   "image/png",
	".jpg":   "image/jpeg",
	".jpeg":  "image/jpeg",
	".gif":   "image/gif",
	".svg":   "image/svg+xml",
	".ico":   "image/x-icon",
	".woff":  "font/woff",
	".woff2": "font/woff2",
	".ttf":   "font/ttf",
	".map":   "application/json",
}

// ServeStaticOrSPA handles unmatched routes — serves static files or falls back to index.html.
func ServeStaticOrSPA(c *gin.Context) {
	p := c.Request.URL.Path
	if strings.HasPrefix(p, "/api/") {
		c.JSON(http.StatusNotFound, models.APIResp{OK: false, Error: "endpoint not found"})
		return
	}

	// 尝试提供静态文件
	safe := strings.TrimLeft(strings.ReplaceAll(p, "\\", "/"), "/")
	if strings.Contains(safe, "..") {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}
	fp := filepath.Join(distDir, safe)
	if info, err := os.Stat(fp); err == nil && !info.IsDir() {
		ext := strings.ToLower(filepath.Ext(fp))
		mime := mimeTypes[ext]
		if mime == "" {
			mime = "application/octet-stream"
		}
		c.File(fp)
		return
	}

	// SPA fallback: serve index.html
	idx := filepath.Join(distDir, "index.html")
	if _, err := os.Stat(idx); err == nil {
		c.File(idx)
		return
	}
	c.AbortWithStatus(http.StatusNotFound)
}
