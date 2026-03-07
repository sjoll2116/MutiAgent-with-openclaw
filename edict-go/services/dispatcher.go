package services

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"time"

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

	taskID := msg.Values["task_id"].(string)
	agent := msg.Values["agent"].(string)
	message := ""
	if m, ok := msg.Values["message"].(string); ok {
		message = m
	}
	traceID := ""
	if t, ok := msg.Values["trace_id"].(string); ok {
		traceID = t
	}
	state := ""
	if s, ok := msg.Values["state"].(string); ok {
		state = s
	}

	log.Printf("🔄 Dispatching task %s → agent '%s' state=%s", taskID, agent, state)

	// 发布心跳开始
	PublishEvent(TopicAgentHeartbeat, "dispatcher", "agent.dispatch.start", traceID, EventPayload{
		"task_id": taskID,
		"agent":   agent,
	})

	result := callOpenClaw(ctx, agent, message, taskID, traceID)

	// 发布 Agent 思考输出
	PublishEvent(TopicAgentThoughts, "agent."+agent, "agent.output", traceID, EventPayload{
		"task_id":     taskID,
		"agent":       agent,
		"output":      result.Stdout,
		"return_code": result.ReturnCode,
	})

	if result.ReturnCode == 0 {
		log.Printf("✅ Agent '%s' completed task %s", agent, taskID)
	} else {
		log.Printf("⚠️ Agent '%s' returned non-zero for task %s: rc=%d", agent, taskID, result.ReturnCode)
		if result.Stderr != "" {
			log.Printf("Stderr: %s", result.Stderr)
		}
	}

	// ACK
	store.RDB.XAck(ctx, TopicTaskDispatch, DispatchGroup, msg.ID)
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
			exitCode = -1
		}
	}

	// 截取日志长度
	stdOutStr := string(outBytes)

	if len(stdOutStr) > 5000 {
		stdOutStr = stdOutStr[len(stdOutStr)-5000:]
	}

	return openclawResult{
		ReturnCode: exitCode,
		Stdout:     stdOutStr,
		Stderr:     "",
	}
}
