package services

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"time"

	"edict-go/models"
	"edict-go/store"

	"github.com/redis/go-redis/v9"
)

const (
	TopicTaskCreated    = "openclaw:agent:events:task.created"
	TopicTaskStatus     = "openclaw:agent:events:task.status"
	TopicTaskDispatch   = "openclaw:agent:events:task.dispatch"
	TopicTaskCompleted  = "openclaw:agent:events:task.completed"
	TopicTaskStalled    = "openclaw:agent:events:task.stalled"
	TopicAgentHeartbeat = "openclaw:agent:events:agent.heartbeat"
	TopicAgentThoughts  = "openclaw:agent:events:agent.thoughts"

	OrchestratorGroup    = "orchestrator"
	OrchestratorConsumer = "orch-go-1"
)

var WatchedTopics = []string{
	TopicTaskCreated,
	TopicTaskStatus,
	TopicTaskCompleted,
	TopicTaskStalled,
	// 在此处添加其他需要 websocket 广播的主题
}

// EventPayload 表示嵌入流中的公共结构
type EventPayload map[string]interface{}

// PublishEvent 将新事件推送到 Redis Stream
func PublishEvent(topic, traceID, eventType, producer string, payload EventPayload) error {
	if store.RDB == nil {
		return errors.New("redis not configured")
	}

	payloadJSON, _ := json.Marshal(payload)

	args := &redis.XAddArgs{
		Stream: topic,
		Values: map[string]interface{}{
			"trace_id":   traceID,
			"event_type": eventType,
			"producer":   producer,
			"timestamp":  time.Now().UnixMilli(),
			"payload":    string(payloadJSON),
		},
	}

	return store.RDB.XAdd(store.Ctx, args).Err()
}

// EnsureConsumerGroups 确保 Stream 存在并创建消费者组。
func EnsureConsumerGroups() {
	if store.RDB == nil {
		return
	}
	for _, topic := range WatchedTopics {
		err := store.RDB.XGroupCreateMkStream(store.Ctx, topic, OrchestratorGroup, "$").Err()
		if err != nil && err.Error() != "BUSYGROUP Consumer Group name already exists" {
			log.Printf("⚠️ Failed to create group for %s: %v", topic, err)
		}
	}
}

// StartOrchestrator 开始轮询逻辑
func StartOrchestrator() {
	if store.RDB == nil {
		log.Println("⚠️ Redis not connected, skipping Orchestrator Start")
		return
	}

	EnsureConsumerGroups()

	go runRecoverPending()
	go runPollCycle()
	go StartDispatchWorker(store.Ctx)
	go StartStallDetector(store.Ctx)

	log.Println("🏛️ Go Orchestrator worker started")
}

func runRecoverPending() {
	// 回收逻辑... 这里做了简化：我们只需使用 ID "0" 的 XREADGROUP 来获取未确认的消息。
	for _, topic := range WatchedTopics {
		args := &redis.XReadGroupArgs{
			Group:    OrchestratorGroup,
			Consumer: OrchestratorConsumer,
			Streams:  []string{topic, "0"},
			Count:    50,
		}

		res, err := store.RDB.XReadGroup(store.Ctx, args).Result()
		if err != nil && err != redis.Nil {
			log.Printf("Recovery error on %s: %v", topic, err)
			continue
		}

		for _, stream := range res {
			for _, msg := range stream.Messages {
				handleEvent(stream.Stream, msg)
			}
		}
	}
}

func runPollCycle() {
	for {
		// 为 XReadGroup 准备 streams
		streams := make([]string, len(WatchedTopics)*2)
		for i, topic := range WatchedTopics {
			streams[i] = topic
			streams[i+len(WatchedTopics)] = ">"
		}

		args := &redis.XReadGroupArgs{
			Group:    OrchestratorGroup,
			Consumer: OrchestratorConsumer,
			Streams:  streams,
			Count:    5,
			Block:    2 * time.Second,
		}

		res, err := store.RDB.XReadGroup(context.Background(), args).Result()
		if err != nil {
			if err != redis.Nil {
				log.Printf("Poll error: %v", err)
				time.Sleep(2 * time.Second)
			}
			continue
		}

		for _, stream := range res {
			for _, msg := range stream.Messages {
				handleEvent(stream.Stream, msg)
			}
		}
	}
}

