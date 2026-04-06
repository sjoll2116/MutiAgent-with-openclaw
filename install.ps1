$ErrorActionPreference = "Stop"
Write-Host "╔═════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     🏛️  OpenClaw MAS 环境初始化部署 ║" -ForegroundColor Cyan
Write-Host "╚═════════════════════════════════════╝" -ForegroundColor Cyan

# 0. 检查前置环境
if (!(Get-Command openclaw -ErrorAction SilentlyContinue)) {
    Write-Host "❌ 找不到 openclaw 命令，请先安装 OpenClaw 底层引擎" -ForegroundColor Red
    exit 1
}
if (!(Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "❌ 找不到 python 命令，请确认 Python 是否已加入环境变量" -ForegroundColor Red
    exit 1
}

# 1. 初始化数据目录结构
Write-Host "`n==> [1/4] 初始化数据看板目录结构..." -ForegroundColor Green
$dataDir = ".\data"
if (!(Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
"{}" | Out-File "$dataDir\live_status.json" -Encoding utf8
"{}" | Out-File "$dataDir\agent_config.json" -Encoding utf8
"{}" | Out-File "$dataDir\model_change_log.json" -Encoding utf8
"[]" | Out-File "$dataDir\pending_model_changes.json" -Encoding utf8

# 2. 注入核心引擎配置 (openclaw.json)
Write-Host "==> [2/4] 向 Openclaw 基础环境注册核心管理集群(Planner/Reviewer/Dispatcher)" -ForegroundColor Green
$pySetupCfg = @"
import json, pathlib
cfg_path = pathlib.Path.home() / '.openclaw' / 'openclaw.json'
if not cfg_path.exists():
    print("⚠️ 未找到底座 openclaw.json，跳过核心集群注册")
    exit(0)
cfg = json.loads(cfg_path.read_text('utf-8'))
agents_cfg = cfg.setdefault('agents', {})
agents_list = agents_cfg.setdefault('list', [])
existing_ids = {a['id'] for a in agents_list}

AGENTS = [
    {"id": "coordinator", "subagents": {"allowAgents": ["planner"]}},
    {"id": "planner",     "subagents": {"allowAgents": ["reviewer", "dispatcher"]}},
    {"id": "reviewer",    "subagents": {"allowAgents": ["dispatcher", "planner"]}},
    {"id": "dispatcher",  "subagents": {"allowAgents": ["planner", "reviewer", "hr_manager"]}},
    {"id": "hr_manager",  "subagents": {"allowAgents": ["dispatcher"]}},
]
changed = False
for ag in AGENTS:
    if ag['id'] not in existing_ids:
        ws = str(pathlib.Path.home() / f'.openclaw/workspace-{ag["id"]}')
        agents_list.append({'id': ag['id'], 'workspace': ws, **{k:v for k,v in ag.items() if k!='id'}})
        changed = True

if changed:
    cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), 'utf-8')
    print('✅ openclaw.json 基础管理集群配置注册/刷新成功')
"@
Set-Content "scripts\init_core_agents.py" $pySetupCfg -Encoding utf8
python scripts\init_core_agents.py

# 3. 运行 28大极领域专家转换与装载
Write-Host "==> [3/4] 编译领域专家，挂载看版协议并推入 Dispatcher 路由系统..." -ForegroundColor Green
python scripts\utils\compile_agency_agents.py
python scripts\sync_agent_config.py

# 4. 后台依赖安装
Write-Host "==> [4/4] 检查依赖与 Python Packages" -ForegroundColor Green
if (Test-Path "requirements.txt") {
    python -m pip install -r requirements.txt -q
    Write-Host "✅ Python 依赖安装完成" -ForegroundColor Green
}

Write-Host "`n🎉 全部 28极专家配置与本地代理网关底层架构部署已完成！" -ForegroundColor Cyan
Write-Host "==========================="
Write-Host "现在你只需直接双击运行 start.ps1 或者在终端输入 ./start.ps1 即可工作！" -ForegroundColor Yellow
