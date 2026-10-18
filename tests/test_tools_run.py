# -*- coding: utf-8 -*-
"""工具调试面板后端逻辑（进程内直接调用 func + 扁平列表）的单元测试。"""
import concurrent.futures

from core.tools.registry_tools import get_tool, list_tools


def _run_tool_inproc(name: str, timeout: int = 30, **kwargs):
    """与 /api/tools/run 端点一致的进程内直调逻辑（CLI 子进程启动过慢，调试面板改用直调）。"""
    meta = get_tool(name)
    if meta is None:
        return f"错误：工具「{name}」不存在"
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            return str(ex.submit(meta["func"], **kwargs).result(timeout=timeout))
    except concurrent.futures.TimeoutExpired:
        return f"错误：工具执行超时（{timeout}秒）"
    except TypeError as e:
        return f"错误：参数不匹配 - {e}"
    except Exception as e:
        return f"错误：执行异常 - {e}"


def test_get_time_success():
    result = _run_tool_inproc("get_time", timeout=5)
    assert not result.startswith("错误")
    assert ":" in result and "-" in result


def test_calculator_success():
    result = _run_tool_inproc("calculator", timeout=5, expr="1+2*3")
    assert "计算结果" in result
    assert "7" in result


def test_nonexistent_tool_returns_error():
    result = _run_tool_inproc("this_tool_does_not_exist")
    assert result.startswith("错误")
    assert "不存在" in result


def test_get_tool_returns_metadata():
    meta = get_tool("get_time")
    assert meta is not None
    assert meta["name"] == "get_time"
    assert "parameters" in meta
    assert "func" in meta


def test_get_tool_missing_returns_none():
    assert get_tool("this_tool_does_not_exist") is None


def test_list_tools_flat_format_matches_run():
    """调试面板列表与运行必须同源：list_tools 返回扁平 parameters（param->{type,description}）。"""
    tools = list_tools()
    assert len(tools) > 0
    calc = [t for t in tools if t["name"] == "calculator"][0]
    params = calc["parameters"]
    # 扁平格式：键是参数名，值含 type/description；而非 JSON-Schema 的 properties 嵌套
    assert "expr" in params
    assert "properties" not in params
    assert params["expr"]["type"] == "string"
    assert "description" in params["expr"]
