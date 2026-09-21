# -*- coding: utf-8 -*-
"""临时诊断: 打印 lane 门禁在 CI 端看到的原始数值与文件指纹。
用完即删。"""
import os, sys, math, hashlib, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
d = os.path.join(HERE, "..", "game", "audio")
d = os.path.normpath(d)
print("[diag] audio_dir =", d)
print("[diag] exists =", os.path.isdir(d))

files = sorted(fn for fn in os.listdir(d) if fn.startswith("bgm_") and fn.endswith(".wav"))
for fn in files:
    p = os.path.join(d, fn)
    with open(p, "rb") as fh:
        b = fh.read()
    print("%-18s %9d B  md5=%s" % (fn, len(b), hashlib.md5(b).hexdigest()))

spec = importlib.util.spec_from_file_location("ll", os.path.join(HERE, "bgm-lane-loudness.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

print()
print("[diag] TRACK_TRIM =", m.TRACK_TRIM)
print("[diag] python", sys.version.split()[0], "wave module", __import__("wave").__name__)
print()
rows, lg = m.analyze(d)
for r in sorted(rows, key=lambda r: (r["lane"], r["eff"])):
    print("%-12s %-7s g=%.3f trim=%.4f dur=%6.2f content=%8.4f eff=%8.4f" % (
        r["name"], r["lane"], r["gain"], r["trim"], r["dur"], r["content"], r["eff"]))

print()
by = {}
for r in rows:
    by.setdefault(r["lane"], []).append(r)
for lane, vs in sorted(by.items()):
    e = sorted(v["eff"] for v in vs)
    print("%-7s n=%d span=%.4f  %s" % (lane, len(vs), e[-1] - e[0],
          " ".join("%.4f" % x for x in e)))
