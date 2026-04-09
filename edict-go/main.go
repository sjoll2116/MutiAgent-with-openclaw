package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"

	"edict-go/handlers"
	"edict-go/services"
	"edict-go/store"
)

func initOpenClawConfig() {
	token := os.Getenv("OPENCLAW_TOKEN")
	if token == "" {
		return
	}
	home, err := os.UserHomeDir()
	if err != nil {
		log.Printf("⚠️ Cannot get user home dir: %v", err)
		return
	}
	configDir := filepath.Join(home, ".openclaw")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		log.Printf("⚠️ Cannot create .openclaw dir: %v", err)
		return
	}
	configPath := filepath.Join(configDir, "openclaw.json")

	configBody := make(map[string]interface{})
	if err := json.Unmarshal([]byte(`{"gateway":{}}`), &configBody); err != nil {
		return
	}

	if data, err := os.ReadFile(configPath); err == nil {
		_ = json.Unmarshal(data, &configBody)
	}

	// 强制设置嵌套结构 gateway.auth.token
	var gateway map[string]interface{}
	if g, ok := configBody["gateway"].(map[string]interface{}); ok {
		gateway = g
	} else {
		gateway = make(map[string]interface{})
		configBody["gateway"] = gateway
	}

	var auth map[string]interface{}
	if a, ok := gateway["auth"].(map[string]interface{}); ok {
		auth = a
	} else {
		auth = make(map[string]interface{})
		gateway["auth"] = auth
	}

	auth["token"] = token

	// 彻底清理所有旧版可能存在的冲突 key (根目录)
	delete(configBody, "gatewayToken")
	delete(configBody, "token")
	// 清理旧版嵌套路径
	delete(gateway, "token")

	data, err := json.MarshalIndent(configBody, "", "  ")
	if err != nil {
		log.Printf("⚠️ Failed to marshal openclaw.json: %v", err)
		return
	}
	if err := os.WriteFile(configPath, data, 0644); err != nil {
		log.Printf("⚠️ Failed to write openclaw.json: %v", err)
	} else {
		log.Printf("✅ Injected OPENCLAW_TOKEN into %s (gateway.auth.token) & Cleaned legacy keys", configPath)
	}
}

