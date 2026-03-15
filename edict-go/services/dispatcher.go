package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
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
			time.Sleep(2 * time.Second)
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
		if p.Idle > 60*time.Second {
			msgs, err := store.RDB.XClaim(ctx, &redis.XClaimArgs{
				Stream:   TopicTaskDispatch,
				Group:    DispatchGroup,
				Consumer: DispatchConsumer,
				MinIdle:  60 * time.Second,
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
	message, _ := payload["message"].(string)
	state, _ := payload["state"].(string)
	traceID, _ := msg.Values["trace_id"].(string)

	if taskID == "" || agent == "" {
		log.Printf("⚠️ Dispatch message %s invalid: task_id=%s, agent=%s", msg.ID, taskID, agent)
		store.RDB.XAck(ctx, TopicTaskDispatch, DispatchGroup, msg.ID)
		return
	}

	log.Printf("🔄 Dispatching task %s → agent '%s' (state: %s)", taskID, agent, state)

	// 1. 发布心跳开始
	PublishEvent(TopicAgentHeartbeat, "dispatcher", "agent.dispatch.start", traceID, EventPayload{
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

		result = callOpenClaw(ctx, agent, message, taskID, traceID)

		if result.ReturnCode == 0 {
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
		checkAndPublishStateChange(taskID, state, agent)
	} else {
		log.Printf("❌ Dispatch EXHAUSTED for task %s (Agent: %s) after %d retries", taskID, agent, retryCount)
		// 最终失败，标记任务阻塞
		markTaskBlocked(taskID, agent, result)
	}

	// ACK
	store.RDB.XAck(ctx, TopicTaskDispatch, DispatchGroup, msg.ID)
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

func markTaskBlocked(taskID, agent string, res openclawResult) {
	tasks, _ := store.LoadTasks()
	task := store.FindTask(tasks, taskID)
	if task == nil {
		return
	}

	task.State = "Blocked"
	task.Block = fmt.Sprintf("Agent %s 最终执行失败: %s", agent, res.Stderr)
	task.UpdatedAt = store.NowISO()
	store.SaveTasks([]models.Task{*task})

	// 发布状态变更事件，以便 Dashboard 监控
	PublishEvent(TopicTaskStatus, taskID, "task.status", "dispatcher-retry", EventPayload{
		"task_id": taskID,
		"from":    "Executing",
		"to":      "Blocked",
		"reason":  task.Block,
	})
}

// checkAndPublishStateChange 检查 Agent 执行后任务状态是否发生变化。
// - 若已变化：发布 task.status 事件驱动后续流转。
// - 若未变化：使用 StateFlow 自动推进到下一状态，写入 JSON，再发布事件。
func checkAndPublishStateChange(taskID, dispatchedState, agent string) {
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
		PublishEvent(TopicTaskStatus, taskID, "task.status", "dispatcher-auto", EventPayload{
			"task_id":      taskID,
			"from":         dispatchedState,
			"to":           currentState,
			"assignee_org": task.Org,
		})
		return
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

	PublishEvent(TopicTaskStatus, taskID, "task.status", "dispatcher-auto", EventPayload{
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

func callOpenClaw(ctx context.Context, agent, message, taskID, traceID string) openclawResult {
	cmdArgs := []string{"agent", "--agent", agent, "-m", message}
	cmd := exec.CommandContext(ctx, "openclaw", cmdArgs...)

	// 设置环境变量
	env := os.Environ()
	env = append(env, fmt.Sprintf("EDICT_TASK_ID=%s", taskID))
	env = append(env, fmt.Sprintf("EDICT_TRACE_ID=%s", traceID))

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

	outBytes, err := cmd.CombinedOutput()
	var exitCode int
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			// 如果是指令找不到（例如 command not found），返回 -1
			log.Printf("❌ Execution error for agent '%s' on task %s: %v", agent, taskID, err)
			return openclawResult{
				ReturnCode: -1,
				Stderr:     err.Error(),
				Stdout:     string(outBytes),
			}
		}
	}

	// 截取日志长度
	stdOutStr := string(outBytes)

	if len(stdOutStr) > 5000 {
		stdOutStr = stdOutStr[len(stdOutStr)-5000:]
	}

	stderr := ""
	if exitCode != 0 {
		stderr = stdOutStr
	}

	return openclawResult{
		ReturnCode: exitCode,
		Stdout:     stdOutStr,
		Stderr:     stderr,
	}
}
