package services

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"edict-go/models"
	"edict-go/store"

	"github.com/redis/go-redis/v9"
)

const (
	DispatchGroup    = "dispatcher"
	DispatchConsumer = "disp-1"
)

// StartDispatchWorker 负责在一个单独的 goroutine 中轮询 task.dispatch 事件，
// 解析 payload，调用 openclaw CLI 执行 agent，并发布相关心跳和结果。
func StartDispatchWorker(ctx context.Context) {
	err := store.RDB.XGroupCreateMkStream(ctx, TopicTaskDispatch, DispatchGroup, "0").Err()
	if err != nil && err.Error() != "BUSYGROUP Consumer Group name already exists" {
		log.Printf("⚠️ StartDispatchWorker Create Group Error: %v", err)
	}

	go dispatchLoop(ctx)
}

func dispatchLoop(ctx context.Context) {
	log.Println("🚀 Go Dispatch worker started")
	sem := make(chan struct{}, 3) // 限制并发数为 3

	// 处理之前崩溃遗留的消息
	recoverPendingDispatches(ctx, sem)

	for {
		select {
		case <-ctx.Done():
			log.Println("Dispatch worker stopped")
			return
		default:
		}

		res, err := store.RDB.XReadGroup(ctx, &redis.XReadGroupArgs{
			Group:    DispatchGroup,
			Consumer: DispatchConsumer,
			Streams:  []string{TopicTaskDispatch, ">"},
			Count:    3,
			Block:    2 * time.Second,
		}).Result()

		if err != nil && err != redis.Nil {
			log.Printf("❌ Dispatch poll error: %v", err)
			time.Sleep(5 * time.Second) // 错误后稍长等待
			continue
		}

		for _, stream := range res {
			for _, msg := range stream.Messages {
				sem <- struct{}{}
				go handleDispatch(ctx, msg, sem)
			}
		}
	}
}

func recoverPendingDispatches(ctx context.Context, sem chan struct{}) {
	pending, err := store.RDB.XPendingExt(ctx, &redis.XPendingExtArgs{
		Stream: TopicTaskDispatch,
		Group:  DispatchGroup,
		Start:  "-",
		End:    "+",
		Count:  20,
	}).Result()

	if err != nil || len(pending) == 0 {
		return
	}

	log.Printf("Recovering %d stale dispatch events", len(pending))
	for _, p := range pending {
		// 只要消息闲置超过 15 秒（排队间隙），就尝试重拾
		if p.Idle > 15*time.Second {
			msgs, err := store.RDB.XClaim(ctx, &redis.XClaimArgs{
				Stream:   TopicTaskDispatch,
				Group:    DispatchGroup,
				Consumer: DispatchConsumer,
				MinIdle:  15 * time.Second,
				Messages: []string{p.ID},
			}).Result()
			if err == nil {
				for _, msg := range msgs {
					sem <- struct{}{}
					go handleDispatch(ctx, msg, sem)
				}
			}
		}
	}
}