func main() {
	initOpenClawConfig()

	port := flag.Int("port", 7891, "HTTP listen port")
	host := flag.String("host", "0.0.0.0", "HTTP listen address")
	dataDir := flag.String("data", "", "Path to data/ directory (default: ../data)")
	distDir := flag.String("dist", "", "Path to dist/ directory for static files (default: ../dashboard/dist)")
	flag.Parse()

	// 解析 data 目录
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
	store.InitDB()
	log.Printf("📂 Data directory: %s", abs)

	// 解析 dist 目录
	if *distDir == "" {
		exe, _ := os.Executable()
		*distDir = filepath.Join(filepath.Dir(exe), "..", "dashboard", "dist")
	}
	distAbs, _ := filepath.Abs(*distDir)
	handlers.SetDistDir(distAbs)
	log.Printf("📂 Dist directory: %s", distAbs)

	// 启动 Go Events 后台编排器
	services.StartOrchestrator()
	// 启动 Runtime 同步服务
	services.StartRuntimeSync(context.Background())

	// 打印环境变量以供调试
	log.Printf("🔧 [ENV] IS_DOCKER: %s", os.Getenv("IS_DOCKER"))
	log.Printf("🔧 [ENV] OPENCLAW_GATEWAY_URL: %s", os.Getenv("OPENCLAW_GATEWAY_URL"))
	log.Printf("🔧 [ENV] PYTHON_BACKEND_URL: %s", os.Getenv("PYTHON_BACKEND_URL"))
	log.Printf("🔧 [ENV] PORT: %s", os.Getenv("PORT"))

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(corsMiddleware())

	// ── GET 路由 ──
	r.GET("/healthz", handlers.Healthz)
	r.GET("/ws", services.WsLiveStatusHandler)
	r.GET("/ws/live-status", services.WsLiveStatusHandler) // 仪表盘别名
	r.GET("/ws/task/:taskId", services.WsLiveStatusHandler)
	
	// ── Auth 路由 ──
	r.POST("/api/auth/login", handlers.LoginHandler)

	// ── 公共查询路由 ──
	r.GET("/api/live-status", handlers.GetLiveStatus)
	r.GET("/api/agent-config", handlers.JSONFile("agent_config.json"))
	r.GET("/api/model-change-log", handlers.JSONFileArray("model_change_log.json"))
	r.GET("/api/last-result", handlers.JSONFile("last_model_change_result.json"))
	r.GET("/api/officials-stats", handlers.JSONFile("officials_stats.json"))
	r.GET("/api/morning-brief", handlers.JSONFile("morning_brief.json"))
	r.GET("/api/morning-brief/:date", handlers.GetMorningBriefByDate)

	// ── 受保护的 API 组 (需 Auth) ──
	authorized := r.Group("/api")
	authorized.Use(handlers.AuthMiddleware())
	{
		// 读取任务
		authorized.GET("/tasks", handlers.ListTasks)
		authorized.POST("/create-task", handlers.CreateTask)
		authorized.GET("/tasks/:taskId", handlers.GetTask)
		authorized.GET("/tasks-stats", handlers.GetTaskStats)
		authorized.GET("/task-activity/:taskId", handlers.GetTaskActivity)
		authorized.GET("/scheduler-state/:taskId", handlers.GetSchedulerState)

		// Task Write/Action
		authorized.POST("/task-todos", handlers.UpdateTaskTodos)
		authorized.POST("/task-scheduler", handlers.UpdateTaskScheduler)
		authorized.POST("/review-action", handlers.ReviewAction)
		authorized.POST("/task-action", handlers.TaskAction)
		authorized.POST("/archive-task", handlers.ArchiveTask)
		authorized.POST("/advance-state", handlers.AdvanceState)

		// Agent/System
		authorized.GET("/agents-status", handlers.GetAgentsStatus)
		authorized.GET("/agent-activity/:agentId", handlers.GetAgentActivity)
		authorized.POST("/agent-wake", handlers.AgentWake)
		authorized.POST("/set-model", handlers.SetModel)
		authorized.GET("/morning-config", handlers.GetMorningConfig)
		authorized.POST("/morning-config", handlers.SaveMorningConfig)
		authorized.POST("/morning-brief/refresh", handlers.RefreshMorningBrief)
		
		// 技能
		authorized.GET("/remote-skills-list", handlers.GetRemoteSkillsList)
		authorized.GET("/skill-content/:agentId/:skillName", handlers.GetSkillContent)
		authorized.POST("/add-skill", handlers.AddSkill)
		authorized.POST("/add-remote-skill", handlers.AddRemoteSkill)
		authorized.POST("/remote-skills-list", handlers.PostRemoteSkillsList)
		authorized.POST("/update-remote-skill", handlers.UpdateRemoteSkill)
		authorized.POST("/remove-remote-skill", handlers.RemoveRemoteSkill)
		
		// 调度器
		authorized.POST("/scheduler-scan", handlers.SchedulerScan)
		authorized.POST("/scheduler-retry", handlers.SchedulerRetry)
		authorized.POST("/scheduler-escalate", handlers.SchedulerEscalate)
		authorized.POST("/scheduler-rollback", handlers.SchedulerRollback)
		authorized.POST("/repair-flow-order", handlers.RepairFlowOrder)
		authorized.GET("/workspace-files", handlers.ListWorkspaceFiles)
	}

	// 代理到 Python 后端 (RAG)
	pythonBackendURL := os.Getenv("PYTHON_BACKEND_URL")
	if pythonBackendURL == "" {
		pythonBackendURL = "http://127.0.0.1:8000"
	}
	pythonTarget, err := url.Parse(pythonBackendURL)
	if err != nil {
		log.Fatalf("Invalid PYTHON_BACKEND_URL: %v", err)
	}
	proxy := httputil.NewSingleHostReverseProxy(pythonTarget)

	pythonProxy := func(c *gin.Context) {
		proxy.ServeHTTP(c.Writer, c.Request)
	}

	r.Any("/api/rag/*any", pythonProxy)

	// ── 静态文件 + SPA 回退 ──
	r.NoRoute(handlers.ServeStaticOrSPA)

	addr := fmt.Sprintf("%s:%d", *host, *port)
	log.Printf("OpenClaw MAS看板(Go) 启动 → http://%s", addr)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

// 跨域中间件
func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" {
			c.Header("Access-Control-Allow-Origin", origin)
		} else {
			c.Header("Access-Control-Allow-Origin", "*")
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
		c.Header("Access-Control-Allow-Credentials", "true")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}
