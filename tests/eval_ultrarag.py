import os
import asyncio
import logging
import pandas as pd
from datasets import load_dataset
from ragas import evaluate, EvaluationDataset
from ragas.metrics import (
    Faithfulness,
    AnswerRelevance,
    ContextPrecision,
    ContextRecall
)
from langchain_openai import ChatOpenAI, OpenAIEmbeddings as LangchainOpenAIEmbeddings
from dotenv import load_dotenv

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ultrarag_eval")

async def run_ultrarag_eval(count: int = 20):
    load_dotenv()
    
    # 硅基流动模型配置
    api_key = os.getenv("SILICONFLOW_API_KEY")
    api_url = os.getenv("SILICONFLOW_API_URL", "https://api.siliconflow.cn/v1")
    
    if not api_key:
        logger.error("SILICONFLOW_API_KEY not found in .env")
        return

    # 初始化评估器
    evaluator_llm = ChatOpenAI(model="THUDM/glm-4-9b-chat", openai_api_key=api_key, openai_api_base=api_url)
    evaluator_embeddings = LangchainOpenAIEmbeddings(model="BAAI/bge-m3", openai_api_key=api_key, openai_api_base=api_url)

    # 1. 从 Hugging Face 获取 UltraRAG 数据集
    # UltraRAG 分为验证集和测试集，包含 question, contexts, answer 等
    logger.info(f"Loading UltraRAG dataset (streaming, size={count})...")
    # 注意：流式加载防止内存溢出，take(count) 取前 N 条
    dataset_raw = load_dataset("openbmb/UltraRAG", split="validation", streaming=True).take(count)

    # 2. 转换为 Ragas 格式
    logger.info("Converting UltraRAG to Ragas format...")
    data_list = []
    for item in dataset_raw:
        data_list.append({
            "user_input": item["question"],
            "retrieved_contexts": item["contexts"],  # UltraRAG 数据集已内置参考上下文
            "response": item.get("model_answer", item["answer"]), # 若无模型答案，默认用标准答案进行 Faithfulness 测试
            "reference": item["answer"]
        })

    eval_dataset = EvaluationDataset.from_list(data_list)

    # 3. 执行评估
    logger.info(f"Starting evaluation on {len(data_list)} samples...")
    metrics = [Faithfulness(), AnswerRelevance(), ContextPrecision(), ContextRecall()]
    
    results = evaluate(
        dataset=eval_dataset,
        metrics=metrics,
        llm=evaluator_llm,
        embeddings=evaluator_embeddings
    )

    # 4. 结果展示
    print("\n" + "="*50)
    print("UltraRAG Benchmark Results:")
    print("="*50)
    print(results)
    
    # 保存结果到 CSV
    output_path = "tests/ultrarag_results.csv"
    results.to_pandas().to_csv(output_path, index=False)
    logger.info(f"Detailed results saved to {output_path}")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=10, help="Number of samples to test")
    args = parser.parse_args()
    
    asyncio.run(run_ultrarag_eval(count=args.count))