func handleDispatch(ctx context.Context, msg redis.XMessage, sem chan struct{}) {
	defer func() { <-sem }()

	payloadStr, ok := msg.Values["payload"].(string)
	if !ok {
		log.Printf("⚠️ Dispatch message %s missing payload", msg.ID)
		store.RDB.XAck(ctx, TopicTaskDispatch, DispatchGroup, msg.ID)
		return
	}

	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(payloadStr), &payload); err != nil {
		log.Printf("❌ Dispatch payload unmarshal error: %v", err)
		store.RDB.XAck(ctx, TopicTaskDispatch, DispatchGroup, msg.ID)
		return
	}

	taskID, _ := payload["task_id"].(string)
	agent, _ := payload["agent"].(string)
	todoID, _ := payload["todo_id"].(string)
	message, _ := payload["message"].(string)
	state, _ := payload["state"].(string)
	traceID, _ := msg.Values["trace_id"].(string)

	if taskID == "" || agent == "" {
		log.Printf("⚠️ Dispatch message %s invalid: task_id=%s, agent=%s", msg.ID, taskID, agent)
		store.RDB.XAck(ctx, TopicTaskDispatch, DispatchGroup, msg.ID)
		return
	}

	// --- [NEW] Agent 级别忙碌锁定检查 ---
	isOccupied, conflictingTaskID := isAgentOccupied(agent, taskID)
	if isOccupied {
		log.Printf("⏳ [Queue] Agent '%s' is busy with task %s. Deferring task %s...", agent, conflictingTaskID, taskID)
		// 注意：不要调用 XAck。
		// 这条消息会留在 PEL (Pending Entries List) 中。
		// 调度器的 recoverPendingDispatches 会在 30s 后自动重新捞起它。
		return
	}

	// 1. 获取任务上下文（重试轮次、最大重试、上一次错误）
	tasks, _ := store.LoadTasks()
	task := store.FindTask(tasks, taskID)
	
	lastError := ""
	retryRound := 0
	if task != nil {
		lastError = task.LastError
		retryRound = task.RetryRound
	}

	timeoutSec := 1800 // 默认 30 分钟
	if task != nil && task.Scheduler != nil {
		if val, ok := task.Scheduler["stallThresholdSec"].(float64); ok && val > 0 {
			timeoutSec = int(val)
		} else if val, ok := task.Scheduler["stallThresholdSec"].(int); ok && val > 0 {
			timeoutSec = val
		}
	}

	// 发布心跳开始
	PublishEvent(TopicAgentHeartbeat, traceID, "agent.dispatch.start", "dispatcher", EventPayload{
		"task_id": taskID,
		"agent":   agent,
	})

	maxRetry := 3 // 默认最大重试次数
	retryCount := 0

	var result openclawResult
	for retryCount <= maxRetry {
		if retryCount > 0 {
			log.Printf("🔄 Retrying task %s (Agent: %s), attempt %d/%d...", taskID, agent, retryCount, maxRetry)
			time.Sleep(time.Duration(retryCount*5) * time.Second) // 指数退避
		}

		// 创建带超时的上下文
		runCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSec)*time.Second)
		result = callOpenClaw(runCtx, agent, message, taskID, traceID, todoID, lastError, retryRound)
		cancel()

		if result.ReturnCode == 0 {
			break
		}

		// 如果是超时导致的（或者 context 被取消），通常不建议盲目重试
		if runCtx.Err() == context.DeadlineExceeded {
			log.Printf("⏳ Task %s TIMEOUT after %d seconds", taskID, timeoutSec)
			result.Stderr = fmt.Sprintf("Execution timeout after %ds", timeoutSec)
			break 
		}

		retryCount++
		// 更新 DB 中的进度/错误信息
		updateTaskRetryInfo(taskID, agent, result, retryCount)
	}

	// 2. 发布 Agent 思考输出
	PublishEvent(TopicAgentThoughts, "agent."+agent, "agent.output", traceID, EventPayload{
		"task_id":     taskID,
		"agent":       agent,
		"output":      result.Stdout,
		"return_code": result.ReturnCode,
		"retry_count": retryCount,
	})

	if result.ReturnCode == 0 {
		log.Printf("✅ Agent '%s' completed task %s", agent, taskID)
		// 若有 todoID，先标记对应 Todo 为 completed
		if todoID != "" {
			markTodoCompleted(taskID, todoID)
		}
		checkAndPublishStateChange(taskID, state, agent, traceID)
	} else {
		// Todo 级重试/跳过逻辑
		if todoID != "" {
			handleTodoFailure(taskID, todoID, agent, result, traceID, message)
		} else {
			log.Printf("❌ Dispatch EXHAUSTED for task %s (Agent: %s) after %d retries", taskID, agent, retryCount)
			// 最终失败，标记任务阻塞
			markTaskBlocked(taskID, agent, result, traceID)
		}
	}

	// 确认
	store.RDB.XAck(ctx, TopicTaskDispatch, DispatchGroup, msg.ID)
}

// isAgentOccupied 检查当前是否有该 Agent 正在处理的其它任务。
func isAgentOccupied(agentName, currentTaskID string) (bool, string) {
	var results []struct {
		ID string
	}
	// 查询数据库中所有正在执行的任务，看是否有同一个 agent/org
	// 排除掉当前正在下发的这个任务 ID (防止由于状态同步导致的自我死锁)
	err := store.DB.Raw(`
		SELECT id FROM tasks 
		WHERE (org = ? OR official = ?) 
		AND state = 'Executing' 
		AND id != ?
		LIMIT 1
	`, agentName, agentName, currentTaskID).Scan(&results).Error

	if err != nil {
		log.Printf("❌ isAgentOccupied Check Error: %v", err)
		return false, ""
	}

	if len(results) > 0 {
		return true, results[0].ID
	}
	return false, ""
}

