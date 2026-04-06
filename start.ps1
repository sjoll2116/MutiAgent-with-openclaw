$ErrorActionPreference = "Continue"

Write-Host "╔═════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     🚀 OpenClaw MAS 专家集群启动器  ║" -ForegroundColor Cyan
Write-Host "╚═════════════════════════════════════╝" -ForegroundColor Cyan

# 1. 唤醒并强制重启 Openclaw 底层网关
Write-Host "正在拉起本地大模型网关与代理路由..." -ForegroundColor Green
openclaw gateway restart

# 2. 启动看板 UI 后端服务
Write-Host "正在启动看板系统节点后端 (端口: 7891)..." -ForegroundColor Green
$serverJob = Start-Process python "dashboard\server.py" -PassThru -NoNewWindow
Start-Sleep -Seconds 2

# 3. 启动数据流循环器进程 (替代原版的 run_loop.sh)
Write-Host "正在监听 Redis 看板流转与状态更新总线..." -ForegroundColor Green
$syncJob = Start-Job -ScriptBlock {
    Set-Location $using:PWD
    while ($true) {
        python scripts\refresh_live_data.py
        Start-Sleep -Seconds 5
    }
}

Write-Host "=========================================" -ForegroundColor Magenta
Write-Host "全部引擎已就绪并启动！" -ForegroundColor Magenta
Write-Host "请打开浏览器访问: http://127.0.0.1:7891" -ForegroundColor Magenta
Write-Host "=========================================" -ForegroundColor Magenta
Write-Host "【提示】请保持这个控制台开启。如果你想关闭整个大集群，在此窗口按 Ctrl+C 即可安全退出。" -ForegroundColor Yellow

try {
    # 阻塞挂起避免脚本退出
    while ($true) {
        Start-Sleep -Seconds 1
    }
}
finally {
    Write-Host "`n检测到退出指令，正在终止所有守护进程与监听器..." -ForegroundColor Yellow
    Stop-Job $syncJob
    Remove-Job $syncJob
    if ($serverJob -ne $null -and !$serverJob.HasExited) {
        Stop-Process -Id $serverJob.Id -Force -ErrorAction SilentlyContinue
    }
    openclaw gateway stop
    Write-Host "集群已完全关闭，再见。" -ForegroundColor Green
}
