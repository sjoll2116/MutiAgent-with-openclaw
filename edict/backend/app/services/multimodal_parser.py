import os
import httpx
import logging
import base64
import io
import tempfile
from typing import Optional

log = logging.getLogger("edict.multimodal_parser")

SILICONFLOW_API_KEY = os.getenv("SILICONFLOW_API_KEY")
SILICONFLOW_API_URL = os.getenv("SILICONFLOW_API_URL", "https://api.siliconflow.cn/v1")

class MultiModalParser:
    """多模态解析服务：负责将文档(PDF/Excel)和图片(JPG/PNG)转换为 Markdown 文本。
    逻辑分流：
    - PDF：优先使用 PyMuPDF4LLM 提取原生 Markdown。
    - Excel/CSV：使用 pandas 提取 Markdown。
    - 纯图片/极其复杂的图表：使用 GLM-Z1-9B-0414 进行视觉解析。
    """

    def __init__(self):
        # 注意：THUDM/GLM-Z1-9B-0414 主要用于 Reason/Code，视觉解析建议用专门的 VLM
        self.glm_model = "THUDM/GLM-4.1V-9B-Thinking" 

    async def parse(self, file_bytes: bytes, filename: str) -> str:
        """解析文件内容为 Markdown 字符串。"""
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        
        if ext == "pdf":
            return await self._parse_with_pymupdf4llm(file_bytes)
            
        elif ext in ("xlsx", "xls", "csv"):
            return await self._parse_with_pandas(file_bytes, ext)
            
        elif ext == "docx":
            return await self._parse_with_docx(file_bytes)
            
        elif ext in ("png", "jpg", "jpeg", "bmp", "tiff"):
            mime_type = f"image/{ext}" if ext != "jpg" else "image/jpeg"
            prompt = """
                # Role: 多模态数据提取专家
                # Task: 分析并提取上传图片的所有关键信息。
                # Constraints:
                1. 识别与分类：首先判断图片属于（纯文字文档、数据图表、自然实景、还是技术架构图）。
                2. 视觉描述：简述图片主体内容、场景。
                3. 文字识别：若有文字，必须按原排版输出 Markdown 格式，严禁漏字、错字。
                4. 数据提取：若含图表/表格，请将其转化为 Markdown 表格，并提取核心趋势或异常数值。
                5. 逻辑结构：使用清晰的分级标题组织输出。
            """
            return await self._parse_with_glm(file_bytes, prompt, mime_type)
        
        # 兜底：纯文本尝试解码
        try:
            return file_bytes.decode("utf-8")
        except UnicodeDecodeError:
            return file_bytes.decode("gbk", errors="ignore")

    async def _parse_with_pymupdf4llm(self, file_bytes: bytes) -> str:
        """使用 PyMuPDF4LLM 提取 PDF，并自动识别/处理扫描件。"""
        try:
            import fitz
            import pymupdf4llm
            doc = fitz.Document(stream=file_bytes, filetype="pdf")
            
            # --- 阶段 1: 尝试原生导出 ---
            md_text = pymupdf4llm.to_markdown(doc)
            
            # --- 阶段 2: 扫描件检测与 VLM 补偿 ---
            # 判研逻辑：如果提取文本极少且页数大于 0，或者文本包含大量乱码/占位符，执行视觉补偿
            if len(md_text.strip()) < 100 * doc.page_count and doc.page_count > 0:
                log.info(f"Detecting potential scanned PDF ({doc.page_count} pages). Falling back to VLM.")
                vlm_results = []
                # 限制最大 OCR 页数，避免 API 费用失控
                max_pages = min(doc.page_count, 10)
                
                for i in range(max_pages):
                    page = doc.load_page(i)
                    # 将页面渲染为高清图片 (Matrix(2,2) 表示 144 DPI)
                    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
                    img_bytes = pix.tobytes("jpg")
                    
                    prompt = f"这是文档的第 {i+1} 页。请准确提取所有文字、表格和图表内容，并以 Markdown 格式输出。如果是表格，请保持排版。"
                    page_text = await self._parse_with_glm(img_bytes, prompt, "image/jpeg")
                    vlm_results.append(f"## Page {i+1}\n\n{page_text}")
                
                return "\n\n".join(vlm_results)
                
            return md_text
        except ImportError:
            log.error("pymupdf4llm or fitz is not installed.")
            return "[解析失败: pymupdf4llm/fitz 依赖缺失]"
        except Exception as e:
            log.error(f"PyMuPDF4LLM fallback parsing error: {e}")
            return f"[PDF解析失败: {e}]"

    async def _parse_with_pandas(self, file_bytes: bytes, ext: str) -> str:
        """使用 pandas 提取表格为 Markdown。"""
        try:
            import pandas as pd
            if ext == "csv":
                df = pd.read_csv(io.BytesIO(file_bytes))
            else:
                df = pd.read_excel(io.BytesIO(file_bytes))
            return df.to_markdown(index=False)
        except ImportError:
             log.error("pandas or tabulate is not installed.")
             return "[解析失败: pandas 依赖缺失]"
        except Exception as e:
            log.error(f"Pandas parsing error: {e}")
            return f"[表格解析失败: {e}]"

    async def _parse_with_docx(self, file_bytes: bytes) -> str:
        """使用 python-docx 提取 Word 文档内容，按顺序保留段落和表格。"""
        try:
            from docx import Document
            from docx.table import Table
            from docx.text.paragraph import Paragraph
            
            doc = Document(io.BytesIO(file_bytes))
            md_sections = []
            
            from docx.oxml.table import CT_Tbl
            from docx.oxml.text.paragraph import CT_P

            for child in doc.element.body:
                if isinstance(child, CT_P):
                    para = Paragraph(child, doc)
                    text = para.text.strip()
                    if text:
                        # 尝试映射标题
                        style = para.style.name if para.style else ""
                        if "Heading" in style:
                            level_match = [s for s in style if s.isdigit()]
                            level = int(level_match[0]) if level_match else 1
                            md_sections.append(f"{'#' * level} {text}")
                        else:
                            md_sections.append(text)
                elif isinstance(child, CT_Tbl):
                    table = Table(child, doc)
                    table_md = []
                    for i, row in enumerate(table.rows):
                        cells = [cell.text.strip().replace("\n", " ") for cell in row.cells]
                        table_md.append("| " + " | ".join(cells) + " |")
                        if i == 0:
                            table_md.append("| " + " | ".join(["---"] * len(cells)) + " |")
                    md_sections.append("\n".join(table_md))
            
            # 兜底：如果上述遍历落空，使用标准遍历
            if not md_sections:
                for para in doc.paragraphs:
                    if para.text.strip():
                        md_sections.append(para.text.strip())
            
            return "\n\n".join(md_sections)
            
        except ImportError:
            log.error("python-docx is not installed.")
            return "[解析失败: python-docx 依赖缺失]"
        except Exception as e:
            log.error(f"Docx parsing error: {e}")
            return f"[Word解析失败: {e}]"

    async def _call_vlm(self, model: str, prompt: str, image_b64: str, mime_type: str = "image/jpeg") -> str:
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
                            "image_url": {"url": f"data:{mime_type};base64,{image_b64}"}
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
            return f"[视觉提取失败: {e}]"
        return ""


    async def _parse_with_glm(self, file_bytes: bytes, prompt: str, mime_type: str = "image/jpeg") -> str:
        """使用 GLM 进行视觉深度解析。"""
        b64 = base64.b64encode(file_bytes).decode("utf-8")
        return await self._call_vlm(self.glm_model, prompt, b64, mime_type)
