import os
import asyncio
import json
import logging
import pandas as pd
from typing import List, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from dotenv import load_dotenv

# Ragas 相关导入
from ragas import evaluate, EvaluationDataset
from ragas.metrics import (
    Faithfulness,
    AnswerRelevance,
    ContextPrecision,
    ContextRecall
)

# 导入项目模型
import sys
# 将 edict/backend 添加到路径以导入模型
sys.path.append(os.path.join(os.getcwd(), "edict", "backend"))

try:
    from app.models.document import EvalSample, EvalResult
    from app.config import get_settings
except ImportError as e:
    print(f"Error importing project models: {e}")
    sys.exit(1)

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ragas_eval")

async def run_evaluation(limit: int = 10):
    # 1. 加载配置和设置环境
    load_dotenv()
    settings = get_settings()
    
    # 硅基流动模型配置
    api_key = os.getenv("SILICONFLOW_API_KEY")
    api_url = os.getenv("SILICONFLOW_API_URL", "https://api.siliconflow.cn/v1")
    
    if not api_key:
        logger.error("SILICONFLOW_API_KEY not found in .env")
        return

    # 初始化 Ragas 评估器 (使用 OpenAI 兼容接口)
    # Ragas 使用自己的 llm 包装
    from langchain_openai import ChatOpenAI, OpenAIEmbeddings as LangchainOpenAIEmbeddings
    
    # 注意：GLM-4 在 Ragas 中可能需要特定的适配，这里使用标准的 OpenAI 兼容方式
    evaluator_llm = ChatOpenAI(
        model="THUDM/glm-4-9b-chat",
        openai_api_key=api_key,
        openai_api_base=api_url,
    )
    evaluator_embeddings = LangchainOpenAIEmbeddings(
        model="BAAI/bge-m3",
        openai_api_key=api_key,
        openai_api_base=api_url,
    )

    # 2. 数据库连接
    engine = create_async_engine(settings.database_url)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        # 3. 提取样本
        logger.info(f"Fetching up to {limit} samples from eval_samples...")
        query = select(EvalSample).where(EvalSample.sample_type == "rag").order_by(EvalSample.created_at.desc()).limit(limit)
        result = await session.execute(query)
        samples = result.scalars().all()

        if not samples:
            logger.warning("No RAG samples found in the database. Please run RAG queries first to populate eval_samples.")
            return

        # 4. 准备 Ragas 数据集
        data_list = []
        for s in samples:
            context_list = s.context.split("\n\n============\n\n")
            meta = json.loads(s.metadata_json) if s.metadata_json else {}
            data_list.append({
                "user_input": s.query,
                "retrieved_contexts": context_list,
                "response": s.answer,
                "reference": meta.get("ground_truth", "")
            })

        dataset = EvaluationDataset.from_list(data_list)

        # 5. 执行评估
        logger.info("Starting Ragas evaluation...")
        
        # 初始化指标实例，并绑定 LLM
        # 在 Ragas 0.4.x 中，evaluate 会自动注入 llm/embeddings 到指标中
        metrics = [Faithfulness(), AnswerRelevance()]
        
        # 如果有 ground_truth，增加检索指标
        if any(d["reference"] for d in data_list):
            metrics.extend([ContextPrecision(), ContextRecall()])
        
        # 将 LLM 和 Embeddings 传入 evaluate
        results = evaluate(
            dataset=dataset,
            metrics=metrics,
            llm=evaluator_llm,
            embeddings=evaluator_embeddings
        )

        logger.info("Evaluation complete!")
        print(results)

        # 6. 将结果存回数据库
        df = results.to_pandas()
        for i, row in df.iterrows():
            sample_id = samples[i].id
            for metric in metrics:
                metric_name = metric.name
                score = row.get(metric_name)
                
                if score is not None:
                    # Ragas 现在在 row 中可能不直接提供 reasoning，除非配置了
                    eval_res = EvalResult(
                        sample_id=sample_id,
                        metric_name=metric_name,
                        score=float(score),
                        reasoning=f"Ragas automated evaluation using {evaluator_llm.model_name}",
                        judge_model=evaluator_llm.model_name
                    )
                    session.add(eval_res)
        
        await session.commit()
        logger.info("Results saved to eval_results table.")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=10, help="Max samples to evaluate")
    args = parser.parse_args()
    
    asyncio.run(run_evaluation(limit=args.limit))
