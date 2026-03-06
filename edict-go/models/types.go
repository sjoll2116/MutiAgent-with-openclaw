package models

// ── Task (persisted to tasks_source.json) ──

// FlowEntry represents a state-transition record in flow_log.
type FlowEntry struct {
	At     string `json:"at"`
	From   string `json:"from"`
	To     string `json:"to"`
	Remark string `json:"remark,omitempty"`
}

// ProgressEntry is a single progress report from an agent.
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

// TodoItem represents a single todo / sub-task.
type TodoItem struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status,omitempty"`
	Detail string `json:"detail,omitempty"`
}

// Task is the core data model stored in tasks_source.json.
// JSON tags MUST match the exact keys produced by the Python dashboard.
type Task struct {
	ID             string          `json:"id"`
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
	CreatedAt      string          `json:"createdAt,omitempty"`
	UpdatedAt      string          `json:"updatedAt"`
}

// ── Request / Response Types ──

// CreateTaskReq is the JSON body for POST /api/create-task.
type CreateTaskReq struct {
	Title      string         `json:"title"`
	Org        string         `json:"org,omitempty"`
	Official   string         `json:"official,omitempty"`
	Priority   string         `json:"priority,omitempty"`
	TemplateID string         `json:"templateId,omitempty"`
	Params     map[string]any `json:"params,omitempty"`
	TargetDept string         `json:"targetDept,omitempty"`
}

// APIResp is a generic {ok, message?, error?} envelope.
type APIResp struct {
	OK      bool   `json:"ok"`
	Message string `json:"message,omitempty"`
	Error   string `json:"error,omitempty"`
	TaskID  string `json:"taskId,omitempty"`
	Count   int    `json:"count,omitempty"`
}

// ── Task Activity response ──

// TaskMeta is the metadata subset returned in task-activity.
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

// TodosDiff captures changes between two todos snapshots.
type TodosDiff struct {
	Changed []TodoDiffItem `json:"changed"`
	Added   []TodoDiffItem `json:"added"`
	Removed []TodoDiffItem `json:"removed"`
}

// TodoDiffItem is a single changed/added/removed todo.
type TodoDiffItem struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	From  string `json:"from,omitempty"`
	To    string `json:"to,omitempty"`
}

// ActivityEntry is a single entry in the activity timeline.
type ActivityEntry struct {
	At   string `json:"at"`
	Kind string `json:"kind"` // "flow" | "progress" | "todos"

	// kind=flow
	From   string `json:"from,omitempty"`
	To     string `json:"to,omitempty"`
	Remark string `json:"remark,omitempty"`

	// kind=progress
	Text       string `json:"text,omitempty"`
	Agent      string `json:"agent,omitempty"`
	AgentLabel string `json:"agentLabel,omitempty"`
	State      string `json:"state,omitempty"`
	Org        string `json:"org,omitempty"`
	Tokens     int    `json:"tokens,omitempty"`
	Cost       float64 `json:"cost,omitempty"`
	Elapsed    int    `json:"elapsed,omitempty"`

	// kind=todos
	Items []TodoItem `json:"items,omitempty"`
	Diff  *TodosDiff `json:"diff,omitempty"`
}

// PhaseDuration is a single phase in the phaseDurations array.
type PhaseDuration struct {
	Phase        string `json:"phase"`
	From         string `json:"from"`
	To           string `json:"to"`
	DurationSec  int    `json:"durationSec"`
	DurationText string `json:"durationText"`
	Ongoing      bool   `json:"ongoing,omitempty"`
	Remark       string `json:"remark,omitempty"`
}

// TodosSummary aggregates completion stats for todos.
type TodosSummary struct {
	Total      int `json:"total"`
	Completed  int `json:"completed"`
	InProgress int `json:"inProgress"`
	NotStarted int `json:"notStarted"`
	Percent    int `json:"percent"`
}

// ResourceSummary aggregates token/cost/elapsed across progress entries.
type ResourceSummary struct {
	TotalTokens     int     `json:"totalTokens"`
	TotalCost       float64 `json:"totalCost"`
	TotalElapsedSec int     `json:"totalElapsedSec"`
}

// TaskActivityResp is the full response for GET /api/task-activity/:taskId.
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

// ── Lookup maps (mirrors Python constants) ──

// StateAgentMap maps task states to their responsible agent.
var StateAgentMap = map[string]string{
	"Taizi":    "taizi",
	"Zhongshu": "zhongshu",
	"Menxia":   "menxia",
	"Assigned": "shangshu",
	"Review":   "shangshu",
}

// OrgAgentMap maps departments to their agent ID.
var OrgAgentMap = map[string]string{
	"礼部":  "libu",
	"户部":  "hubu",
	"兵部":  "bingbu",
	"刑部":  "xingbu",
	"工部":  "gongbu",
	"吏部":  "libu_hr",
	"中书省": "zhongshu",
	"门下省": "menxia",
	"尚书省": "shangshu",
}

// StateLabels maps state keys to Chinese labels.
var StateLabels = map[string]string{
	"Pending":   "待处理",
	"Taizi":     "太子",
	"Zhongshu":  "中书省",
	"Menxia":    "门下省",
	"Assigned":  "尚书省",
	"Next":      "待执行",
	"Doing":     "执行中",
	"Review":    "审查",
	"Done":      "完成",
	"Blocked":   "阻塞",
	"Cancelled": "已取消",
}

// StateFlowEntry defines where a state advances to.
type StateFlowEntry struct {
	Next     string
	FromDept string
	ToDept   string
	Remark   string
}

// StateFlow is the manual-advance state machine.
var StateFlow = map[string]StateFlowEntry{
	"Pending":  {Next: "Taizi", FromDept: "皇上", ToDept: "太子", Remark: "待处理旨意转交太子分拣"},
	"Taizi":    {Next: "Zhongshu", FromDept: "太子", ToDept: "中书省", Remark: "太子分拣完毕，转中书省起草"},
	"Zhongshu": {Next: "Menxia", FromDept: "中书省", ToDept: "门下省", Remark: "中书省方案提交门下省审议"},
	"Menxia":   {Next: "Assigned", FromDept: "门下省", ToDept: "尚书省", Remark: "门下省准奏，转尚书省派发"},
	"Assigned": {Next: "Doing", FromDept: "尚书省", ToDept: "六部", Remark: "尚书省开始派发执行"},
	"Next":     {Next: "Doing", FromDept: "尚书省", ToDept: "六部", Remark: "待执行任务开始执行"},
	"Doing":    {Next: "Review", FromDept: "六部", ToDept: "尚书省", Remark: "各部完成，进入汇总"},
	"Review":   {Next: "Done", FromDept: "尚书省", ToDept: "太子", Remark: "全流程完成，回奏太子转报皇上"},
}

// TerminalStates are states from which no further transitions occur.
var TerminalStates = map[string]bool{
	"Done":      true,
	"Cancelled": true,
}

// MinTitleLen is the minimum title length for task creation.
const MinTitleLen = 10

// JunkTitles are titles too short/trivial to be valid edicts.
var JunkTitles = map[string]bool{
	"?": true, "？": true, "好": true, "好的": true, "是": true,
	"否": true, "不": true, "不是": true, "对": true, "了解": true,
	"收到": true, "嗯": true, "哦": true, "知道了": true, "开启了么": true,
	"可以": true, "不行": true, "行": true, "ok": true, "yes": true,
	"no": true, "你去开启": true, "测试": true, "试试": true, "看看": true,
}
