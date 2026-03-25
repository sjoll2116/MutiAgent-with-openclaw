import re
import logging
from cleantext import clean

log = logging.getLogger("edict.cleaning_service")

class AdvancedCleaningService:
    """生产级高级数据清洗服务，负责标准化、去噪、语法修复及跨页缝合。"""

    @staticmethod
    def normalize_text(text: str) -> str:
        """1. 深度规范化：去除零宽字符，统一 Unicode 编码，清理乱码。"""
        try:
            return clean(
                text,
                fix_unicode=True,               # 修复损坏的 unicode
                to_ascii=False,                 # 绝不转 ASCII，保留中文
                lower=False,                    # 不转小写
                no_line_breaks=False,           # 保留换行符，因为我们需要结构
                no_urls=False,                  # 保留 URL
                no_emails=False,                # 保留 Email
                no_phone_numbers=False,         # 保留电话
                no_numbers=False,               # 保留数字
                no_digits=False,                # 保留数字
                no_currency_symbols=False,      # 保留货币
                no_punct=False,                 # 保留标点
                lang="en"                       # 用于处理特殊字符回退，中文不受 to_ascii=False 影响
            )
        except Exception as e:
            log.warning(f"clean-text 深度规范化失败，回退为基础清理: {e}")
            return text.strip()

    @staticmethod
    def remove_boilerplate(text: str) -> str:
        """2. 结构化去噪：移除常见页头页脚、页码及无意义的大量重复字符。"""
        # 移除独立成行的页码 (例如: - 12 -, Page 12 of 20, 12 / 20)
        text = re.sub(r'^\s*-\s*\d+\s*-\s*$', '', text, flags=re.MULTILINE)
        text = re.sub(r'^\s*Page\s+\d+\s+of\s+\d+\s*$', '', text, flags=re.MULTILINE | re.IGNORECASE)
        text = re.sub(r'^\s*\d+\s*/\s*\d+\s*$', '', text, flags=re.MULTILINE)
        
        # 移除大量连续的无意义字符 (OCR 常见干扰线，如 ------- 或 ======)
        text = re.sub(r'([_#*=\-~]){7,}', r'\1\1\1', text)
        
        # 压缩连续空行
        text = re.sub(r'\n{3,}', '\n\n', text)
        
        return text

    @staticmethod
    def consolidate_cross_page(text: str) -> str:
        """3. 跨页语义缝合：修复被物理换页或 PDF 转换打断的句子。"""
        # 1. 缝合被破折号连字符打断的英文单词 (Hyphenation)
        text = re.sub(r'([a-zA-Z])-\n([a-zA-Z])', r'\1\2', text)
        
        # 2. 缝合普通句子（保守策略，防止破坏 Markdown 结构）
        lines = text.split("\n")
        consolidated = []
        skip_next = False
        
        for i in range(len(lines)):
            if skip_next:
                skip_next = False
                continue
                
            line = lines[i]
            
            if i < len(lines) - 1:
                next_line = lines[i+1]
                # 条件：当前行非空，下一行非空，且下一行不是以特殊 Markdown 符号开头
                if line.strip() and next_line.strip() and not next_line.strip().startswith(("- ", "* ", "#", "```", "> ", "1. ")):
                    # 判断结尾词（如果是中文、英文小写字母、逗号等）和开头词（中英文）
                    if re.search(r'[\u4e00-\u9fa5a-z,，及和与的]$', line.strip()) and \
                       re.search(r'^[\u4e00-\u9fa5a-z]', next_line.strip()):
                        
                        # 如果是英文连接，加个空格；如果是中文连接，直接连起来
                        if re.search(r'[a-z]$', line.strip()):
                            consolidated.append(line + " " + next_line.lstrip())
                        else:
                            consolidated.append(line + next_line.lstrip())
                            
                        skip_next = True
                        continue
            
            consolidated.append(line)
            
        return "\n".join(consolidated)

    @staticmethod
    def lint_markdown(text: str) -> str:
        """4. Markdown 语法修复：补全断头代码块，防止 Chunking 时发生上下文撕裂。"""
        lines = text.split("\n")
        in_code_block = False
        code_block_char = ""
        
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("```") or stripped.startswith("~~~"):
                char = stripped[:3]
                if not in_code_block:
                    in_code_block = True
                    code_block_char = char
                elif char == code_block_char:
                    in_code_block = False
                    
        # 如果遍历到底发现代码块未闭合，强制追加闭合符号
        if in_code_block:
            text += f"\n{code_block_char}"
            
        return text

    @staticmethod
    def strip_html_tags(text: str) -> str:
        """5. 移除残余的 HTML 标签（如 <br>, <p> 等），PDF 解析常有此类残留。"""
        # 将换行类标签替换为换行符
        text = re.sub(r'<(br|p|div)[^>]*>', '\n', text, flags=re.IGNORECASE)
        # 移除其他所有 HTML 标签
        text = re.sub(r'<[^>]+>', '', text)
        return text

    @staticmethod
    def fix_table_format(text: str) -> str:
        """6. 修复 Markdown 表格乱象：处理多余的管道符 || 或不规范的对齐线。"""
        # 移除行首或行尾多余的 ||
        text = re.sub(r'^\|{2,}', '|', text, flags=re.MULTILINE)
        text = re.sub(r'\|{2,}$', '|', text, flags=re.MULTILINE)
        # 移除行中的 || 替换为单 |
        text = re.sub(r'\|{2,}', '|', text)
        return text

    @classmethod
    def process(cls, text: str) -> str:
        """执行完整的高级清洗流水线"""
        if not text:
            return ""
            
        text = cls.normalize_text(text)
        text = cls.strip_html_tags(text) # 新增：移除 HTML 标签
        text = cls.fix_table_format(text) # 新增：修复表格
        text = cls.remove_boilerplate(text)
        text = cls.consolidate_cross_page(text)
        text = cls.lint_markdown(text)
        
        return text.strip()
