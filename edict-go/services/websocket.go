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
		return true // Allow all for dashboard proxy
	},
}

type wsClient struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

var (
	clients   = make(map[*wsClient]bool)
	clientsMu sync.Mutex
)

// WsLiveStatusHandler handles WebSocket connection requests from dashboard
func WsLiveStatusHandler(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WS upgrade error: %v", err)
		return
	}

	client := &wsClient{conn: conn}

	clientsMu.Lock()
	clients[client] = true
	clientsMu.Unlock()

	// Keep conn open, wait for close
	go func() {
		defer func() {
			clientsMu.Lock()
			delete(clients, client)
			clientsMu.Unlock()
			conn.Close()
		}()
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					log.Printf("WS error: %v", err)
				}
				break
			}
		}
	}()
}

// BroadcastToWebSockets parses a message from Redis Streams and sends it over WS
func BroadcastToWebSockets(topic string, msg redis.XMessage) {
	payloadStr, ok := msg.Values["payload"].(string)
	if !ok {
		return
	}

	type broadcastMsg struct {
		Topic     string          `json:"topic"`
		ID        string          `json:"id"`
		EventType string          `json:"event_type"`
		Payload   json.RawMessage `json:"payload"`
	}

	var rawPayload json.RawMessage
	json.Unmarshal([]byte(payloadStr), &rawPayload)

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

	clientsMu.Lock()
	defer clientsMu.Unlock()

	for client := range clients {
		client.mu.Lock()
		err := client.conn.WriteMessage(websocket.TextMessage, out)
		client.mu.Unlock()

		if err != nil {
			client.conn.Close()
			delete(clients, client)
		}
	}
}