func updateTaskRetryInfo(taskID, agent string, res openclawResult, attempt int) {
	tasks, _ := store.LoadTasks()
	task := store.FindTask(tasks, taskID)
	if task == nil {
		return
	}

	task.Now = fmt.Sprintf("⚠️ 执行失败 (重试 %d/3): %s", attempt, res.Stderr)
	task.UpdatedAt = store.NowISO()
	store.SaveTasks([]models.Task{*task})
}

func markTaskBlocked(taskID, agent string, res openclawResult, traceID string) {
	err := store.WithTasks(func(allTasks []models.Task) ([]models.Task, error) {
		t := store.FindTask(allTasks, taskID)
		if t == nil {
			return allTasks, nil
		}
		
		// 故障自愈逻辑：不直接阻断，而是退回编排阶段进行诊断
		t.State = "Planning"
		t.Org = "任务编排引擎"
		t.LastError = res.Stderr
		t.Now = fmt.Sprintf("⚠️ 专家 [%s] 执行失败，已退回编排引擎进行故障诊断", agent)
		
		t.FlowLog = append(t.FlowLog, models.FlowEntry{
			At:     store.NowISO(),
			From:   "任务调度引擎",
			To:     "任务编排引擎",
			Remark: fmt.Sprintf("🚨 专家执行受挫: %s。系统已进入自愈循环，将尝试重新编排方案。", res.Stderr),
		})
		t.UpdatedAt = store.NowISO()
		return allTasks, nil
	})

	if err != nil {
		log.Printf("❌ Failed to update task for loopback: %v", err)
		return
	}
 
	// 发布状态变更事件，激活 Planner
	PublishEvent(TopicTaskStatus, traceID, "task.status", "dispatcher-diagnosis", EventPayload{
		"task_id":      taskID,
		"from":         "Executing",
		"to":           "Planning",
		"assignee_org": "任务编排引擎",
		"error":        res.Stderr,
	})
}

// checkAndPublishStateChange 检查 Agent 执行后任务状态是否发生变化。
// - 若已变化：发布 task.status 事件驱动后续流转。
// - 若未变化：使用 StateFlow 自动推进到下一状态，写入 JSON，再发布事件。
func checkAndPublishStateChange(taskID, dispatchedState, agent, traceID string) {
	tasks, err := store.LoadTasks()
	if err != nil {
		log.Printf("⚠️ checkAndPublishStateChange: failed to load tasks: %v", err)
		return
	}
	task := store.FindTask(tasks, taskID)
	if task == nil {
		log.Printf("⚠️ checkAndPublishStateChange: task %s not found", taskID)
		return
	}
 
	currentState := task.State
 
	// 终态不再流转
	if models.TerminalStates[currentState] {
		log.Printf("ℹ️ Task %s reached terminal state %s, no further dispatch", taskID, currentState)
		return
	}
 
	// 情况 1：Agent 已经推进了状态 → 直接发布事件
	if currentState != dispatchedState && currentState != "" {
		log.Printf("🔁 Task %s state changed: %s → %s (by agent '%s'), publishing event to continue flow",
			taskID, dispatchedState, currentState, agent)
		PublishEvent(TopicTaskStatus, traceID, "task.status", "dispatcher-auto", EventPayload{
			"task_id":      taskID,
			"from":         dispatchedState,
			"to":           currentState,
			"assignee_org": task.Org,
		})
		return
	}
 
	// Stage 编排感知：若任务有多阶段计划，由 Stage Controller 接管
	if task.Scheduler != nil {
		if _, hasStages := task.Scheduler["totalStages"]; hasStages {
			log.Printf("📋 Task %s has staged execution plan, delegating to Stage Controller", taskID)
			checkStageCompletion(taskID, traceID)
			return
		}
	}

	// 情况 2：Agent 完成但未推进状态 → 使用 StateFlow 自动推进
	flow, ok := models.StateFlow[currentState]
	if !ok {
		log.Printf("⚠️ Task %s state %s has no defined next step in StateFlow, cannot auto-advance", taskID, currentState)
		return
	}
 
	log.Printf("🔁 Auto-advancing task %s: %s → %s (agent '%s' completed but didn't advance state)",
		taskID, currentState, flow.Next, agent)
 
	// 写入新状态到 tasks_source.json
	err = store.WithTasks(func(allTasks []models.Task) ([]models.Task, error) {
		t := store.FindTask(allTasks, taskID)
		if t == nil {
			return allTasks, nil
		}
		t.State = flow.Next
		t.Org = flow.ToDept
		t.Now = "⬇️ 自动推进：" + flow.Remark
		t.FlowLog = append(t.FlowLog, models.FlowEntry{
			At:     store.NowISO(),
			From:   flow.FromDept,
			To:     flow.ToDept,
			Remark: "⬇️ 自动推进：" + flow.Remark,
		})
		t.UpdatedAt = store.NowISO()
		return allTasks, nil
	})
	if err != nil {
		log.Printf("❌ Auto-advance failed for task %s: %v", taskID, err)
		return
	}
 
	// 终态不发布事件
	if models.TerminalStates[flow.Next] {
		log.Printf("ℹ️ Task %s auto-advanced to terminal state %s", taskID, flow.Next)
		return
	}
 
	PublishEvent(TopicTaskStatus, traceID, "task.status", "dispatcher-auto", EventPayload{
		"task_id":      taskID,
		"from":         currentState,
		"to":           flow.Next,
		"assignee_org": flow.ToDept,
	})
}

