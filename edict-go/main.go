package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"

	"edict-go/handlers"
	"edict-go/services"
	"edict-go/store"
)

func main() {
	port := flag.Int("port", 7891, "HTTP listen port")
	host := flag.String("host", "127.0.0.1", "HTTP listen address")
	dataDir := flag.String("data", "", "Path to data/ directory (default: ../data)")
	distDir := flag.String("dist", "", "Path to dist/ directory for static files (default: ../dashboard/dist)")
	flag.Parse()

	// Resolve data directory
	if *dataDir == "" {
		exe, _ := os.Executable()
		*dataDir = filepath.Join(filepath.Dir(exe), "..", "data")
	}
	abs, err := filepath.Abs(*dataDir)
	if err != nil {
		log.Fatalf("invalid data dir: %v", err)
	}
	store.Init(abs)
	store.InitRedis()
	log.Printf("📂 Data directory: %s", abs)

	// Resolve dist directory
	if *distDir == "" {
		exe, _ := os.Executable()
		*distDir = filepath.Join(filepath.Dir(exe), "..", "dashboard", "dist")
	}
	distAbs, _ := filepath.Abs(*distDir)
	handlers.SetDistDir(distAbs)
	log.Printf("📂 Dist directory: %s", distAbs)

	// Start Go Events background orchestrator
	services.StartOrchestrator()

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(corsMiddleware())

	// ── GET routes ──
	r.GET("/healthz", handlers.Healthz)
	r.GET("/ws/live-status", services.WsLiveStatusHandler)
	r.GET("/api/live-status", handlers.JSONFile("live_status.json"))
	r.GET("/api/agent-config", handlers.JSONFile("agent_config.json"))
	r.GET("/api/model-change-log", handlers.JSONFileArray("model_change_log.json"))
	r.GET("/api/last-result", handlers.JSONFile("last_model_change_result.json"))
	r.GET("/api/officials-stats", handlers.JSONFile("officials_stats.json"))
	r.GET("/api/morning-brief", handlers.JSONFile("morning_brief.json"))
	r.GET("/api/morning-config", handlers.GetMorningConfig)
	r.GET("/api/morning-brief/:date", handlers.GetMorningBriefByDate)
	r.GET("/api/remote-skills-list", handlers.GetRemoteSkillsList)
	r.GET("/api/skill-content/:agentId/:skillName", handlers.GetSkillContent)
	r.GET("/api/task-activity/:taskId", handlers.GetTaskActivity)
	r.GET("/api/scheduler-state/:taskId", handlers.GetSchedulerState)
	r.GET("/api/agents-status", handlers.GetAgentsStatus)
	r.GET("/api/agent-activity/:agentId", handlers.GetAgentActivity)

	// ── POST routes ──
	r.POST("/api/create-task", handlers.CreateTask)
	r.POST("/api/review-action", handlers.ReviewAction)
	r.POST("/api/task-action", handlers.TaskAction)
	r.POST("/api/archive-task", handlers.ArchiveTask)
	r.POST("/api/task-todos", handlers.UpdateTaskTodos)
	r.POST("/api/advance-state", handlers.AdvanceState)
	r.POST("/api/agent-wake", handlers.AgentWake)
	r.POST("/api/set-model", handlers.SetModel)
	r.POST("/api/morning-config", handlers.SaveMorningConfig)
	r.POST("/api/morning-brief/refresh", handlers.RefreshMorningBrief)
	r.POST("/api/add-skill", handlers.AddSkill)
	r.POST("/api/add-remote-skill", handlers.AddRemoteSkill)
	r.POST("/api/remote-skills-list", handlers.PostRemoteSkillsList)
	r.POST("/api/update-remote-skill", handlers.UpdateRemoteSkill)
	r.POST("/api/remove-remote-skill", handlers.RemoveRemoteSkill)
	r.POST("/api/scheduler-scan", handlers.SchedulerScan)
	r.POST("/api/scheduler-retry", handlers.SchedulerRetry)
	r.POST("/api/scheduler-escalate", handlers.SchedulerEscalate)
	r.POST("/api/scheduler-rollback", handlers.SchedulerRollback)
	r.POST("/api/repair-flow-order", handlers.RepairFlowOrder)

	// ── Static files + SPA fallback ──
	r.NoRoute(handlers.ServeStaticOrSPA)

	addr := fmt.Sprintf("%s:%d", *host, *port)
	log.Printf("三省六部看板(Go) 启动 → http://%s", addr)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

// corsMiddleware mirrors the Python CORS headers.
func corsMiddleware() gin.HandlerFunc {
	allowed := map[string]bool{
		"http://127.0.0.1:7891": true,
		"http://localhost:7891": true,
		"http://127.0.0.1:5173": true,
		"http://localhost:5173": true,
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if !allowed[origin] {
			origin = "http://127.0.0.1:7891"
		}
		c.Header("Access-Control-Allow-Origin", origin)
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(200)
			return
		}
		c.Next()
	}
}
