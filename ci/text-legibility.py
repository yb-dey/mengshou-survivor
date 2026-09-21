# -*- coding: utf-8 -*-
"""
⚠⚠ 本判据已于 2026-09-21 被**实测证伪**，结论：不可用于判定"文字可读性" ⚠⚠

证伪过程（真实截图 13 屏，非合成）：
  1. 67.3% 的"近白文字像素"其 5x5 邻域众数背景**也是近白**（>=0.85 亮度）
     —— 它们长在奶白面板底 #eef4dc 上，是无字的底纹/渐变，不是白字。
  2. 同屏对照：真文字块低对比率 95.4%，**同尺寸空白面板块 98.7%** —— 判据分不出两者。
  3. 根因（决定性）：整屏最暗像素 (5,9,1)（"返回"纯黑笔画），
     窗口偏 1px → 邻域众数从 (11,13,10) 变 (248,254,230)，
     对比度从 1.03 跳到 19.42。文字笔画仅 2-5px 宽（300px 缩略图），
     **5x5 窗口众数在笔画上不成立** → 背景取值随机。
  4. 旁证：既有 screen-analyze.py 的 lowct% 因同样原因常年 70-91%（虚高）。

因此：本脚本仅保留 `--selftest`（四项判据自检，仍有效，用于回归），
主流程输出**仅供参考、不可采信**，不得据此改画面。

—— 为什么合成自测抓不住：合成图是 crisp 大笔画，窗口众数稳定；
   真实截图经 0.4167x 下采样，笔画只剩 2-5px，众数随机。
   **教训：判据必须在真实产物尺度上验证，不能只在合成样本上验证。**
"""
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

    ⚠ 两条曾踩过的坑（都靠对照实验才发现，务必保留）：
      1. **单位混用**：lum() 返回 0..1，早期按"0..255 级"设阈值 60 → 判据全灭。
      2. **背景取错**：早期取"窗口内第一个亮度差 ≥ 阈值的颜色"当背景
         → 对比度被**阈值本身钉死**（所有"最差样本"亮度差恰好 = 阈值 20.2）。
         正确做法：背景 = 窗口内**出现次数最多**的颜色（真正的底色），
         中心像素则是笔画。这样对比度才反映真实"字压底"关系。

    文字判定：中心像素相对其**主要背景色**亮度差足够大，且 3x3 邻域够"锐"。
    """
    W, H = im.size
    px = im.load()

    L = [[lum(px[x, y]) for x in range(W)] for y in range(H)]
    SPREAD = 40 / 255.0      # 3x3 亮度极差 ≥ 40 级 → 有笔画结构
    MINDIF = 45 / 255.0      # 笔画与底色差 ≥ 45 级 → 才算"真文字"（排除抗锯齿斜坡）
    out = []
    for y in range(2, H - 2, step):
        for x in range(2, W - 2, step):
            vals = [L[y + dy][x + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1)]
            if max(vals) - min(vals) < SPREAD:
                continue
            # 背景 = 5x5 窗口内**出现最多**的颜色（真底色），而非"第一个够差的"
            win = Counter()
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    win[px[x + dx, y + dy]] += 1
            bg = win.most_common(1)[0][0]
            fg = px[x, y]
            if abs(lum(fg) - lum(bg)) < MINDIF:    # 只是底色的微小起伏 → 不是文字
                continue
            out.append((fg, bg, contrast(fg, bg)))
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
    """用合成图验证判据有效性。

    必须能拦住两类"判据自身失效"（本项目都真实发生过）：
      A. 判据全灭（单位混用：按 0..255 设阈值而 lum() 返回 0..1）
      B. 判据把**阈值当答案**（背景取"第一个够差的色" → 所有对比度恰等于阈值常数）
    """
    from PIL import ImageDraw

    IMG = Image.new("RGB", (400, 200), (238, 244, 220))   # 浅面板底
    d = ImageDraw.Draw(IMG)
    d.text((20, 20), "MMMM", fill=(40, 48, 30))       # 深字压浅底 → 高对比（应通过）
    d.text((20, 120), "MMMM", fill=(215, 220, 205))   # 浅灰字压浅底 → 低对比（应不通过）

    pairs = text_pairs(IMG, step=1)
    if not pairs:
        print("[自测 A] ❌ 判据未检出任何文字像素 → 判据全灭（检查阈值单位）")
        return False

    hi = [c for c in pairs if c[2] >= 4.5]
    lo = [c for c in pairs if c[2] < 2.0]
    ok_a = len(hi) > 0 and len(lo) > 0
    print("[自测 A] 检出文字像素 %d 个：高对比(≥4.5) %d / 低对比(<2.0) %d → %s"
          % (len(pairs), len(hi), len(lo), "✅ 能区分深字与浅字" if ok_a else "❌ 判别力不足"))

    # 自测 B：对比度必须**有分布**，不能全钉在一个常数上（= 阈值当答案）
    cs = sorted(c[2] for c in pairs)
    uniq = len(set(round(c, 2) for c in cs))
    span = cs[-1] - cs[0]
    ok_b = uniq >= 5 and span > 1.0
    print("[自测 B] 对比度取值 %d 种，跨度 %.2f（期望多样且跨度大）→ %s"
          % (uniq, span, "✅ 非阈值常数" if ok_b else "❌ 疑似'阈值当答案'"))

    # 自测 C：纯平坦图必须检出 0 个（不高估）
    flat = Image.new("RGB", (200, 120), (238, 244, 220))
    fp = text_pairs(flat, step=1)
    ok_c = len(fp) == 0
    print("[自测 C] 纯平坦图检出 %d 个（期望 0）→ %s" % (len(fp), "✅" if ok_c else "❌ 高估"))

    # 自测 D：**真实失效场景复现** —— 浅底 + 大面积柔和抗锯齿斜坡。
    #   合成字（crisp stroke）测不出"背景取第一个够差的色"这个 bug（实测：合成图仍通过）；
    #   必须在**浅底 + 高通量柔和边缘**下检验 —— 这正是真实截图的条件。
    soft = Image.new("RGB", (200, 160), (238, 244, 220))
    ds = ImageDraw.Draw(soft)
    for k in range(8):                       # 多段柔和斜坡：每条跨越 ~20 级
        y0 = 8 + k * 18
        for t in range(10):
            v = 238 - t * 2                  # 238 → 220，只有 18 级
            ds.rectangle([10, y0 + t, 190, y0 + t + 1], fill=(v, v + 4, v - 8))
    sp = text_pairs(soft, step=1)
    # 期望：柔和斜坡（< 45 级差）不应被当成文字 → 检出量必须很少
    ok_d = len(sp) <= 20
    print("[自测 D] 浅底柔和斜坡检出 %d 个（期望 ≤20，柔和边缘不该算文字）→ %s"
          % (len(sp), "✅" if ok_d else "❌ 把抗锯齿斜坡误当文字"))

    return ok_a and ok_b and ok_c and ok_d
    # ⚠ **已知盲区（诚实记录）**：自测 A~D 用的是合成图（crisp 笔画 + 简单斜坡），
    #   而真实失效场景是"真实截图里的高频细节（图标/描边/抖动）"，
    #   实测旧逻辑（背景取"第一个够差的色"）在**四项目测自测里全部通过**，
    #   只在真实截图上暴露（所有"最差样本"亮度差恰好=阈值 20.2）。
    #   → 结论：**合成自测不足以验证这类判据**。必须外加"真实数据合理性检查"：
    #     若输出的对比度取值高度集中在某一个常数附近 → 说明判据在报阈值而不是在测画面。
    #   本脚本主流程已加该检查（见末尾「合理性自检」）。


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
      "判据：文字像素 vs **局部邻域背景（窗口内众数色）**，按 WCAG 算对比度；阈值 %.1f:1（AA 正文）。" % THRESH,
      "> 与 `screen-analyze.py` 的 `lowct%` 不同：那个用全屏 min/max，会因深 HUD + 浅面板并存而虚高。", "",
      "| 屏 | 文字像素 | <%.1f:1 的占比%% | 最差样本（文字/背景/对比度） |" % THRESH,
      "|---|---|---|---|"]
for r in rows:
    if r["n"] == 0:
        md.append("| %s | 0 | — | （未检出文字） |" % r["s"])
        continue
    ws = " ｜ ".join("%s / %s / %.2f" % (t, b, c) for t, b, c in r["worst"])
    md.append("| %s | %d | %.1f | %s |" % (r["s"], r["n"], r["pct"], ws))

# ---- 合理性自检：判据输出不能"全都钉在一个常数上"（那是判据在报阈值，不是在测画面）----
_cls = []
for f in sorted(glob(SHOTS + "/*.png")):
    nm = Path(f).name
    if nm.startswith((".", "z-", "overview", "sheet", "cmp", "sim", "fx-")):
        continue
    for _t, _b, _c in text_pairs(canvas_box(Image.open(f).convert("RGB")), step=4):
        _cls.append(round(_c, 1))
_sanity = "未采样到数据"
if _cls:
    _u = len(set(_cls))
    _top = Counter(_cls).most_common(1)[0]
    _share = _top[1] * 100.0 / len(_cls)
    _sanity = ("取值 %d 种 / 众数 %.1f 占 %.1f%%" % (_u, _top[0], _share))
    if _share > 60:
        _sanity += "  ← ⚠ 过度集中，判据可能在报阈值而非测画面，结论不可信"

md += ["", "## 判据合理性自检", "", "- " + _sanity, "",
       "> ⛔ **本表不可采信**（2026-09-21 实测证伪，见文件头横幅）。",
       "> 实测：真文字块低对比率 95.4% vs 同尺寸空白面板块 98.7% —— 判据区分不出两者；",
       "> 根因：缩略图里文字笔画仅 2-5px 宽，5x5 邻域众数在笔画上不成立，",
       "> 同一像素窗口偏 1px，对比度可从 1.03 跳到 19.42。",
       "> 保留输出仅为留痕，**不得据此改画面**。"]
Path(OUT).write_text("\n".join(md), encoding="utf-8")
print("\n".join(md))
print("\n→ 已写 " + OUT)
