# -*- coding: utf-8 -*-
"""card-band.py —— 卡内死区双带扫描（云端跑，产出文本小产物）。

动机（范式 32）：查容器内死区必须**同时扫两类空带**
  ① 容器顶 → 首个内容（topPad）
  ② 末个内容 → 容器底（botPad）
只看其中一个会漏掉"底部大空档"—— 顶部往往正常，缺陷藏在尾部标签与容器底之间。

做法：不用"面板底色"这种全屏口径，而是**直接找"卡片框"**：
卡片框 = 一个圆角矩形区域，其内部大部分像素是"卡底族颜色"（比背景亮、低饱和）。
然后用连通分量找所有卡，逐卡扫两带。

判据：botPad / 卡高 > 25% 且 同族卡中位数 botPad 明显更小 → 疑似"远端锚点漏算"。
输出只给"候选清单"（文本），不做结论 —— 结论必须在同族对照后人工下。
"""
import sys
import json
from collections import Counter, deque

from PIL import Image

PATH = sys.argv[1] if len(sys.argv) > 1 else 'ci/out'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'ci/out/card-band.md'


def load(p):
    im = Image.open(p).convert('RGB')
    return im


def find_bg(px, W, H):
    """画面主底色（卡内区域之外）"""
    c = Counter()
    for y in range(int(H * 0.3), int(H * 0.9), 4):
        for x in range(int(W * 0.05), int(W * 0.95), 4):
            c[px[x, y]] += 1
    return c.most_common(1)[0][0]


def near(p, q, tol=14):
    return abs(p[0]-q[0]) <= tol and abs(p[1]-q[1]) <= tol and abs(p[2]-q[2]) <= tol


def is_cardish(c, bg):
    """卡底族：比背景亮，且是低饱和的绿白/奶白系"""
    r, g, b = c
    br, bgc, bb = bg
    if r + g + b <= br + bgc + bb + 30:      # 必须明显亮于背景
        return False
    if g < 190:                               # 卡底都比较亮
        return False
    mx, mn = max(c), min(c)
    return (mx - mn) <= 70                    # 低饱和


def scan_screen(path):
    im = load(path)
    W, H = im.size
    px = im.load()
    bg = find_bg(px, W, H)

    # 逐行：卡底族像素占比
    rowcard = []
    for y in range(H):
        n = 0
        for x in range(30, W - 30, 3):
            if is_cardish(px[x, y], bg):
                n += 1
        rowcard.append(n * 3 / (W - 60))

    # 找竖直连续"卡底带"（占比 > 0.5 的连续行）
    bands = []
    cur = None
    for y in range(H):
        f = rowcard[y] > 0.45
        if f and cur is None:
            cur = y
        elif not f and cur is not None:
            if y - cur >= 40:
                bands.append((cur, y - 1))
            cur = None
    if cur is not None and H - cur >= 40:
        bands.append((cur, H - 1))

    out = []
    for (a, b) in bands:
        h = b - a + 1
        # 在卡带内逐行找"深色内容行"
        content_rows = []
        for y in range(a, b + 1):
            dark = 0
            for x in range(60, W - 60, 2):
                r, g, bl = px[x, y]
                if r + g + bl < 480:
                    dark += 1
            content_rows.append((y, dark))
        cl = [y for y, d in content_rows if d > 3]
        if not cl:
            continue
        top, bot = cl[0], cl[-1]
        # 排除"卡外残留" —— 卡带可能把两块卡连起来
        out.append({
            "band": [a, b], "h": h,
            "topPad": top - a, "botPad": b - bot,
            "content": [top, bot], "contentH": bot - top,
        })
    return {"file": path.rsplit('/', 1)[-1], "bg": bg, "bands": out}


def main():
    import glob
    import os
    files = sorted(glob.glob(os.path.join(PATH, '*.png')))
    files = [f for f in files if os.path.basename(f) != 'overview.png']
    md = ["# 卡内死区双带扫描（CI 端）", "",
          "> 范式 32：**同时扫** ① 容器顶→首内容 ② 末内容→容器底。",
          "> 只看一个会漏掉底部大空档。**本表只给候选清单，结论必须靠同族对照下。**", ""]
    md.append("| 屏 | 卡带 y范围 | 卡高 | 顶留白 | **底留白** | 底留白% | 内容高 |")
    md.append("|---|---|---|---|---|---|---|")
    allres = []
    for f in files:
        r = scan_screen(f)
        allres.append(r)
        for bd in r["bands"]:
            pct = round(bd["botPad"] * 100.0 / bd["h"], 1) if bd["h"] else 0
            flag = " ⚠" if pct >= 25 else ""
            md.append("| %s | %d..%d | %d | %d | **%d**%s | %s | %d |" % (
                r["file"].replace('.png', ''), bd["band"][0], bd["band"][1],
                bd["h"], bd["topPad"], bd["botPad"], flag, pct, bd["contentH"]))
    md.append("")
    md.append("> ⚠ 标记 = 底留白 ≥ 卡高 25%。**需与同屏/同族同类卡对照后才能判缺陷。**")
    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write("\n".join(md) + "\n")
    print("\n".join(md))


main()
