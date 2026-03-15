#!/usr/bin/env python3
"""
MAS 自动化评估引擎 (LLM-as-a-judge)
定期运行以评分 eval_samples 中的 RAG  accuracy 和 Agent thinking quality。
"""
import os
import json
import asyncio
import logging
from typing import List, Dict, Any
from datetime import datetime

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import select, update, and_

# 路径处理：将目录加入到导入路径中，以便使用 edict 下的模型
import sys
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if project_root not in sys.path:
    sys.path.append(project_root)

from edict.backend.app.models.document import EvalSample, EvalResult
from edict.backend.app.db import Base
from edict.backend.app.config import get_settings

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(name)s] %(message)s')
log = logging.getLogger("mas.evaluator")

# 配置
settings = get_settings()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
SILICONFLOW_API_KEY = os.getenv("SILICONFLOW_API_KEY")
SILICONFLOW_API_URL = os.getenv("SILICONFLOW_API_URL", "https://api.siliconflow.cn/v1")
JUDGE_MODEL = os.getenv("JUDGE_MODEL", "THUDM/GLM-Z1-9B-0414")
DATABASE_URL = settings.database_url

class MASEvaluator:
    def __init__(self, db_session: AsyncSession):
        self.db = db_session
        self.client = httpx.AsyncClient(timeout=60.0)

    async def _call_llm(self, prompt: str) -> str:
        """调用评委模型进行打分。"""
        if not SILICONFLOW_API_KEY:
            return "ERROR: API KEY NOT FOUND"
            
        try:
            response = await self.client.post(
                f"{SILICONFLOW_API_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {SILICONFLOW_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": JUDGE_MODEL,
                    "messages": [
                        {"role": "system", "content": "你是一个严谨的 AI 系统评估专家。请基于事实和给定准则，以 JSON 格式输出评分结果。输出格式：{\"score\": 0.8, \"reasoning\": \"...\"}"},
                        {"role": "user", "content": prompt}
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.1 # 提高一致性
                }
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]
        except Exception as e:
            log.error(f"LLM Judge call failed: {e}")
            return str(e)

    async def run_evaluation(self, limit: int = 50):
        """扫描并评估未评分的样本。"""
        # 查找还没有任何 EvalResult 的 EvalSample
        subquery = select(EvalResult.sample_id)
        query = select(EvalSample).where(~EvalSample.id.in_(subquery)).limit(limit)
        
        result = await self.db.execute(query)
        samples = result.scalars().all()
        
        log.info(f"Found {len(samples)} samples to evaluate.")
        
        for sample in samples:
            if sample.sample_type == "rag":
                await self.evaluate_rag(sample)
            elif sample.sample_type == "agent":
                await self.evaluate_agent(sample)
            
        await self.db.commit()

    async def evaluate_rag(self, sample: EvalSample):
        log.info(f"Evaluating RAG Sample {sample.id}...")
        
        # 1. Faithfulness (忠实度)
        faith_prompt = f"""
        请评估提供的【回答】是否完全基于给定的【背景信息】。
        
        【背景信息】:
        {sample.context}
        
        【问题】:
        {sample.query}
        
        【回答】:
        {sample.answer}
        
        若回答中包含背景信息之外的虚假事实，请根据严重程度扣分。如果回答完全基于背景，给 1.0。
        """
        
        # 2. Relevancy (相关性)
        rel_prompt = f"""
        请评估【回答】是否准确、直接地回答了【问题】。
        
        【问题】:
        {sample.query}
        
        【回答】:
        {sample.answer}
        
        即便回答是事实正确的，但如果不切题，也请扣分。
        """
        
        for metric, prompt in [("faithfulness", faith_prompt), ("relevance", rel_prompt)]:
            res_str = await self._call_llm(prompt)
            try:
                res_data = json.loads(res_str)
                result = EvalResult(
                    sample_id=sample.id,
                    metric_name=metric,
                    score=float(res_data.get("score", 0)),
                    reasoning=res_data.get("reasoning", ""),
                    judge_model=JUDGE_MODEL
                )
                self.db.add(result)
            except Exception as e:
                log.error(f"Parse result failed for RAG {sample.id} [{metric}]: {e}")

    async def evaluate_agent(self, sample: EvalSample):
        log.info(f"Evaluating Agent Sample {sample.id}...")
        
        # Thinking Coherence (条理性)
        coh_prompt = f"""
        评估 Agent 的思考链 (Traces) 是否条理清晰、因果逻辑严密。
        
        【任务目标】:
        {sample.query}
        
        【思考过程】:
        {sample.context}
        
        评价准则：
        1.0: 步骤严密，没有逻辑跳跃，能准确识别关键约束。
        0.5: 基本合理，但有冗余思考或轻微逻辑不协调。
        0.0: 语无伦次，重复，或与目标完全脱节。
        """
        
        res_str = await self._call_llm(coh_prompt)
        try:
            res_data = json.loads(res_str)
            result = EvalResult(
                sample_id=sample.id,
                metric_name="coherence",
                score=float(res_data.get("score", 0)),
                reasoning=res_data.get("reasoning", ""),
                judge_model=JUDGE_MODEL
            )
            self.db.add(result)
        except Exception as e:
            log.error(f"Parse result failed for Agent {sample.id}: {e}")

async def main():
    if not DATABASE_URL:
        print("DATABASE_URL not set.")
        return
        
    engine = create_async_engine(DATABASE_URL)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as session:
        evaluator = MASEvaluator(session)
        await evaluator.run_evaluation()

if __name__ == "__main__":
    asyncio.run(main())
