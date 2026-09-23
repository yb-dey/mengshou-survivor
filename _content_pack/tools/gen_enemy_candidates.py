# -*- coding: utf-8 -*-
"""gen_enemy_candidates.py — 程序化生成 6 个候选敌种精灵（96×96 RGBA 真透底）
复用 gen_vfx.Canvas 距离场画法。与现有 6 敌种（wave_design）同 Q 版风格但**不覆盖**：
输出到独立目录 enemy_candidates/，作为「待接入阶段池的候选包」。
"""
import os
import math
from gen_vfx import Canvas, save

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'enemy_candidates')
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


def eyes(c, lx, ly, rx, ry, r=4.0, hi=True):
    for ex, ey in [(lx, ly), (rx, ry)]:
        circle(c, ex, ey, r, (0.10, 0.10, 0.12))
        if hi:
            circle(c, ex - r * 0.3, ey - r * 0.35, r * 0.35, (1, 1, 1), 0.9)


def feet(c, cx, cy, dx, rgb, r=5):
    for sx in (-dx, dx):
        ell(c, cx + sx, cy, r, r * 0.65, rgb)


# ---------------- 1. 灰烬蛾（fire · swarm 群飞自爆）----------------
def e_ember_moth():
    c = Canvas(S, S)
    wing = (0.85, 0.42, 0.22)
    wing_d = (0.62, 0.28, 0.14)
    body = (0.45, 0.28, 0.20)
    ell(c, 48, 54, 10, 16, body)                       # 身
    for sx in (-1, 1):                                 # 双翅
        ell(c, 48 + sx * 17, 44, 15, 12, wing_d)
        ell(c, 48 + sx * 17, 44, 11, 8, wing)
        circle(c, 48 + sx * 20, 40, 3, (0.95, 0.72, 0.35), 0.85)
    circle(c, 48, 38, 8, body)                         # 头
    for sx in (-1, 1):                                 # 触角
        for i in range(10):
            t = i / 10
            c.blend(48 + sx * (6 + 8 * t), 32 - 10 * t, body[0], body[1], body[2], 1.0)
    eyes(c, 45, 37, 51, 37, 3)
    c.glow(48, 52, 18, (0.95, 0.45, 0.15), 0.22)       # 余烬辉光
    save(c, os.path.join(OUT, 'cand_ember_moth.png'))


# ---------------- 2. 泡囊蛙（water · ranged 远程减速）----------------
def e_bubble_toad():
    c = Canvas(S, S)
    body = (0.35, 0.62, 0.78)
    belly = (0.62, 0.82, 0.90)
    ell(c, 48, 62, 22, 18, body)                       # 身
    ell(c, 48, 68, 15, 11, belly, 0.9)
    ell(c, 48, 46, 18, 13, body)                       # 头
    circle(c, 38, 40, 6, (0.95, 0.97, 1.0))            # 突眼
    circle(c, 58, 40, 6, (0.95, 0.97, 1.0))
    circle(c, 38, 40, 3, (0.10, 0.12, 0.16))
    circle(c, 58, 40, 3, (0.10, 0.12, 0.16))
    for i in range(24):                                # 嘴线
        t = (i - 12) / 12
        c.blend(48 + t * 12, 52 + abs(t) * 3, 0.25, 0.45, 0.58, 0.9)
    feet(c, 48, 78, 14, (0.28, 0.52, 0.68))
    for bx, by, br in [(26, 34, 5), (70, 30, 4), (72, 44, 3)]:   # 泡囊
        circle(c, bx, by, br, (0.72, 0.90, 0.98), 0.55)
        circle(c, bx, by, br * 0.55, (1, 1, 1), 0.5)
    save(c, os.path.join(OUT, 'cand_bubble_toad.png'))


# ---------------- 3. 卵石蟹（earth · tank 装甲格挡）----------------
def e_pebble_crab():
    c = Canvas(S, S)
    shell = (0.58, 0.55, 0.52)
    shell_d = (0.42, 0.40, 0.39)
    ell(c, 48, 58, 26, 17, shell_d)                    # 甲壳
    ell(c, 48, 54, 22, 13, shell)
    ell(c, 48, 50, 14, 7, (0.70, 0.68, 0.64), 0.8)     # 高光
    for sx in (-1, 1):                                 # 螯
        ell(c, 48 + sx * 26, 52, 9, 7, shell_d)
        tri(c, [(48 + sx * 30, 46), (48 + sx * 38, 52), (48 + sx * 28, 58)], shell)
    eyes(c, 43, 44, 53, 44, 3.4)
    for sx in (-2, 0, 2):                              # 腿
        for i in range(8):
            c.blend(48 + sx * 10 + i * 0.6, 72 + i * 1.2, shell_d[0], shell_d[1], shell_d[2], 1.0)
    circle(c, 34, 62, 2.5, (0.30, 0.48, 0.30), 0.8)    # 壳上苔
    save(c, os.path.join(OUT, 'cand_pebble_crab.png'))


