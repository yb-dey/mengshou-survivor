# -*- coding: utf-8 -*-
"""text-legibility.py —— 逐屏**文字级**可读性体检（在 CI 跑，只产出文本报告）。

为什么需要它（与 screen-analyze.py 的分工）：
  `screen-analyze.py` 的 `lowct%` 是拿**全屏最暗/最亮**当基准算的
  （`(hi+0.05)/(v+0.05) < 2` 即计入）—— 只要画面里同时出现深色 HUD 与浅色面板，
  大量中间调像素就会被判成"低对比"，**这是度量口径问题，不是可读性问题**。
  本项目已因此吃过一次假阳性（CI 接缝旧判据把完美循环的正弦判 FAIL）。

本脚本改为**真实文字对**口径：
  1. 逐屏取像素，划分为"文字像素"（相对邻域显著偏暗或偏亮的细结构）与"背景像素"；
  2. 对每个文字像素，取它周围的**局部背景**（同一连通区域的中位色）；
  3. 按 WCAG 公式算对比度 → 统计"低于 4.5:1 的文字像素占比"，以及**最差的一批**样本色。

并内置**阴性对照自测**（--selftest）：
  用合成图验证判据 —— 已知 4.5:1 与 1.2:1 的两组文字，
  判据必须分别给出"通过"与"不通过"。**判据先证明自己有效，才许用它下结论。**

用法:
  python ci/text-legibility.py <截图目录> [输出文件]
  python ci/text-legibility.py --selftest
"""
import sys
from collections import Counter, defaultdict
from glob import glob
from pathlib import Path

from PIL import Image


def lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def lum(rgb):
    r, g, b = rgb[0], rgb[1], rgb[2]
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def lum255(rgb):
    """亮度映射回 0..255 量级，便于"肉眼级"阈值比较（曾因单位混用导致判据全灭）。"""
    return lum(rgb) * 255.0


def contrast(a, b):
    la, lb = lum(a), lum(b)
    if la < lb:
        la, lb = lb, la
    return (la + 0.05) / (lb + 0.05)


# ---------- 核心：找出"文字像素"并配对其局部背景 ----------

def text_pairs(im, step=1):
    """返回 [(文字色, 局部背景色, 对比度)]。

    文字判定：像素所在 3x3 邻域的**亮度极差**足够大（细结构 = 笔画特征，排除渐变/大色块）。
    ⚠ 单位坑：lum() 返回 0..1，阈值必须按 0..1 设（曾用 60 当"级"判 → 全灭）。
    """
    W, H = im.size
    px = im.load()

    # 预取亮度网格（0..1）
    L = [[lum(px[x, y]) for x in range(W)] for y in range(H)]
    SPREAD = 40 / 255.0     # 3x3 亮度极差 ≥ 40 级（0..255 口径）
    BGDIFF = 20 / 255.0     # 文字与其背景亮度差 ≥ 20 级
    out = []
    for y in range(2, H - 2, step):
        for x in range(2, W - 2, step):
            c = L[y][x]
            vals = [L[y + dy][x + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1)]
            if max(vals) - min(vals) < SPREAD:      # 不够"锐" → 不是笔画
                continue
            win = Counter()
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    win[px[x + dx, y + dy]] += 1
            best = None
            for col, n in win.most_common(8):
                if abs(lum(col) - c) >= BGDIFF:
                    best = col
                    break
            if best is None:
                continue
            out.append((px[x, y], best, contrast(px[x, y], best)))
    return out


def canvas_box(im):
    """裁掉左右纯黑边（截图含黑底）。"""
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


# ---------- 阴性对照自测 ----------

