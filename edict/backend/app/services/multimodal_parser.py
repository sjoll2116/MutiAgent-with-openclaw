import os
import httpx
import logging
import base64
from typing import Optional

log = logging.getLogger("edict.multimodal_parser")

SILICONFLOW_API_KEY = os.getenv("SILICONFLOW_API_KEY")
SILICONFLOW_API_URL = os.getenv("SILICONFLOW_API_URL", "https://api.siliconflow.cn/v1")

class MultiModalParser:
    """多模态解析服务：负责将 PDF 和图片转换为文本。
    逻辑分流：
    - 常见扫描件、标准 PDF：PaddleOCR-VL-1.5 (快速、低成本)
    - 复杂图表、手写、学术报表：GLM-Z1-9B-0414 (高性能、逻辑理解)
    """

    def __init__(self):
        self.paddle_model = "PaddlePaddle/PaddleOCR-VL-1.5"
        self.glm_model = "THUDM/GLM-Z1-9B-0414"

    async def parse(self, file_bytes: bytes, filename: str) -> str:
        """解析文件内容。"""
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        
        if ext in ("pdf", "png", "jpg", "jpeg", "bmp", "tiff"):
            complexity = await self._assess_complexity(file_bytes, ext)
            if complexity == "complex":
                log.info(f"Complex file detected, using GLM: {filename}")
                return await self._parse_with_glm(file_bytes)
            else:
                log.info(f"Standard document detected, using Paddle: {filename}")
                return await self._parse_with_paddle(file_bytes)
        
        # 兜底：纯文本尝试解码
        try:
            return file_bytes.decode("utf-8")
        except UnicodeDecodeError:
            return file_bytes.decode("gbk", errors="ignore")

    async def _assess_complexity(self, file_bytes: bytes, ext: str) -> str:
        """复杂度评估逻辑：
        目前简单基于文件大小和扩展名：
        - 大于 5MB 的图片或 PDF 倾向于复杂。
        - 也可以根据页面采样或概率分布。
        """
        # 简单策略：仅作为示例演示逻辑分流
        if len(file_bytes) > 5 * 1024 * 1024:
            return "complex"
        return "simple"

    async def _call_vlm(self, model: str, prompt: str, image_b64: str) -> str:
        """通用的 VLM 调用逻辑。"""
        if not SILICONFLOW_API_KEY:
            return "错误：未发现 SILICONFLOW_API_KEY，无法解析多模态文件。"

        payload = {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}
                        }
                    ]
                }
            ],
            "temperature": 0.2
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{SILICONFLOW_API_URL}/chat/completions",
                    headers={"Authorization": f"Bearer {SILICONFLOW_API_KEY}"},
                    json=payload,
                    timeout=60.0
                )
                response.raise_for_status()
                data = response.json()
                return data["choices"][0]["message"]["content"]
        except Exception as e:
            log.error(f"VLM ({model}) call failed: {e}")
            return f"[解析失败: {e}]"

    async def _parse_with_paddle(self, file_bytes: bytes) -> str:
        """使用 PaddleOCR-VL 进行 OCR。"""
        b64 = base64.b64encode(file_bytes).decode("utf-8")
        prompt = "请识别并提取图中的所有文字内容，保持原始排版逻辑。"
        return await self._call_vlm(self.paddle_model, prompt, b64)

    async def _parse_with_glm(self, file_bytes: bytes) -> str:
        """使用 GLM-4.1V 进行深度解析。"""
        b64 = base64.b64encode(file_bytes).decode("utf-8")
        prompt = "请详细分析这张图/文档。如果是报表，请提取表格数据；如果是图表，请描述趋势和核心数值。"
        return await self._call_vlm(self.glm_model, prompt, b64)
