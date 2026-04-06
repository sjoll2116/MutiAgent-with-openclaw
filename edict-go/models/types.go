package models

// ── 任务 (持久化到 tasks_source.json) ──

// FlowEntry 表示 flow_log 中的一个状态转换记录。
type FlowEntry struct {
	At     string `json:"at"`
	From   string `json:"from"`
	To     string `json:"to"`
	Remark string `json:"remark,omitempty"`
}

// ProgressEntry 是来自 agent 的单一进度报告。
type ProgressEntry struct {
	At         string     `json:"at,omitempty"`
	Agent      string     `json:"agent,omitempty"`
	Text       string     `json:"text,omitempty"`
	AgentLabel string     `json:"agentLabel,omitempty"`
	Todos      []TodoItem `json:"todos,omitempty"`
	State      string     `json:"state,omitempty"`
	Org        string     `json:"org,omitempty"`
	Tokens     int        `json:"tokens,omitempty"`
	Cost       float64    `json:"cost,omitempty"`
	Elapsed    int        `json:"elapsed,omitempty"`
}

// TodoItem 表示一个单一的待办事项 / 子任务。
type TodoItem struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Status     string `json:"status,omitempty"`
	Detail     string `json:"detail,omitempty"`
	Stage      int    `json:"stage,omitempty"`      // 所属执行阶段 (1, 2, 3...)
	Agent      string `json:"agent,omitempty"`      // 指派的 Agent ID
	RetryCount int    `json:"retryCount,omitempty"` // 已重试次数
	MaxRetry   int    `json:"maxRetry,omitempty"`   // 最大重试次数 (默认 2)
	FailReason string `json:"failReason,omitempty"` // 失败/跳过原因
}

// Task 是存储在 tasks_source.json 中的核心数据模型。
// JSON 标签必须完全匹配 Python dashboard 生成的键。
type Task struct {
	ID             string          `json:"id"`
	TraceID        string          `json:"trace_id"`
	Title          string          `json:"title"`
	State          string          `json:"state"`
	Org            string          `json:"org"`
	Official       string          `json:"official"`
	Now            string          `json:"now"`
	ETA            string          `json:"eta"`
	Block          string          `json:"block"`
	Output         string          `json:"output"`
	Priority       string          `json:"priority"`
	Archived       bool            `json:"archived,omitempty"`
	ArchivedAt     string          `json:"archivedAt,omitempty"`
	FlowLog        []FlowEntry     `json:"flow_log"`
	ProgressLog    []ProgressEntry `json:"progress_log,omitempty"`
	Todos          []TodoItem      `json:"todos,omitempty"`
	TemplateID     string          `json:"templateId,omitempty"`
	TemplateParams map[string]any  `json:"templateParams,omitempty"`
	AC             string          `json:"ac,omitempty"`
	TargetDept     string          `json:"targetDept,omitempty"`
	Scheduler      map[string]any  `json:"_scheduler,omitempty"`
	ReviewRound    int             `json:"review_round,omitempty"`
	PrevState      string          `json:"_prev_state,omitempty"`
	RetryRound     int             `json:"retry_round,omitempty"`
	MaxRetry       int             `json:"max_retry,omitempty"`
	LastError      string          `json:"last_error,omitempty"`
	CreatedAt      string          `json:"createdAt,omitempty"`
	UpdatedAt      string          `json:"updatedAt"`
}

// ── 请求 / 响应类型 ──

// CreateTaskReq 是 POST /api/create-task 的 JSON body。
type CreateTaskReq struct {
	Title      string         `json:"title"`
	Org        string         `json:"org,omitempty"`
	Official   string         `json:"official,omitempty"`
	Priority   string         `json:"priority,omitempty"`
	TemplateID string         `json:"templateId,omitempty"`
	Params     map[string]any `json:"params,omitempty"`
	TargetDept string         `json:"target_dept,omitempty"`
}

// TaskActionReq 用于 POST /api/task-action (done / block / progress / stop / cancel / resume)
type TaskActionReq struct {
	TaskID    string `json:"task_id"`
	Action    string `json:"action,omitempty"` // stop, cancel, resume
	State     string `json:"state,omitempty"`  // Completed, Blocked
	Now       string `json:"now,omitempty"`
	Block     string `json:"block,omitempty"`
	Output    string `json:"output,omitempty"`
	TodosPipe string `json:"todos_pipe,omitempty"`
	Tokens    int    `json:"tokens,omitempty"`
	Cost      float64 `json:"cost,omitempty"`
	Elapsed   int     `json:"elapsed,omitempty"`
	TargetDept string `json:"target_dept,omitempty"`
	FromDept  string  `json:"from,omitempty"`
	ToDept    string  `json:"to,omitempty"`
	Remark    string  `json:"remark,omitempty"`
}

// ArchiveTaskReq 用于 POST /api/archive-task
type ArchiveTaskReq struct {
	TaskID         string `json:"task_id"`
	Archived       *bool  `json:"archived,omitempty"`
	ArchiveAllDone bool   `json:"archive_all_done,omitempty"`
}

