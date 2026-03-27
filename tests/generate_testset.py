"""
Ragas 0.2.x 测试集生成脚本
==========================
从数据库读取已入库的文档片段 (pre-chunked)，使用 Ragas TestsetGenerator
生成合成评估问答对，保存为 CSV 供后续 eval_runner.py 使用。

核心 API 说明 :
- generate_with_chunks(): 用于已经分片的数据
- generate_with_langchain_docs(): 用于原始完整文档 (Ragas 会自行切分)
- 两个方法都在内部自动完成: KG构建 -> Transforms -> Persona生成 -> 测试集生成
- 自定义 transforms 通过 transforms 参数直接传入即可
"""

import os
import sys
import asyncio
import json
import logging
from typing import List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from dotenv import load_dotenv

# 禁用 noisy 日志，确保进度条不被干扰
logging.getLogger("httpx").setLevel(logging.WARNING)

# ── Ragas 导入 (兼容 0.2.x 不同子版本的路径差异) ──────────────────────
try:
    # 核心生成器
    try:
        from ragas.testset.synthesizers.generate import TestsetGenerator
    except ImportError:
        try:
            from ragas.testset.generator import TestsetGenerator
        except ImportError:
            from ragas.testset import TestsetGenerator

    # Transforms
    from ragas.testset.transforms import (
        default_transforms,
        TitleExtractor,
        SummaryExtractor,
        EmbeddingExtractor,
    )

    # 模型封装类
    try:
        from ragas.llms import LangchainLLMWrapper
        from ragas.embeddings import LangchainEmbeddingsWrapper
    except ImportError:
        from ragas.llms.base import LangchainLLMWrapper
        from ragas.embeddings.base import LangchainEmbeddingsWrapper

except ImportError as e:
    print(f"Error: Could not import Ragas components: {e}")
    print("Please install: pip install ragas>=0.2.12")
    sys.exit(1)

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

    # ── 1. 初始化模型 ────────────────────────────────────────────────
    generator_llm = ChatOpenAI(
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

    # 封装为 Ragas 内部格式 (解决 'str' object has no attribute 'content' 等兼容问题)
    llm_wrapped = LangchainLLMWrapper(generator_llm)
    embeddings_wrapped = LangchainEmbeddingsWrapper(embeddings)

    # ── 2. 从数据库读取已入库的文档片段 ──────────────────────────────
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

        # ── 3. 初始化生成器并生成测试集 ──────────────────────────────
        generator = TestsetGenerator(
            llm=llm_wrapped,
            embedding_model=embeddings_wrapped,
        )

        # 诊断：打印当前环境下 TestsetGenerator 拥有的所有方法
        available_methods = [m for m in dir(generator) if 'generate' in m.lower()]
        logger.info(f"Ragas TestsetGenerator available methods: {available_methods}")

        # 定义自定义转换流程
        custom_transforms = [
            TitleExtractor(llm=llm_wrapped),
            SummaryExtractor(llm=llm_wrapped),
            EmbeddingExtractor(embedding_model=embeddings_wrapped, property_name="summary_embedding")
        ]

        logger.info(f"Generating {count} test samples (this may take a while)...")

        # 使用 generate_with_chunks: 专为已切分数据设计
        # 内部流程: 创建 KG(CHUNK节点) -> 应用 transforms -> 生成 persona -> 生成测试集
        # Ragas 源码: generate.py L334-L390
        testset = generator.generate_with_chunks(
            chunks=documents,
            testset_size=count,
            transforms=custom_transforms, # Explicitly pass custom transforms
            transforms_llm=llm_wrapped,
            transforms_embedding_model=embeddings_wrapped,
            raise_exceptions=True,
        )

        # ── 4. 保存结果 ─────────────────────────────────────────────
        output_file = "tests/synthetic_testset.csv"
        testset.to_pandas().to_csv(output_file, index=False)
        logger.info(f"Testset generated and saved to {output_file}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Generate synthetic RAG evaluation testset using Ragas")
    parser.add_argument("--count", type=int, default=5, help="Number of samples to generate")
    args = parser.parse_args()

    asyncio.run(generate_testset(count=args.count))
