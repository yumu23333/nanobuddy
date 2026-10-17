# -*- coding: utf-8 -*-
# 一次性工具：把 启动助手.bat 从 UTF-8 转为 GBK + CRLF，并校验可 round-trip
import sys

p = r"D:\桌面\大四上\nanobuddy-agent\启动助手.bat"
s = open(p, encoding="utf-8").read()

# 1) 校验所有字符均可被 GBK 表示（含中文参数、全角标点）
try:
    s.encode("gbk")
except UnicodeEncodeError as e:
    print("GBK-UNSAFE CHAR:", e)
    sys.exit(1)

# 2) 按 GBK + CRLF 落盘
with open(p, "w", encoding="gbk", newline="\r\n") as f:
    f.write(s)

# 3) round-trip 校验
back = open(p, encoding="gbk").read()
assert back == s, "round-trip mismatch"

raw = open(p, "rb").read()
crlf = raw.count(b"\r\n")
lone_lf = raw.count(b"\n") - crlf
print("OK  chars=%d  bytes=%d  crlf=%d  lone_lf=%d" % (len(s), len(raw), crlf, lone_lf))
assert lone_lf == 0, "found lone LF"
print("bom:", raw[:3] == b"\xef\xbb\xbf")
