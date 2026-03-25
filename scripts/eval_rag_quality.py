import os
import json
import asyncio
import logging
from typing import List, Dict, Any
from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_session_maker, AsyncSession

# 配置日志
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("rag_evaluator")

# 从环境变量获取配置
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://edict:edict_secret_change_me@localhost:5432/edict")
SILICONFLOW_API_KEY = os.getenv("SILICONFLOW_API_KEY")

client = AsyncOpenAI(api_key=SILICONFLOW_API_KEY, base_url="https://api.siliconflow.cn/v1")

class RAGEvaluator:
    """使用 LLM-as-a-Judge 对 RAG 效果进行量化评估。"""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def evaluate_sample(self, query: str, context: str, answer: str) -> Dict[str, Any]:
        """评估单个样本的 忠实度(Faithfulness) 和 相关性(Relevancy)。"""
        prompt = f"""你是一个严谨的 RAG 系统评测专家。请根据提供的检索上下文和回答，计算以下两个指标（0-10分）：

1. 忠实度 (Faithfulness): 回答是否完全基于上下文？是否有幻觉（即上下文未提及的信息）？
2. 相关性 (Relevancy): 回答是否精准解决了用户的问题？

输入：
[查询]: {query}
[检索上下文]: {context}
[回答]: {answer}

请仅输出 JSON 格式：
{{"relevancy_score": 0-10, "faithfulness_score": 0-10, "hallucination_detected": true/false, "reason": "..."}}
"""
        response = await client.chat.completions.create(
            model="THUDM/glm-4-9b-chat",
            messages=[{"role": "system", "content": "You are a professional evaluator."},
                      {"role": "user", "content": prompt}],
            temperature=0.1,
            response_format={"type": "json_object"}
        )
        return json.loads(response.choices[0].message.content)

    async def run_suite(self):
        """运行全量评估任务（从数据库读取待评测样本）。"""

        log.info("开始 RAG 质量闭环评估...")
        
        # 模拟样本数据 (实际应从 eval_samples 或日志中提取)
        # 这里为了演示闭环，假设我们已经有了一组测试数据
        test_samples = [
            {
                "query": "如何配置 Redis 缓存过期？",
                "context": "项目在 config.yaml 中定义了 REDIS_TTL=3600 用于控制缓存时效。",
                "answer": "可以在 config.yaml 中通过设置 REDIS_TTL 项来配置，默认建议值为 3600 秒。"
            }
        ]
        
        results = []
        for sample in test_samples:
            score = await self.evaluate_sample(sample['query'], sample['context'], sample['answer'])
            results.append(score)
            log.info(f"评估完成: {score}")

        # 计算总指标
        avg_faith = sum(r['faithfulness_score'] for r in results) / len(results)
        hallucination_rate = sum(1 for r in results if r['hallucination_detected']) / len(results)
        
        report = {
            "avg_faithfulness": avg_faith,
            "hallucination_rate": f"{hallucination_rate * 100}%",
            "status": "PASS" if hallucination_rate < 0.05 else "FAIL"
        }
        
        print("\n" + "="*50)
        print("🏛️  OpenClaw RAG 评估报告 (LLM-as-a-Judge)")
        print(f"平均忠实度: {report['avg_faithfulness']}/10")
        print(f"幻觉率(Hallucination Rate): {report['hallucination_rate']}")
        print(f"结论: {report['status']}")
        print("="*50)

# 脚本入口
if __name__ == "__main__":
    async def main():
        # 这里仅做逻辑演示，不实际连接数据库
        evaluator = RAGEvaluator(None)
        await evaluator.run_suite()
    
    asyncio.run(main())