type openclawResult struct {
	ReturnCode int
	Stdout     string
	Stderr     string
}
 
func callOpenClaw(ctx context.Context, agent, message, taskID, traceID, todoID, lastError string, retryRound int) openclawResult {
	cmdArgs := []string{"agent", "--agent", agent, "-m", message}
	cmd := exec.CommandContext(ctx, "openclaw", cmdArgs...)

	// 设置环境变量
	env := os.Environ()
	env = append(env, fmt.Sprintf("EDICT_TASK_ID=%s", taskID))
	env = append(env, fmt.Sprintf("EDICT_TRACE_ID=%s", traceID))
	if todoID != "" {
		env = append(env, fmt.Sprintf("EDICT_TODO_ID=%s", todoID))
	}
	if lastError != "" {
		env = append(env, fmt.Sprintf("EDICT_LAST_ERROR=%s", lastError))
	}
	env = append(env, fmt.Sprintf("EDICT_RETRY_ROUND=%d", retryRound))

	port := os.Getenv("PORT")
	if port == "" {
		port = "7891"
	}
	env = append(env, fmt.Sprintf("EDICT_API_URL=http://localhost:%s", port))
	token := os.Getenv("OPENCLAW_TOKEN")
	if token != "" {
		env = append(env, fmt.Sprintf("OPENCLAW_GATEWAY_TOKEN=%s", token))
	}
	cmd.Env = env

	openclawDir := os.Getenv("OPENCLAW_PROJECT_DIR")
	if openclawDir != "" {
		cmd.Dir = openclawDir
	}

	// 1. 创建管道
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return openclawResult{ReturnCode: -1, Stderr: err.Error()}
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return openclawResult{ReturnCode: -1, Stderr: err.Error()}
	}

	// 2. 用于累加最终完整输出的 Buffer
	var combinedOutput bytes.Buffer
	var mu sync.Mutex // 保护 combinedOutput

	// 3. 日志批处理队列 (防止 Redis 被高频日志击穿)
	logQueue := make([]string, 0)
	var queueMu sync.Mutex

	// 启动定时器，每 300ms 批量推送一次日志
	ticker := time.NewTicker(300 * time.Millisecond)
	tickerDone := make(chan bool)
	go func() {
		for {
			select {
			case <-ticker.C:
				queueMu.Lock()
				if len(logQueue) > 0 {
					batch := strings.Join(logQueue, "\n")
					// 批量推送到 Redis
					PublishEvent(TopicAgentThoughts, traceID, "agent.stdout", agent, EventPayload{
						"task_id": taskID,
						"chunk":   batch,
					})
					logQueue = logQueue[:0] // 清空队列
				}
				queueMu.Unlock()
			case <-tickerDone:
				return
			}
		}
	}()

	// 4. 定义通用的流式读取函数
	streamReader := func(r io.Reader) {
		reader := bufio.NewReader(r)
		for {
			// 使用 ReadString 替代 Scanner，避免 64KB 行长限制
			line, err := reader.ReadString('\n')
			
			if len(line) > 0 {
				mu.Lock()
				combinedOutput.WriteString(line)
				mu.Unlock()

				queueMu.Lock()
				logQueue = append(logQueue, strings.TrimRight(line, "\r\n"))
				queueMu.Unlock()
			}

			if err != nil {
				break // EOF 或其他错误
			}
		}
	}

	// 5. 启动命令
	if err := cmd.Start(); err != nil {
		ticker.Stop()
		close(tickerDone)
		return openclawResult{ReturnCode: -1, Stderr: err.Error()}
	}

	// 6. 并发读取 stdout 和 stderr
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); streamReader(stdout) }()
	go func() { defer wg.Done(); streamReader(stderr) }()

	// 等待读取流结束
	wg.Wait()
	
	// 等待命令结束
	err = cmd.Wait()
	ticker.Stop() 
	close(tickerDone) // 停止定时器推送协程

	// 推送最后一批残留日志
	queueMu.Lock()
	if len(logQueue) > 0 {
		PublishEvent(TopicAgentThoughts, traceID, "agent.stdout", agent, EventPayload{
			"task_id": taskID,
			"chunk":   strings.Join(logQueue, "\n"),
		})
	}
	queueMu.Unlock()

	// 7. 处理最终的返回结果 (兼容原有逻辑)
	var exitCode int
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = -1
		}
	}

	stdOutStr := combinedOutput.String()
	// 保留原有截断逻辑，防止超大日志存入数据库
	if len(stdOutStr) > 5000 {
		stdOutStr = stdOutStr[len(stdOutStr)-5000:]
	}

	finalStderr := ""
	if exitCode != 0 {
		finalStderr = stdOutStr
	}

	return openclawResult{
		ReturnCode: exitCode,
		Stdout:     stdOutStr,
		Stderr:     finalStderr,
	}
}

