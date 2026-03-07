package store

import (
	"context"
	"log"
	"os"

	"github.com/redis/go-redis/v9"
)

var RDB *redis.Client
var Ctx = context.Background()

func InitRedis() {
	url := os.Getenv("REDIS_URL")
	if url == "" {
		url = "redis://localhost:6379/0"
	}

	opts, err := redis.ParseURL(url)
	if err != nil {
		log.Fatalf("Invalid REDIS_URL: %v", err)
	}

	RDB = redis.NewClient(opts)

	if err := RDB.Ping(Ctx).Err(); err != nil {
		log.Printf("⚠️ Starting without Redis backend (EventBus/Orchestrator inactive): %v", err)
		RDB = nil // 如果连接失败则设为 nil，允许使用降级/备用方案
		return
	}

	log.Printf("🔌 Connected to Redis at %s", opts.Addr)
}
