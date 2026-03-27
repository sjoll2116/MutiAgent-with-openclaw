import os
import asyncio
import json
import logging
from typing import List
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from dotenv import load_dotenv

# 禁用 noisy 日志，确保进度条不被干扰
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("ragas").setLevel(logging.WARNING)



try:
    # 尝试 0.2.x 标准路径
    try:
        from ragas.testset.generator import TestsetGenerator
    except ImportError:
        from ragas.testset import TestsetGenerator
        
    try:
        from ragas.testset.transforms import TitleExtractor, SummaryExtractor, EmbeddingExtractor
        from ragas.testset.graph import KnowledgeGraph, Node
        from ragas.testset.persona import generate_personas_from_kg
        # 导入封装类以解决 'str' object has no attribute 'content' 报错问题
        from ragas.llms import LangchainLLMWrapper
        from ragas.embeddings import LangchainEmbeddingsWrapper
    except ImportError:
        # 0.2.12 某些环境可能直接从 .testset 导出
        from ragas.testset import TitleExtractor, SummaryExtractor, EmbeddingExtractor
        from ragas.testset import KnowledgeGraph, Node
        from ragas.testset.persona import generate_personas_from_kg
        # 0.2.12 兼容性导入
        from ragas.llms.base import LangchainLLMWrapper
        from ragas.embeddings.base import LangchainEmbeddingsWrapper
        
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
    
    generator_llm = ChatOpenAI(
        model="Pro/deepseek-ai/DeepSeek-V3.2", 
        openai_api_key=api_key, 
        openai_api_base=api_url,
        max_tokens=2048,
        temperature=0.3
    )
    embeddings = LangchainOpenAIEmbeddings(model="BAAI/bge-m3", openai_api_key=api_key, openai_api_base=api_url)

    # 封装模型以适配 Ragas 0.2.x
    generator_llm_wrapped = LangchainLLMWrapper(generator_llm)
    embeddings_wrapped = LangchainEmbeddingsWrapper(embeddings)

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

        # 2. 初始化 Ragas 生成器
        generator = TestsetGenerator(
            llm=generator_llm_wrapped,
            embedding_model=embeddings_wrapped
        )

        # 3. 手动构建知识图谱并应用转换
        logger.info("Building Knowledge Graph and applying transforms...")
        kg = KnowledgeGraph.from_langchain_documents(documents)
        
        # 定义自定义转换流程，避开报错的 HeadlineSplitter
        custom_transforms = [
            TitleExtractor(llm=generator_llm_wrapped),
            SummaryExtractor(llm=generator_llm_wrapped),
            EmbeddingExtractor(embedding_model=embeddings_wrapped, property_name="summary_embedding")
        ]
        
        # 应用转换 (这一步构建丰富的上下文关系)
        kg.apply_transforms(custom_transforms)
        
        # 4. 手动生成人物画像 (Persona)
        # 这是解决 KeyError: 'personas' 的关键，确保人物画像正确生成并关联到 KG
        logger.info("Generating personas from Knowledge Graph...")
        persona_list = generate_personas_from_kg(
            kg, 
            generator_llm_wrapped, 
            embeddings_wrapped, 
            persona_size=3
        )
        
        # 5. 执行测试集生成
        # 直接使用已经构建并丰富好的 KG
        logger.info(f"Generating {count} test samples from enriched KG...")
        
        # 注入生成的画像列表到生成器中
        generator.persona_list = persona_list
        
        testset = generator.generate(
            knowledge_graph=kg,
            testset_size=count
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