# ---------------- 4. 辉光萤（light · support 治疗光环）----------------
def e_glow_moth():
    c = Canvas(S, S)
    wing = (0.95, 0.92, 0.60)
    body = (0.62, 0.58, 0.42)
    ell(c, 48, 58, 8, 14, body)
    for sx in (-1, 1):
        ell(c, 48 + sx * 15, 48, 16, 11, wing, 0.75)
        ell(c, 48 + sx * 15, 48, 10, 6, (1, 1, 0.85), 0.85)
    ell(c, 48, 76, 9, 7, (0.98, 0.95, 0.70))           # 尾灯
    eyes(c, 45, 54, 51, 54, 3)
    c.glow(48, 76, 24, (1.0, 0.95, 0.55), 0.42)        # 治疗光环
    for k in range(6):                                 # 光点
        a = math.radians(k * 60)
        circle(c, 48 + 20 * math.cos(a), 76 + 12 * math.sin(a), 1.8, (1, 1, 0.85), 0.8)
    save(c, os.path.join(OUT, 'cand_glow_moth.png'))


# ---------------- 5. 荆刺野豕（wood · charger 冲锋撞击）----------------
def e_thorn_boar():
    c = Canvas(S, S)
    body = (0.48, 0.38, 0.28)
    dark = (0.35, 0.27, 0.19)
    ell(c, 50, 60, 24, 16, body)                       # 身
    ell(c, 74, 56, 12, 11, dark)                       # 头
    for k in range(7):                                 # 背刺
        sx = 34 + k * 7
        tri(c, [(sx, 48), (sx + 4, 40), (sx + 8, 48)], (0.32, 0.55, 0.30))
    tri(c, [(78, 52), (90, 50), (78, 60)], (0.85, 0.80, 0.72))   # 獠牙
    tri(c, [(78, 62), (88, 64), (78, 68)], (0.85, 0.80, 0.72))
    circle(c, 70, 52, 3, (0.10, 0.12, 0.12))
    feet(c, 50, 74, 12, dark, 5)
    circle(c, 40, 52, 3, (0.90, 0.85, 0.70), 0.7)      # 侧斑
    save(c, os.path.join(OUT, 'cand_thorn_boar.png'))


# ---------------- 6. 灰烬狼（fire · skirmisher 游击撕咬）----------------
def e_ash_wolf():
    c = Canvas(S, S)
    fur = (0.42, 0.40, 0.44)
    dark = (0.30, 0.28, 0.32)
    ell(c, 48, 62, 22, 14, fur)                        # 身
    ell(c, 70, 52, 13, 11, dark)                       # 头
    for sx, ang in [(-1, -0.5), (1, -0.4)]:            # 耳
        tri(c, [(70 + sx * 8, 44), (70 + sx * 12, 32), (70 + sx * 2, 42)], dark)
    ell(c, 82, 56, 8, 5, (0.22, 0.20, 0.24))           # 吻
    circle(c, 86, 55, 2, (0.10, 0.10, 0.12))
    eyes(c, 68, 50, 76, 48, 3.2)
    for i in range(18):                                # 尾（余烬）
        t = i / 18
        c.blend(28 - 10 * t, 60 - 14 * t, fur[0], fur[1], fur[2], 1.0)
    feet(c, 48, 74, 13, dark, 5)
    c.glow(78, 54, 12, (0.95, 0.40, 0.20), 0.20)       # 眼中余烬
    save(c, os.path.join(OUT, 'cand_ash_wolf.png'))


JOBS = [
    ('cand_ember_moth', e_ember_moth),
    ('cand_bubble_toad', e_bubble_toad),
    ('cand_pebble_crab', e_pebble_crab),
    ('cand_glow_moth', e_glow_moth),
    ('cand_thorn_boar', e_thorn_boar),
    ('cand_ash_wolf', e_ash_wolf),
]

if __name__ == '__main__':
    for name, fn in JOBS:
        p = os.path.join(OUT, name + '.png')
        fn()
        print('PNG OK: %-22s %d bytes' % (name + '.png', os.path.getsize(p)))
    print('done:', len(JOBS), 'candidates ->', os.path.abspath(OUT))