// ── Stage Controller: 阶段编排核心逻辑 ──

// getIntFromScheduler 从 _scheduler map 安全读取 int 值（JSON 反序列化后为 float64）。
func getIntFromScheduler(sched map[string]any, key string, fallback int) int {
	if v, ok := sched[key].(float64); ok {
		return int(v)
	}
	if v, ok := sched[key].(int); ok {
		return v
	}
	return fallback
}

// markTodoCompleted 将指定 Todo 状态标记为 completed。
func markTodoCompleted(taskID, todoID string) {
	store.WithTasks(func(tasks []models.Task) ([]models.Task, error) {
		t := store.FindTask(tasks, taskID)
		if t == nil {
			return tasks, nil
		}
		for i := range t.Todos {
			if t.Todos[i].ID == todoID {
				t.Todos[i].Status = "completed"
				log.Printf("✅ Todo %s of task %s marked completed", todoID, taskID)
				break
			}
		}
		t.UpdatedAt = store.NowISO()
		return tasks, nil
	})
}

// handleTodoFailure 处理单个 Todo 的执行失败：重试或跳过。
func handleTodoFailure(taskID, todoID, agent string, result openclawResult, traceID, message string) {
	var shouldRetry bool

	store.WithTasks(func(tasks []models.Task) ([]models.Task, error) {
		t := store.FindTask(tasks, taskID)
		if t == nil {
			return tasks, nil
		}

		for i := range t.Todos {
			if t.Todos[i].ID != todoID {
				continue
			}

			t.Todos[i].RetryCount++
			maxRetry := t.Todos[i].MaxRetry
			if maxRetry == 0 {
				maxRetry = 2 // 默认重试 2 次
			}

			if t.Todos[i].RetryCount <= maxRetry {
				// ── 重试 ──
				t.Todos[i].Status = "not-started"
				t.Now = fmt.Sprintf("🔄 Todo-%s 执行失败，自动重试 (%d/%d)",
					todoID, t.Todos[i].RetryCount, maxRetry)
				shouldRetry = true
				log.Printf("🔄 Todo %s retry %d/%d for task %s",
					todoID, t.Todos[i].RetryCount, maxRetry, taskID)
			} else {
				// ── 超限跳过 ──
				t.Todos[i].Status = "skipped"
				t.Todos[i].FailReason = result.Stderr
				t.Now = fmt.Sprintf("⏭️ Todo-%s 重试耗尽，已跳过 (Agent: %s)", todoID, agent)
				log.Printf("⏭️ Todo %s skipped for task %s (exhausted %d retries)",
					todoID, taskID, maxRetry)
			}
			break
		}
		t.UpdatedAt = store.NowISO()
		return tasks, nil
	})

	if shouldRetry {
		// 重新发布 dispatch 事件
		PublishEvent(TopicTaskDispatch, traceID, "task.dispatch.retry",
			"stage-controller", EventPayload{
				"task_id": taskID,
				"agent":   agent,
				"todo_id": todoID,
				"state":   "Executing",
				"message": "🔄 重试: " + message,
			})
	} else {
		// 已跳过 → 触发 Stage 完成度检查（可能推进下一 Stage）
		checkStageCompletion(taskID, traceID)
	}
}

