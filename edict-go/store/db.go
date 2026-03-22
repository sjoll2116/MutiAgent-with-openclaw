package store

import (
	"log"
	"os"

	"edict-go/models"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

func InitDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		// 备用：从单个环境变量拼接
		mHost := os.Getenv("POSTGRES_HOST")
		if mHost == "" {
			mHost = "localhost"
		}
		mPort := os.Getenv("POSTGRES_PORT")
		if mPort == "" {
			mPort = "5432"
		}
		mUser := os.Getenv("POSTGRES_USER")
		if mUser == "" {
			mUser = "postgres"
		}
		mPass := os.Getenv("POSTGRES_PASSWORD")
		if mPass == "" {
			mPass = "postgres"
		}
		mName := os.Getenv("POSTGRES_DB")
		if mName == "" {
			mName = "mas_db"
		}
		dsn = "host=" + mHost + " user=" + mUser + " password=" + mPass + " dbname=" + mName + " port=" + mPort + " sslmode=disable"
	}

	var err error
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to connect to PostgreSQL: %v", err)
	}

	// 自动迁移模型
	_ = db.AutoMigrate(
		&models.GormTask{},
		&models.GormFlowEntry{},
		&models.GormProgressEntry{},
		&models.GormTodoItem{},
		&models.GormEvalSample{},
		&models.GormEvalResult{},
	)

	// 强制补充唯一索引 (解决 ON CONFLICT 报错)
	// 由于 Python 侧可能已经将 task_id 设为主键，这里通过唯一索引确保 Go 的 id 字段也可用于 ON CONFLICT
	db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_id ON tasks(id)`)

	DB = db
	log.Printf("🔌 Connected to PostgreSQL via GORM & Schema Migrated")
}
