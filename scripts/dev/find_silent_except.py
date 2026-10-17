import re, pathlib, sys

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
hits = []
for p in sorted(root.rglob("*.py")):
    if "__pycache__" in str(p):
        continue
    try:
        text = p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        text = p.read_text(encoding="gbk", errors="replace")
    lines = text.splitlines()
    for i, ln in enumerate(lines):
        if re.match(r"\s*except Exception:\s*(#.*)?$", ln):
            nxt = lines[i + 1] if i + 1 < len(lines) else ""
            if re.match(r"\s*pass\s*(#.*)?$", nxt):
                ctx = [c.strip()[:80] for c in lines[max(0, i - 3):i]]
                hits.append((str(p), i + 1, ctx))
print(f"TOTAL: {len(hits)}")
for f, ln, ctx in hits:
    print(f"--- {f}:{ln}")
    for c in ctx:
        print("   |", c)
