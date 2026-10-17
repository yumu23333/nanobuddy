"""拆分 requirements.txt 为 主 / OCR 可选 / 打包 三个文件。

依据 scripts/dev/analyze_deps.py 的可达性分析（2026-10-17）：
- 主文件：代码运行必需（core/nanobuddy 实际 import 闭包）
- requirements-ocr.txt：easyocr 独占依赖（torch 生态）。本机无 NVIDIA GPU，
  故 torch/torchvision 指向 CPU 版（官方 CPU index），CUDA 版约 5GB+ 不列入
- requirements-build.txt：PyInstaller 打包链（scripts/package_offline.ps1 用）

删除的孤立包：代码不 import、无任何包依赖（pip show Required-by 为空）、
且非打包/GUI 工具链。逐一甄别过边界：
- onnxruntime：chromadb 依赖 → 留主文件（曾差点误删）
- sympy/filelock/mpmath：onnxruntime/huggingface_hub 依赖 → 留主文件
- scipy：easyocr 与 engineer-your-data 依赖 → 留主文件
- tavily：adapter.py 仅用字符串 provider 名，WebSearchTool 来自引擎自带 → 删
- email-validator：代码无 EmailStr → 删
- comtypes/uiautomation/pywin32-ctypes：pywebview Windows 后端（extra 声明，
  BFS 不可见）→ 留主文件
- engineer-your-data：可选第三方 MCP（config.yaml 引用，当前缺 src 不可用）→ 留
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# easyocr 独占依赖（analyze_deps：ocr_closure - rest）
OCR_EXCLUSIVE = {
    "easyocr", "torch", "torchvision", "opencv-python-headless", "scikit-image",
    "imageio", "tifffile", "networkx", "ninja", "pyclipper", "python-bidi",
    "shapely", "lazy-loader",
}
# CUDA 版 torch 的附属大包：CPU 版不需要，不写入任何文件
CUDA_ONLY = {
    "cuda-bindings", "cuda-toolkit", "nvidia-cudnn-cu13", "nvidia-cusparselt-cu13",
    "nvidia-nccl-cu13", "nvidia-nvshmem-cu13", "triton",
}
# PyInstaller 打包链
BUILD = {"pyinstaller", "pyinstaller-hooks-contrib", "altgraph", "pefile"}
# 孤立包：直接删除（甄别依据见模块 docstring）
DELETE = {
    "qdrant-client", "tavily", "fpdf2", "fastparquet", "keyring", "keyboard",
    "matplotlib", "seaborn", "scikit-learn", "xlrd", "xlwt", "duckduckgo-search",
    "watchfiles", "httptools", "email-validator", "dnspython", "h2", "hpack",
    "hyperframe", "socksio", "caio", "aiofile", "beartype", "cyclopts",
    "defusedxml", "docstring-parser", "docutils", "fastmcp", "fonttools",
    "griffelib", "html5lib", "joblib", "joserfc", "jsonref", "jsonschema-path",
    "markdown", "more-itertools", "openapi-pydantic", "pathable",
    "py-key-value-aio", "pyperclip", "rich-rst", "threadpoolctl", "webencodings",
    "backports-tarfile", "cramjam", "contourpy", "cycler", "portalocker",
    "cachetools", "authlib",
}


def norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name.strip().lower())


def main():
    lines = (ROOT / "requirements.txt").read_text(encoding="utf-8").splitlines()
    main_lines, ocr_lines, build_lines = [], [], []
    removed = {"ocr": [], "delete": [], "build": [], "cuda": []}

    for ln in lines:
        s = ln.strip()
        if not s or s.startswith("#"):
            main_lines.append(ln)
            continue
        name = norm(re.split(r"[=<>!~\[]", s)[0])
        if name in CUDA_ONLY:
            removed["cuda"].append(name)
        elif name in OCR_EXCLUSIVE:
            removed["ocr"].append(name)
            ocr_lines.append(s)
        elif name in BUILD:
            removed["build"].append(name)
            build_lines.append(s)
        elif name in DELETE:
            removed["delete"].append(name)
        else:
            main_lines.append(ln)

    header_main = (
        "# nanobuddy 运行时依赖（主文件）\n"
        "# OCR（easyocr/torch）为可选功能，需要时另装 requirements-ocr.txt\n"
        "# 打包 exe 用 requirements-build.txt；两者均为可选，不影响主程序运行\n"
    )
    header_ocr = (
        "# 可选：OCR 图片文字识别（core/tools/ocr_tools.py 的 easyocr 引擎）\n"
        "# 不安装本组依赖时 OCR 工具自动禁用，其余功能不受影响\n"
        "# 本机无 NVIDIA GPU 时 torch 用 CPU 版（约 200MB，CUDA 版约 5GB+）：\n"
        "#   pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu\n"
        "#   pip install -r requirements-ocr.txt\n"
    )
    header_build = (
        "# 可选：PyInstaller 打包链（scripts/package_offline.ps1 使用）\n"
    )

    # 主文件：插入头部注释（若原文件有 BOM 头已移除过，这里直接写）
    (ROOT / "requirements.txt").write_text(
        header_main + "\n".join(main_lines) + "\n", encoding="utf-8"
    )
    (ROOT / "requirements-ocr.txt").write_text(
        header_ocr + "\n".join(sorted(ocr_lines)) + "\n", encoding="utf-8"
    )
    (ROOT / "requirements-build.txt").write_text(
        header_build + "\n".join(sorted(build_lines)) + "\n", encoding="utf-8"
    )

    for k in ("ocr", "delete", "build", "cuda"):
        print(f"[{k}] {len(removed[k])} 个: {' '.join(sorted(removed[k]))}")
    print(f"\n主文件剩余: {sum(1 for l in main_lines if l.strip() and not l.startswith('#'))} 包")


if __name__ == "__main__":
    main()
