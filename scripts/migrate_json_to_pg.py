import json
import os
import uuid
import psycopg2
from datetime import datetime

# 配置
JSON_FILE = '../data/tasks_source.json'
DB_URL = os.environ.get('DATABASE_URL_SYNC', 'postgresql://edict:edict_secret_change_me@localhost:5432/edict')

def migrate():
    if not os.path.exists(JSON_FILE):
        print(f"File {JSON_FILE} not found.")
        return

    with open(JSON_FILE, 'r', encoding='utf-8') as f:
        tasks = json.load(f)

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    print(f"Starting migration of {len(tasks)} tasks...")

    for t in tasks:
        task_id = t.get('id')
        if not task_id: continue
        
        # 插入主任务
        cur.execute("""
            INSERT INTO tasks (id, title, state, org, priority, official, now_text, eta, block_reason, output, archived, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO NOTHING
        """, (
            task_id, t.get('title'), t.get('state'), t.get('org'), 
            t.get('priority', 'Normal'), t.get('official'), t.get('now'),
            t.get('eta') if t.get('eta') != '-' else None,
            t.get('block'), t.get('output'), t.get('archived', False),
            t.get('updatedAt') or datetime.now()
        ))

        # 插入 FlowLog
        for flow in t.get('flow_log', []):
            cur.execute("""
                INSERT INTO task_flow_log (task_id, at, from_dept, to_dept, remark)
                VALUES (%s, %s, %s, %s, %s)
            """, (task_id, flow.get('at'), flow.get('from'), flow.get('to'), flow.get('remark')))

        # 插入 ProgressLog
        for prog in t.get('progress_log', []):
            cur.execute("""
                INSERT INTO task_progress_log (task_id, at, agent, agent_label, text, state, org, tokens, cost, elapsed_sec)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                task_id, prog.get('at'), prog.get('agent'), prog.get('agentLabel'),
                prog.get('text'), prog.get('state'), prog.get('org'),
                prog.get('tokens', 0), prog.get('cost', 0.0), prog.get('elapsed', 0)
            ))

        # 插入 Todos
        for todo in t.get('todos', []):
            cur.execute("""
                INSERT INTO task_todos (task_id, todo_id, title, status, detail)
                VALUES (%s, %s, %s, %s, %s)
            """, (task_id, todo.get('id'), todo.get('title'), todo.get('status'), todo.get('detail')))

    conn.commit()
    cur.close()
    conn.close()
    print("Migration completed successfully.")

if __name__ == '__main__':
    migrate()
