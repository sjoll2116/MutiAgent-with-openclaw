import os
import asyncio
import httpx
import json
import time
from typing import Dict, Any

# 配置
API_BASE = "http://localhost:8000/api/rag"
TOKEN = "0a7f3132c662cd8327e190f3f77681c689ca2ede7de8756f"
HEADERS = {"X-Service-Token": TOKEN}

# 测试数据
TEST_DOC_CONTENT = """
# Edict RAG 架构说明

## 系统概述
Edict 是一个工业级的多模态 RAG 系统，旨在提供精准的知识检索。

## 核心组件
1. **Multimodal Parser**: 支持 PDF, Word, Excel 和图片解析。
2. **Hybrid Search**: 结合向量搜索与全文检索。
3. **Parent-Child Indexing**: 采用 1024/256 的双层切片策略。

## 部署要求
默认使用 PostgreSQL 16 配合 pgvector 扩展。建议配合 Redis 作为消息总线。
"""

async def run_test():
    print("🔔 开始 RAG 全流程自动化测试...")
    
    # 模拟一个临时文件
    temp_file = "rag_test_sample.md"
    with open(temp_file, "w", encoding="utf-8") as f:
        f.write(TEST_DOC_CONTENT)
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        # 1. 上传测试文档
        print("\n1️⃣  正在上传测试文档...")
        with open(temp_file, "rb") as f:
            files = {"file": (temp_file, f)}
            data = {"project_id": "test_suite", "is_temporary": "false"}
            res = await client.post(f"{API_BASE}/ingest-file", files=files, data=data, headers=HEADERS)
            res.raise_for_status()
            doc_id = res.json().get("doc_id")
            print(f"✅ 上传成功! Doc ID: {doc_id}")
        
        # 2. 等待异步处理完成 (向量化通常需要 3-10 秒)
        print("\n2️⃣  等待向量化处理 (10秒)...")
        await asyncio.sleep(10)
        
        # 3. 验证切片是否生成 (通过搜索验证)
        print("\n3️⃣  验证切片检索功能...")
        search_payload = {"query": "Edict 的双层切片策略是什么？", "top_k": 3}
        res = await client.post(f"{API_BASE}/search", json=search_payload, headers=HEADERS)
        res.raise_for_status()
        chunks = res.json()
        if chunks:
            print(f"✅ 检索成功! 找到 {len(chunks)} 个相关片段。")
            for i, c in enumerate(chunks):
                print(f"   [{i+1}] Score: {c['score']:.4f} | Content: {c['content'][:50]}...")
        else:
            print("❌ 未找到任何片段。请检查后端日志或 API Key。")
            return

        # 4. 验证 RAG 问答合成
        print("\n4️⃣  测试 RAG 闭环合成回答...")
        ask_payload = {"query": "请总结 Edict 的部署要求和核心组件。", "top_k": 5}
        res = await client.post(f"{API_BASE}/ask", json=ask_payload, headers=HEADERS)
        res.raise_for_status()
        answer = res.json().get("answer")
        print("\n🏛️  RAG 回答如下：")
        print("-" * 50)
        print(answer)
        print("-" * 50)
        
    # 清理
    if os.path.exists(temp_file):
        os.remove(temp_file)
    print("\n🏁 测试完成！")

if __name__ == "__main__":
    try:
        asyncio.run(run_test())
    except Exception as e:
        print(f"\n❌ 测试中断: {e}")
        print("💡 提示：请确保后端服务 (uvicorn) 已在 localhost:8000 启动。")
