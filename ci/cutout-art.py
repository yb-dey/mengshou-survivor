# -*- coding: utf-8 -*-
"""批量抠图 —— 把 game/*.html 内联的 AI 贴图背景去掉，写回一个新 HTML。

为什么必须是「边缘洪水填充」而不是颜色阈值：
  角色内部有白色眼睛高光/白肚皮，按颜色一刀切会把它们一起删掉。

安全前提（已核对代码）：
  makeEnemySprite 里 drawImage(aiA, …, aiD, aiD) 会把贴图**拉伸铺满** vis*2 方块，
  且 half 由 vis+pad*0.22 算出、与图片尺寸无关
  → 抠掉背景**不改变游戏内显示尺寸**，也没有尺寸跳变风险。

产物：game/<原名>.cutout.html + cutout-report.json + cutout-preview.png
"""
import base64
import io
import json
import os
import re
import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw

TOL = int(os.environ.get("CUTOUT_TOL", "30"))
GAME_DIR = Path("game")
OUT_DIR = Path("ci/out")
OUT_DIR.mkdir(parents=True, exist_ok=True)

htmls = [p for p in GAME_DIR.glob("*.html")]
assert len(htmls) == 1, f"期望 game/ 下恰好一个 html，实得 {len(htmls)}"
src_path = htmls[0]
html = src_path.read_text(encoding="utf-8")

start = html.index("var AI_ART_TABLE")
end = html.index("};", start)
block = html[start:end]

ENTRY = re.compile(r'"([A-Za-z0-9_]+)":"data:image/(webp|png);base64,([A-Za-z0-9+/=]+)"')


def cutout(im, tol=TOL):
    """从四边向内洪水填充，只清除与边缘连通的背景区域。"""
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


stats = []
new_block = block
total_before = 0
total_after = 0
preview = []

for m in list(ENTRY.finditer(block)):
    key, fmt, b64 = m.group(1), m.group(2), m.group(3)
    raw = base64.b64decode(b64)
    total_before += len(raw)
    try:
        im = Image.open(io.BytesIO(raw))
        w0, h0 = im.size
        cut, bg, cleared, tot = cutout(im)
        ratio = cleared * 100.0 / tot
        buf = io.BytesIO()
        # 带 alpha 的 WebP：Pillow 检测到 RGBA 会自动写 VP8X+ALPH
        cut.save(buf, "WEBP", quality=84, method=6)
        out = buf.getvalue()
        if ratio < 3:            # 几乎没抠掉东西 → 可能本来就透明，保持原样
            stats.append({"key": key, "size": f"{w0}x{h0}", "bg": bg, "clearedPct": round(ratio, 1),
                          "note": "skip(无需抠)", "before": len(raw), "after": len(raw)})
            total_after += len(raw)
            continue
        new_uri = f"data:image/{fmt};base64," + base64.b64encode(out).decode("ascii")
        new_block = new_block.replace(m.group(0), f'"{key}":"{new_uri}"', 1)
        total_after += len(out)
        stats.append({"key": key, "size": f"{w0}x{h0}", "bg": bg, "clearedPct": round(ratio, 1),
                      "before": len(raw), "after": len(out)})
        if len(preview) < 12 and ratio > 20:
            preview.append((key, cut))
    except Exception as e:  # noqa: BLE001
        total_after += len(raw)
        stats.append({"key": key, "error": str(e)[:120], "before": len(raw), "after": len(raw)})

new_html = html[:start] + new_block + html[end:]
out_path = src_path.with_suffix(".cutout.html")
out_path.write_text(new_html, encoding="utf-8")

# 预览条：上排原图、下排抠后，直观对比
if preview:
    CELL = 128
    sheet = Image.new("RGBA", (CELL * len(preview), CELL * 2), (18, 18, 26, 255))
    d = ImageDraw.Draw(sheet)
    for i, (k, cut) in enumerate(preview):
        s = min((CELL - 12) / cut.size[0], (CELL - 22) / cut.size[1], 1.0)
        small = cut.resize((max(1, int(cut.size[0] * s)), max(1, int(cut.size[1] * s))), Image.NEAREST)
        sheet.alpha_composite(small, (i * CELL + (CELL - small.size[0]) // 2, 4 + (CELL - 22 - small.size[1]) // 2))
        d.text((i * CELL + 6, CELL - 16), k[:16], fill=(220, 220, 235, 255))
    sheet.save(OUT_DIR / "cutout-preview.png")

changed = sum(1 for s in stats if "clearedPct" in s and s["clearedPct"] >= 3)
report = {
    "source": str(src_path),
    "output": str(out_path),
    "entries": len(stats),
    "changed": changed,
    "skipped": sum(1 for s in stats if s.get("note")),
    "errors": sum(1 for s in stats if s.get("error")),
    "payloadBeforeKB": round(total_before / 1024),
    "payloadAfterKB": round(total_after / 1024),
    "deltaPct": round((total_after - total_before) * 100.0 / total_before, 1),
    "details": stats,
}
(OUT_DIR / "cutout-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

md = [
    "# 批量抠图报告",
    "",
    f"- 源文件: `{src_path}` → `{out_path}`",
    f"- 处理条目: **{len(stats)}**（实际抠除 {changed}，跳过 {report['skipped']}，出错 {report['errors']}）",
    f"- 贴图载荷: {report['payloadBeforeKB']} KB → **{report['payloadAfterKB']} KB**（{report['deltaPct']:+}%）",
    "",
    "## 抠除比例最高/最低各 10 项",
    "",
    "| id | 尺寸 | 检出底色 | 抠除% | 前 KB | 后 KB |",
    "|---|---|---|---|---|---|",
]
ok = [s for s in stats if "clearedPct" in s]
for s in (sorted(ok, key=lambda x: -x["clearedPct"])[:10] + sorted(ok, key=lambda x: x["clearedPct"])[:10]):
    md.append(f"| {s['key']} | {s['size']} | rgb{tuple(s['bg'])} | {s['clearedPct']} | {round(s['before']/1024,1)} | {round(s['after']/1024,1)} |")
(OUT_DIR / "report.md").write_text("\n".join(md) + "\n", encoding="utf-8")

print("\n".join(md))
print(f"\n输出: {out_path}  ({out_path.stat().st_size} 字节)")
sys.exit(0)
