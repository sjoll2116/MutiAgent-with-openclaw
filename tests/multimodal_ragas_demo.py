import os
import asyncio
import logging
from PIL import Image

from dotenv import load_dotenv

# Ragas 相关导入
from ragas import evaluate, EvaluationDataset
from ragas.metrics import (
    Faithfulness,
    AnswerRelevance
)
# Ragas 高级功能：多模态支持 (实验性)
# 注意：多模态要求底座 llm 必须支持 vision
try:
    from ragas.metrics._multimodal_relevance import MultiModalRelevance
    from ragas.metrics._multimodal_faithfulness import MultiModalFaithfulness
    HAS_MM = True
except ImportError:
    HAS_MM = False
    
from langchain_openai import ChatOpenAI

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mm_ragas")

async def run_mm_evaluation():
    load_dotenv()
    api_key = os.getenv("SILICONFLOW_API_KEY")
    api_url = os.getenv("SILICONFLOW_API_URL", "https://api.siliconflow.cn/v1")
    
    if not api_key:
        logger.error("SILICONFLOW_API_KEY not found in .env")
        return

    # 1. 准备多模态大模型 (例如 Qwen-VL 或 GLM-4V)
    # Ragas 多模态评估强制要求 LLM 支持 image 输入
    mm_llm = ChatOpenAI(model="THUDM/glm-4v-9b", openai_api_key=api_key, openai_api_base=api_url)

    logger.info("Setting up Multi-modal Evaluation Dataset...")
    
    # 2. 准备数据集 (结合 Image)
    # 为演示，创建一个空白红图 (实际中您可以放入 Edict 架构图路径)
    test_img_path = "tests/test_architecture.png"
    if not os.path.exists(test_img_path):
        img_dir = os.path.dirname(test_img_path)
        if hasattr(os, "makedirs") and img_dir:
            os.makedirs(img_dir, exist_ok=True)
            
        img = Image.new('RGB', (100, 100), color = 'red')
        img.save(test_img_path)
        logger.info(f"Created a dummy image at {test_img_path}")

    # 数据格式：retrieved_contexts 可以包含 <image> 标签和额外的多模态元数据
    # 目前 Ragas 的多模态处于活跃开发期，不同版本 API 略有差异
    # 这里演示标准做法：把图片封装进去
    
    data_list = [
        {
            "user_input": "这张图片是什么颜色的方块？",
            "retrieved_contexts": [test_img_path, "这是一个颜色测试图案"], 
            "response": "这是一个红色的方块",
            "reference": "这是一个红色的方块"
        }
    ]
    
    eval_dataset = EvaluationDataset.from_list(data_list)
    
    if HAS_MM:
        logger.info("Initializing MM-Ragas metrics...")
        # 实际使用中可能需要适配 langchain-openai 与 Ragas-MM 接口的转换
        metrics = [MultiModalFaithfulness(), MultiModalRelevance()]
        
        try:
            logger.info("Starting MM Evaluation (This requires vision model support)...")
            results = evaluate(
                dataset=eval_dataset,
                metrics=metrics,
                llm=mm_llm
            )
            print(results)
        except Exception as e:
            logger.error(f"MM Evaluation API Error (Vision models often have strict format requirements): {e}")
    else:
        logger.warning(
            "Ragas MultiModal metrics not found in this version (0.4.3). \n"
            "This is expected as Ragas is migrating their MM APIs. \n"
            "Please use the e2e_rag_eval.py script which handles 'Transcribed MultiModal' evaluation via OCR Markdown."
        )

if __name__ == "__main__":
    asyncio.run(run_mm_evaluation())
