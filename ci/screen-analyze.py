# -*- coding: utf-8 -*-
"""screen-analyze.py —— 在 **CI 里**跑屏幕分析，产出**文本报告**（本机只下载小文件）。

为什么放在 CI：用户的硬规则是"吃算力的活（验证/构建/**分析**）全走云端，本机只做文本编辑"。
而此前这些图像分析（13 屏 × 72 万像素的逐像素统计）都在**本机**跑 —— 属于违规，已改为 CI 步骤。

产出 analysis.md：
  · 逐屏画像（空占比/色数/低对比%/主色占比）+ 弱度排序
  · 逐屏"面板内最长连续无内容带"（死区）
用法: python ci/screen-analyze.py <截图目录> [输出文件]
"""
import sys
from collections import Counter
from glob import glob
from pathlib import Path

from PIL import Image

SHOTS = sys.argv[1] if len(sys.argv) > 1 else "ci/out"
OUT = sys.argv[2] if len(sys.argv) > 2 else "ci/out/analysis.md"

# ⚠ 自己确保输出目录存在。此前依赖调用方先 `mkdir -p`（或前一步恰好建过），
#   一旦调用顺序变了就会 FileNotFoundError 崩掉 —— 而崩掉的是**体检步骤**本身，
#   等于门禁静默失效。在全新 checkout 上尤其危险。
Path(OUT).parent.mkdir(parents=True, exist_ok=True)


def lum(r, g, b):
    def f(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def canvas_box(im):
    w, h = im.size
    px = im.load()

    def black(x):
        d = n = 0
        for y in range(0, h, 4):
            r, g, b = px[x, y][:3]
            n += 1
            if r < 12 and g < 12 and b < 12:
                d += 1
        return d > n * 0.94
    xs = [x for x in range(w) if not black(x)]
    return im.crop((min(xs), 0, max(xs) + 1, h)) if xs else im


rows = []
for f in sorted(glob(SHOTS + "/*.png")):
    name = Path(f).name
    if name.startswith((".", "z-", "overview", "sheet", "cmp", "sim")) or name.startswith("fx-"):
        continue
    im = canvas_box(Image.open(f).convert("RGB"))
    W, H = im.size
    px = im.load()
    cnt = Counter()
    lums = []
    for y in range(H):
        for x in range(W):
            r, g, b = px[x, y]
            cnt[(r >> 4, g >> 4, b >> 4)] += 1
            lums.append(lum(r, g, b))
    lums.sort()
    lo, hi = lums[0], lums[-1]
    low_ct = sum(1 for v in lums if (hi + 0.05) / (v + 0.05) < 2.0 or (v + 0.05) / (lo + 0.05) < 2.0)
    flat = 0
    for gy in range(12):
        for gx in range(12):
            c = Counter()
            n = 0
            for y in range(H * gy // 12, H * (gy + 1) // 12):
                for x in range(W * gx // 12, W * (gx + 1) // 12):
                    r, g, b = px[x, y]
                    c[(r >> 3, g >> 3, b >> 3)] += 1
                    n += 1
            if n and c.most_common(1)[0][1] / n >= 0.95:
                flat += 1
    # 面板内最长无内容带（用画面出现最多的色当"面板底色"）
    base = Counter()
    for y in range(int(H * 0.3), int(H * 0.9), 3):
        for x in range(int(W * 0.05), int(W * 0.95), 3):
            base[px[x, y]] += 1
    base_c = base.most_common(1)[0][0]

    def near(p, q, tol):
        return abs(p[0] - q[0]) <= tol and abs(p[1] - q[1]) <= tol and abs(p[2] - q[2]) <= tol
    ys = [y for y in range(H) if sum(1 for x in range(20, W - 20, 8) if near(px[x, y], base_c, 12)) > 40]
    gap = 0
    if ys:
        top, bot = min(ys), max(ys)
        cur = None
        for y in range(top, bot):
            n = sum(1 for x in range(45, W - 45) if not near(px[x, y], base_c, 26))
            if n <= 3:
                if cur is None:
                    cur = y
            else:
                if cur is not None and y - cur > 30:
                    gap = max(gap, y - cur)
                cur = None
    rows.append({"s": name.replace(".png", ""), "size": "%dx%d" % (W, H), "empty": round(flat * 100.0 / 144, 1),
                 "colors": len(cnt), "lowct": round(low_ct * 100.0 / (W * H), 1),
                 "domi": round(cnt.most_common(1)[0][1] * 100.0 / (W * H), 1), "gap": gap})


def norm(key, inv=False):
    vs = [r[key] for r in rows]
    lo, hi = min(vs), max(vs)
    if hi == lo:
        return {r["s"]: 0.0 for r in rows}
    return {r["s"]: (((r[key] - lo) / (hi - lo)) if not inv else ((hi - r[key]) / (hi - lo))) for r in rows}


nE, nC, nL, nD = norm("empty"), norm("colors", True), norm("lowct"), norm("domi")
for r in rows:
    r["weak"] = round(nE[r["s"]] + nC[r["s"]] + nL[r["s"]] + nD[r["s"]], 3)
rows.sort(key=lambda r: -r["weak"])

md = ["# 屏幕分析（CI 端产出，本机不跑图像计算）", "",
      "屏数 %d ｜ 按「综合弱度」降序（越靠前越该优先看）" % len(rows), "",
      "| 屏 | 画布 | 空占比% | 色数 | 低对比% | 主色% | 面板死区px | 弱度 |",
      "|---|---|---|---|---|---|---|---|"]
for r in rows:
    md.append("| %s | %s | %.1f | %d | %.1f | %.1f | %d | %.3f |" % (
        r["s"], r["size"], r["empty"], r["colors"], r["lowct"], r["domi"], r["gap"], r["weak"]))
md += ["", "> 「死区」= 面板内最长连续无内容带（面板底色取该屏出现最多的色）。",
       "> ⚠ 面板类屏的「空占比」天然偏高（面板本来就有底色）→ 弱度榜只能当线索，不能当结论。"]
Path(OUT).write_text("\n".join(md), encoding="utf-8")
print("\n".join(md))
print("\n→ 已写 " + OUT)

# ---- 总览拼图：把 13 屏缩略拼成一张，供"整套视觉语言一致性"评审 ----
from PIL import ImageDraw
shots = sorted(glob(SHOTS + "/*.png"))
shots = [f for f in shots if not Path(f).name.startswith((".", "z-", "overview", "sheet", "cmp", "sim"))]
if shots:
    COLS, CW = 4, 300
    ch = None
    cells = []
    for f in shots:
        im = Image.open(f).convert("RGB")
        if ch is None:
            ch = int(CW * im.size[1] / im.size[0])
        im2 = im.resize((CW, ch), Image.LANCZOS)
        d2 = ImageDraw.Draw(im2)
        d2.rectangle([0, 0, CW - 1, 16], fill=(16, 20, 14))
        d2.text((5, 3), Path(f).stem, fill=(238, 244, 220))
        cells.append(im2)
    rows = (len(cells) + COLS - 1) // COLS
    sheet = Image.new("RGB", (COLS * CW + (COLS + 1) * 8, rows * (ch + 22) + 8), (20, 20, 24))
    for k, im2 in enumerate(cells):
        gx = 8 + (k % COLS) * (CW + 8)
        gy = 8 + (k // COLS) * (ch + 22)
        sheet.paste(im2, (gx, gy))
    out_png = str(Path(OUT).with_name("overview.png"))
    sheet.save(out_png)
    print("→ 已写 " + out_png + "  (" + str(len(cells)) + " 屏拼图)")
