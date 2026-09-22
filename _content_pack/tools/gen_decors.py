# -*- coding: utf-8 -*-
"""gen_decors.py — 程序化生成 8 个场景装饰件（96×96 RGBA 真透底）
复用 gen_vfx.Canvas 距离场画法。视觉语言：低饱和森林配色、无描边强调（远景感），
与 pickups（小物件高饱和）、sprites（角色）区分：decors = 战场布景。
"""
import os
import math
from gen_vfx import Canvas, save

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'decors')
os.makedirs(OUT, exist_ok=True)
S = 96


def ell(c, cx, cy, rx, ry, rgb, a=1.0):
    for y in range(S):
        for x in range(S):
            dx, dy = (x - cx) / rx, (y - cy) / ry
            if dx * dx + dy * dy <= 1:
                c.blend(x, y, rgb[0], rgb[1], rgb[2], a)


def circle(c, cx, cy, r, rgb, a=1.0):
    ell(c, cx, cy, r, r, rgb, a)


def tri(c, pts, rgb, a=1.0):
    (x0, y0), (x1, y1), (x2, y2) = pts
    minx, maxx = int(min(x0, x1, x2)), int(max(x0, x1, x2)) + 1
    miny, maxy = int(min(y0, y1, y2)), int(max(y0, y1, y2)) + 1
    denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
    if abs(denom) < 1e-9:
        return
    for y in range(max(0, miny), min(S, maxy)):
        for x in range(max(0, minx), min(S, maxx)):
            l0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / denom
            l1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / denom
            l2 = 1 - l0 - l1
            if l0 >= 0 and l1 >= 0 and l2 >= 0:
                c.blend(x, y, rgb[0], rgb[1], rgb[2], a)


def blade(c, x, y, h, lean, w, rgb, a=1.0):
    """一根草叶：底粗顶尖的弯曲线条"""
    steps = int(h * 1.5)
    for i in range(steps):
        t = i / steps
        px = x + lean * t * t
        py = y - h * t
        ww = w * (1 - t * 0.85)
        for oy in range(-int(ww), int(ww) + 1):
            if abs(oy) <= ww:
                c.blend(px + oy, py, rgb[0], rgb[1], rgb[2], a)


GRASS = (0.36, 0.58, 0.30)
GRASS_D = (0.28, 0.47, 0.24)
TRUNK = (0.45, 0.32, 0.20)
LEAF = (0.30, 0.52, 0.28)
LEAF_D = (0.24, 0.42, 0.23)
ROCK = (0.52, 0.52, 0.55)
ROCK_D = (0.38, 0.38, 0.42)
PETAL = (0.92, 0.62, 0.70)
PETAL2 = (0.85, 0.75, 0.45)


def d_grass1(path):
    c = Canvas(S, S)
    for i, (x, h, ln) in enumerate([(30, 30, 6), (40, 40, 2), (50, 34, -5), (60, 26, 3), (68, 32, -8)]):
        blade(c, x, 88, h, ln, 2.6, GRASS if i % 2 == 0 else GRASS_D)
    save(c, path)


def d_grass2(path):
    c = Canvas(S, S)
    for i, (x, h, ln) in enumerate([(24, 38, -4), (34, 30, 5), (46, 44, 0), (58, 33, -6), (70, 40, 6)]):
        blade(c, x, 90, h, ln, 2.8, GRASS_D if i % 2 else GRASS)
    circle(c, 48, 88, 5, (0.30, 0.48, 0.26), 0.9)
    save(c, path)


def d_bush(path):
    c = Canvas(S, S)
    ell(c, 48, 74, 30, 16, LEAF_D)
    ell(c, 34, 66, 14, 12, LEAF)
    ell(c, 60, 64, 15, 13, LEAF)
    ell(c, 47, 58, 13, 12, (0.34, 0.58, 0.31))
    shine_dot = (0.42, 0.66, 0.38)
    circle(c, 40, 56, 3, shine_dot, 0.8)
    circle(c, 58, 60, 2.6, shine_dot, 0.7)
    save(c, path)


