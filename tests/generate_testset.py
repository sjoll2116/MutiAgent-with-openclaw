import os
import asyncio
import json
import logging
from typing import List
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from dotenv import load_dotenv

# Ragas 相关导入
from ragas.testset import TestsetGenerator
from ragas.testset.evolutions import simple, reasoning, multi_context

# 导入项目模型
import sys
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
    load_dotenv()
    settings = get_settings()
    
    api_key = os.getenv("SILICONFLOW_API_KEY")
    api_url = os.getenv("SILICONFLOW_API_URL", "https://api.siliconflow.cn/v1")

    from langchain_openai import ChatOpenAI, OpenAIEmbeddings as LangchainOpenAIEmbeddings
    
    generator_llm = ChatOpenAI(model="THUDM/glm-4-9b-chat", openai_api_key=api_key, openai_api_base=api_url)
    critic_llm = ChatOpenAI(model="THUDM/glm-4-9b-chat", openai_api_key=api_key, openai_api_base=api_url)
    embeddings = LangchainOpenAIEmbeddings(model="BAAI/bge-m3", openai_api_key=api_key, openai_api_base=api_url)

    # 1. 从数据库读取文档片段作为知识源
    engine = create_async_engine(settings.database_url)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        logger.info("Fetching document chunks for knowledge base...")
        query = select(DocumentChunk).limit(100) # 取前 100 个片段作为源
        res = await session.execute(query)
        chunks = res.scalars().all()
        
        if not chunks:
            logger.error("No document chunks found. Please ingest some documents first.")
            return

        # 转换为 Langchain Document 对象供 Ragas 使用
        from langchain_core.documents import Document
        documents = [
            Document(page_content=c.content, metadata=json.loads(c.metadata_json) if c.metadata_json else {})
            for c in chunks
        ]

        # 2. 初始化生成器
        generator = TestsetGenerator.from_langchain(
            generator_llm,
            critic_llm,
            embeddings
        )

        # 3. 生成测试集
        logger.info(f"Generating {count} test samples (this may take a while)...")
        # 概率分布：简单题、推理题、多上下文题
        distributions = {
            simple: 0.5,
            reasoning: 0.25,
            multi_context: 0.25
        }
        
        testset = generator.generate_with_langchain_docs(documents, test_size=count, distributions=distributions)
        
        # 4. 保存为 CSV 或 JSON
        output_file = "tests/synthetic_testset.csv"
        testset.to_pandas().to_csv(output_file, index=False)
        logger.info(f"Testset generated and saved to {output_file}")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=5, help="Number of samples to generate")
    args = parser.parse_args()
    
    asyncio.run(generate_testset(count=args.count))
