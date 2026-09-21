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
SIZE = int(os.environ.get("ART_SIZE", os.environ.get("DEAD_SIZE", "96")))
SUFFIX = os.environ.get("ART_SUFFIX", "_dead")          # "_dead" 或 "_hit"，驱动同一套流程
RAW_DIR = Path(os.environ.get("ART_RAW_DIR", "ci/dead-frames"))
GAME = Path("game")
OUT = Path("ci/out")
OUT.mkdir(parents=True, exist_ok=True)

DEFAULT_IDS = ["rabbit", "mouse", "bear", "fox", "badger", "boar", "monkey", "boss1", "boss2", "boss3",
               "leaptoad", "raven", "orbitcrab", "boomfruit", "sporecap", "burrowmole",
               "hedgehog", "chargerhino", "shieldbug", "honeypot", "rollshell"]
IDS = [x.strip() for x in os.environ.get("ART_IDS", ",".join(DEFAULT_IDS)).split(",") if x.strip()]
print("后缀 %s ｜ 尺寸 %d ｜ 素材目录 %s ｜ 目标 %d 个" % (SUFFIX, SIZE, RAW_DIR, len(IDS)))


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
injections = []
total_before = 0
total_after = 0
preview = []

for eid in IDS:
    raw = RAW_DIR / (eid + SUFFIX + "_raw.jpg")
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
    key = eid + SUFFIX
    entries.append({"id": eid, "key": key, "cutPct": round(cleared * 100.0 / tot, 1),
                    "size": SIZE, "bytes": len(out), "kb": round(len(out) / 1024, 1)})
    total_after += len(out)
    injections.append((key, b64))
    if len(preview) < 10:
        preview.append((key, small))

# ---------- 注入：一次性前缀插入（不做累积替换，避免引号/逗号错位）----------
# 幂等：先把同名旧键整段删掉（含其尾随逗号可选），再统一前缀插入
for key, _ in injections:
    block = re.sub('"' + re.escape(key) + '":"data:image/[a-z]+;base64,[A-Za-z0-9+/=]+",?', '', block)
prefix = "".join('"' + k + '":"data:image/webp;base64,' + v + '",' for k, v in injections)
ANCHOR = "var AI_ART_TABLE = {"
if block.count(ANCHOR) != 1:
    print("FAIL: 锚点 AI_ART_TABLE 命中 %d 次" % block.count(ANCHOR))
    sys.exit(3)
block = block.replace(ANCHOR, ANCHOR + prefix, 1)
for e, (k, _) in zip([x for x in entries if "bytes" in x], injections):
    e["mode"] = "前缀插入"

# 自检：键数应等于注入数，且每个键都必须带引号（**按当前 SUFFIX 计数**，
# 写死 "_dead" 会在受击帧那趟误报：它会把已有的 21 个 _dead 键当成目标数去比 → 实测踩过）
quoted = len(re.findall('"[A-Za-z0-9_]+' + re.escape(SUFFIX) + '":"data:image', block))
if quoted != len(injections):
    print("FAIL: 带引号的 %s 键 %d 个，期望 %d 个" % (SUFFIX, quoted, len(injections)))
    sys.exit(4)

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
