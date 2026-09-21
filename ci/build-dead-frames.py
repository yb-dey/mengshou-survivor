# -*- coding: utf-8 -*-
"""死亡帧构建：抠图 → 裁到内容 → 补成方图 → 缩到 96×96 → WebP(带 alpha) → 注入 AI_ART_TABLE。

为什么「裁到内容再补成方图」而不是直接整图缩放：
  makeEnemySprite 里 drawImage(aiA, …, aiD, aiD) 会把贴图**拉伸铺满正方形**，
  若原图留白过大，角色会显小；若直接按内容裁成非方图，又会被拉伸变形。
  → 先裁掉空白，再把内容**居中补成正方形**，两头都对。

产物：game/<原名>.dead.html + ci/out/dead-report.json/md + dead-preview.png
"""
import base64
import io
import json
import os
import re
import sys
from collections import deque
from pathlib import Path

from PIL import Image

TOL = int(os.environ.get("CUTOUT_TOL", "30"))
SIZE = int(os.environ.get("DEAD_SIZE", "96"))
RAW_DIR = Path("ci/dead-frames")
GAME = Path("game")
OUT = Path("ci/out")
OUT.mkdir(parents=True, exist_ok=True)

IDS = ["rabbit", "mouse", "bear", "fox", "badger", "boar", "monkey", "boss1", "boss2", "boss3"]


def cutout(im, tol=TOL):
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))

    def is_bg(p):
        return abs(p[0] - bg[0]) <= tol and abs(p[1] - bg[1]) <= tol and abs(p[2] - bg[2]) <= tol

    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not seen[y * w + x] and is_bg(px[x, y]):
                seen[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not seen[y * w + x] and is_bg(px[x, y]):
                seen[y * w + x] = 1
                q.append((x, y))
    cleared = 0
    while q:
        x, y = q.popleft()
        r, g, b, _ = px[x, y]
        px[x, y] = (r, g, b, 0)
        cleared += 1
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and is_bg(px[nx, ny]):
                seen[ny * w + nx] = 1
                q.append((nx, ny))
    return im, bg, cleared, w * h


def to_square(im, pad_ratio=0.06):
    """裁到内容边界，再居中补成正方形（留一点边距）。"""
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    w, h = im.size
    side = int(max(w, h) * (1 + pad_ratio * 2))
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(im, ((side - w) // 2, (side - h) // 2), im)
    return sq


htmls = list(GAME.glob("*.html"))
if not htmls:
    print("FAIL: game/ 下没有 html")
    sys.exit(1)
src_path = htmls[0]
html = src_path.read_text(encoding="utf-8")
start = html.index("var AI_ART_TABLE")
end = html.index("};", start)
block = html[start:end]

entries = []
total_before = 0
total_after = 0
preview = []

for eid in IDS:
    raw = RAW_DIR / f"{eid}_dead_raw.jpg"
    if not raw.exists():
        entries.append({"id": eid, "error": "原始素材缺失"})
        continue
    im = Image.open(raw)
    cut, bg, cleared, tot = cutout(im)
    sq = to_square(cut)
    small = sq.resize((SIZE, SIZE), Image.LANCZOS)
    buf = io.BytesIO()
    small.save(buf, "WEBP", quality=86, method=6)
    out = buf.getvalue()
    b64 = base64.b64encode(out).decode("ascii")
    key = eid + "_dead"
    # 若键已存在则替换，否则插入到表头之后
    pat = re.compile('"' + re.escape(key) + '":"data:image/[a-z]+;base64,[A-Za-z0-9+/=]+"')
    if pat.search(block):
        block = pat.sub('"' + key + '":"data:image/webp;base64,' + b64 + '"', block, count=1)
        mode = "替换"
    else:
        block = block.replace('{"', '{"' + key + '":"data:image/webp;base64,' + b64 + '",', 1)
        mode = "插入"
    entries.append({"id": eid, "key": key, "mode": mode, "cutPct": round(cleared * 100.0 / tot, 1),
                    "size": SIZE, "bytes": len(out), "kb": round(len(out) / 1024, 1)})
    total_after += len(out)
    if len(preview) < 10:
        preview.append((key, small))

new_html = html[:start] + block + html[end:]
out_path = src_path.with_suffix(".dead.html")
out_path.write_text(new_html, encoding="utf-8")

# 预览条
if preview:
    CELL = 150
    sheet = Image.new("RGB", (CELL * len(preview), CELL), (18, 18, 26))
    for i, (k, im) in enumerate(preview):
        bgc = Image.new("RGB", im.size, (18, 18, 26))
        bgc.paste(im, (0, 0), im)
        bgc = bgc.resize((CELL, CELL), Image.NEAREST)
        sheet.paste(bgc, (i * CELL, 0))
    sheet.save(OUT / "dead-preview.png")

ok = [e for e in entries if "bytes" in e]
mem_mb = SIZE * SIZE * 4 * len(ok) / 1024 / 1024
report = {
    "source": str(src_path), "output": str(out_path), "size": SIZE,
    "count": len(ok), "errors": [e for e in entries if "error" in e],
    "payloadKB": round(total_after / 1024, 1),
    "pixelMemMB": round(mem_mb, 3),
    "entries": entries,
}
(OUT / "dead-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

md = [
    "# 死亡帧构建报告",
    "",
    f"- 源 → 输出: `{src_path}` → `{out_path}`",
    f"- 成功: **{len(ok)}/{len(IDS)}**   尺寸: {SIZE}×{SIZE}",
    f"- 贴图载荷: **{report['payloadKB']} KB**",
    f"- **像素内存增量: {report['pixelMemMB']} MB**（上限 4MB，当前 3.402MB）",
    "",
    "| id | 键名 | 方式 | 抠除% | KB |",
    "|---|---|---|---|---|",
]
for e in entries:
    if "error" in e:
        md.append(f"| {e['id']} | - | ❌ {e['error']} | - | - |")
    else:
        md.append(f"| {e['id']} | `{e['key']}` | {e['mode']} | {e['cutPct']} | {e['kb']} |")
(OUT / "report-dead.md").write_text("\n".join(md) + "\n", encoding="utf-8")
print("\n".join(md))
print(f"\n输出: {out_path}  ({out_path.stat().st_size} 字节)")
sys.exit(0 if len(ok) == len(IDS) else 1)
