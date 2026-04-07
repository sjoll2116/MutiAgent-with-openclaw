# 🏛️ OpenClaw MAS 核心调度 API 参考

本系统采用 Go 语言编写的高性能调度引擎，通过标准 RESTful 接口与各类专家 Agent、看板前端以及消息渠道进行协同。

## 🔐 认证 (Authentication)

所有核心 API 调用均需在 HTTP Header 中携带服务令牌：

| Key | Value | 备注 |
| :--- | :--- | :--- |
| `X-Service-Token` | `0a7f3132c662...` | 令牌存储于主配置文件的 `service_token` 字段 |

---

## 📋 任务生命周期管理

### 1. 创建任务 (Create Task)
`POST /api/create-task`

- **Payload**:
```json
{
  "title": "任务简述",
  "org": "发起部门",
  "official": "责任人",
  "templateId": "可选模板ID",
  "params": {} // 模板参数
}
```

### 2. 执行状态变更 (Task Action)
`POST /api/task-action`
用于推进任务状态、上报进度或标记阻塞。

- **Payload**:
```json
{
  "task_id": "MAS-xxx",
  "state": "Executing", // 可选: Executing, Blocked, Completed, Cancelled
  "now": "当前动作描述",
  "output": "产物路径(仅在完成时)",
  "block": "阻塞原因描述",
  "tokens": 1024, // 统计字段
  "cost": 0.05
}
```

### 3. 智能故障自愈 (Smart Loopback)
当系统检测到专家执行失败时，调度器会自动调用该接口将任务回滚至编排阶段：
- **目标状态**: `Planning`
- **关键字段**: `last_error` 将包含 stderr 的原始报错信息。

---

## 🛠 子任务管理 (Todos)

### 更新子任务 (Update Todos)
`POST /api/task-todos`
支持**局部重做（Local Redo）**的核心接口。

- **模式 A：全量刷新** (直接覆盖整个列表)
```json
{
  "task_id": "MAS-xxx",
  "todos": [
    {"id": "1", "title": "步骤A", "status": "completed"},
    {"id": "2", "title": "步骤B", "status": "not-started"}
  ]
}
```

- **模式 B：单点/增量更新** (仅修改或追加特定 ID)
```json
{
  "task_id": "MAS-xxx",
  "todo_id": "2",
  "title": "修订后的步骤B",
  "status": "in-progress",
  "agent": "agency_engineering_ai_engineer",
  "detail": "具体的修复指令..."
}
```

---

## 🧪 监控与查询

### 1. 获取任务详情
`GET /api/tasks/:taskId`
返回任务的完整 JSON 对象，包含 `flow_log` 和 `last_error`。

### 2. 获取活动时间轴 (Activity Timeline)
`GET /api/task-activity/:taskId`
包含任务的聚合活动记录，常用于看板的前端渲染。

### 3. 统计摘要
`GET /api/tasks-stats`
返回按状态分类的任务总数。

---

## 📜 调度元数据 (_scheduler)

任务对象中的 `_scheduler` 字段存储了高级编排参数：
- `totalStages`: 总执行阶段数。
- `currentStage`: 当前所处阶段。
- `stallThresholdSec`: 心跳超时重试阈值。
- `maxRetry`: 最大允许的自愈轮次。

---

## 🛠 命令行调用方法

建议直接使用项目内置的 `scripts/kanban_update.py` 工具进行交互，它已封装了上述所有 API：

```bash
# 读取任务上下文进行诊断
python3 scripts/kanban_update.py read MAS-xxx

# 更新单条 Todo 的详细诊断回执
python3 scripts/kanban_update.py todo MAS-xxx 2 "故障点修复" in-progress --detail "已自动定位错误..."
```
