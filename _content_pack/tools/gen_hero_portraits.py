# -*- coding: utf-8 -*-
"""gen_hero_portraits.py — 程序化生成 4 枚英雄徽章头像（128×128 RGBA 真透底）
复用 gen_vfx.Canvas 距离场画法。视觉语言：圆形徽章底盘（深底 + 元素色双环）+ Q 版主体 + 元素纹样。
与 icons/（圆牌状态）、skill_icons/（方板技能）、pickups/（小物件）区分：徽章 = 英雄身份。
"""
import os
import math
from gen_vfx import Canvas, save

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'hero_portraits')
os.makedirs(OUT, exist_ok=True)
S = 128
CX = CY = 64


def circle(c, cx, cy, r, rgb, a=1.0):
    for y in range(S):
        for x in range(S):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                c.blend(x, y, rgb[0], rgb[1], rgb[2], a)


def ring_edge(c, r0, r1, rgb, a):
    for y in range(S):
        for x in range(S):
            d = math.sqrt((x - CX) ** 2 + (y - CY) ** 2)
            if r0 <= d <= r1:
                c.blend(x, y, rgb[0], rgb[1], rgb[2], a)


def disc_base(c, main_rgb, glow_rgb):
    """统一徽章底盘：暗底 + 元素色双环 + 辉光"""
    circle(c, CX, CY, 58, (0.05, 0.10, 0.07))
    ring_edge(c, 58, 61, main_rgb, 1.0)
    ring_edge(c, 52.5, 54.5, main_rgb, 0.55)
    c.glow(CX, CY, 52, glow_rgb, 0.16)


def tri(c, pts, rgb, a=1.0):
    """实心三角形（重心坐标法）"""
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


def line_thick(c, x0, y0, x1, y1, w, rgb, a=1.0):
    d = math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2) or 1e-6
    ux, uy = (x1 - x0) / d, (y1 - y0) / d
    steps = int(d * 2)
    for i in range(steps + 1):
        t = i / steps
        px, py = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        for oy in range(-int(w), int(w) + 1):
            for ox in range(-int(w), int(w) + 1):
                if ox * ox + oy * oy <= w * w:
                    c.blend(px + ox, py + oy, rgb[0], rgb[1], rgb[2], a)


def shine(c, x, y, a=0.9):
    for oy in range(2):
        for ox in range(3):
            c.blend(x + ox, y + oy, 1, 1, 1, a * (1 - 0.25 * (ox + oy)))


# ---------------- 1. 灵鹿祭司（wood·木）：白鹿脸 + 分叉鹿角 + 叶 ----------------
def pt_deer():
    c = Canvas(S, S)
    disc_base(c, (0.30, 0.75, 0.42), (0.35, 0.85, 0.45))
    face = (0.94, 0.95, 0.90)
    circle(c, CX, 74, 26, face)                                   # 脸
    circle(c, CX - 22, 62, 7, face)                               # 左耳根
    circle(c, CX + 22, 62, 7, face)
    # 分叉鹿角（棕，左右对称两叉）
    ant = (0.55, 0.38, 0.22)
    for sx in (-1, 1):
        x0 = CX + sx * 16
        line_thick(c, x0, 56, x0 + sx * 8, 30, 2.5, ant)
        line_thick(c, x0 + sx * 5, 42, x0 + sx * 18, 36, 2, ant)   # 前叉
        line_thick(c, x0 + sx * 7, 34, x0 + sx * 16, 22, 2, ant)   # 上叉
    # 眼 + 鼻
    circle(c, CX - 10, 72, 3.2, (0.15, 0.18, 0.15))
    circle(c, CX + 10, 72, 3.2, (0.15, 0.18, 0.15))
    circle(c, CX, 86, 4.5, (0.35, 0.25, 0.25))
    # 额叶（木元素纹样）
    for sx in (-1, 1):
        tri(c, [(CX, 46), (CX + sx * 12, 40), (CX + sx * 4, 52)], (0.30, 0.62, 0.34), 0.95)
    shine(c, 44, 62)
    save(c, os.path.join(OUT, 'portrait_deer.png'))


