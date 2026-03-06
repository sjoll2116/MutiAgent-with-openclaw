// Package store provides atomic JSON file I/O for tasks_source.json
// and scheduler helper functions.
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

// Init sets the data directory (typically ../data relative to binary).
func Init(dir string) { dataDir = dir }

// DataDir returns the configured data directory path.
func DataDir() string { return dataDir }

// NowISO returns the current UTC time in ISO 8601 format with Z suffix.
func NowISO() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

// ── JSON file helpers ──

// ReadJSONFile reads a JSON file into target. Returns nil on file-not-found.
func ReadJSONFile(filename string, target any) error {
	data, err := os.ReadFile(filepath.Join(dataDir, filename))
	if err != nil {
		if os.IsNotExist(err) {
			return nil // caller should check target for zero-value
		}
		return err
	}
	return json.Unmarshal(data, target)
}

// ReadJSONRaw reads a file as raw JSON bytes.
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

// WriteJSONFile atomically writes data to filename inside dataDir.
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

// ── Task CRUD ──

// LoadTasks reads tasks_source.json (mutex protected).
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

// SaveTasks writes tasks_source.json (mutex protected).
func SaveTasks(tasks []models.Task) error {
	mu.Lock()
	defer mu.Unlock()
	return saveTasksLocked(tasks)
}

func saveTasksLocked(tasks []models.Task) error {
	return WriteJSONFile("tasks_source.json", tasks)
}

// WithTasks performs an atomic load-modify-save cycle.
// The callback receives the current tasks and returns the modified list.
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

// FindTask returns a pointer to the task with matching ID, or nil.
func FindTask(tasks []models.Task, id string) *models.Task {
	for i := range tasks {
		if tasks[i].ID == id {
			return &tasks[i]
		}
	}
	return nil
}

// ── Scheduler helpers ──

// EnsureScheduler initialises the _scheduler map with defaults if missing.
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

// SchedulerSnapshot saves the current state as a snapshot.
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

// SchedulerMarkProgress resets stall counters and records progress.
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

// SchedulerAddFlow appends a scheduler-originated flow_log entry.
func SchedulerAddFlow(task *models.Task, remark string) {
	to := task.Org
	if to == "" {
		to = "系统"
	}
	task.FlowLog = append(task.FlowLog, models.FlowEntry{
		At:     NowISO(),
		From:   "太子调度",
		To:     to,
		Remark: "🧭 " + remark,
	})
}
