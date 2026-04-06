# 技能：知识库检索 (RAG)

## 描述
使用此技能从 OpenClaw 知识库中提取与当前任务相关的背景信息、历史记录、API 文档或技术指标。

## 触发场景
- **需求分析**：当收到模糊的任务指令，需要查找历史方案或需求文档时。
- **技术决策**：需要确认现有系统的 API 定义、数据库 Schema 或架构规范时。
- **纠错过程**：当收到错误信息（`EDICT_LAST_ERROR`），需要查找相关模块的实现参考或最佳实践时。

## 使用工具
`python3 agents/tools/search_knowledge.py "<query>" [--top_k K]`

### 参数说明
- `<query>`: **关键提示**。查询语句应尽可能具体。例如，不要只搜 "API"，而应搜索 "用户鉴权 API 定义"。
- `--top_k`: (可选) 返回的相关片段数量，默认为 5。

## 最佳实践
1. **HyDE 自动增强**：该工具已内置 HyDE (Hypothetical Document Embeddings) 技术。这意味着它可以根据你的问题生成一段“伪答案”，再用该答案去检索真实文档，极大提升了语义匹配度。
2. **多轮检索**：如果第一轮检索结果不满意，尝试从不同角度描述你的问题，单次检索仅描述一个方面。
3. **结合阅读内容**：检索到 Source ID 后，如果需要查阅物理原件，可以询问任务调度引擎获取文件路径。

## 示例
```bash
# 查找 RAG 服务的实现逻辑
python3 agents/tools/search_knowledge.py "OpenClaw RAG service implementation details and 3-way routing logic"

# 查找关于 MinerU 解析器的配置
python3 agents/tools/search_knowledge.py "MinerU parser configuration and API endpoint" --top_k 3
```