# ---------------- 2. 雷羽鹰（light·光）：金喙鸟首 + 闪电羽冠 ----------------
def pt_eagle():
    c = Canvas(S, S)
    disc_base(c, (0.95, 0.85, 0.35), (1.0, 0.92, 0.5))
    head = (0.58, 0.68, 0.86)
    circle(c, CX, 72, 25, head)                                   # 头
    tri(c, [(CX, 96), (CX - 12, 84), (CX + 12, 84)], (0.95, 0.72, 0.25))   # 喙
    circle(c, CX - 11, 66, 6.5, (1, 1, 1))                        # 眼白
    circle(c, CX + 11, 66, 6.5, (1, 1, 1))
    circle(c, CX - 11, 66, 3.2, (0.10, 0.12, 0.16))
    circle(c, CX + 11, 66, 3.2, (0.10, 0.12, 0.16))
    # 闪电羽冠（三道锯齿，light 金白）
    bolt = (1.0, 0.93, 0.45)
    for k, dx in enumerate((-14, 0, 14)):
        pts = [(CX + dx, 50), (CX + dx - 5, 38), (CX + dx + 4, 38), (CX + dx - 2, 24)]
        for i in range(3):
            line_thick(c, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 2.2, bolt)
    # 额心小闪电
    tri(c, [(CX, 58), (CX - 5, 70), (CX + 6, 62)], bolt, 0.95)
    shine(c, 44, 58)
    save(c, os.path.join(OUT, 'portrait_eagle.png'))


# ---------------- 3. 霜甲熊（water·水）：棕熊脸 + 圆耳 + 冰霜纹 ----------------
def pt_bear():
    c = Canvas(S, S)
    disc_base(c, (0.35, 0.62, 0.92), (0.45, 0.72, 1.0))
    fur = (0.52, 0.36, 0.24)
    circle(c, CX - 20, 48, 9, fur)                                # 左耳
    circle(c, CX + 20, 48, 9, fur)
    circle(c, CX - 20, 48, 4.5, (0.72, 0.58, 0.48))
    circle(c, CX + 20, 48, 4.5, (0.72, 0.58, 0.48))
    circle(c, CX, 72, 27, fur)                                    # 脸
    circle(c, CX, 84, 12, (0.78, 0.66, 0.56))                     # 口鼻
    circle(c, CX, 80, 4, (0.12, 0.10, 0.10))                      # 鼻
    circle(c, CX - 12, 68, 3.2, (0.12, 0.10, 0.10))
    circle(c, CX + 12, 68, 3.2, (0.12, 0.10, 0.10))
    # 冰霜纹（water 元素纹样：三道冰蓝弧）
    ice = (0.62, 0.86, 1.0)
    for k, r in enumerate((34, 40, 46)):
        for deg in range(210, 331, 4):
            a = math.radians(deg)
            x = CX + r * math.cos(a)
            y = 72 + r * 0.86 * math.sin(a)
            if 0 <= x < S and 0 <= y < S:
                c.blend(x, y, ice[0], ice[1], ice[2], 0.55 - k * 0.12)
    shine(c, 42, 60)
    save(c, os.path.join(OUT, 'portrait_bear.png'))


# ---------------- 4. 焰心术士（fire·火）：暗袍帽 + 三层火焰 + 余烬 ----------------
def pt_mage():
    c = Canvas(S, S)
    disc_base(c, (0.95, 0.45, 0.25), (1.0, 0.55, 0.25))
    # 焰形（三层水滴叠加：外橙 / 中金 / 内白）
    def flame(cx, cy, r, h, rgb, a=1.0):
        circle(c, cx, cy, r, rgb, a)
        for y in range(S):
            for x in range(S):
                dx, dy = x - cx, y - cy
                if dy < 0:
                    t = -dy / h
                    if abs(dx) <= r * (1 - t) * 0.85 and -dy <= h:
                        c.blend(x, y, rgb[0], rgb[1], rgb[2], a)
    flame(CX, 78, 22, 30, (0.92, 0.38, 0.15))
    flame(CX, 82, 14, 22, (0.98, 0.70, 0.20))
    flame(CX, 86, 7, 13, (1.0, 0.95, 0.75))
    # 帽檐阴影弧（术士感）
    for deg in range(200, 341, 3):
        a = math.radians(deg)
        x = CX + 26 * math.cos(a)
        y = 70 + 26 * 0.5 * math.sin(a)
        c.blend(x, y, 0.25, 0.10, 0.08, 0.55)
    # 余烬粒子
    rng = [(30, 40), (92, 52), (74, 34), (46, 30), (96, 84)]
    for x, y in rng:
        circle(c, x, y, 1.6, (1.0, 0.72, 0.30), 0.85)
    shine(c, 44, 64)
    save(c, os.path.join(OUT, 'portrait_mage.png'))


JOBS = [
    ('portrait_deer.png', pt_deer),
    ('portrait_eagle.png', pt_eagle),
    ('portrait_bear.png', pt_bear),
    ('portrait_mage.png', pt_mage),
]

if __name__ == '__main__':
    for name, fn in JOBS:
        p = os.path.join(OUT, name)
        fn()
        print('PNG OK:', name, os.path.getsize(p), 'bytes')
    print('done:', len(JOBS), 'portraits ->', os.path.abspath(OUT))
