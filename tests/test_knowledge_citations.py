# -*- coding: utf-8 -*-
"""知识库引用标注：来源格式化纯函数。"""
from core.agent.agent_core import format_knowledge_context


def test_format_knowledge_context_basic():
    sources = [
        {"doc": "a.pdf", "doc_id": "d1", "snippet": "内容A", "score": 0.9},
        {"doc": "b.md", "doc_id": "d2", "snippet": "内容B", "score": 0.8},
    ]
    text = format_knowledge_context(sources)
    assert "[知识片段 1] 来源: a.pdf" in text
    assert "[知识片段 2] 来源: b.md" in text
    assert "内容A" in text and "内容B" in text
    assert text.count("---") == 1  # 两段之间一个分隔


def test_format_knowledge_context_empty():
    assert format_knowledge_context([]) == ""
    assert format_knowledge_context(None) == ""


def test_format_knowledge_context_missing_fields():
    text = format_knowledge_context([{"snippet": "只有内容"}])
    assert "未知文档" in text
    assert "只有内容" in text
