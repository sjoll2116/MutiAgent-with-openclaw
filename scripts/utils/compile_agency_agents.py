import os
import yaml
import re

# 目录探测
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AGENCY_AGENTS_DIR = os.path.join(BASE_DIR, "agency-agents")
OUTPUT_AGENTS_DIR = os.path.join(BASE_DIR, "agents")
SKILLS_DIR = os.path.join(BASE_DIR, "skills", "dispatch")

# 目标文件名单
TARGET_AGENTS = {
    "engineering": [
        "engineering-frontend-developer.md",
        "engineering-senior-developer.md",
        "engineering-rapid-prototyper.md",
        "engineering-ai-engineer.md",
        "engineering-database-optimizer.md",
        "engineering-code-reviewer.md",
        "engineering-software-architect.md",
        "engineering-devops-automator.md",
        "engineering-sre.md",
        "engineering-data-engineer.md",
        "engineering-technical-writer.md",
        "engineering-security-engineer.md"
    ],
    "testing": [
        "testing-api-tester.md",
        "testing-performance-benchmarker.md",
        "testing-workflow-optimizer.md",
        "testing-tool-evaluator.md"
    ],
    "product": [
        "product-manager.md",
        "product-trend-researcher.md",
        "product-feedback-synthesizer.md",
        "product-behavioral-nudge-engine.md"
    ],
    "academic": [
        "academic-anthropologist.md",
        "academic-geographer.md",
        "academic-historian.md",
        "academic-narratologist.md",
        "academic-psychologist.md",
        "academic-study-planner.md"
    ],
    "marketing": [
        "marketing-content-creator.md",
        "marketing-social-media-strategist.md"
    ]
}

# MAS 核心规则后缀
MAS_CORE_PROTOCOL = """
---

## 🛠 MAS Core Protocol: 任务执行与看板流转限制（极其重要）
你的身份已被接入 Openclaw MAS（Multi-Agent System）框架。无论你的专业是什么，在这个系统中，你必须通过 `kanban_update.py` CLI 命令与流转总线（Redis）交互。

### 1. 接任务与自我纠错 (Context & Error Recovery)
- 第一时间执行 `read` 命令获取任务上下文：
  `python3 scripts/kanban_update.py read MAS-xxx`
- 若遇到报错或被 Reviewer 打回，系统会自动唤醒你进入纠错轮次。并在环境变量中注入 `EDICT_LAST_ERROR`。如果有此报错变量，你必须在回答中指明你正在修复它。

### 2. 标准化看板动作（必须用 CLI）
**接取子任务时**：立刻执行 (替换 MAS-xxx)
`python3 scripts/kanban_update.py state MAS-xxx Doing "开始执行任务"`
`python3 scripts/kanban_update.py flow MAS-xxx "{name}" "{name}" "▶️ 开始执行"`

**完成子任务时**：立刻执行
`python3 scripts/kanban_update.py flow MAS-xxx "{name}" "任务调度引擎" "✅ 完成：[产物摘要]"`

**遇到阻塞**：立刻执行
`python3 scripts/kanban_update.py state MAS-xxx Blocked "[阻塞原因]"`
`python3 scripts/kanban_update.py flow MAS-xxx "{name}" "任务调度引擎" "🚫 阻塞请求协助"`

**汇报产出节点**：每完成一个小节点，立刻上报成果以便展示给用户
`python3 scripts/kanban_update.py todo MAS-xxx <todo_id> "<title>" completed --detail "<产出详情>"`

### 3. 实时进度上报 (Progress Tracking)
> 🚨 在每完成一项思考、环境检查或代码编写后，必须用 progress 向用户展示动态！
`python3 scripts/kanban_update.py progress MAS-xxx "正在做XX" "分析✅|执行🔄|验证|完成汇总"`

当你成功产出成果并完成 `flow` 移交回"任务调度引擎"后，请直接结束对话，等待系统下一次唤醒。
"""

def parse_markdown(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 解析 YAML frontmatter
    meta = {}
    if content.startswith('---'):
        parts = content.split('---', 2)
        if len(parts) >= 3:
            try:
                meta = yaml.safe_load(parts[1])
                content = parts[2].strip()
            except yaml.YAMLError:
                pass
    
    # 提取 name
    name = meta.get('name', 'Unknown')
    description = meta.get('description', '')
    
    return name, description, content

def main():
    if not os.path.exists(AGENCY_AGENTS_DIR):
        print(f"ℹ️ [信息] 找不到源码目录 '{AGENCY_AGENTS_DIR}'。跳过领域专家编译逻辑。")
        return

    os.makedirs(OUTPUT_AGENTS_DIR, exist_ok=True)

    catalog_lines = [
        "# Agent 注册表 (Dispatch Catalog)",
        "你是任务调度引擎 `dispatcher`，下面是系统中所有目前活跃的专家列表。不要猜测，请完全参考以下列表进行 `todo` 派发：",
        "",
        "| 部门 | Agent ID | 智能体名称 | 职责定位摘要 |",
        "|------|----------|------------|--------------|"
    ]

    count = 0
    for department, files in TARGET_AGENTS.items():
        for filename in files:
            source_path = os.path.join(AGENCY_AGENTS_DIR, department, filename)
            if not os.path.exists(source_path):
                print(f"[警告] 找不到文件: {source_path}")
                continue
            
            name, desc, body = parse_markdown(source_path)
            
            # 生成 ID (如 engineering-frontend-developer 去掉 .md，转下划线以防冲突)
            agent_id = f"agency_{filename.replace('.md', '').replace('-', '_')}"
            
            # 创建目标目录
            agent_dir = os.path.join(OUTPUT_AGENTS_DIR, agent_id)
            os.makedirs(agent_dir, exist_ok=True)
            
            # 组装 SOUL.md
            soul_content = f"# {name} · 执行节点\n\n{body}\n\n"
            soul_content += MAS_CORE_PROTOCOL.format(name=name)
            
            with open(os.path.join(agent_dir, 'SOUL.md'), 'w', encoding='utf-8') as f:
                f.write(soul_content)
                
            # 写入 Catalog
            # 缩短 desc 防止撑爆表格
            short_desc = desc.replace('\n', ' ')
            if len(short_desc) > 80:
                short_desc = short_desc[:77] + '...'
                
            catalog_lines.append(f"| {department} | {agent_id} | {name} | {short_desc} |")
            count += 1
            print(f"[成功] 转换: {name} ({agent_id})")

    # 写入 SKILL.md
    skill_content = "\n".join(catalog_lines)
    with open(os.path.join(SKILLS_DIR, 'SKILL.md'), 'w', encoding='utf-8') as f:
        f.write(skill_content)
    
    print(f"\n✅ 成功编译 {count} 个智能体！总调度目录已写入 {SKILLS_DIR}\\SKILL.md")

if __name__ == "__main__":
    main()
