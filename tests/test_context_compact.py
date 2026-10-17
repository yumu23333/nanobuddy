# -*- coding: utf-8 -*-
"""上下文治理：历史消息剪枝。"""
from core.context.context_compact import get_context_settings, prune_history_messages


def _big_tool_history():
    """构造可触发剪枝的历史：

    - 前 4 条为头部保护区（小体积）
    - 索引 9 放置大体积工具结果（应被摘要替换的目标）
    - 之后 20 条为尾部，总体积超过 _TAIL_TOKEN_BUDGET(20000 tokens)，
      使 cut_idx 落在索引 10 附近，从而 [4, cut_idx) 区间内的工具结果被裁剪
    - 全量 token > 30000（should_prune 阈值）
    """
    msgs = [{"role": "user", "content": "开始排查问题"}]
    msgs.append({"role": "assistant", "content": "", "tool_calls": [
        {"id": "call_1", "function": {"name": "read_file", "arguments": "{}"}}]})
    msgs.append({"role": "user", "content": "继续"})
    msgs.append({"role": "assistant", "content": "好的"})
    for i in range(5):  # 索引 4-8：旧消息（小体积）
        msgs.append({"role": "user", "content": f"旧问题 {i}"})
    # 索引 9：大体积工具结果（>200 字符才会被摘要）
    msgs.append({"role": "tool", "tool_call_id": "call_1", "content": "x" * 80000})
    for i in range(20):  # 索引 10-29：尾部（累计超 20000 tokens）
        msgs.append({"role": "user", "content": f"新问题 {i}" + "y" * 4000})
    return msgs


def test_prune_disabled_returns_same_object():
    h = _big_tool_history()
    assert prune_history_messages(h, enabled=False) is h


def test_prune_empty_history():
    assert prune_history_messages([], enabled=True) == []


def test_prune_small_history_unchanged():
    h = [{"role": "user", "content": "hi"}]
    assert prune_history_messages(h, enabled=True) is h


def test_prune_shrinks_big_tool_results():
    h = _big_tool_history()
    out = prune_history_messages(h, enabled=True)
    assert len(out) == len(h)  # 消息结构保留
    big_before = sum(len(str(m.get("content", ""))) for m in h)
    big_after = sum(len(str(m.get("content", ""))) for m in out)
    assert big_after < big_before  # 体积被压缩
    # 被摘要的正是索引 9 的大体积工具结果
    assert len(out[9]["content"]) < 200


def test_get_context_settings_defaults():
    cfg = get_context_settings({})
    assert isinstance(cfg, dict)
    assert "prune_tool_results" in cfg
