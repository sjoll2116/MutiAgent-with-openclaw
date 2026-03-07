package services

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"time"

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
	// 1. 广播到 WebSockets（始终执行）
	BroadcastToWebSockets(topic, msg)

	// 2. 调度器逻辑
	eventType := msg.Values["event_type"].(string)
	payloadStr := msg.Values["payload"].(string)

	var payload EventPayload
	json.Unmarshal([]byte(payloadStr), &payload)

	switch topic {
	case TopicTaskCreated:
		onTaskCreated(payload)
	case TopicTaskStatus:
		onTaskStatus(eventType, payload)
	case TopicTaskCompleted:
		// 记录日志
	case TopicTaskStalled:
		// 停滞处理逻辑
	}

	// 3. 确认消息
	store.RDB.XAck(store.Ctx, topic, OrchestratorGroup, msg.ID)
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
	if toStateStr == "Dispatching" {
		org, _ := payload["assignee_org"].(string)
		orgAgent := store.GetAgentForOrg(org)
		if orgAgent != "" {
			agent = orgAgent
		}
	}

	if agent != "" {
		PublishEvent(TopicTaskDispatch, "go-orch", "task.dispatch.request", "orchestrator", EventPayload{
			"task_id": taskID,
			"agent":   agent,
			"state":   toStateStr,
			"message": "任务已流转到 " + toStateStr,
		})
	}
}
