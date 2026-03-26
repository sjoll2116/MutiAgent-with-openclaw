import os
import asyncio
import json
import logging
from typing import List
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from dotenv import load_dotenv


try:
    # 尝试 0.2.x 标准路径
    try:
        from ragas.testset.generator import TestsetGenerator
    except ImportError:
        from ragas.testset import TestsetGenerator
        
    try:
        from ragas.testset.transforms import TitleExtractor, SummaryExtractor, EmbeddingExtractor
    except ImportError:
        # 0.2.12 某些环境可能直接从 .testset 导出
        from ragas.testset import TitleExtractor, SummaryExtractor, EmbeddingExtractor
        
except ImportError as e:
    print(f"Error: Could not import Ragas components: {e}")
    sys.exit(1)



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
    
    generator_llm = ChatOpenAI(model="Qwen/Qwen3.5-397B-A17B", openai_api_key=api_key, openai_api_base=api_url)
    critic_llm = ChatOpenAI(model="Pro/deepseek-ai/DeepSeek-V3.2", openai_api_key=api_key, openai_api_base=api_url)
    embeddings = LangchainOpenAIEmbeddings(model="BAAI/bge-m3", openai_api_key=api_key, openai_api_base=api_url)

    # 1. 从数据库读取文档片段作为知识源
    engine = create_async_engine(settings.db_url)
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
        
        # 定义自定义转换流程，避开报错的 HeadlineSplitter
        # 注意：在 0.2.x 中可以通过 transforms 参数自定义知识图谱的构建过程
        # 为了支持 Persona 生成，必须包含 summary_embedding
        custom_transforms = [
            TitleExtractor(llm=generator_llm),
            SummaryExtractor(llm=generator_llm),
            EmbeddingExtractor(embedding_model=embeddings, property_name="summary_embedding")
        ]

        
        # 兼容 0.2.x 版本的新逻辑 (注意参数名为 testset_size)
        testset = generator.generate_with_langchain_docs(
            documents, 
            testset_size=count,
            transforms=custom_transforms
        )
        
        
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