// checkStageCompletion 检查当前 Stage 的所有 Todo 是否完成/跳过。
// 若当前 Stage 结算完毕：推进到下一 Stage 或进入 ResultReview。
// checkStageCompletion 升级为基于 DAG 的就绪检查与智能调度。
// 它会扫描所有未开始的任务，检查其依赖是否满足，并进行智能 Agent 分配与派发。
func checkStageCompletion(taskID, traceID string) {
	task, err := store.GetTaskByID(taskID)
	if err != nil || task == nil {
		return
	}

	// 1. 统计总体状态
	allDone := true
	anyReady := false
	completedIDs := make(map[string]bool)
	for _, td := range task.Todos {
		if td.Status == "completed" || td.Status == "skipped" {
			completedIDs[td.ID] = true
		} else {
			allDone = false
		}
	}

	// 2. 如果全部完成，推进到 ResultReview
	if allDone && len(task.Todos) > 0 {
		log.Printf("🏁 All tasks in DAG completed for task %s, entering ResultReview", taskID)
		store.WithTasks(func(allTasks []models.Task) ([]models.Task, error) {
			t := store.FindTask(allTasks, taskID)
			if t == nil { return allTasks, nil }
			t.State = "ResultReview"
			t.Org = "任务调度引擎"
			t.Now = "✅ 全部子任务已按依赖序列执行完毕，正在汇总成果"
			t.FlowLog = append(t.FlowLog, models.FlowEntry{
				At: store.NowISO(), From: "执行智能体集群", To: "任务调度引擎",
				Remark: "🏁 DAG 依赖链执行完毕，进入汇总验收阶段",
			})
			t.UpdatedAt = store.NowISO()
			return allTasks, nil
		})
		PublishEvent(TopicTaskStatus, traceID, "task.status", "dag-controller", EventPayload{
			"task_id": taskID, "from": "Executing", "to": "ResultReview", "assignee_org": "任务调度引擎",
		})
		return
	}

	// 3. 寻找并派发就绪任务
	matcher := NewAgentMatcher()
	var toDispatch []models.TodoItem

	err = store.WithTasks(func(allTasks []models.Task) ([]models.Task, error) {
		t := store.FindTask(allTasks, taskID)
		if t == nil { return allTasks, nil }

		modified := false
		for i, todo := range t.Todos {
			if todo.Status != "not-started" {
				continue
			}

			// 检查依赖
			ready := true
			for _, depID := range todo.DependsOn {
				if !completedIDs[depID] {
					ready = false
					break
				}
			}

			if ready {
				// 智能选型：由 Dispatcher 最终决定执行智能体
				if t.Todos[i].Agent == "" {
					assigned := matcher.Match(todo.RequestedRole, todo.Title)
					if assigned == "" {
						// 兜底：如果完全匹配不到，暂时发给通用开发
						assigned = "agency_engineering_senior_developer"
					}
					t.Todos[i].Agent = assigned
					log.Printf("🤖 Dispatcher assigned agent '%s' to todo %s", assigned, todo.ID)
				}
				
				t.Todos[i].Status = "in-progress" // 标记为进行中防止重复派发
				toDispatch = append(toDispatch, t.Todos[i])
				anyReady = true
				modified = true
			}
		}
		
		if modified {
			t.UpdatedAt = store.NowISO()
		}
		return allTasks, nil
	})

	// 4. 发送派单事件
	for _, todo := range toDispatch {
		PublishEvent(TopicTaskDispatch, traceID, "task.dispatch.request", "dag-controller", EventPayload{
			"task_id": taskID,
			"agent":   todo.Agent,
			"todo_id": todo.ID,
			"state":   "Executing",
			"message": fmt.Sprintf("项目指令: %s\n\n详情: %s", todo.Title, todo.Detail),
		})
	}

	if anyReady {
		log.Printf("🚀 DAG: %d ready todos dispatched for task %s", len(toDispatch), taskID)
	}
}
