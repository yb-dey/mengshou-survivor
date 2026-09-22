# -*- coding: utf-8 -*-
"""通用边缘洪水填充抠图（文件进 / 文件出）。

算法来自项目 ci/cutout-art.py 的 cutout()：只清除与图片四边连通的背景区域，
因此角色内部的白色眼睛高光、白肚皮不会被误删。
本脚本把那个绑定 game/*.html 内联表的版本，改成对任意 PNG 目录通用的工具。

用法:
  python cutout.py <input_dir> <output_dir> [--tol 30]
产物: 每个输入 <name>.png -> <output_dir>/<name>.png (RGBA) + <name>.webp (RGBA, q84)
"""
import io
import os
import sys
from collections import deque
from pathlib import Path

from PIL import Image

TOL = int(os.environ.get("CUTOUT_TOL", "30"))


def cutout(im, tol=TOL):
    """从四边向内洪水填充，只清除与边缘连通的背景区域。返回 (RGBA图, 底色, 抠除比例)。"""
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
    return im, bg, cleared * 100.0 / (w * h)


def main():
    if len(sys.argv) < 3:
        print("用法: python cutout.py <input_dir> <output_dir> [--tol 30]")
        sys.exit(2)
    in_dir = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    tol = TOL
    if "--tol" in sys.argv:
        tol = int(sys.argv[sys.argv.index("--tol") + 1])

    pngs = sorted(in_dir.glob("*.png"))
    print(f"输入: {in_dir}  共 {len(pngs)} 张  tol={tol}\n")
    print(f"{'文件':<20}{'尺寸':<10}{'底色':<14}{'抠除%':<8}结果")
    for p in pngs:
        im = Image.open(p)
        w0, h0 = im.size
        cut, bg, ratio = cutout(im, tol)
        name = p.stem
        if ratio < 3:
            # 几乎没抠掉 -> 可能已是透明或背景不连通，保持原样复制
            cut.save(out_dir / f"{name}.png")
            cut.save(out_dir / f"{name}.webp", "WEBP", quality=84, method=6)
            print(f"{p.name:<20}{f'{w0}x{h0}':<10}{str(tuple(bg)):<14}{ratio:<8.1f}跳过(原样)")
            continue
        cut.save(out_dir / f"{name}.png")
        cut.save(out_dir / f"{name}.webp", "WEBP", quality=84, method=6)
        print(f"{p.name:<20}{f'{w0}x{h0}':<10}{str(tuple(bg)):<14}{ratio:<8.1f}已抠透")
    print(f"\n输出目录: {out_dir}")


if __name__ == "__main__":
    main()
