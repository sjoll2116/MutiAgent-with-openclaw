#!/usr/bin/env python3
"""
看板任务更新工具 (API 客户端版本) - 供各省部 Agent 调用
所有操作均通过 Go 后端 API 完成，确保全局状态一致性与持久化安全性。
"""
import os, sys, logging, datetime

# 配置
EDICT_API_URL = os.environ.get('EDICT_API_URL', 'http://localhost:7891')
SERVICE_TOKEN = os.environ.get('SERVICE_TOKEN', 'edict-internal-service-token-2024')

log = logging.getLogger('kanban')
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(name)s] %(message)s', datefmt='%H:%M:%S')

def _api_call(endpoint, payload):
    """通用 API 调用逻辑。"""
    headers = {
        'Content-Type': 'application/json',
        'X-Service-Token': SERVICE_TOKEN
    }
    try:
        import httpx
        url = f"{EDICT_API_URL}/api/{endpoint}"
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            return resp.json()
    except ImportError:
        import json, urllib.request
        try:
            url = f"{EDICT_API_URL}/api/{endpoint}"
            req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), 
                                         headers=headers, method='POST')
            with urllib.request.urlopen(req) as f:
                return json.loads(f.read().decode('utf-8'))
        except Exception as e:
            log.error(f"Fallback API 调用失败: {e}")
            return {"ok": False, "error": str(e)}
    except Exception as e:
        log.error(f"API 调用失败 [{endpoint}]: {e}")
        return {"ok": False, "error": str(e)}

def cmd_create(task_id, title, state, org, official, remark=None):
    payload = {
        "title": title, "state": state, "org": org, 
        "official": official, "remark": remark
    }
    res = _api_call("create-task", payload)
    if res.get("ok"): log.info(f"✅ 创建任务成功: {res.get('taskId')}")
    else: log.error(f"❌ 创建任务失败: {res.get('error')}")

def cmd_state(task_id, new_state, now_text=None):
    payload = {"task_id": task_id, "state": new_state, "now": now_text}
    _api_call("task-action", payload)

def cmd_flow(task_id, from_dept, to_dept, remark):
    payload = {"task_id": task_id, "from": from_dept, "to": to_dept, "remark": remark}
    _api_call("task-action", payload)

def cmd_done(task_id, output_path='', summary=''):
    payload = {"task_id": task_id, "state": "Completed", "output": output_path, "now": summary}
    _api_call("task-action", payload)

def cmd_block(task_id, reason):
    payload = {"task_id": task_id, "state": "Blocked", "block": reason}
    _api_call("task-action", payload)

def cmd_progress(task_id, now_text, todos_pipe='', tokens=0, cost=0.0, elapsed=0):
    payload = {
        "task_id": task_id, "now": now_text, "todos_pipe": todos_pipe,
        "tokens": tokens, "cost": cost, "elapsed": elapsed
    }
    _api_call("task-action", payload)

def cmd_todo(task_id, todo_id, title, status='not-started', detail=''):
    payload = {
        "task_id": task_id, "todo_id": todo_id, "title": title, 
        "status": status, "detail": detail
    }
    _api_call("task-todos", payload)

if __name__ == '__main__':
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(0)
    cmd = args[0]
    if cmd == 'create': cmd_create(*args[1:])
    elif cmd == 'state': cmd_state(*args[1:])
    elif cmd == 'flow': cmd_flow(*args[1:])
    elif cmd == 'done': cmd_done(*args[1:])
    elif cmd == 'block': cmd_block(*args[1:])
    elif cmd == 'todo': cmd_todo(*args[1:])
    elif cmd == 'progress': cmd_progress(*args[1:])
