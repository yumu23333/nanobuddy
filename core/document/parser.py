import csv
import json
import os
import re
import io
import logging
from typing import Optional, List, Dict, Any

import yaml

# ---------- 配置与常量 ----------
# 增加最大文件大小限制（例如 50MB），防止 OOM
MAX_TEXT_FILE_SIZE = 50 * 1024 * 1024  # 50 MB

SUPPORTED_EXTENSIONS = {
    ".txt", ".md", ".py", ".js", ".ts", ".java", ".cpp", ".h", ".c",
    ".json", ".yaml", ".yml", ".xml", ".html", ".htm", ".css",
    ".csv", ".pdf", ".docx", ".xlsx", ".xls", ".pptx", ".ppt",
    ".log", ".ini", ".cfg", ".conf", ".toml", ".rs", ".go", ".rb",
    ".php", ".sql", ".sh", ".bat", ".ps1", ".rtf", ".eml",
}

TEXT_EXTENSIONS = {
    ".txt", ".md", ".py", ".js", ".ts", ".java", ".cpp", ".h", ".c",
    ".json", ".yaml", ".yml", ".xml", ".html", ".htm", ".css",
    ".log", ".ini", ".cfg", ".conf", ".toml", ".rs", ".go", ".rb",
    ".php", ".sql", ".sh", ".bat", ".ps1", ".rtf", ".eml",
}

CATEGORY_MAP = {
    ".txt": "text", ".md": "document", ".pdf": "document",
    ".docx": "document", ".xlsx": "spreadsheet", ".xls": "spreadsheet",
    ".csv": "data", ".pptx": "presentation", ".ppt": "presentation",
    ".json": "data", ".yaml": "data", ".yml": "data",
    ".xml": "data", ".html": "web", ".htm": "web",
    ".py": "code", ".js": "code", ".ts": "code",
    ".java": "code", ".cpp": "code", ".c": "code", ".h": "code",
    ".rs": "code", ".go": "code", ".rb": "code", ".php": "code",
    ".sql": "code", ".sh": "code", ".bat": "code", ".ps1": "code",
}

# ---------- 日志 ----------
# 若项目有全局 logger 可替换为此
logger = logging.getLogger("nanobuddy.parser")
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
    logger.addHandler(handler)


def get_file_type(file_path: str) -> str:
    _, ext = os.path.splitext(file_path)
    return ext.lower()


def get_doc_category(file_path: str) -> str:
    ext = get_file_type(file_path)
    return CATEGORY_MAP.get(ext, "other")


def is_supported(file_path: str) -> bool:
    ext = get_file_type(file_path)
    return ext in SUPPORTED_EXTENSIONS


def is_text_file(file_path: str) -> bool:
    ext = get_file_type(file_path)
    return ext in TEXT_EXTENSIONS


def parse_document(file_path: str, extract_tables: bool = True) -> Optional[str]:
    """
    解析文档，返回文本内容。
    增加文件大小预检，防止超大文本导致内存溢出。
    """
    # 检查文件大小（仅对文本类文件做严格限制）
    ext = get_file_type(file_path)
    try:
        file_size = os.path.getsize(file_path)
        if ext in TEXT_EXTENSIONS and file_size > MAX_TEXT_FILE_SIZE:
            logger.warning("文本文件过大 (%.2f MB)，超过限制 (%.2f MB)，跳过解析: %s",
                           file_size / (1024*1024), MAX_TEXT_FILE_SIZE / (1024*1024), file_path)
            # 可选择截断，此处保守返回 None
            return None
    except OSError:
        return None

    if ext in TEXT_EXTENSIONS:
        return _parse_text_file(file_path)
    elif ext == ".pdf":
        return _parse_pdf(file_path, extract_tables=extract_tables)
    elif ext == ".docx":
        return _parse_docx(file_path)
    elif ext == ".xlsx":
        return _parse_xlsx(file_path)
    elif ext == ".xls":
        return _parse_xls(file_path)
    elif ext == ".pptx":
        return _parse_pptx(file_path)
    elif ext == ".ppt":
        return _parse_ppt(file_path)
    return None


# ================= 内部解析器 =================

def _parse_text_file(file_path: str) -> Optional[str]:
    """优化：使用流式读取，避免一次性加载；增强编码检测兜底"""
    # 1. 编码检测
    encoding = None
    try:
        import chardet
        with open(file_path, "rb") as f:
            raw = f.read(10000)
        detected = chardet.detect(raw)
        encoding = detected.get("encoding", "utf-8")
        # 修正常见误判
        if encoding and encoding.lower() in ("ascii", "iso-8859-1", "windows-1252"):
            encoding = "utf-8"
    except ImportError:
        pass

    encodings = [encoding] if encoding else []
    encodings.extend(["utf-8", "gbk", "gb2312", "latin-1"])

    # 2. 流式读取（使用 io.StringIO 减少内存复制）
    for enc in encodings:
        try:
            with open(file_path, "r", encoding=enc, errors="replace") as f:
                # 逐块读取，减小内存峰值
                buffer = io.StringIO()
                while True:
                    chunk = f.read(8192)
                    if not chunk:
                        break
                    buffer.write(chunk)
                return buffer.getvalue()
        except (UnicodeDecodeError, UnicodeError):
            continue
        except Exception as e:
            logger.warning("读取文本文件失败 %s (编码: %s): %s", file_path, enc, e)
            continue
    return None


