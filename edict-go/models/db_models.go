package models

import (
	"time"
)

// GORM Models for PostgreSQL persistence

type GormTask struct {
	ID          string    `gorm:"primaryKey;type:varchar(100)"`
	Title       string    `gorm:"not null;type:varchar(500)"`
	State       string    `gorm:"not null;type:varchar(50)"`
	Org         string    `gorm:"type:varchar(100)"`
	Priority    string    `gorm:"type:varchar(20);default:Normal"`
	Official    string    `gorm:"type:varchar(100)"`
	NowText     string    `gorm:"column:now_text"`
	ETA         *time.Time `gorm:"column:eta"`
	BlockReason string    `gorm:"column:block_reason"`
	Output      string    `gorm:"column:output"`
	Archived    bool      `gorm:"default:false"`
	ArchivedAt  *time.Time
	Scheduler   string    `gorm:"column:scheduler"` // JSON string for metadata
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (GormTask) TableName() string {
	return "tasks"
}

type GormFlowEntry struct {
	ID       uint      `gorm:"primaryKey"`
	TaskID   string    `gorm:"type:varchar(100);not null"`
	At       time.Time `gorm:"default:now()"`
	FromDept string    `gorm:"column:from_dept;type:varchar(100)"`
	ToDept   string    `gorm:"column:to_dept;type:varchar(100)"`
	Remark   string
}

func (GormFlowEntry) TableName() string {
	return "task_flow_log"
}

type GormProgressEntry struct {
	ID         uint      `gorm:"primaryKey"`
	TaskID     string    `gorm:"type:varchar(100);not null"`
	At         time.Time `gorm:"default:now()"`
	Agent      string    `gorm:"type:varchar(100)"`
	AgentLabel string    `gorm:"column:agent_label;type:varchar(100)"`
	Text       string
	State      string    `gorm:"type:varchar(50)"`
	Org        string    `gorm:"type:varchar(100)"`
	Tokens     int       `gorm:"default:0"`
	Cost       float64   `gorm:"type:decimal(10,4);default:0.0"`
	ElapsedSec int       `gorm:"column:elapsed_sec;default:0"`
}

func (GormProgressEntry) TableName() string {
	return "task_progress_log"
}

type GormTodoItem struct {
	ID     uint   `gorm:"primaryKey"`
	TaskID string `gorm:"type:varchar(100);not null"`
	TodoID string `gorm:"column:todo_id;type:varchar(100)"`
	Title  string `gorm:"type:varchar(255)"`
	Status string `gorm:"type:varchar(50);default:not-started"`
	Detail string
}

func (GormTodoItem) TableName() string {
	return "task_todos"
}

type GormEvalSample struct {
	ID           uint      `gorm:"primaryKey"`
	SampleType   string    `gorm:"column:sample_type;type:varchar(50);index"`
	TaskID       string    `gorm:"column:task_id;type:varchar(100);index"`
	Query        string    `gorm:"type:text;not null"`
	Context      string    `gorm:"type:text"`
	Answer       string    `gorm:"type:text"`
	MetadataJSON string    `gorm:"column:metadata_json;type:text"`
	CreatedAt    time.Time `gorm:"default:now()"`
}

func (GormEvalSample) TableName() string {
	return "eval_samples"
}

type GormEvalResult struct {
	ID         uint      `gorm:"primaryKey"`
	SampleID   uint      `gorm:"column:sample_id;index"`
	MetricName string    `gorm:"column:metric_name;type:varchar(50);index"`
	Score      float64   `gorm:"type:float"`
	Reasoning  string    `gorm:"type:text"`
	JudgeModel string    `gorm:"column:judge_model;type:varchar(100)"`
	CreatedAt  time.Time `gorm:"default:now()"`
}

func (GormEvalResult) TableName() string {
	return "eval_results"
}
