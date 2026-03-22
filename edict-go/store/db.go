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

	// 强制补充主键约束 (解决 ON CONFLICT 报错)
	// 如果表已存在但没有主键，AutoMigrate 有时无法自动补全
	db.Exec(`ALTER TABLE tasks ADD PRIMARY KEY (id)` ) // 忽略报错 (如果已存在)

	DB = db
	log.Printf("🔌 Connected to PostgreSQL via GORM & Schema Migrated")
}