def _parse_pdf(file_path: str, extract_tables: bool = True) -> Optional[str]:
    """优化：增加结构化表格提取的清晰度"""
    parts = []
    # 1. 元数据
    try:
        from pypdf import PdfReader as PdfMetaReader
        reader = PdfMetaReader(file_path)
        meta = reader.metadata
        if meta:
            meta_lines = []
            if meta.title:
                meta_lines.append(f"标题: {meta.title}")
            if meta.author:
                meta_lines.append(f"作者: {meta.author}")
            if meta.subject:
                meta_lines.append(f"主题: {meta.subject}")
            if meta_lines:
                parts.append("=== 文档信息 ===")
                parts.extend(meta_lines)
                parts.append("")
    except ImportError:
        pass
    except Exception as e:
        logger.debug("提取PDF元数据失败: %s", e)

    # 2. 主解析（优先 pdfplumber）
    try:
        import pdfplumber
        with pdfplumber.open(file_path) as pdf:
            parts.append(f"=== 共 {len(pdf.pages)} 页 ===")
            for i, page in enumerate(pdf.pages, 1):
                page_text = []
                # 正文
                text = page.extract_text()
                if text and text.strip():
                    page_text.append(text)

                # 表格（结构化输出，使用 Markdown 风格）
                if extract_tables:
                    tables = page.extract_tables()
                    for j, table in enumerate(tables):
                        if table and len(table) > 0:
                            # 转为管道符格式，方便 LLM 理解
                            page_text.append(f"\n--- 表格 {j+1} ---")
                            # 过滤并拼接行列
                            for row in table:
                                clean = [str(c).strip() if c is not None else "" for c in row]
                                if any(clean):
                                    page_text.append("| " + " | ".join(clean) + " |")
                if page_text:
                    parts.append(f"\n--- 第 {i} 页 ---")
                    parts.extend(page_text)
            result = "\n".join(parts)
            return result if result.strip() else None
    except ImportError:
        logger.warning("pdfplumber 未安装，降级使用 PyPDF2")
    except Exception as e:
        logger.warning("pdfplumber 解析失败 (%s)，降级使用 PyPDF2", e)

    # 3. 降级 PyPDF2
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(file_path)
        pages = []
        for page in reader.pages:
            text = page.extract_text()
            if text:
                pages.append(text)
        combined = "\n\n".join(pages)
        # 如果主解析有部分内容，但降级没内容，保留主解析的碎片
        if combined.strip():
            return combined
    except ImportError:
        pass
    except Exception as e:
        logger.warning("PyPDF2 降级解析也失败: %s", e)

    return "\n".join(parts) if any(p.strip() for p in parts) else None


def _parse_docx(file_path: str) -> Optional[str]:
    try:
        from docx import Document
        doc = Document(file_path)
        paragraphs = []
        for para in doc.paragraphs:
            text = para.text.strip()
            if text:
                paragraphs.append(text)
        # 表格内容
        for table in doc.tables:
            for row in table.rows:
                cells = [cell.text.strip() for cell in row.cells]
                if any(cells):
                    paragraphs.append("| " + " | ".join(cells) + " |")
        return "\n".join(paragraphs) if paragraphs else None
    except Exception as e:
        logger.error("解析 .docx 失败 %s: %s", file_path, e)
        return None


def _parse_xlsx(file_path: str) -> Optional[str]:
    """优化：增加空值处理与日志"""
    try:
        from openpyxl import load_workbook
        wb = load_workbook(file_path, read_only=True, data_only=True)
        rows = []
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            rows.append(f"=== 工作表: {sheet_name} ===")
            for row in ws.iter_rows(values_only=True):
                cells = [str(c) if c is not None else "" for c in row]
                line = "\t".join(cells)
                if line.strip():
                    rows.append(line)
        wb.close()
        return "\n".join(rows) if rows else None
    except Exception as e:
        logger.error("解析 .xlsx 失败 %s: %s", file_path, e)
        return None


def _parse_xls(file_path: str) -> Optional[str]:
    """优化：优先使用 pandas，若不可用则报错"""
    try:
        import pandas as pd
        sheets = pd.read_excel(file_path, sheet_name=None, engine='xlrd')
        rows = []
        for name, df in sheets.items():
            rows.append(f"=== 工作表: {name} ===")
            # 限制输出行数避免超长（可选）
            rows.append(df.to_string(index=False, max_rows=1000))
        return "\n".join(rows)
    except ImportError:
        logger.error("解析 .xls 需要安装 pandas 和 xlrd: pip install pandas xlrd")
        return "[错误: 缺少 pandas 库，无法解析 .xls 文件]"
    except Exception as e:
        logger.error("解析 .xls 失败 %s: %s", file_path, e)
        return None


