"""
Ragas 0.4.3 测试集生成脚本
==========================
从数据库读取已入库的文档片段 (pre-chunked)，使用 Ragas TestsetGenerator
生成合成评估问答对，保存为 CSV 供后续 eval_runner.py 使用。

核心 API (基于 Ragas 0.4.3 源码验证):
- TestsetGenerator.from_langchain(llm, embedding_model): 自动封装 Langchain 模型
- generate_with_chunks(chunks, testset_size, ...): 专用于已分片数据
- default_transforms_for_prechunked(llm, embedding_model): 官方预分片转换流水线
"""

import os
import sys
import asyncio
import json
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from dotenv import load_dotenv

# 禁用 noisy 日志，确保进度条不被干扰
logging.getLogger("httpx").setLevel(logging.WARNING)

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

    api_key = os.getenv("SILICONFLOW_API_KEY")
    api_url = os.getenv("SILICONFLOW_API_URL", "https://api.siliconflow.cn/v1")

    from langchain_openai import ChatOpenAI, OpenAIEmbeddings as LangchainOpenAIEmbeddings

    # ── 1. 初始化 Langchain 模型 (无需手动包装) ──────────────────────
    llm = ChatOpenAI(
        model="Pro/deepseek-ai/DeepSeek-V3.2",
        openai_api_key=api_key,
        openai_api_base=api_url,
        max_tokens=2048,
        temperature=0.3,
    )
    embeddings = LangchainOpenAIEmbeddings(
        model="BAAI/bge-m3",
        openai_api_key=api_key,
        openai_api_base=api_url,
    )

    # ── 2. 使用 from_langchain 初始化生成器 (0.4.3 推荐方式) ─────────
    # 内部会自动调用 LangchainLLMWrapper / LangchainEmbeddingsWrapper
    generator = TestsetGenerator.from_langchain(
        llm=llm,
        embedding_model=embeddings,
    )

    # ── 3. 从数据库读取已入库的文档片段 ──────────────────────────────
    engine = create_async_engine(settings.db_url)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        logger.info("Fetching document chunks for knowledge base...")
        query = select(DocumentChunk).limit(100)
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

        # generate_with_chunks: 专为已切分数据设计 (0.4.3 原生方法)
        # 内部流程:
        #   1. 将 chunks 转为 Node(type=CHUNK)
        #   2. 创建 KnowledgeGraph
        #   3. 应用 default_transforms_for_prechunked (含 ThemesExtractor, NERExtractor 等)
        #   4. 自动生成 Persona
        #   5. 生成 Scenarios -> 生成 Samples -> 返回 Testset
        testset = generator.generate_with_chunks(
            chunks=documents,
            testset_size=count,
            raise_exceptions=True,
        )

        # ── 5. 保存结果 ─────────────────────────────────────────────
        output_file = "tests/synthetic_testset.csv"
        testset.to_pandas().to_csv(output_file, index=False)
        logger.info(f"Testset generated and saved to {output_file}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Generate synthetic RAG evaluation testset using Ragas 0.4.3")
    parser.add_argument("--count", type=int, default=5, help="Number of samples to generate")
    args = parser.parse_args()

    asyncio.run(generate_testset(count=args.count))
