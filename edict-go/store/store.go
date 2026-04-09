// Package store 为 tasks_source.json 提供原子的 JSON 文件 I/O 操作
// 及调度器辅助函数。
package store

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"edict-go/models"

	"gorm.io/gorm"
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

// ── 任务 CRUD 操作 (PostgreSQL 实现) ──

// QueryTasks 从 PostgreSQL 读取满足条件的任务。
func QueryTasks(state, org, priority string, limit, offset int) ([]models.Task, error) {
	var gTasks []models.GormTask
	query := DB.Order("created_at desc")
	if state != "" {
		query = query.Where("state = ?", state)
	}
	if org != "" {
		query = query.Where("org = ?", org)
	}
	if priority != "" {
		query = query.Where("priority = ?", priority)
	}
	if limit > 0 {
		query = query.Limit(limit)
	}
	if offset > 0 {
		query = query.Offset(offset)
	}

	if err := query.Find(&gTasks).Error; err != nil {
		return nil, err
	}

	tasks := make([]models.Task, len(gTasks))
	for i, gt := range gTasks {
		tasks[i] = mapGormToTask(gt)
	}
	return tasks, nil
}

// GetTaskByID 从 DB 获取单个任务详情（包含关联表）。
func GetTaskByID(id string) (*models.Task, error) {
	var gt models.GormTask
	if err := DB.First(&gt, "id = ?", id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	task := mapGormToTask(gt)
	return &task, nil
}

// GetTaskStats 获取各状态任务统计。
func GetTaskStats() (map[string]int64, error) {
	var results []struct {
		State string
		Count int64
	}
	if err := DB.Model(&models.GormTask{}).Select("state, count(*) as count").Group("state").Scan(&results).Error; err != nil {
		return nil, err
	}
	stats := make(map[string]int64)
	for _, r := range results {
		stats[r.State] = r.Count
	}
	return stats, nil
}

// LoadTasks 从 PostgreSQL 读取所有任务 (兼容旧代码)。
func LoadTasks() ([]models.Task, error) {
	return QueryTasks("", "", "", -1, -1)
}

// 保存记录Tasks 将任务保存到 PostgreSQL。
func SaveTasks(tasks []models.Task) error {
	for _, t := range tasks {
		if err := saveSingleTask(t); err != nil {
			return err
		}
	}
	return nil
}

func saveSingleTask(t models.Task) error {
	gt := mapTaskToGorm(t)
	return DB.Transaction(func(tx *gorm.DB) error {
		// 保存主表
		if err := tx.Save(&gt).Error; err != nil {
			return err
		}

		// 处理 FlowLog (通常只会追加，但为了简单这里可以先全量覆盖或根据 At 判断)
		// 生产环境建议只增量同步
		tx.Where("task_id = ?", t.ID).Delete(&models.GormFlowEntry{})
		for _, fe := range t.FlowLog {
			gfe := mapFlowToGorm(t.ID, fe)
			if err := tx.Create(&gfe).Error; err != nil {
				return err
			}
		}

		// 处理 ProgressLog
		tx.Where("task_id = ?", t.ID).Delete(&models.GormProgressEntry{})
		for _, pe := range t.ProgressLog {
			gpe := mapProgressToGorm(t.ID, pe)
			if err := tx.Create(&gpe).Error; err != nil {
				return err
			}
		}

		// 处理 Todos
		tx.Where("task_id = ?", t.ID).Delete(&models.GormTodoItem{})
		for _, todo := range t.Todos {
			gtodo := mapTodoToGorm(t.ID, todo)
			if err := tx.Create(&gtodo).Error; err != nil {
				return err
			}
		}

		return nil
	})
}

// WithTasks 执行一次原子的 读取-修改-保存 周期 (基于 DB 事务)。
func WithTasks(fn func([]models.Task) ([]models.Task, error)) error {
	// 在数据库版本中，WithTasks 可能范围过大，建议尽量使用单任务操作。
	// 这里为了兼容性实现一个全量版。
	tasks, err := LoadTasks()
	if err != nil {
		return err
	}
	modified, err := fn(tasks)
	if err != nil {
		return err
	}
	return SaveTasks(modified)
}

// 辅助映射函数

func mapGormToTask(gt models.GormTask) models.Task {
	t := models.Task{
		ID:          gt.ID,
		TraceID:     gt.TraceID,
		Title:       gt.Title,
		State:       gt.State,
		Org:         gt.Org,
		Official:    gt.Official,
		Now:         gt.NowText,
		Priority:    gt.Priority,
		Block:       gt.BlockReason,
		Output:      gt.Output,
		Archived:    gt.Archived,
		RetryRound:  gt.RetryRound,
		MaxRetry:    gt.MaxRetry,
		LastError:   gt.LastError,
		UpdatedAt:   gt.UpdatedAt.Format(time.RFC3339),
		CreatedAt:   gt.CreatedAt.Format(time.RFC3339),
	}
	if gt.ETA != "" {
		t.ETA = gt.ETA
	}
	if gt.ArchivedAt != nil {
		t.ArchivedAt = gt.ArchivedAt.Format(time.RFC3339)
	}
	if gt.Scheduler != "" {
		_ = json.Unmarshal([]byte(gt.Scheduler), &t.Scheduler)
	}

	// 加载关联数据
	// 修正：模型中没加关联字段，直接查询
	var gFlows []models.GormFlowEntry
	DB.Where("task_id = ?", gt.ID).Order("at asc").Find(&gFlows)
	for _, gf := range gFlows {
		t.FlowLog = append(t.FlowLog, models.FlowEntry{
			At: gf.At.Format(time.RFC3339), From: gf.FromDept, To: gf.ToDept, Remark: gf.Remark,
		})
	}

	var gProgs []models.GormProgressEntry
	DB.Where("task_id = ?", gt.ID).Order("at asc").Find(&gProgs)
	for _, gp := range gProgs {
		t.ProgressLog = append(t.ProgressLog, models.ProgressEntry{
			At: gp.At.Format(time.RFC3339), Agent: gp.Agent, AgentLabel: gp.AgentLabel,
			Text: gp.Text, State: gp.State, Org: gp.Org, Tokens: gp.Tokens,
			Cost: gp.Cost, Elapsed: gp.ElapsedSec,
		})
	}

	var gTodos []models.GormTodoItem
	DB.Where("task_id = ?", gt.ID).Find(&gTodos)
	for _, gtd := range gTodos {
		t.Todos = append(t.Todos, models.TodoItem{
			ID: gtd.TodoID, Title: gtd.Title, Status: gtd.Status, Detail: gtd.Detail,
			Stage: gtd.Stage, Agent: gtd.Agent,
			RetryCount: gtd.RetryCount, MaxRetry: gtd.MaxRetry, FailReason: gtd.FailReason,
		})
	}

	return t
}

func mapTaskToGorm(t models.Task) models.GormTask {
	gt := models.GormTask{
		ID: t.ID, TraceID: t.TraceID, Title: t.Title, State: t.State, Org: t.Org,
		Official: t.Official, NowText: t.Now, Priority: t.Priority,
		BlockReason: t.Block, Output: t.Output, Archived: t.Archived,
		RetryRound: t.RetryRound, MaxRetry: t.MaxRetry, LastError: t.LastError,
	}
	if t.ETA != "" {
		gt.ETA = t.ETA
	}
	if t.ArchivedAt != "" {
		parsed, _ := time.Parse(time.RFC3339, t.ArchivedAt)
		gt.ArchivedAt = &parsed
	}
	if t.Scheduler != nil {
		bytes, _ := json.Marshal(t.Scheduler)
		gt.Scheduler = string(bytes)
	}
	return gt
}

func mapFlowToGorm(taskID string, fe models.FlowEntry) models.GormFlowEntry {
	at, _ := time.Parse(time.RFC3339, fe.At)
	return models.GormFlowEntry{TaskID: taskID, At: at, FromDept: fe.From, ToDept: fe.To, Remark: fe.Remark}
}

func mapProgressToGorm(taskID string, pe models.ProgressEntry) models.GormProgressEntry {
	at, _ := time.Parse(time.RFC3339, pe.At)
	return models.GormProgressEntry{
		TaskID: taskID, At: at, Agent: pe.Agent, AgentLabel: pe.AgentLabel,
		Text: pe.Text, State: pe.State, Org: pe.Org, Tokens: pe.Tokens,
		Cost: pe.Cost, ElapsedSec: pe.Elapsed,
	}
}

func mapTodoToGorm(taskID string, todo models.TodoItem) models.GormTodoItem {
	return models.GormTodoItem{
		TaskID: taskID, TodoID: todo.ID, Title: todo.Title, Status: todo.Status, Detail: todo.Detail,
		Stage: todo.Stage, Agent: todo.Agent,
		RetryCount: todo.RetryCount, MaxRetry: todo.MaxRetry, FailReason: todo.FailReason,
	}
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
	setDefault("stallThresholdSec", 600)
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

// 调度器Snapshot 将当前状态保存为快照。
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

// 调度器MarkProgress 重置停滞计数器并记录进度。
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

// 调度器AddFlow 追加一个源于调度器的 flow_log 条目。
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
// 保存记录EvalSample 异步保存评估样本。
func SaveEvalSample(sampleType, taskID, query, context, answer, metadata string) {
	go func() {
		gs := models.GormEvalSample{
			SampleType:   sampleType,
			TaskID:       taskID,
			Query:        query,
			Context:      context,
			Answer:       answer,
			MetadataJSON: metadata,
		}
		if err := DB.Create(&gs).Error; err != nil {
			log.Printf("⚠️ Failed to save eval sample to DB: %v", err)
		}
	}()
}
