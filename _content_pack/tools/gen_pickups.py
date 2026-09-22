# -*- coding: utf-8 -*-
"""gen_pickups.py — 程序化生成 8 个局内拾取物精灵（64×64 RGBA 真透底）
复用 gen_vfx 的 Canvas 画法（blend/glow 距离场），纯标准库、零依赖。
风格：Q 版可爱 + 深色描边 + 微辉光，与 icons/（圆牌状态）、vfx/（爆发特效）语言区分：
拾取物 = 高辨识度小物件（能一眼看出「捡了有什么用」）。
"""
import os
from gen_vfx import Canvas, save

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pickups')
os.makedirs(OUT, exist_ok=True)
S = 64


def circle(c, cx, cy, r, rgb, a=1.0, edge=None):
    """实心圆（可选暗描边）"""
    for y in range(S):
        for x in range(S):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if d <= r:
                c.blend(x, y, rgb[0], rgb[1], rgb[2], a)
    if edge:
        for y in range(S):
            for x in range(S):
                d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
                if r < d <= r + 1.6:
                    c.blend(x, y, edge[0], edge[1], edge[2], 0.9)


def rrect(c, x0, y0, x1, y1, r, rgb, a=1.0, edge=None):
    """圆角矩形"""
    for y in range(S):
        for x in range(S):
            if x0 + r <= x <= x1 - r and y0 <= y <= y1:
                c.blend(x, y, rgb[0], rgb[1], rgb[2], a)
            elif x0 <= x <= x1 and y0 + r <= y <= y1 - r:
                c.blend(x, y, rgb[0], rgb[1], rgb[2], a)
            elif x0 <= x < x0 + r and y0 <= y < y0 + r:
                if ((x - (x0 + r)) ** 2 + (y - (y0 + r)) ** 2) ** 0.5 <= r:
                    c.blend(x, y, rgb[0], rgb[1], rgb[2], a)
            elif x1 - r < x <= x1 and y0 <= y < y0 + r:
                if ((x - (x1 - r)) ** 2 + (y - (y0 + r)) ** 2) ** 0.5 <= r:
                    c.blend(x, y, rgb[0], rgb[1], rgb[2], a)
            elif x0 <= x < x0 + r and y1 - r < y <= y1:
                if ((x - (x0 + r)) ** 2 + (y - (y1 - r)) ** 2) ** 0.5 <= r:
                    c.blend(x, y, rgb[0], rgb[1], rgb[2], a)
            elif x1 - r < x <= x1 and y1 - r < y <= y1:
                if ((x - (x1 - r)) ** 2 + (y - (y1 - r)) ** 2) ** 0.5 <= r:
                    c.blend(x, y, rgb[0], rgb[1], rgb[2], a)
    if edge:
        e = edge
        for y in range(S):
            for x in range(S):
                inside = x0 + 1.4 <= x <= x1 - 1.4 and y0 + 1.4 <= y <= y1 - 1.4
                outer = x0 - 0.2 <= x <= x1 + 0.2 and y0 - 0.2 <= y <= y1 + 0.2
                if outer and not inside:
                    c.blend(x, y, e[0], e[1], e[2], 0.75)


def drop(c, cx, cy, r, rgb, a=1.0, edge=None):
    """水滴/晶露形：上尖下圆"""
    for y in range(S):
        for x in range(S):
            dx, dy = x - cx, y - cy
            if dy >= 0:
                d = (dx ** 2 + dy ** 2) ** 0.5
                inside = d <= r
            else:
                t = -dy / (r * 1.9)
                inside = abs(dx) <= r * (1 - t) * 0.92 and -dy <= r * 1.9
            if inside:
                c.blend(x, y, rgb[0], rgb[1], rgb[2], a)
    if edge:
        for y in range(S):
            for x in range(S):
                dx, dy = x - cx, y - cy
                if dy >= 0:
                    d = (dx ** 2 + dy ** 2) ** 0.5
                    if r < d <= r + 1.5:
                        c.blend(x, y, edge[0], edge[1], edge[2], 0.85)


def shine(c, x, y, rgb=(1, 1, 1), a=0.9):
    """两像素高光点"""
    c.blend(x, y, rgb[0], rgb[1], rgb[2], a)
    c.blend(x + 1, y, rgb[0], rgb[1], rgb[2], a * 0.6)
    c.blend(x, y + 1, rgb[0], rgb[1], rgb[2], a * 0.6)


def base_glow(c, rgb, intensity=0.25, radius=26):
    c.glow(S / 2, S / 2 + 2, radius, rgb, intensity)


