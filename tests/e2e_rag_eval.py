import os
import asyncio
import logging
from typing import Dict, Any, List
import uuid

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from dotenv import load_dotenv

# Ragas 相关导入
from ragas import evaluate, EvaluationDataset
from ragas.metrics import (
    Faithfulness,
    ResponseRelevancy,
    ContextPrecision,
    ContextRecall
)
from langchain_openai import ChatOpenAI, OpenAIEmbeddings as LangchainOpenAIEmbeddings

# 导入项目模块
import sys
sys.path.append(os.path.join(os.getcwd(), "edict", "backend"))

import httpx

try:
    from app.config import get_settings
    from app.db import Base
    from app.services.rag_service import RAGService
except ImportError as e:
    print(f"Error importing project models: {e}")
    sys.exit(1)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("e2e_ragas")

# 模拟注入的文档 (模拟转码后的图片/表格 Markdown 和普通文本)
MOCK_DOC_CONTENT = """
# 系统架构与多模态解析指南

## 1. 营收数据图标分析 (模拟多模态 OCR 转码)
该图片显示了 2023 年至 2025 年度的核心营收。
| 年份 | 核心营收 (万美元) | 增长率 |
|---|---|---|
| 2023 | 500 | - |
| 2024 | 850 | 70% |
| 2025 | 1200 | 41% |
结论：增长主要来源于海外市场扩张，尤其是欧洲区域的爆发。

## 2. 核心架构说明
系统采用事件驱动架构。EventBus 是系统的核心枢纽，负责所有跨模块的消息分发。
组件间通过 Kafka 进行解耦。
"""

async def run_e2e_evaluation():
    load_dotenv()
    settings = get_settings()
    
    api_key = os.getenv("SILICONFLOW_API_KEY")
    api_url = os.getenv("SILICONFLOW_API_URL", "https://api.siliconflow.cn/v1")
    
    if not api_key:
        logger.error("SILICONFLOW_API_KEY not found in .env")
        return

    # 1. 数据库准备与依赖注入
    engine = create_async_engine(settings.database_url)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as session:
        async with httpx.AsyncClient() as http_client:
            rag_service = RAGService(db=session, http_client=http_client)
            
            # --- 步骤 1：自动灌入数据 (Data Ingestion) ---
            doc_id = str(uuid.uuid4())
            logger.info(f"Step 1: Ingesting mock multi-modal and text data (doc_id: {doc_id})...")
            # 强制注入数据库并走一遍向量化
            try:
                await rag_service.ingest_document(
                    doc_id=doc_id,
                    raw_text=MOCK_DOC_CONTENT,
                    metadata={"filename": "mock_architecture_data.md"},
                    is_temporary=True # 设为临时文件
                )
            except Exception as e:
                logger.error(f"Ingestion failed (maybe vectors offline?): {e}")
                return
                
            # --- 步骤 2：触发 RAG 流程 (Retrieval & Generation) ---
            # 设计提问与标准答案 (Ground Truth)
            # 提问 1 针对图片转码表格，提问 2 针对普通文本
            test_cases = [
                {
                    "question": "根据营收图表，2024年的核心营收是多少？增长原因是什么？",
                    "ground_truth": "2024年的核心营收是850万美元。增长主要来源于海外市场扩张，尤其是欧洲区域的爆发。"
                },
                {
                    "question": "系统架构的核心枢纽是什么组件？",
                    "ground_truth": "EventBus 是系统架构的核心枢纽，负责跨模块消息分发。"
                }
            ]
            
            data_list = []
            logger.info("Step 2: Triggering native RAG pipeline...")
            for tc in test_cases:
                # 调用项目原生的 RAG 检索和回答生成
                logger.info(f"Querying: {tc['question']}")
                res = await rag_service.answer_query(tc["question"], top_k=3)
                
                # 提取系统实际检索到的片段文本
                contexts = [chunk["content"] for chunk in res.get("sources", [])]
                
                data_list.append({
                    "user_input": tc["question"],
                    "retrieved_contexts": contexts,
                    "response": res.get("answer", "No answer generated"),
                    "reference": tc["ground_truth"]
                })
            
            # 删除刚才注入的临时文档，保持数据库干净
            logger.info("Cleaning up mock data...")
            await rag_service.delete_document(doc_id)
            
            # --- 步骤 3：RAGAS 评估 ---
            logger.info("Step 3: Running RAGAS Evaluation...")
            eval_dataset = EvaluationDataset.from_list(data_list)
            
            evaluator_llm = ChatOpenAI(model="THUDM/glm-4-9b-chat", openai_api_key=api_key, openai_api_base=api_url)
            evaluator_embeddings = LangchainOpenAIEmbeddings(model="BAAI/bge-m3", openai_api_key=api_key, openai_api_base=api_url)
            
            metrics = [Faithfulness(), ResponseRelevancy(), ContextPrecision(), ContextRecall()]
            
            # 执行评估
            results = evaluate(
                dataset=eval_dataset,
                metrics=metrics,
                llm=evaluator_llm,
                embeddings=evaluator_embeddings
            )
            
            print("\n" + "="*50)
            print("End-to-End RAGAS Evaluation Results:")
            print("="*50)
            print(results)
            print("\n注：如果 Context Recall 为 0，说明底层 BGE-m3 向量检索或 Rerank 没有把正确的片段找回来。")
            

if __name__ == "__main__":
    asyncio.run(run_e2e_evaluation())
