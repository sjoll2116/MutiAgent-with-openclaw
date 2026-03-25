package services

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // 允许所有来源的连接
	},
}

type wsClient struct {
	conn   *websocket.Conn
	mu     sync.Mutex
	taskID string // 如果设置，只接收此任务的消息
}

var (
	clients   = make(map[*wsClient]bool)
	clientsMu sync.Mutex
)

func WsLiveStatusHandler(c *gin.Context) {
	taskID := c.Param("taskId")

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WS upgrade error: %v", err)
		return
	}

	client := &wsClient{
		conn:   conn,
		taskID: taskID,
	}

	clientsMu.Lock()
	clients[client] = true
	clientsMu.Unlock()

	log.Printf("WS client connected (TaskID: %s). Total: %d", taskID, len(clients))

	// 保持连接打开，等待关闭
	go func() {
		defer func() {
			clientsMu.Lock()
			delete(clients, client)
			clientsMu.Unlock()
			conn.Close()
			log.Printf("WS client disconnected. Remaining: %d", len(clients))
		}()
		for {
			_, message, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					log.Printf("WS error: %v", err)
				}
				break
			}
			// 处理客户端消息（例如心跳）
			var msg map[string]interface{}
			if err := json.Unmarshal(message, &msg); err == nil {
				if msg["type"] == "ping" {
					client.mu.Lock()
					client.conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"pong"}`))
					client.mu.Unlock()
				}
			}
		}
	}()
}

// BroadcastToWebSockets 解析 Redis Streams 数据并广播至 WebSocket
func BroadcastToWebSockets(topic string, msg redis.XMessage) {
	payloadStr, ok := msg.Values["payload"].(string)
	if !ok {
		return
	}

	// 1. 准备广播消息
	type broadcastMsg struct {
		Topic     string          `json:"topic"`
		ID        string          `json:"id"`
		EventType string          `json:"event_type"`
		Payload   json.RawMessage `json:"payload"`
	}

	var rawPayload json.RawMessage
	json.Unmarshal([]byte(payloadStr), &rawPayload)

	// 提取 taskId 以便过滤
	var payloadData map[string]interface{}
	json.Unmarshal([]byte(payloadStr), &payloadData)
	msgTaskID, _ := payloadData["task_id"].(string)

	bMsg := broadcastMsg{
		Topic:     topic,
		ID:        msg.ID,
		EventType: msg.Values["event_type"].(string),
		Payload:   rawPayload,
	}

	out, err := json.Marshal(bMsg)
	if err != nil {
		return
	}

	// 2. 转发给所有匹配的客户端
	clientsMu.Lock()
	defer clientsMu.Unlock()

	for client := range clients {
		// 按 TaskID 过滤
		if client.taskID != "" && client.taskID != msgTaskID {
			continue
		}

		client.mu.Lock()
		err := client.conn.WriteMessage(websocket.TextMessage, out)
		client.mu.Unlock()

		if err != nil {
			log.Printf("Failed to send WS message to client: %v", err)
			client.conn.Close()
			delete(clients, client)
		}
	}
}
