#!/bin/bash
echo -e "\033[0;36m╔═════════════════════════════════════╗\033[0m"
echo -e "\033[0;36m║     🚀 OpenClaw MAS 集群启动器      ║\033[0m"
echo -e "\033[0;36m╚═════════════════════════════════════╝\033[0m"

echo -e "\033[0;32m正在拉起本地大模型网关与代理路由...\033[0m"
openclaw gateway restart

echo -e "\033[0;32m正在启动看板系统节点后端 (端口: 7891)...\033[0m"
python3 dashboard/server.py &
SERVER_PID=$!
sleep 2

echo -e "\033[0;32m正在监听 Redis 看板流转与状态更新总线...\033[0m"
if [ -f "scripts/run_loop.sh" ]; then
    bash scripts/run_loop.sh &
    SYNC_PID=$!
else
    while true; do
        python3 scripts/refresh_live_data.py
        sleep 5
    done &
    SYNC_PID=$!
fi

echo -e "\033[0;35m=========================================\033[0m"
echo -e "\033[0;35m全部引擎已就绪并启动！\033[0m"
echo -e "\033[0;35m请打开浏览器访问: http://127.0.0.1:7891\033[0m"
echo -e "\033[0;35m=========================================\033[0m"
echo -e "\033[0;33m【提示】按 Ctrl+C 即可安全关闭整个大集群。\033[0m"

# 优雅关闭逻辑
trap "echo -e '\n\033[0;33m接收到退出信号，正在终止所有后台进程...\033[0m'; kill $SERVER_PID $SYNC_PID 2>/dev/null; openclaw gateway stop; echo -e '\033[0;32m集群已安全关闭。\033[0m'; exit 0" SIGINT SIGTERM

# 阻塞主线程以保持后台进程存活
wait
