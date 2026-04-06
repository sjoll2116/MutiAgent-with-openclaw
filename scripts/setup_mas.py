import os
import sys
import json
import pathlib
import subprocess
import shutil
import argparse

# --- Configuration ---
BASE_DIR = pathlib.Path(__file__).parent.parent
DATA_DIR = BASE_DIR / 'data'
SCRIPTS_DIR = BASE_DIR / 'scripts'
OPENCLAW_CFG_PATH = pathlib.Path.home() / '.openclaw' / 'openclaw.json'

# Current Core Agents (Consolidated from deploy.sh)
CORE_AGENTS = [
    {"id": "coordinator", "subagents": {"allowAgents": ["planner"]}},
    {"id": "planner",     "subagents": {"allowAgents": ["reviewer", "dispatcher"]}},
    {"id": "reviewer",    "subagents": {"allowAgents": ["dispatcher", "planner"]}},
    {"id": "dispatcher",  "subagents": {"allowAgents": ["planner", "reviewer", "hr_manager"]}},
    {"id": "hr_manager",  "subagents": {"allowAgents": ["dispatcher"]}},
]

def log_step(msg):
    print(f"\n\033[0;32m==> {msg}\033[0m")

def log_warn(msg):
    print(f"\033[0;33m⚠️  {msg}\033[0m")

def log_error(msg):
    print(f"\033[0;31m❌ {msg}\033[0m")

def run_command(cmd, cwd=None, shell=True):
    try:
        subprocess.run(cmd, cwd=cwd, shell=shell, check=True)
        return True
    except subprocess.CalledProcessError as e:
        log_error(f"Command failed: {cmd}\nError: {e}")
        return False

def check_env():
    log_step("检查环境依赖...")
    deps = {
        "openclaw": "OpenClaw CLI (https://openclaw.ai)",
        "go": "Go 1.21+",
    }
    # Check for python/python3
    python_cmd = sys.executable
    print(f"Python: {python_cmd} ({sys.version.split()[0]})")

    for dep, info in deps.items():
        if shutil.which(dep) is None:
            # Special case for 'openclaw' which might be an alias or in a non-standard path
            # But usually shutil.which is enough for installed commands
            log_error(f"缺少依赖: {dep}. {info}")
            sys.exit(1)
    
    if not OPENCLAW_CFG_PATH.exists():
        log_error(f"未找到 OpenClaw 配置文件: {OPENCLAW_CFG_PATH}。请先运行 'openclaw init'。")
        sys.exit(1)
    print("✅ 环境检查通过。")

def init_data_dirs():
    log_step("初始化工作目录与数据结构...")
    DATA_DIR.mkdir(exist_ok=True)
    files = {
        "live_status.json": "{}",
        "agent_config.json": "{}",
        "model_change_log.json": "{}",
        "pending_model_changes.json": "[]"
    }
    for filename, content in files.items():
        p = DATA_DIR / filename
        if not p.exists():
            p.write_text(content, encoding='utf-8')
            print(f"  + 创建空文件: {filename}")
    print(f"✅ 数据目录就绪: {DATA_DIR}")

def register_core_agents():
    log_step("向 OpenClaw 注册核心管理智能体 (5 大集群)...")
    try:
        cfg = json.loads(OPENCLAW_CFG_PATH.read_text('utf-8'))
        agents_cfg = cfg.setdefault('agents', {})
        agents_list = agents_cfg.setdefault('list', [])
        existing_ids = {a.get('id') for a in agents_list}
        
        changed = False
        for ag in CORE_AGENTS:
            ag_id = ag['id']
            if ag_id not in existing_ids:
                ws = pathlib.Path.home() / f'.openclaw/workspace-{ag_id}'
                ws.mkdir(parents=True, exist_ok=True)
                entry = {
                    'id': ag_id, 
                    'workspace': str(ws), 
                    **{k:v for k,v in ag.items() if k!='id'}
                }
                agents_list.append(entry)
                changed = True
                print(f"  + 注册新 Agent: {ag_id}")
            else:
                print(f"  ~ Agent 已存在: {ag_id} (跳过)")
        
        if changed:
            OPENCLAW_CFG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), 'utf-8')
            print("✅ openclaw.json 更新成功。")
        else:
            print("ℹ️ 所有核心智能体已注册，无需更新。")
    except Exception as e:
        log_error(f"注册智能体失败: {e}")

def compile_experts(args):
    log_step("编译领域专家智能体 (Agency Experts)...")
    compile_script = SCRIPTS_DIR / 'utils' / 'compile_agency_agents.py'
    if compile_script.exists():
        run_command(f"{sys.executable} {compile_script}")
    else:
        log_warn("未找到专家编译脚本，跳过此步。")

def sync_configs():
    log_step("同步智能体运行时配置 (Sync Config)...")
    sync_script = SCRIPTS_DIR / 'sync_agent_config.py'
    if sync_script.exists():
        run_command(f"{sys.executable} {sync_script}")
    else:
        log_warn("未找到配置同步脚本，跳过此步。")

def build_frontend():
    log_step("构建看板前端 (React Dashboard UI)...")
    frontend_dir = BASE_DIR / 'edict' / 'frontend'
    if not (frontend_dir / 'package.json').exists():
        log_warn("未找到前端目录或 package.json，跳过构建。")
        return

    if shutil.which("node") and shutil.which("npm"):
        print("正在启动 Node.js 构建流程 (npm install & npm run build)...")
        # In some environments, 'npm.cmd' is needed on Windows, but run_command with shell=True handles it.
        cmd = "npm install --silent && npm run build"
        if run_command(cmd, cwd=str(frontend_dir)):
            print("✅ 前端构建完成。产物位于 dashboard/dist/")
        else:
            log_error("前端构建失败，请检查 Node.js 环境或网络。")
    else:
        log_warn("未检测到 Node.js 或 npm。跳过前端物理构建，将尝试使用现有 dist 目录。")

def main():
    parser = argparse.ArgumentParser(description="OpenClaw MAS 统一初始化与部署工具")
    parser.add_argument("--check-only", action="store_true", help="仅进行环境检查")
    parser.add_argument("--skip-frontend", action="store_true", help="跳过前端构建")
    args = parser.parse_args()

    print("\033[0;36m╔════════════════════════════════════════════════════════╗")
    print("║        🏛️  OpenClaw MAS 统一自动化部署系统           ║")
    print("╚════════════════════════════════════════════════════════╝\033[0m")

    check_env()
    if args.check_only:
        print("\n✅ 环境检查完毕，未执行修改。")
        return

    init_data_dirs()
    register_core_agents()
    compile_experts(args)
    sync_configs()
    
    if not args.skip_frontend:
        build_frontend()
    
    log_step("🎉 OpenClaw MAS 部署成功！")
    print("\n\033[0;33m后续操作建议：\033[0m")
    print("1. 启动 OpenClaw 网关:  openclaw gateway restart")
    print("2. 启动系统集群:        bash start.sh (Linux) 或 ./start.ps1 (Windows)")
    print("3. 访问 Web 监控台:     http://localhost (Caddy 代理)")

if __name__ == "__main__":
    main()