// TodoUpdateReq 用于 POST /api/task-todos
type TodoUpdateReq struct {
	TaskID string `json:"task_id"`
	TodoID string `json:"todo_id,omitempty"`
	Title  string `json:"title,omitempty"`
	Status string `json:"status,omitempty"`
	Detail string `json:"detail,omitempty"`
	Stage  int    `json:"stage,omitempty"`
	Agent  string `json:"agent,omitempty"`
	Todos  []TodoItem `json:"todos,omitempty"`
}

// SchedulerUpdateReq 用于 POST /api/task-scheduler
type SchedulerUpdateReq struct {
	TaskID    string         `json:"task_id"`
	Scheduler map[string]any `json:"scheduler"`
}

// ReviewActionReq 用于 POST /api/review-action
type ReviewActionReq struct {
	TaskID  string `json:"task_id"`
	Action  string `json:"action"`
	Comment string `json:"comment,omitempty"`
}

// AdvanceStateReq 用于 POST /api/advance-state
type AdvanceStateReq struct {
	TaskID  string `json:"task_id"`
	Comment string `json:"comment,omitempty"`
}

// AgentWakeReq 用于 POST /api/agent-wake
type AgentWakeReq struct {
	AgentID string `json:"agent_id"`
	Message string `json:"message,omitempty"`
}

// SetModelReq 用于 POST /api/set-model
type SetModelReq struct {
	AgentID string `json:"agent_id"`
	Model   string `json:"model"`
}

// APIResp 是一个通用的 {ok, message?, error?} 包络对象。
type APIResp struct {
	OK      bool   `json:"ok"`
	Message string `json:"message,omitempty"`
	Error   string `json:"error,omitempty"`
	TaskID  string `json:"taskId,omitempty"`
	Count   int    `json:"count,omitempty"`
}

// ── 任务活动响应 ──

// TaskMeta 是在 task-activity 中返回的元数据子集。
type TaskMeta struct {
	Title       string `json:"title"`
	State       string `json:"state"`
	Org         string `json:"org"`
	Output      string `json:"output,omitempty"`
	Block       string `json:"block,omitempty"`
	Priority    string `json:"priority"`
	ReviewRound int    `json:"reviewRound,omitempty"`
	Archived    bool   `json:"archived,omitempty"`
}

// TodosDiff 记录两个 todos 快照之间的更改。
type TodosDiff struct {
	Changed []TodoDiffItem `json:"changed"`
	Added   []TodoDiffItem `json:"added"`
	Removed []TodoDiffItem `json:"removed"`
}

// TodoDiffItem 是一个单一的 更改/新增/移除 的待办事项。
type TodoDiffItem struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	From  string `json:"from,omitempty"`
	To    string `json:"to,omitempty"`
}

// ActivityEntry 是活动时间线中的一个单一条目。
type ActivityEntry struct {
	At   string `json:"at"`
	Kind string `json:"kind"` // "flow" | "progress" | "todos"

	// kind=flow
	From   string `json:"from,omitempty"`
	To     string `json:"to,omitempty"`
	Remark string `json:"remark,omitempty"`

	// kind=progress
	Text       string  `json:"text,omitempty"`
	Agent      string  `json:"agent,omitempty"`
	AgentLabel string  `json:"agentLabel,omitempty"`
	State      string  `json:"state,omitempty"`
	Org        string  `json:"org,omitempty"`
	Tokens     int     `json:"tokens,omitempty"`
	Cost       float64 `json:"cost,omitempty"`
	Elapsed    int     `json:"elapsed,omitempty"`

	// kind=todos
	Items []TodoItem `json:"items,omitempty"`
	Diff  *TodosDiff `json:"diff,omitempty"`
}

// PhaseDuration 是 phaseDurations 数组中的单个阶段。
type PhaseDuration struct {
	Phase        string `json:"phase"`
	From         string `json:"from"`
	To           string `json:"to"`
	DurationSec  int    `json:"durationSec"`
	DurationText string `json:"durationText"`
	Ongoing      bool   `json:"ongoing,omitempty"`
	Remark       string `json:"remark,omitempty"`
}

// TodosSummary 聚合各待办事项的完成统计信息。
type TodosSummary struct {
	Total      int `json:"total"`
	Completed  int `json:"completed"`
	InProgress int `json:"inProgress"`
	NotStarted int `json:"notStarted"`
	Percent    int `json:"percent"`
}

// ResourceSummary 汇总各项进度条目的 token、成本与耗时。
type ResourceSummary struct {
	TotalTokens     int     `json:"totalTokens"`
	TotalCost       float64 `json:"totalCost"`
	TotalElapsedSec int     `json:"totalElapsedSec"`
}

