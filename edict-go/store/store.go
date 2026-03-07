// Package store 为 tasks_source.json 提供原子的 JSON 文件 I/O 操作
// 及调度器辅助函数。
package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"edict-go/models"
)

var (
	dataDir string
	mu      sync.Mutex
)

// Init 设置数据目录 (通常为相对于二进制文件的 ../data)
func Init(dir string) { dataDir = dir }

// DataDir 返回配置的数据目录路径。
func DataDir() string { return dataDir }

// NowISO 以带 Z 后缀的 ISO 8601 格式返回当前的 UTC 时间。
func NowISO() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

// ── JSON 文件辅助函数 ──

// ReadJSONFile 将一个 JSON 文件读取到 target 中。如果文件未找到则返回 nil。
func ReadJSONFile(filename string, target any) error {
	data, err := os.ReadFile(filepath.Join(dataDir, filename))
	if err != nil {
		if os.IsNotExist(err) {
			return nil // 调用者应该检查 target 是否有零值
		}
		return err
	}
	return json.Unmarshal(data, target)
}

// ReadJSONRaw 将一个文件按原始 JSON 字节读取。
func ReadJSONRaw(filename string) (json.RawMessage, error) {
	data, err := os.ReadFile(filepath.Join(dataDir, filename))
	if err != nil {
		if os.IsNotExist(err) {
			return json.RawMessage("{}"), nil
		}
		return nil, err
	}
	return json.RawMessage(data), nil
}

// WriteJSONFile 将数据原子写入 dataDir 目录下的 filename 文件中。
func WriteJSONFile(filename string, data any) error {
	path := filepath.Join(dataDir, filename)
	content, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, content, 0644); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

// ── 任务 CRUD 操作 ──

// LoadTasks 读取 tasks_source.json (通过互斥锁保护)。
func LoadTasks() ([]models.Task, error) {
	mu.Lock()
	defer mu.Unlock()
	return loadTasksLocked()
}

func loadTasksLocked() ([]models.Task, error) {
	var tasks []models.Task
	data, err := os.ReadFile(filepath.Join(dataDir, "tasks_source.json"))
	if err != nil {
		if os.IsNotExist(err) {
			return []models.Task{}, nil
		}
		return nil, err
	}
	if err := json.Unmarshal(data, &tasks); err != nil {
		return nil, fmt.Errorf("parse tasks_source.json: %w", err)
	}
	return tasks, nil
}

// SaveTasks 写入 tasks_source.json (通过互斥锁保护)。
func SaveTasks(tasks []models.Task) error {
	mu.Lock()
	defer mu.Unlock()
	return saveTasksLocked(tasks)
}

func saveTasksLocked(tasks []models.Task) error {
	return WriteJSONFile("tasks_source.json", tasks)
}

// WithTasks 执行一次原子的 读取-修改-保存 周期。
// 回调函数接收当前的所有任务列表并返回修改后的列表。
func WithTasks(fn func([]models.Task) ([]models.Task, error)) error {
	mu.Lock()
	defer mu.Unlock()

	tasks, err := loadTasksLocked()
	if err != nil {
		return err
	}
	modified, err := fn(tasks)
	if err != nil {
		return err
	}
	return saveTasksLocked(modified)
}

// FindTask 返回一个指向拥有匹配 ID 的任务指针，如未找到则返回 nil。
func FindTask(tasks []models.Task, id string) *models.Task {
	for i := range tasks {
		if tasks[i].ID == id {
			return &tasks[i]
		}
	}
	return nil
}

// ── 调度器辅助函数 ──

// EnsureScheduler 初始化 _scheduler map, 若缺失则补充默认值。
func EnsureScheduler(task *models.Task) map[string]any {
	if task.Scheduler == nil {
		task.Scheduler = map[string]any{}
	}
	s := task.Scheduler
	setDefault := func(k string, v any) {
		if _, ok := s[k]; !ok {
			s[k] = v
		}
	}
	setDefault("enabled", true)
	setDefault("stallThresholdSec", 180)
	setDefault("maxRetry", 1)
	setDefault("retryCount", 0)
	setDefault("escalationLevel", 0)
	setDefault("autoRollback", true)

	if s["lastProgressAt"] == nil || s["lastProgressAt"] == "" {
		ua := task.UpdatedAt
		if ua == "" {
			ua = NowISO()
		}
		s["lastProgressAt"] = ua
	}
	if _, ok := s["stallSince"]; !ok {
		s["stallSince"] = nil
	}
	if _, ok := s["lastDispatchStatus"]; !ok {
		s["lastDispatchStatus"] = "idle"
	}
	if _, ok := s["snapshot"]; !ok {
		s["snapshot"] = map[string]any{
			"state":   task.State,
			"org":     task.Org,
			"now":     task.Now,
			"savedAt": NowISO(),
			"note":    "init",
		}
	}
	return s
}

// SchedulerSnapshot 将当前状态保存为快照。
func SchedulerSnapshot(task *models.Task, note string) {
	s := EnsureScheduler(task)
	if note == "" {
		note = "snapshot"
	}
	s["snapshot"] = map[string]any{
		"state":   task.State,
		"org":     task.Org,
		"now":     task.Now,
		"savedAt": NowISO(),
		"note":    note,
	}
}

// SchedulerMarkProgress 重置停滞计数器并记录进度。
func SchedulerMarkProgress(task *models.Task, note string) {
	s := EnsureScheduler(task)
	s["lastProgressAt"] = NowISO()
	s["stallSince"] = nil
	s["retryCount"] = 0
	s["escalationLevel"] = 0
	s["lastEscalatedAt"] = nil
	if note != "" {
		SchedulerAddFlow(task, "进展确认："+note)
	}
}

// SchedulerAddFlow 追加一个源于调度器的 flow_log 条目。
func SchedulerAddFlow(task *models.Task, remark string) {
	to := task.Org
	if to == "" {
		to = "系统"
	}
	task.FlowLog = append(task.FlowLog, models.FlowEntry{
		At:     NowISO(),
		From:   "系统调度",
		To:     to,
		Remark: "🧭 " + remark,
	})
}