def selftest():
    """用合成图验证判据有效性：已知对比度的两组文字必须被正确区分。"""
    from PIL import ImageDraw

    IMG = Image.new("RGB", (400, 200), (238, 244, 220))   # 浅面板底
    d = ImageDraw.Draw(IMG)
    # 上：深字压浅底 → 高对比（应通过）
    d.text((20, 20), "MMMM", fill=(40, 48, 30))
    # 下：浅灰字压浅底 → 低对比（应不通过）
    d.text((20, 120), "MMMM", fill=(215, 220, 205))

    pairs = text_pairs(IMG, step=1)
    if not pairs:
        print("[自测] ❌ 判据未检出任何文字像素 → 判据本身失效")
        return False

    hi = [c for c in pairs if c[2] >= 4.5]
    lo = [c for c in pairs if c[2] < 2.0]
    # 期望：存在高对比样本（读到深字），也存在低对比样本（读到浅字）
    ok = len(hi) > 0 and len(lo) > 0
    print("[自测] 检出文字像素 %d 个：高对比(≥4.5) %d 个 / 低对比(<2.0) %d 个" % (len(pairs), len(hi), len(lo)))
    print("[自测] 期望两者都 >0（判据能区分深字与浅字）→ " + ("✅ 有效" if ok else "❌ 无效"))

    # 第二项：纯平坦图必须检出 0 个文字像素（不高估）
    flat = Image.new("RGB", (200, 120), (238, 244, 220))
    fp = text_pairs(flat, step=1)
    print("[自测] 纯平坦图检出 %d 个文字像素（期望 0）→ %s" % (len(fp), "✅" if len(fp) == 0 else "❌ 高估"))
    return ok and len(fp) == 0


# ---------- 主流程 ----------

if "--selftest" in sys.argv:
    sys.exit(0 if selftest() else 1)

SHOTS = sys.argv[1] if len(sys.argv) > 1 else "ci/out"
OUT = sys.argv[2] if len(sys.argv) > 2 else "ci/out/legibility-text.md"

THRESH = 4.5      # WCAG AA 正文
rows = []
for f in sorted(glob(SHOTS + "/*.png")):
    name = Path(f).name
    if name.startswith((".", "z-", "overview", "sheet", "cmp", "sim", "fx-")):
        continue
    im = canvas_box(Image.open(f).convert("RGB"))
    pairs = text_pairs(im, step=2)          # step=2 降采样，够用且快
    if not pairs:
        rows.append({"s": name[:-4], "n": 0, "bad": 0, "pct": 0.0, "worst": None})
        continue
    bad = [c for c in pairs if c[2] < THRESH]
    # 最差样本：取对比度最低的 3 个颜色对（去重）
    seen = set()
    worst = []
    for t, b, c in sorted(pairs, key=lambda z: z[2]):
        k = (t, b)
        if k in seen:
            continue
        seen.add(k)
        worst.append((t, b, round(c, 2)))
        if len(worst) >= 3:
            break
    rows.append({"s": name[:-4], "n": len(pairs), "bad": len(bad),
                 "pct": round(len(bad) * 100.0 / len(pairs), 1), "worst": worst})

rows.sort(key=lambda r: -r["pct"])
md = ["# 文字级可读性体检（CI 端，局部文字-背景对口径）", "",
      "判据：文字像素 vs **局部邻域背景**，按 WCAG 算对比度；阈值 %.1f:1（AA 正文）。" % THRESH,
      "> 与 `screen-analyze.py` 的 `lowct%` 不同：那个用全屏 min/max，会因深 HUD + 浅面板并存而虚高。", "",
      "| 屏 | 文字像素 | <%.1f:1 的占比%% | 最差样本（文字/背景/对比度） |" % THRESH,
      "|---|---|---|---|"]
for r in rows:
    if r["n"] == 0:
        md.append("| %s | 0 | — | （未检出文字） |" % r["s"])
        continue
    ws = " ｜ ".join("%s / %s / %.2f" % (t, b, c) for t, b, c in r["worst"])
    md.append("| %s | %d | %.1f | %s |" % (r["s"], r["n"], r["pct"], ws))
md += ["", "> ⚠ 本表也可能有假阳性（抗锯齿边缘、图标描边会被算作文字），",
       "> 但**跨屏横向比较**是稳的：占比显著偏高的屏值得人工看一眼。"]
Path(OUT).write_text("\n".join(md), encoding="utf-8")
print("\n".join(md))
print("\n→ 已写 " + OUT)