func handleEvent(topic string, msg redis.XMessage) {
	// 1. 广播到 WebSockets
	BroadcastToWebSockets(topic, msg)

	// 2. 调度器逻辑
	eventType := msg.Values["event_type"].(string)
	payloadStr := msg.Values["payload"].(string)

	var payload EventPayload
	if err := json.Unmarshal([]byte(payloadStr), &payload); err != nil {
		log.Printf("⚠️ Failed to unmarshal event payload from %s: %v", topic, err)
		return
	}

	log.Printf("📥 Event received: topic=%s type=%s", topic, eventType)

	switch topic {
	case TopicTaskCreated:
		onTaskCreated(payload)
	case TopicTaskStatus:
		onTaskStatus(eventType, payload)
	case TopicTaskCompleted:
		// 记录日志
	case TopicTaskStalled:
		onTaskStalled(payload)
	}

	// 3. 确认消息
	store.RDB.XAck(store.Ctx, topic, OrchestratorGroup, msg.ID)
}

// StartStallDetector 启动后台协程，定期扫描超时未更新的任务
func StartStallDetector(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Minute)
	log.Println("🧭 Stall detector started")
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			detectStalledTasks()
		}
	}
}

func detectStalledTasks() {
	tasks, err := store.LoadTasks()
	if err != nil {
		return
	}

	threshold := 5 * time.Minute
	now := time.Now()

	for _, t := range tasks {
		if models.TerminalStates[t.State] || t.State == "Blocked" {
			continue
		}

		updatedAt, err := time.Parse(time.RFC3339, t.UpdatedAt)
		if err != nil {
			continue
		}

		if now.Sub(updatedAt) > threshold {
			log.Printf("⚠️ Task %s is STALLED (state: %s, last update: %s)", t.ID, t.State, t.UpdatedAt)
			PublishEvent(TopicTaskStalled, t.ID, "task.stalled", "stall-detector", EventPayload{
				"task_id": t.ID,
				"state":   t.State,
				"since":   t.UpdatedAt,
			})
		}
	}
}

func onTaskStalled(payload EventPayload) {
	taskID, _ := payload["task_id"].(string)

	// 对停滞任务进行升级：增加 FlowLog 并标记 Now 状态
	store.WithTasks(func(tasks []models.Task) ([]models.Task, error) {
		t := store.FindTask(tasks, taskID)
		if t == nil {
			return tasks, nil
		}

		remark := "🧭 检测到任务长时间未进展，系统已发布停滞告警"
		t.Now = "⚠️ 运行异常：" + remark
		t.FlowLog = append(t.FlowLog, models.FlowEntry{
			At:     store.NowISO(),
			From:   "系统调度站",
			To:     t.Org,
			Remark: remark,
		})
		t.UpdatedAt = store.NowISO()
		return tasks, nil
	})
}

func onTaskCreated(payload EventPayload) {
	taskID, _ := payload["task_id"].(string)
	title, _ := payload["title"].(string)
	state, ok := payload["state"].(string)
	if !ok {
		state = "Queued"
	}

	// 根据状态查找对应的 agent
	agent := store.GetAgentForState(state) // TODO: 在 store 中实现
	if agent == "" {
		agent = "coordinator"
	}

	log.Printf("⚡ Triggering dispatch for new task %s (state: %s) -> agent: %s", taskID, state, agent)
	PublishEvent(TopicTaskDispatch, "go-orch", "task.dispatch.request", "orchestrator", EventPayload{
		"task_id": taskID,
		"agent":   agent,
		"state":   state,
		"message": "新任务已创建: " + title,
	})
}

func onTaskStatus(eventType string, payload EventPayload) {
	taskID, _ := payload["task_id"].(string)
	toStateStr, _ := payload["to"].(string)

	agent := store.GetAgentForState(toStateStr)
	// 若状态没有固定映射的 agent，则按 org 查找（如 Executing 状态按部门分配执行 agent）
	if agent == "" {
		org, _ := payload["assignee_org"].(string)
		orgAgent := store.GetAgentForOrg(org)
		if orgAgent != "" {
			agent = orgAgent
		}
	}
	if toStateStr == "Dispatching" {
		org, _ := payload["assignee_org"].(string)
		orgAgent := store.GetAgentForOrg(org)
		if orgAgent != "" {
			agent = orgAgent
		}
	}

	if agent != "" {
		log.Printf("⚡ Triggering dispatch for task %s (status change: %s) -> agent: %s", taskID, toStateStr, agent)
		PublishEvent(TopicTaskDispatch, "go-orch", "task.dispatch.request", "orchestrator", EventPayload{
			"task_id": taskID,
			"agent":   agent,
			"state":   toStateStr,
			"message": "任务已流转到 " + toStateStr,
		})
	} else {
		log.Printf("⚠️ No agent found for state %s, skipping dispatch", toStateStr)
	}
}
