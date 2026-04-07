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
AGENTS_DIR = BASE_DIR / 'agents'
OPENCLAW_CFG_PATH = pathlib.Path.home() / '.openclaw' / 'openclaw.json'

# --- Agent Cluster Definitions ---

# 废弃的旧版执行智能体 (将从 openclaw.json 中自动剔除)
DISCARDED_AGENTS = [
    'software_engineer', 'qa_engineer', 'data_analyst', 'doc_writer',
    'recruiter', 'observer'
]

# 核心中枢集群 (指挥层)
CORE_AGENTS = [
    {"id": "coordinator", "subagents": {"allowAgents": ["planner"]}},
    {"id": "planner",     "subagents": {"allowAgents": ["reviewer", "dispatcher"]}},
    {"id": "reviewer",    "subagents": {"allowAgents": ["dispatcher", "planner"]}},
    {"id": "dispatcher",  "subagents": {"allowAgents": ["planner", "reviewer", "hr_manager"]}}, # Experts will be injected dynamically
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
        log_warn(f"未找到 OpenClaw 配置文件: {OPENCLAW_CFG_PATH}。将为你初始化默认配置...")
        OPENCLAW_CFG_PATH.parent.mkdir(parents=True, exist_ok=True)
        default_cfg = {"agents": {"list": []}, "channels": {"list": []}}
        OPENCLAW_CFG_PATH.write_text(json.dumps(default_cfg, indent=2), encoding='utf-8')
    
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
    log_step("向 OpenClaw 注册核心管理与专家集群 (Dynamic Discovery)...")
    try:
        cfg = json.loads(OPENCLAW_CFG_PATH.read_text('utf-8'))
        agents_cfg = cfg.setdefault('agents', {})
        agents_list = agents_cfg.setdefault('list', [])
        
        # 1. 自动剔除废弃智能体
        initial_len = len(agents_list)
        agents_list = [a for a in agents_list if a.get('id') not in DISCARDED_AGENTS]
        if len(agents_list) < initial_len:
            print(f"  - 已从配置中剔除 {initial_len - len(agents_list)} 个废弃智能体")

        # 2. 动态感应专家智能体 (agency_*)
        expert_ids = []
        if AGENTS_DIR.exists():
            expert_ids = [d.name for d in AGENTS_DIR.iterdir() if d.is_dir() and d.name.startswith('agency_')]
            print(f"  + 发现 {len(expert_ids)} 个领域专家智能体 (New Version)")

        # 3. 构造 Full Agents List (核心 + 专家)
        all_to_register = []
        
        # 处理核心中枢
        for ag in CORE_AGENTS:
            if ag['id'] == 'dispatcher':
                # 核心逻辑：为 Dispatcher 注入所有专家的路由
                ag_copy = ag.copy()
                sub = ag_copy.setdefault('subagents', {})
                allowed = set(sub.setdefault('allowAgents', []))
                for eid in expert_ids:
                    allowed.add(eid)
                sub['allowAgents'] = sorted(list(allowed))
                all_to_register.append(ag_copy)
            else:
                all_to_register.append(ag)
        
        # 处理每一个专家 (确保他们在 openclaw.json 中有条目)
        for eid in expert_ids:
            all_to_register.append({"id": eid, "subagents": {"allowAgents": []}})

        # 4. 执行注册与 Workspace 维护
        existing_map = {a.get('id'): a for a in agents_list}
        final_list = []
        registered_ids = set()
        changed = (len(agents_list) != initial_len) # 如果刚才删除了废弃 Agent，则标记为已改变

        # 处理所有需要注册的智能体
        shared_ws = pathlib.Path.home() / '.openclaw/workspace-shared-experts'
        shared_ws.mkdir(parents=True, exist_ok=True)

        for ag_meta in all_to_register:
            ag_id = ag_meta['id']
            
            # 专家 Agent 使用共享工作区进行协作与记忆，核心中枢保留独立隔离区
            if ag_id.startswith('agency_'):
                ws = shared_ws
            else:
                ws = pathlib.Path.home() / f'.openclaw/workspace-{ag_id}'
                ws.mkdir(parents=True, exist_ok=True)
            
            entry = {
                'id': ag_id, 
                'workspace': str(ws), 
                **{k:v for k,v in ag_meta.items() if k!='id'}
            }
            final_list.append(entry)
            registered_ids.add(ag_id)
            
            if ag_id not in existing_map:
                print(f"  + 注册新 Agent: {ag_id}")
                changed = True
            elif existing_map[ag_id] != entry:
                # 如果配置（如 subagents）发生变化
                changed = True

        # 保留用户可能手动添加且不属于我们管理范畴的智能体
        for old_ag in agents_list:
            if old_ag.get('id') not in registered_ids:
                final_list.append(old_ag)

        if changed or len(final_list) != len(agents_list):
            agents_cfg['list'] = final_list
            OPENCLAW_CFG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), 'utf-8')
            print(f"✅ openclaw.json 同步完成。当前集群规模: {len(final_list)} 个智能体。")
        else:
            print("ℹ️ 智能体集群配置已是最新，无需更新。")

    except Exception as e:
        log_error(f"动态注册智能体失败: {e}")

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
