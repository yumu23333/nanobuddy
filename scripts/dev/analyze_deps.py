"""分析 requirements.txt 中哪些包是代码运行真正需要的。

方法：
1. AST 扫描全部业务代码（core/ nanobuddy/ main.py cli.py desktop.py wechat_bridge.py
   tests/ scripts/），收集 import 的顶层模块名
2. 用 importlib.metadata.packages_distributions() 将 import 名映射为发行包名
3. 从直接依赖集合出发，沿 pip Requires-Dist（跳过 extra marker）做 BFS，
   得到运行必需闭包
4. freeze 中不在闭包内的包 = 可移除/可拆 optional 的包
5. 从 easyocr 出发做 BFS 得到 easyocr 依赖闭包（torch 生态组）

输出：reachable / easyocr-closure / orphan 三组清单（不修改任何文件）。
"""
import ast
import re
import sys
from collections import deque
from pathlib import Path
from importlib.metadata import distributions, packages_distributions

ROOT = Path(__file__).resolve().parents[2]
SCAN_DIRS = ["core", "nanobuddy", "tests", "scripts"]
SCAN_FILES = ["main.py", "cli.py", "desktop.py", "wechat_bridge.py"]

STDLIB = set(
    "os sys re json time math random datetime pathlib typing collections itertools "
    "functools subprocess threading asyncio logging hashlib hmac base64 secrets uuid "
    "sqlite3 shutil tempfile io csv argparse traceback contextlib dataclasses enum abc "
    "copy glob socket ssl http urllib xml html email smtplib imaplib zipfile gzip "
    "tarfile configparser struct textwrap string difflib unicodedata warnings inspect "
    "importlib platform getpass signal queue concurrent multiprocessing ctypes array "
    "bisect heapq statistics decimal fractions operator pickle keyword token ast dis "
    "pptraceback __future__ binascii fcntl termios select stat shlex socketio websocket "
    "mimetypes pkgutil weakref builtins types contextvars exceptiongroup ipaddress "
    "fnmatch zoneinfo tomllib webbrowser tracemalloc".split()
)


def collect_imported_top_levels() -> set:
    mods = set()
    paths = []
    for d in SCAN_DIRS:
        p = ROOT / d
        if p.exists():
            paths += [x for x in p.rglob("*.py") if "__pycache__" not in str(x)]
    for f in SCAN_FILES:
        if (ROOT / f).exists():
            paths.append(ROOT / f)
    for p in paths:
        try:
            tree = ast.parse(p.read_text(encoding="utf-8", errors="replace"))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for a in node.names:
                    mods.add(a.name.split(".")[0])
            elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                mods.add(node.module.split(".")[0])
    # 本地包
    mods -= {"core", "nanobuddy", "prompts", "main", "scripts", "tests"}
    return mods


def norm(name: str) -> str:
    """PEP 503 规范化：小写，[-_.]+ → -"""
    return re.sub(r"[-_.]+", "-", name.strip().lower())


def build_graph():
    """返回 (forward: pkg -> set(deps), all_pkgs)"""
    forward = {}
    all_pkgs = set()
    for dist in distributions():
        name = dist.metadata["Name"]
        if not name:
            continue
        key = norm(name)
        all_pkgs.add(key)
        deps = set()
        for req in dist.requires or []:
            # 跳过 extra marker（如 ; extra == "server"）
            if "extra ==" in req or "extra==" in req:
                continue
            m = re.match(r"^([A-Za-z0-9._-]+)", req.strip())
            if m:
                deps.add(norm(m.group(1)))
        forward[key] = deps
    return forward, all_pkgs


def bfs(seeds: set, forward: dict) -> set:
    seen = set()
    q = deque(seeds)
    while q:
        cur = q.popleft()
        if cur in seen:
            continue
        seen.add(cur)
        for dep in forward.get(cur, ()):
            if dep not in seen:
                q.append(dep)
    return seen


def main():
    imported = collect_imported_top_levels()
    pkg_map = packages_distributions()  # import 名 -> [发行包名]
    direct = set()
    unmapped = sorted(m for m in imported if m not in STDLIB and m not in pkg_map)
    for m in imported:
        if m in STDLIB:
            continue
        for dist in pkg_map.get(m, []):
            direct.add(norm(dist))
    forward, all_pkgs = build_graph()

    reachable = bfs(direct, forward)
    ocr_closure = bfs({"easyocr"}, forward)
    freeze = []
    for ln in (ROOT / "requirements.txt").read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if ln and not ln.startswith("#"):
            freeze.append(norm(re.split(r"[=<>!~\[]", ln)[0]))

    orphan = [p for p in freeze if p not in reachable]
    ocr_pkgs = [p for p in freeze if p in ocr_closure]
    other_orphan = [p for p in orphan if p not in ocr_closure]

    print(f"import 的顶层模块: {len(imported)} | 映射到发行包: {len(direct)}")
    if unmapped:
        print(f"[提示] 未映射到已安装包的 import（多为内置/条件导入）: {unmapped}")
    print(f"\n运行必需闭包: {len(reachable)} 包 | freeze 总数: {len(freeze)}")
    print(f"\n=== easyocr 闭包（{len(ocr_pkgs)} 个，可拆 optional）===")
    print(" ".join(sorted(ocr_pkgs)))
    print(f"\n=== 其他孤立包（{len(other_orphan)} 个，代码不 import 也无包依赖）===")
    print(" ".join(sorted(other_orphan)))
    # easyocr 闭包中是否有运行必需的（不能动）
    overlap = reachable & ocr_closure
    print(f"\n=== 交集（easyocr 闭包 ∩ 运行必需，必须留在主文件）===")
    print(" ".join(sorted(overlap)) if overlap else "(无交集，torch 生态可整体移出)")


if __name__ == "__main__":
    sys.exit(main())
