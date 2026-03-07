# 🤝 参与贡献

我们欢迎任何形式的贡献，无论是修复文档错误、优化代码还是提交新的功能建议。

## 📋 提交指南

1. **Bug 诊断**：提交 Issue 请附带环境信息（WSL2 版本、OpenClaw 版本）及可复现的日志。
2. **Pull Request**：
   - 所有的代码修改应确保通过本地测试。
   - Go 代码请运行 `go fmt`。
   - Python 代码建议遵循 PEP 8 规范。
3. **Commit 信息**：推荐使用 Conventional Commits 规范（如 `feat:`, `fix:`, `refactor:`）。

## 🤖 扩展 Agent 角色

如果你想为集群添加新的专职 Agent：
1. 在 `agents/` 下创建新目录并编写 `SOUL.md`。
2. 在 `install.sh` 的 `AGENTS` 列表中注册该 ID。
3. 更新权限矩阵以确保该 Agent 与 `dispatcher` 的通信链路闭环。

---
感谢参与构建更强大的 OpenClaw 生态。