def d_tree(path):
    c = Canvas(S, S)
    ell(c, 48, 82, 8, 14, TRUNK)                       # 干
    ell(c, 48, 40, 27, 25, LEAF_D)                     # 冠
    ell(c, 36, 32, 16, 14, LEAF)
    ell(c, 60, 34, 15, 13, (0.34, 0.58, 0.31))
    ell(c, 48, 24, 13, 11, (0.38, 0.62, 0.34))
    circle(c, 38, 22, 2.5, (0.5, 0.74, 0.42), 0.8)
    circle(c, 58, 28, 2.2, (0.5, 0.74, 0.42), 0.7)
    save(c, path)


def d_rock(path):
    c = Canvas(S, S)
    tri(c, [(16, 84), (34, 48), (58, 58), ], ROCK)
    tri(c, [(58, 58), (76, 50), (82, 84)], ROCK)
    tri(c, [(16, 84), (58, 58), (82, 84)], ROCK_D, 0.85)
    tri(c, [(16, 84), (34, 48), (58, 58)], ROCK, 1.0)
    ell(c, 40, 56, 7, 4, (0.62, 0.63, 0.66), 0.8)      # 亮面
    circle(c, 62, 74, 2, (0.30, 0.50, 0.30), 0.85)     # 石上苔
    circle(c, 68, 78, 1.6, (0.30, 0.50, 0.30), 0.7)
    save(c, path)


def d_flower1(path):
    c = Canvas(S, S)
    for k in range(6):
        a = math.radians(k * 60 - 90)
        circle(c, 48 + 9 * math.cos(a), 44 + 9 * math.sin(a), 5.5, PETAL)
    circle(c, 48, 44, 4.2, (0.95, 0.85, 0.40))
    line_thick = 2.4
    for i in range(int(34 * 1.5)):
        t = i / (34 * 1.5)
        c.blend(48 + 2 * t * t, 50 + 34 * t, GRASS[0], GRASS[1], GRASS[2], 1.0)
        c.blend(48 + 2 * t * t + 1, 50 + 34 * t, GRASS_D[0], GRASS_D[1], GRASS_D[2], 0.8)
    blade(c, 56, 86, 20, 4, 2, GRASS_D)
    save(c, path)


def d_flower2(path):
    c = Canvas(S, S)
    for k in range(5):
        a = math.radians(k * 72 - 90)
        circle(c, 46 + 8 * math.cos(a), 50 + 8 * math.sin(a), 5, PETAL2)
    circle(c, 46, 50, 3.8, (0.90, 0.55, 0.35))
    for i in range(int(30 * 1.5)):
        t = i / (30 * 1.5)
        c.blend(46 - 2 * t * t, 56 + 30 * t, GRASS[0], GRASS[1], GRASS[2], 1.0)
    blade(c, 60, 88, 16, -3, 2, GRASS)
    save(c, path)


def d_shroom(path):
    c = Canvas(S, S)
    ell(c, 48, 76, 9, 13, (0.88, 0.84, 0.76))          # 柄
    ell(c, 48, 58, 20, 13, (0.55, 0.75, 0.85))         # 盖（冰蓝发光）
    ell(c, 48, 54, 15, 8, (0.70, 0.88, 0.95), 0.9)
    c.glow(48, 56, 22, (0.55, 0.85, 1.0), 0.30)
    for x, y in [(38, 56), (52, 52), (60, 58)]:
        circle(c, x, y, 2, (0.92, 0.97, 1.0), 0.9)
    save(c, path)


JOBS = [
    ('decor_grass1.png', d_grass1),
    ('decor_grass2.png', d_grass2),
    ('decor_bush.png', d_bush),
    ('decor_tree.png', d_tree),
    ('decor_rock.png', d_rock),
    ('decor_flower1.png', d_flower1),
    ('decor_flower2.png', d_flower2),
    ('decor_shroom.png', d_shroom),
]

if __name__ == '__main__':
    for name, fn in JOBS:
        p = os.path.join(OUT, name)
        fn(p)
        print('PNG OK:', name, os.path.getsize(p), 'bytes')
    print('done:', len(JOBS), 'decors ->', os.path.abspath(OUT))