def _parse_pptx(file_path: str) -> Optional[str]:
    """优化：重点增强表格结构化提取"""
    try:
        from pptx import Presentation
        prs = Presentation(file_path)
        parts = [f"=== 共 {len(prs.slides)} 张幻灯片 ==="]

        for i, slide in enumerate(prs.slides, 1):
            slide_parts = [f"\n--- 幻灯片 {i} ---"]

            for shape in slide.shapes:
                # 1. 文本框
                if shape.has_text_frame:
                    for para in shape.text_frame.paragraphs:
                        text = para.text.strip()
                        if text:
                            prefix = "  " * para.level if para.level else ""
                            slide_parts.append(f"{prefix}{text}")

                # 2. 表格（新增结构化输出）
                if shape.has_table:
                    table = shape.table
                    slide_parts.append("\n[表格]:")
                    for row_idx, row in enumerate(table.rows):
                        cells = []
                        for cell in row.cells:
                            cell_text = cell.text.strip().replace("\n", " ")
                            cells.append(cell_text if cell_text else "")
                        if any(cells):
                            # 第一行作为表头处理（可选，这里不特殊处理，统一加管道符）
                            slide_parts.append("| " + " | ".join(cells) + " |")

                # 3. 图表（仅标记）
                if hasattr(shape, 'has_chart') and shape.has_chart:
                    slide_parts.append("[图表内容]")

                # 4. 备注（重要上下文）
                if hasattr(shape, 'has_notes_slide') and shape.has_notes_slide:
                    notes = slide.notes_slide.notes_text_frame.text.strip()
                    if notes:
                        slide_parts.append(f"备注: {notes}")

            parts.append("\n".join(slide_parts))

        return "\n".join(parts)
    except ImportError:
        logger.error("解析 .pptx 需要安装 python-pptx: pip install python-pptx")
        return "[错误: 缺少 python-pptx 库]"
    except Exception as e:
        logger.error("解析 .pptx 失败 %s: %s", file_path, e)
        return f"[PPTX解析失败: {e}]"


def _parse_ppt(file_path: str) -> Optional[str]:
    # 保持原提示，但增加日志
    logger.warning("旧版 .ppt 格式需要手动转换为 .pptx 后才能解析")
    return "[提示: 旧版 .ppt 格式需要先转换为 .pptx 才能解析]"


# ================= 智能分块（增强版） =================

def chunk_text(
    text: str,
    chunk_size: int = 500,
    overlap: int = 100,
    prefer_sentence: bool = True
) -> List[str]:
    """
    智能分块。
    优化点：
    1. 增加对中文标点（。！？）的支持。
    2. 处理纯数字/符号导致的异常空块。
    """
    if not text:
        return []

    # 按段落分割（保留段落边界）
    paragraphs = re.split(r"\n\s*\n", text.strip())
    chunks = []
    current_chunk = []

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        # 如果单段落太长，强制按句子切分
        if len(para) > chunk_size:
            if current_chunk:
                chunks.append("\n\n".join(current_chunk))
                current_chunk = []

            # 支持中英文标点
            sentences = re.split(r'(?<=[.!?。！？])\s*', para)
            temp = ""
            for sent in sentences:
                sent = sent.strip()
                if not sent:
                    continue
                if len(temp) + len(sent) > chunk_size and temp:
                    chunks.append(temp)
                    temp = sent
                else:
                    temp = (temp + " " + sent) if temp else sent
            if temp:
                chunks.append(temp)
            continue

        # 正常段落累积
        current_len = sum(len(p) for p in current_chunk) + len(para)
        if current_len > chunk_size and current_chunk:
            chunks.append("\n\n".join(current_chunk))

            # Overlap：保留尾部文本（基于句子或单词）
            overlap_texts = []
            overlap_len = 0
            for p in reversed(current_chunk):
                if overlap_len + len(p) > overlap and overlap_texts:
                    break
                overlap_texts.insert(0, p)
                overlap_len += len(p)
            current_chunk = overlap_texts

        current_chunk.append(para)

    if current_chunk:
        chunks.append("\n\n".join(current_chunk))

    # 过滤空块
    return [c for c in chunks if c.strip()]


# ================= 元数据与估算 =================

def get_file_metadata(file_path: str) -> dict:
    """增加 mtime 返回，用于外部去重判断"""
    try:
        stat = os.stat(file_path)
        _, ext = os.path.splitext(file_path)
        return {
            "size": stat.st_size,
            "mtime": stat.st_mtime,          # 返回修改时间
            "created": getattr(stat, "st_ctime", 0),
            "ext": ext.lower(),
            "category": CATEGORY_MAP.get(ext.lower(), "other"),
        }
    except Exception as e:
        logger.warning("获取文件元数据失败 %s: %s", file_path, e)
        return {"size": 0, "ext": "", "category": "other", "mtime": 0}


def count_tokens(text: str) -> int:
    """保持原有估算逻辑，增加边界处理"""
    if not text:
        return 0
    chinese_chars = len(re.findall(r"[一-鿿]", text))
    english_words = len(re.findall(r"[a-zA-Z0-9]+", text))
    return int(chinese_chars * 1.5 + english_words * 1.3)