import os
# 禁用 Ragas 官方遥测
os.environ["RAGAS_DO_NOT_TRACK"] = "true"

import asyncio
import json
import logging
import pandas as pd
from typing import List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from dotenv import load_dotenv
import sys
import httpx
import nest_asyncio

load_dotenv()
nest_asyncio.apply()
from ragas import evaluate, EvaluationDataset
from ragas.metrics import (
    Faithfulness,
    LLMContextPrecisionWithoutReference, 
    LLMContextRecall                     
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


# 配置日志 (过滤掉底层的向量打印和请求刷屏)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("eval_runner")

# 屏蔽底层网络请求库的刷屏日志
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("openai").setLevel(logging.WARNING)
logging.getLogger("langchain_core").setLevel(logging.WARNING)

async def run_and_evaluate(csv_path: str = "tests/synthetic_testset.csv", limit: int = 10):
    """读取测试集，跑完 RAG 流程，最后给出打分结果。"""
    
    # --- 环境准备 ---
    settings = get_settings()
    
    # 硅基流动配置 (专用于 Embedding)
    sf_api_key = os.getenv("SILICONFLOW_API_KEY")
    sf_api_url = os.getenv("SILICONFLOW_API_URL", "https://api.siliconflow.cn/v1")
    
    # DeepSeek 官方配置 (专用于 Ragas 评测 LLM)
    ds_api_key = os.getenv("DEEPSEEK_API_KEY")
    ds_api_url = "https://api.deepseek.com/v1"
    
    if not sf_api_key:
        logger.error("SILICONFLOW_API_KEY not found in .env (Required for Embedding)")
        return
        
    if not ds_api_key:
        logger.error("DEEPSEEK_API_KEY not found in .env (Required for Evaluation LLM)")
        return

    if not os.path.exists(csv_path):
        logger.error(f"Testset file not found: {csv_path}. Please run generate_testset.py first.")
        return

    # 加载测试集
    df_test = pd.read_csv(csv_path).head(limit)
    logger.info(f"Loaded {len(df_test)} test samples from {csv_path}")

    # --- 初始化 RAG 服务与评估器 ---
    engine = create_async_engine(settings.db_url)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    # 评测器 LLM: 使用 DeepSeek 官方 API 
    evaluator_llm = ChatOpenAI(
        model="deepseek-chat", 
        openai_api_key=ds_api_key, 
        openai_api_base=ds_api_url,
        temperature=0.0,
        timeout=300,
        max_retries=3
    )

    # 评测器 Embeddings
    evaluator_embeddings = LangchainOpenAIEmbeddings(
        model="BAAI/bge-m3", 
        openai_api_key=sf_api_key, 
        openai_api_base=sf_api_url,
    )

    data_list = []

    async with async_session() as session:
        async with httpx.AsyncClient() as http_client:
            service = RAGService(session, http_client=http_client)
            
            logger.info("Starting RAG Batch Processing...")
            for i, row in df_test.iterrows():
                query = row.get("question") or row.get("user_input")
                ground_truth = row.get("ground_truth") or row.get("reference")
                
                if not query:
                    logger.error(f"Row {i} is missing 'question'. Available columns: {list(df_test.columns)}")
                    continue

                logger.info(f"[{i+1}/{len(df_test)}] Processing Query: {str(query)[:50]}...")
                
                # 执行完整的 RAG 流程
                res = await service.answer_query(query, top_k=5)
                
                # 提取检索到的上下文
                contexts = [c["content"] for c in res.get("sources", [])]
                
                # Ragas 0.4.3 规范：必须使用新版字段名
                data_list.append({
                    "user_input": query,
                    "retrieved_contexts": contexts,
                    "response": res.get("answer", ""),
                    "reference": ground_truth
                })

    # --- Ragas 评估 ---
    logger.info("Running Ragas Metrics Calculation...")
    dataset = EvaluationDataset.from_list(data_list)
    
    # 实例化指标类 (已移除 AnswerRelevancy 避免 DeepSeek 报错)
    metrics = [
        Faithfulness(), 
        LLMContextPrecisionWithoutReference(), 
        LLMContextRecall()
    ]

    results = evaluate(
        dataset=dataset,
        metrics=metrics,
        llm=evaluator_llm,
        embeddings=evaluator_embeddings,
    )
    
    # --- 输出与保存 ---
    print("\n" + "="*50)
    print("🚀 OpenClaw RAG 综合评估报告")
    print("="*50)
    # 直接打印总体分数，避免打印整个对象导致刷屏
    if hasattr(results, 'scores'):
        print(results.scores)
    else:
        print(results)
    print("="*50)
    
    # 转为 DataFrame
    df_results = results.to_pandas()
    
    # 过滤掉包含向量的列 (清理 CSV 数据)
    cols_to_drop = [col for col in df_results.columns if "embedding" in col.lower() or "vector" in col.lower()]
    if cols_to_drop:
        df_results = df_results.drop(columns=cols_to_drop)
    
    # 保存结果到 CSV 为离线查看
    output_report = "tests/eval_report_final.csv"
    os.makedirs(os.path.dirname(output_report), exist_ok=True)
    df_results.to_csv(output_report, index=False, encoding='utf-8-sig')
    logger.info(f"Detailed clean report saved to {output_report}")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", default="tests/synthetic_testset.csv", help="Path to testset CSV")
    parser.add_argument("--limit", type=int, default=10, help="Number of samples to run")
    args = parser.parse_args()
    
    asyncio.run(run_and_evaluate(csv_path=args.csv, limit=args.limit))