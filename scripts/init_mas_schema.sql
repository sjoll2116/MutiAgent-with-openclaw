-- OpenClaw MAS Persistence Refactoring Schema
-- This script initializes the tasks and MAS-related tables in PostgreSQL.

-- 任务主表
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    state VARCHAR(50) NOT NULL,
    org VARCHAR(100),
    priority VARCHAR(20) DEFAULT 'Normal',
    official VARCHAR(100),
    now_text TEXT,
    eta TIMESTAMP WITH TIME ZONE,
    block_reason TEXT,
    output TEXT,
    archived BOOLEAN DEFAULT FALSE,
    archived_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 任务流转日志
CREATE TABLE IF NOT EXISTS task_flow_log (
    id SERIAL PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    from_dept VARCHAR(100),
    to_dept VARCHAR(100),
    remark TEXT
);

-- 任务进度日志 (Agent Thoughts)
CREATE TABLE IF NOT EXISTS task_progress_log (
    id SERIAL PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    agent VARCHAR(100),
    agent_label VARCHAR(100),
    text TEXT,
    state VARCHAR(50),
    org VARCHAR(100),
    tokens INTEGER DEFAULT 0,
    cost DECIMAL(10, 4) DEFAULT 0.0,
    elapsed_sec INTEGER DEFAULT 0
);

-- 任务待办 (Todos)
CREATE TABLE IF NOT EXISTS task_todos (
    id SERIAL PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    todo_id VARCHAR(100), -- 对应前端/Agent生成的ID
    title VARCHAR(255),
    status VARCHAR(50) DEFAULT 'not-started',
    detail TEXT
);

-- 创建索引以优化查询
CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
CREATE INDEX IF NOT EXISTS idx_tasks_archived ON tasks(archived);
CREATE INDEX IF NOT EXISTS idx_task_flow_task_id ON task_flow_log(task_id);
CREATE INDEX IF NOT EXISTS idx_task_progress_task_id ON task_progress_log(task_id);
CREATE INDEX IF NOT EXISTS idx_task_todos_task_id ON task_todos(task_id);
