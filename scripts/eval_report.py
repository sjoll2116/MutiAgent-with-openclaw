#!/usr/bin/env python3
"""
MAS 评估结果汇总报告
展示 RAG 和 Agent 的各项质量指标统计。
"""
import os, sys
from sqlalchemy import select, func, create_async_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
import asyncio

# 路径处理
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if project_root not in sys.path:
    sys.path.append(project_root)

from edict.backend.app.models.document import EvalSample, EvalResult
from edict.backend.app.config import get_settings

async def show_report():
    settings = get_settings()
    engine = create_async_engine(settings.database_url)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as session:
        print("\n" + "="*50)
        print("📊 MAS 自动化评估报告".center(50))
        print("="*50)
        
        # 1. 总体统计
        res = await session.execute(select(func.count(EvalSample.id)))
        total_samples = res.scalar() or 0
        print(f"总样本数: {total_samples}")
        
        # 2. RAG 指标
        print("\n[ RAG 质量分析 ]")
        for metric in ["faithfulness", "relevance"]:
            query = select(func.avg(EvalResult.score)).where(EvalResult.metric_name == metric)
            res = await session.execute(query)
            avg_score = res.scalar()
            if avg_score is not None:
                print(f"  - 平均 {metric.capitalize()}: {avg_score:.2f}")
            else:
                print(f"  - {metric.capitalize()}: 暂无评分")

        # 3. Agent 指标
        print("\n[ Agent 思考质量分析 ]")
        query = select(func.avg(EvalResult.score)).where(EvalResult.metric_name == "coherence")
        res = await session.execute(query)
        avg_score = res.scalar()
        if avg_score is not None:
            print(f"  - 平均 Coherence (连贯性): {avg_score:.2f}")
        else:
            print(f"  - Coherence: 暂无评分")
            
        # 4. 最近的差评案例 (Score < 0.6)
        print("\n[ 需关注的低分案例 ]")
        query = (
            select(EvalSample.id, EvalSample.query, EvalResult.metric_name, EvalResult.score, EvalResult.reasoning)
            .join(EvalResult, EvalSample.id == EvalResult.sample_id)
            .where(EvalResult.score < 0.6)
            .order_by(EvalResult.created_at.desc())
            .limit(3)
        )
        res = await session.execute(query)
        bad_cases = res.all()
        for row in bad_cases:
            print(f"  ID:{row.id} | {row.metric_name}: {row.score:.1f}")
            print(f"  问题: {row.query[:40]}...")
            print(f"  理由: {row.reasoning[:60]}...")
            print("-" * 30)

    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(show_report())