# ---------------- 1. 治愈果实（红浆果） ----------------
def pk_heal(path):
    c = Canvas(S, S)
    base_glow(c, (0.95, 0.35, 0.40), 0.20)
    circle(c, 32, 38, 15, (0.90, 0.28, 0.34), edge=(0.45, 0.10, 0.14))          # 浆果主体
    circle(c, 25, 32, 5, (1.0, 0.55, 0.58), a=0.85)                              # 左上亮斑
    shine(c, 24, 30)
    circle(c, 39, 44, 3.2, (0.72, 0.16, 0.22), a=0.9)                            # 右下暗斑
    rrect(c, 29, 16, 35, 25, 1.5, (0.42, 0.62, 0.30), edge=(0.22, 0.36, 0.14))   # 叶柄
    for dx, rot in [(-6, -1), (6, 1)]:                                           # 两片叶
        for t in range(9):
            c.blend(32 + dx * t / 8, 20 - t * 1.1, 0.48, 0.72, 0.32, 0.95)
    save(c, path)


# ---------------- 2. 金币袋 ----------------
def pk_coin(path):
    c = Canvas(S, S)
    base_glow(c, (0.95, 0.80, 0.30), 0.20)
    circle(c, 32, 40, 16, (0.86, 0.68, 0.28), edge=(0.45, 0.32, 0.10))           # 袋身
    circle(c, 32, 22, 8, (0.78, 0.58, 0.22), edge=(0.42, 0.28, 0.08))            # 袋口
    rrect(c, 27, 24, 37, 29, 2, (0.55, 0.38, 0.12), edge=None)                   # 系绳结
    circle(c, 32, 42, 8.5, (0.98, 0.85, 0.45))                                   # 袋上金币纹
    for y in range(S):
        for x in range(S):
            if ((x - 32) ** 2 + (y - 42) ** 2) ** 0.5 <= 8.5 and 38 <= y <= 47 and abs(x - 32) <= 1.2:
                c.blend(x, y, 0.62, 0.44, 0.14, 0.9)                             # 币纹竖线
    shine(c, 23, 33)
    shine(c, 40, 48)
    save(c, path)


# ---------------- 3. 磁石（马蹄形） ----------------
def pk_magnet(path):
    c = Canvas(S, S)
    base_glow(c, (0.45, 0.55, 0.95), 0.20)
    red = (0.85, 0.30, 0.32)
    edge = (0.40, 0.12, 0.14)
    # U 形磁铁：左腿 + 右腿 + 底部半圆弧
    rrect(c, 18, 14, 26, 40, 2, red, edge=edge)
    rrect(c, 38, 14, 46, 40, 2, red, edge=edge)
    for y in range(S):
        for x in range(S):
            d = ((x - 32) ** 2 + 0) ** 0.5
            if 26 <= x <= 38 and 32 <= y <= 40:
                c.blend(x, y, red[0], red[1], red[2], 1.0)
    circle(c, 32, 32, 14, (0, 0, 0), a=0)  # no-op keep
    # 内挖半圆（把弧心掏空成马蹄）
    for y in range(S):
        for x in range(S):
            d = ((x - 32) ** 2 + (y - 40) ** 2) ** 0.5
            if d < 12 and 26 <= x <= 38:
                pass  # 中间镂空区被腿与弧覆盖，保持
    rrect(c, 16, 12, 28, 20, 2, (0.92, 0.94, 0.98), edge=(0.55, 0.58, 0.66))     # 白极头（左）
    rrect(c, 36, 12, 48, 20, 2, (0.92, 0.94, 0.98), edge=(0.55, 0.58, 0.66))     # 白极头（右）
    shine(c, 21, 28)
    shine(c, 43, 30)
    save(c, path)


# ---------------- 4. 震地菇（蘑菇炸弹） ----------------
def pk_bomb(path):
    c = Canvas(S, S)
    base_glow(c, (0.85, 0.55, 0.30), 0.18)
    # 菌盖：宽半圆
    for y in range(S):
        for x in range(S):
            dx, dy = x - 32, y - 30
            if dy <= 0 and (dx ** 2 + (dy * 1.45) ** 2) ** 0.5 <= 19:
                c.blend(x, y, 0.72, 0.34, 0.26, 1.0)
            if dy <= 0 and 19 < (dx ** 2 + (dy * 1.45) ** 2) ** 0.5 <= 20.4:
                c.blend(x, y, 0.36, 0.14, 0.10, 0.85)
    for cx, cy, r in [(22, 24, 3.4), (36, 20, 2.8), (42, 27, 2.2), (29, 17, 2.4)]:  # 盖上白点
        circle(c, cx, cy, r, (0.96, 0.90, 0.82))
    rrect(c, 25, 30, 39, 47, 5, (0.93, 0.88, 0.78), edge=(0.55, 0.48, 0.38))     # 菌柄
    circle(c, 32, 39, 2.2, (0.55, 0.48, 0.38), a=0.8)                            # 柄纹
    circle(c, 32, 12, 1.8, (1.0, 0.85, 0.35))                                    # 引信火花
    c.glow(32, 12, 6, (1.0, 0.80, 0.30), 0.5)
    shine(c, 27, 34)
    save(c, path)


