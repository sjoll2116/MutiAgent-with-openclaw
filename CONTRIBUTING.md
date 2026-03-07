


### 💡 功能建议

使用 [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) 模板。


### 🔧 提交 Pull Request

```bash
# 1. Fork 本仓库
# 2. 克隆你的 Fork
git clone https://github.com/<your-username>/edict.git
cd edict

# 3. 创建功能分支
git checkout -b feat/my-awesome-feature

# 4. 开发 & 测试
python3 dashboard/server.py  # 启动看板验证

# 5. 提交
git add .
git commit -m "feat: 添加了一个很酷的功能"

# 6. 推送 & 创建 PR
git push origin feat/my-awesome-feature
```

---

## 🏗️ 开发环境

### 前置条件
- [OpenClaw](https://openclaw.ai) 已安装
- Python 3.9+
- macOS / Linux

### 本地启动

```bash
# 安装
./install.sh

# 构建前端（首次或前端代码变更后）
cd edict/frontend && npm install && npm run build && cd ../..

# 启动数据刷新（后台运行）
bash scripts/run_loop.sh &

# 启动看板服务器
python3 dashboard/server.py

# 打开浏览器
open http://127.0.0.1:7891
```

> 💡 **前端开发模式**：`cd edict/frontend && npm run dev` → http://localhost:5173（热重载，自动代理 API 到 7891）

### 项目结构速览

| 目录/文件 | 说明 | 改动频率 |
|----------|------|---------|
| `edict/frontend/src/components/` | 看板前端组件（React 18 + TypeScript） | 🔥 高 |
| `edict/frontend/src/index.css` | CSS 样式（CSS 变量主题） | 🔥 高 |
| `dashboard/server.py` | API 服务器（stdlib，~2200 行） | 🔥 高 |
| `agents/*/SOUL.md` | 12 个 Agent 人格模板 | 🔶 中 |
| `scripts/kanban_update.py` | 看板 CLI + 数据清洗（~300 行） | 🔶 中 |
| `scripts/*.py` | 数据同步 / 自动化脚本 | 🔶 中 |
| `tests/test_e2e_kanban.py` | E2E 看板测试（17 断言） | 🔶 中 |
| `install.sh` | 安装脚本 | 🟢 低 |

---





---

## 🧪 测试

```bash
# 编译检查
python3 -m py_compile dashboard/server.py
python3 -m py_compile scripts/kanban_update.py

# 前端类型检查 + 构建
cd edict/frontend && npx tsc -b && npm run build && cd ../..

# E2E 看板测试（9 场景 17 断言）
python3 tests/test_e2e_kanban.py

# 验证数据同步
python3 scripts/refresh_live_data.py
python3 scripts/sync_agent_config.py

# 启动服务器验证 API
python3 dashboard/server.py &
curl -s http://localhost:7891/api/live-status | python3 -m json.tool | head -20
```

用 `-`，代码块标注语言

