import os
import asyncio
import json
import logging
import pandas as pd
from typing import List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from dotenv import load_dotenv
import sys
import httpx

# Ragas 相关导入
from ragas import evaluate, EvaluationDataset
from ragas.metrics import (
    Faithfulness,
    AnswerRelevance,
    ContextPrecision,
    ContextRecall
)
from langchain_openai import ChatOpenAI, OpenAIEmbeddings as LangchainOpenAIEmbeddings

# 导入项目模块
sys.path.append(os.path.join(os.getcwd(), "edict", "backend"))

try:
    from app.config import get_settings
    from app.services.rag_service import RAGService
    from app.models.document import EvalResult
except ImportError as e:
    print(f"Error importing project models: {e}")
    sys.exit(1)

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("eval_runner")

async def run_and_evaluate(csv_path: str = "tests/synthetic_testset.csv", limit: int = 10):
    """读取测试集，跑完 RAG 流程，最后给出打分结果。"""
    
    # 1. 环境准备
    load_dotenv()
    settings = get_settings()
    api_key = os.getenv("SILICONFLOW_API_KEY")
    api_url = os.getenv("SILICONFLOW_API_URL", "https://api.siliconflow.cn/v1")
    
    if not api_key:
        logger.error("SILICONFLOW_API_KEY not found in .env")
        return

    if not os.path.exists(csv_path):
        logger.error(f"Testset file not found: {csv_path}. Please run generate_testset.py first.")
        return

    # 加载测试集
    df_test = pd.read_csv(csv_path).head(limit)
    logger.info(f"Loaded {len(df_test)} test samples from {csv_path}")

    # 2. 初始化 RAG 服务与评估器
    engine = create_async_engine(settings.database_url)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    # 评估器模型 (使用 0.4.3 稳健配置: JSON Mode + Timeout)
    evaluator_llm = ChatOpenAI(
        model="Pro/deepseek-ai/DeepSeek-V3.2", 
        openai_api_key=api_key, 
        openai_api_base=api_url,
        temperature=0.0,
        model_kwargs={"response_format": {"type": "json_object"}},
        timeout=120
    )
    evaluator_embeddings = LangchainOpenAIEmbeddings(
        model="BAAI/bge-m3", 
        openai_api_key=api_key, 
        openai_api_base=api_url,
    )

    data_list = []

    async with async_session() as session:
        async with httpx.AsyncClient() as http_client:
            service = RAGService(session, http_client=http_client)
            
            logger.info("Starting RAG Batch Processing...")
            for i, row in df_test.iterrows():
                query = row["question"]
                ground_truth = row["ground_truth"]
                
                logger.info(f"[{i+1}/{len(df_test)}] Processing Query: {query[:50]}...")
                
                # 执行完整的 RAG 流程
                res = await service.answer_query(query, top_k=5)
                
                # 提取检索到的上下文
                contexts = [c["content"] for c in res.get("sources", [])]
                
                # 使用 Ragas 0.4.3 默认列名
                data_list.append({
                    "question": query,
                    "contexts": contexts,
                    "answer": res.get("answer", ""),
                    "ground_truth": ground_truth
                })

    # 3. Ragas 评估
    logger.info("Running Ragas Metrics Calculation...")
    dataset = EvaluationDataset.from_list(data_list)
    
    metrics = [
        Faithfulness(), 
        AnswerRelevance(), 
        ContextPrecision(), 
        ContextRecall()
    ]
    
    # 0.4.3 evaluate 现在直接接收 llm 和 embeddings
    results = evaluate(
        dataset=dataset,
        metrics=metrics,
        llm=evaluator_llm,
        embeddings=evaluator_embeddings,
    )
    
    # 4. 输出与保存
    print("\n" + "="*50)
    print("🚀 OpenClaw RAG 综合评估报告")
    print("="*50)
    print(results)
    print("="*50)
    
    # 保存结果到 CSV 为离线查看
    output_report = "tests/eval_report_final.csv"
    results.to_pandas().to_csv(output_report, index=False)
    logger.info(f"Detailed report saved to {output_report}")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", default="tests/synthetic_testset.csv", help="Path to testset CSV")
    parser.add_argument("--limit", type=int, default=10, help="Number of samples to run")
    args = parser.parse_args()
    
    asyncio.run(run_and_evaluate(csv_path=args.csv, limit=args.limit))
