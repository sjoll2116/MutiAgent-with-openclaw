package models

import (
	"time"
)

// 用于 PostgreSQL 持久化的 GORM 模型

type GormTask struct {
	ID          string    `gorm:"uniqueIndex:idx_tasks_id;type:varchar(100)"` // 使用唯一索引替代主键，避免与 Python 侧 task_id 主键冲突
	TraceID     string    `gorm:"column:trace_id;type:varchar(64);not null;index"`
	Title       string    `gorm:"not null;type:varchar(500)"`
	State       string    `gorm:"not null;type:varchar(50)"`
	Org         string    `gorm:"type:varchar(100)"`
	Priority    string    `gorm:"type:varchar(20);default:Normal"`
	Official    string    `gorm:"type:varchar(100)"`
	NowText     string    `gorm:"column:now"`          // 对齐 Python 侧字段名 'now'
	ETA         string    `gorm:"column:eta;type:varchar(64)"` // 改为 string 兼容 Python 侧 "-" 或其它格式
	BlockReason string    `gorm:"column:block"`        // 对齐 Python 侧字段名 'block'
	Output      string    `gorm:"column:output"`
	Archived    bool      `gorm:"default:false"`
	ArchivedAt  *time.Time
	Scheduler   string    `gorm:"column:scheduler"` // 用于元数据的 JSON 字符串
	RetryRound  int       `gorm:"column:retry_round;default:0"`
	MaxRetry    int       `gorm:"column:max_retry;default:3"`
	LastError   string    `gorm:"column:last_error;type:text"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (GormTask) TableName() string {
	return "tasks"
}

type GormFlowEntry struct {
	ID       uint       `gorm:"primaryKey"`
	TaskID   string    `gorm:"type:varchar(100);not null;index"` // 增加索引优化删除/查询
	At       time.Time `gorm:"default:now();index"`              // 增加按时间排序索引
	FromDept string    `gorm:"column:from_dept;type:varchar(100)"`
	ToDept   string    `gorm:"column:to_dept;type:varchar(100)"`
	Remark   string
}

func (GormFlowEntry) TableName() string {
	return "task_flow_log"
}

type GormProgressEntry struct {
	ID         uint      `gorm:"primaryKey"`
	TaskID     string    `gorm:"type:varchar(100);not null;index"` // 增加索引
	At         time.Time `gorm:"default:now();index"`              // 增加索引
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
	ID         uint   `gorm:"primaryKey"`
	TaskID     string `gorm:"type:varchar(100);not null;index"` // 增加索引
	TodoID     string `gorm:"column:todo_id;type:varchar(100)"`
	Title      string `gorm:"type:varchar(255)"`
	Status     string `gorm:"type:varchar(50);default:not-started"`
	Detail     string
	Stage      int    `gorm:"column:stage;default:0"`
	Agent      string `gorm:"column:agent;type:varchar(100)"`
	RetryCount int    `gorm:"column:retry_count;default:0"`
	MaxRetry   int    `gorm:"column:max_retry;default:2"`
	FailReason string `gorm:"column:fail_reason;type:text"`
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
