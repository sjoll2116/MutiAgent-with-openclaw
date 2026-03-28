"""
Ragas 0.4.3 测试集生成脚本
==========================
从数据库读取已入库的文档片段 (pre-chunked)，使用 Ragas TestsetGenerator
生成合成评估问答对，保存为 CSV 供后续 eval_runner.py 使用。
"""

import os
import sys
import asyncio
import json
import logging

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from dotenv import load_dotenv

# 禁用 noisy 日志，确保进度条不被干扰
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

# ── Ragas 0.4.3 导入 ─────────────────────────────────────────────────
from ragas.testset.synthesizers.generate import TestsetGenerator
from ragas.testset.transforms import default_transforms_for_prechunked

# ── 项目模型导入 ─────────────────────────────────────────────────────
sys.path.append(os.path.join(os.getcwd(), "edict", "backend"))

try:
    from app.models.document import DocumentChunk
    from app.config import get_settings
except ImportError as e:
    print(f"Error importing project models: {e}")
    sys.exit(1)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("generate_testset")


async def generate_testset(count: int = 5):
    """主生成流程"""
    load_dotenv()
    settings = get_settings()

    # 硅基流动配置 (专用于 Embedding)
    sf_api_key = os.getenv("SILICONFLOW_API_KEY")
    sf_api_url = os.getenv("SILICONFLOW_API_URL", "https://api.siliconflow.cn/v1")
    
    # DeepSeek 官方配置 (专用于 生成摘要和问题，完美支持 Tool Calling)
    ds_api_key = os.getenv("DEEPSEEK_API_KEY")
    ds_api_url = "https://api.deepseek.com/v1"

    if not sf_api_key or not ds_api_key:
        logger.error("Please ensure both SILICONFLOW_API_KEY and DEEPSEEK_API_KEY are set in .env")
        return

    from langchain_openai import ChatOpenAI, OpenAIEmbeddings

    # ── 1. 初始化 Langchain 模型 (移除强制 JSON 模式，改用官方 DeepSeek) ──
    llm = ChatOpenAI(
        model="deepseek-chat", # 使用官方 API
        openai_api_key=ds_api_key,
        openai_api_base=ds_api_url,
        max_tokens=None,
        temperature=0.0,
        timeout=120,
        max_retries=3
    )
    
    embeddings = OpenAIEmbeddings(
        model="BAAI/bge-m3",
        openai_api_key=sf_api_key,
        openai_api_base=sf_api_url,
    )

    # ── 2. 使用 from_langchain 初始化生成器 ─────────
    generator = TestsetGenerator.from_langchain(
        llm=llm,
        embedding_model=embeddings,
    )

    # ── 3. 从数据库读取已入库的文档片段 ──────────────────────────────
    engine = create_async_engine(settings.db_url)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        # 你可以适当提高采样量，比如随机抽取 80-100 个
        logger.info("Fetching document chunks for knowledge base...")
        query = select(DocumentChunk).order_by(func.random()).limit(100)
        res = await session.execute(query)
        chunks = res.scalars().all()

        if not chunks:
            logger.error("No document chunks found. Please ingest some documents first.")
            return

        # 转换为 Langchain Document 对象
        from langchain_core.documents import Document
        documents = [
            Document(
                page_content=c.content,
                metadata=json.loads(c.metadata_json) if c.metadata_json else {},
            )
            for c in chunks
        ]
        logger.info(f"Loaded {len(documents)} chunks from database.")

        # ── 4. 生成测试集 ────────────────────────────────────────────
        logger.info(f"Generating {count} test samples (this may take a while)...")

        testset = generator.generate_with_chunks(
            chunks=documents,
            testset_size=count,
            raise_exceptions=True,
        )

        # ── 5. 保存结果 ─────────────────────────────────────────────
        output_file = "tests/synthetic_testset.csv"
        os.makedirs(os.path.dirname(output_file), exist_ok=True)
        testset.to_pandas().to_csv(output_file, index=False, encoding='utf-8-sig')
        logger.info(f"Testset generated and saved to {output_file}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Generate synthetic RAG evaluation testset using Ragas 0.4.3")
    parser.add_argument("--count", type=int, default=5, help="Number of samples to generate")
    args = parser.parse_args()

    asyncio.run(generate_testset(count=args.count))