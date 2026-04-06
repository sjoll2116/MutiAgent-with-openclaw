#!/bin/bash
set -e

# NOTE: install.sh is retained for compatibility, but its internal logic 
# has been migrated to scripts/setup_mas.py to ensure consistency 
# with the latest project architecture.

echo -e "\033[0;32m正在启动 OpenClaw MAS 统一安装向导...\033[0m"

if command -v python3 &> /dev/null; then
    python3 scripts/setup_mas.py "$@"
elif command -v python &> /dev/null; then
    python scripts/setup_mas.py "$@"
else
    echo -e "\033[0;31m❌ 错误: 找不到 Python 环境。\033[0m"
    exit 1
fi
v/null || npm install
    npm run build 2>/dev/null
    cd "$REPO_DIR"
    if [ -f "$REPO_DIR/dashboard/dist/index.html" ]; then
      log "前端构建完成: dashboard/dist/"
    else
      warn "前端构建可能失败，请手动检查"
    fi
  else
    warn "未找到 edict/frontend/package.json，跳过前端构建"
  fi
}

# ── Step 5: 首次数据同步 ────────────────────────────────────
first_sync() {
  info "执行首次数据同步..."
  cd "$REPO_DIR"
  
  REPO_DIR="$REPO_DIR" python3 scripts/sync_agent_config.py || warn "sync_agent_config 有警告"
  python3 scripts/refresh_live_data.py || warn "refresh_live_data 有警告"
  
  log "首次同步完成"
}

# ── Step 6: 重启 Gateway ────────────────────────────────────
restart_gateway() {
  info "重启 OpenClaw Gateway..."
  if openclaw gateway restart 2>/dev/null; then
    log "Gateway 重启成功"
  else
    warn "Gateway 重启失败，请手动重启：openclaw gateway restart"
  fi
}

# ── Main ────────────────────────────────────────────────────
banner
check_deps
backup_existing
create_workspaces
register_agents
init_data
build_frontend
first_sync
restart_gateway

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  🎉  OpenClaw MAS 安装完成！                     ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo "下一步："
echo "  1. 启动数据刷新循环:  bash scripts/run_loop.sh &"
echo "  2. 启动看板服务器:    python3 dashboard/server.py"
echo "  3. 打开看板:          http://127.0.0.1:7891"
echo ""
info "文档: docs/getting-started.md"