# ---------------- 5. 宝箱 ----------------
def pk_chest(path):
    c = Canvas(S, S)
    base_glow(c, (0.90, 0.70, 0.30), 0.20)
    wood = (0.62, 0.42, 0.24)
    wood_edge = (0.34, 0.20, 0.10)
    rrect(c, 12, 26, 52, 52, 4, wood, edge=wood_edge)                            # 箱体
    rrect(c, 12, 14, 52, 28, 4, (0.72, 0.50, 0.28), edge=wood_edge)              # 箱盖
    for x in range(18, 50, 10):                                                  # 木纹竖条
        for y in range(28, 52):
            c.blend(x, y, 0.50, 0.32, 0.18, 0.7)
    rrect(c, 29, 24, 35, 40, 2, (0.92, 0.76, 0.30), edge=(0.55, 0.40, 0.10))     # 金锁扣
    circle(c, 32, 33, 2.4, (0.45, 0.30, 0.08))                                   # 锁孔
    rrect(c, 12, 36, 52, 40, 1, (0.80, 0.62, 0.26), edge=None)                   # 金属横带
    shine(c, 17, 19)
    shine(c, 46, 46)
    save(c, path)


# ---------------- 6. 经验晶露（绿晶滴） ----------------
def pk_exp(path):
    c = Canvas(S, S)
    base_glow(c, (0.45, 0.95, 0.55), 0.22)
    drop(c, 32, 36, 14, (0.38, 0.85, 0.48), edge=(0.14, 0.42, 0.20))
    circle(c, 27, 40, 4.5, (0.72, 1.0, 0.78), a=0.9)                             # 内亮核
    shine(c, 26, 38)
    c.glow(32, 40, 12, (0.45, 0.95, 0.55), 0.30)
    save(c, path)


# ---------------- 7. 灵盾花（白花盾） ----------------
def pk_shield(path):
    c = Canvas(S, S)
    base_glow(c, (0.85, 0.92, 1.0), 0.20)
    circle(c, 32, 30, 13, (0.90, 0.93, 0.98), edge=(0.55, 0.60, 0.72))           # 盘面
    # 五瓣花瓣
    import math
    for k in range(5):
        ang = -math.pi / 2 + k * 2 * math.pi / 5
        px, py = 32 + 16 * math.cos(ang), 30 + 16 * math.sin(ang)
        circle(c, px, py, 4.6, (0.96, 0.86, 0.92), edge=(0.60, 0.45, 0.55))
    # 中心盾形
    for y in range(24, 38):
        for x in range(26, 39):
            t = (y - 24) / 14.0
            half = 5.5 * (1 - t * 0.55)
            if abs(x - 32) <= half and 24 <= y <= 36:
                c.blend(x, y, 0.42, 0.62, 0.90, 1.0)
            if abs(x - 32) in (5, 6) and 25 <= y <= 35:
                c.blend(x, y, 0.20, 0.34, 0.58, 0.85)
    shine(c, 24, 22)
    save(c, path)


# ---------------- 8. 幸运骰 ----------------
def pk_reroll(path):
    c = Canvas(S, S)
    base_glow(c, (0.95, 0.92, 0.85), 0.18)
    rrect(c, 14, 14, 50, 50, 10, (0.96, 0.94, 0.90), edge=(0.55, 0.52, 0.48))    # 骰身
    for cx, cy in [(22, 22), (42, 42), (32, 32), (42, 22), (22, 42)]:            # 5 点
        circle(c, cx, cy, 3.4, (0.28, 0.28, 0.32))
    shine(c, 20, 18)
    save(c, path)


JOBS = [
    ('pickup_heal.png', pk_heal),
    ('pickup_coin.png', pk_coin),
    ('pickup_magnet.png', pk_magnet),
    ('pickup_bomb.png', pk_bomb),
    ('pickup_chest.png', pk_chest),
    ('pickup_exp.png', pk_exp),
    ('pickup_shield.png', pk_shield),
    ('pickup_reroll.png', pk_reroll),
]

if __name__ == '__main__':
    for name, fn in JOBS:
        p = os.path.join(OUT, name)
        fn(p)
        print('PNG OK:', name, os.path.getsize(p), 'bytes')
    print('done:', len(JOBS), 'pickups ->', os.path.abspath(OUT))