// TaskActivityResp 是 GET /api/task-activity/:taskId 的完整响应格式。
type TaskActivityResp struct {
	OK              bool             `json:"ok"`
	Error           string           `json:"error,omitempty"`
	TaskID          string           `json:"taskId,omitempty"`
	TaskMeta        *TaskMeta        `json:"taskMeta,omitempty"`
	AgentID         string           `json:"agentId,omitempty"`
	AgentLabel      string           `json:"agentLabel,omitempty"`
	LastActive      string           `json:"lastActive,omitempty"`
	Activity        []ActivityEntry  `json:"activity,omitempty"`
	ActivitySource  string           `json:"activitySource,omitempty"`
	RelatedAgents   []string         `json:"relatedAgents,omitempty"`
	PhaseDurations  []PhaseDuration  `json:"phaseDurations,omitempty"`
	TotalDuration   string           `json:"totalDuration,omitempty"`
	TodosSummary    *TodosSummary    `json:"todosSummary,omitempty"`
	ResourceSummary *ResourceSummary `json:"resourceSummary,omitempty"`
}

// ── 映射字典 (镜像自 Python 常量) ──

// StateAgentMap 将任务状态映射到其负责的 Agent。
// 注意：Executing 状态没有固定 agent，其实际 agent 会在 eventbus.go 取决于具体部门 OrgAgentMap。
var StateAgentMap = map[string]string{
	"Queued":       "coordinator",
	"Planning":     "planner",
	"PlanReview":   "reviewer",
	"Dispatching":  "dispatcher",
	"ResultReview": "dispatcher",
}

// OrgAgentMap 将部门映射到其对应的 Agent ID。
var OrgAgentMap = map[string]string{
	"文档编写员":   "doc_writer",
	"数据分析师":   "data_analyst",
	"质量保证师":   "qa_engineer",
	"代码架构师":   "software_engineer",
	"任务编排引擎":  "planner",
	"安全审查引擎":  "reviewer",
	"任务调度引擎":  "dispatcher",
	"协调中枢":    "coordinator",
	"执行智能体集群": "dispatcher", // Dispatcher 负责统筹执行和验收
}

// StateLabels 将状态 key 映射到中文显示标签。
var StateLabels = map[string]string{
	"Pending":      "待处理",
	"Queued":       "待路由",
	"Planning":     "规划中",
	"PlanReview":   "方案审核中",
	"Dispatching":  "调度派发中",
	"Next":         "待执行",
	"Executing":    "执行中",
	"ResultReview": "成果验收中",
	"Completed":    "已完成",
	"Blocked":      "阻塞",
	"Cancelled":    "已取消",
}

// StateFlowEntry 定义一个状态的流转去向。
type StateFlowEntry struct {
	Next     string
	FromDept string
	ToDept   string
	Remark   string
}

// StateFlow 是用于手动推进的状态机。
var StateFlow = map[string]StateFlowEntry{
	"Pending":      {Next: "Queued", FromDept: "用户", ToDept: "协调中枢", Remark: "待处理任务转交协调中枢分拣"},
	"Queued":       {Next: "Planning", FromDept: "协调中枢", ToDept: "任务编排引擎", Remark: "协调中枢分拣完毕，转任务编排引擎起草"},
	"Planning":     {Next: "PlanReview", FromDept: "任务编排引擎", ToDept: "安全审查引擎", Remark: "方案提交安全审查引擎审议"},
	"PlanReview":   {Next: "Dispatching", FromDept: "安全审查引擎", ToDept: "任务调度引擎", Remark: "方案审核通过，转任务调度引擎派发"},
	"Dispatching":  {Next: "Executing", FromDept: "任务调度引擎", ToDept: "执行智能体集群", Remark: "任务调度引擎开始派发执行"},
	"Next":         {Next: "Executing", FromDept: "任务调度引擎", ToDept: "执行智能体集群", Remark: "待执行任务开始执行"},
	"Executing":    {Next: "ResultReview", FromDept: "执行智能体集群", ToDept: "任务调度引擎", Remark: "各节点执行完成，进入汇总验收"},
	"ResultReview": {Next: "Completed", FromDept: "任务调度引擎", ToDept: "协调中枢", Remark: "全流程完成，回执协调中枢转报用户"},
}

// TerminalStates 是不再发生进一步流转的终态。
var TerminalStates = map[string]bool{
	"Completed": true,
	"Cancelled": true,
}

// MinTitleLen 是创建任务时的最小标题长度限制。
const MinTitleLen = 10

// JunkTitles 是一些过短或琐碎而不能作为有效诏令的标题。
var JunkTitles = map[string]bool{
	"?": true, "？": true, "好": true, "好的": true, "是": true,
	"否": true, "不": true, "不是": true, "对": true, "了解": true,
	"收到": true, "嗯": true, "哦": true, "知道了": true, "开启了么": true,
	"可以": true, "不行": true, "行": true, "ok": true, "yes": true,
	"no": true, "你去开启": true, "测试": true, "试试": true, "看看": true,
}
