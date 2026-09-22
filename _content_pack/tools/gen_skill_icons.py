# -*- coding: utf-8 -*-
"""
gen_skill_icons.py — 森灵内容包「技能 / 元素图标」生成器（纯 Python 标准库，零依赖，不卡机）

复用 gen_vfx.Canvas 与 gen_icons 的符号语言，新增两类图标，落在 _content_pack/skill_icons/：

  1) 元素徽章 el_*（64²，六边符印底盘 + 白色符号）
     五元素系统的统一视觉身份，与 R18 的元素命中 VFX（fx_water_splash / fx_earth_shard / fx_leaf_burst）
     + 元素命中音效（cp_sfx_hit_*）配对，用于元素指示 / 元素选择 UI / 克制关系图例。
     底盘用「六边符印」，与 st_* 的「圆牌」、ab_* 的「方面板」三系分明，避免同形混淆。
       el_fire  火   el_water 水   el_earth 土   el_light 光   el_wood  木

  2) 技能图标 ab_*（64²，圆角方面板 + 白色符号）
     英雄技能栏按钮，区别于 st_* 的「常驻状态指示」。
       ab_fireball 火球术  ab_heal 治疗  ab_frost 霜冻  ab_chain 链雷
       ab_vine 藤缚  ab_quake 地震  ab_dash 瞬步  ab_summon 召唤

全部原创程序化生成，无第三方权利。
"""
import math, random, os
from gen_vfx import Canvas, save
from gen_icons import disc, W, g_snow, g_flame, g_drop, g_bolt, g_cross

SIZE = 64
OUT = 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou/_content_pack/skill_icons'

# ---------------- 底盘 1：六边符印（元素徽章专用） ----------------
def _in_poly(x, y, pts):
    """凸多边形内测试（叉积同号）。"""
    sign = 0
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        cr = (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0)
        if abs(cr) > 1e-9:
            s = 1 if cr > 0 else -1
            if sign == 0:
                sign = s
            elif s != sign:
                return False
    return True

def hexplate(c, color):
    """六边符印：元素色暗版填充 + 白色描边 + 元素色外柔晕。"""
    cx = cy = c.w / 2
    R = c.w * 0.42
    pts = [(cx + math.cos(-math.pi / 2 + k * math.pi / 3) * R,
            cy + math.sin(-math.pi / 2 + k * math.pi / 3) * R) for k in range(6)]
    dark = (color[0] * 0.40 + 0.03, color[1] * 0.40 + 0.03, color[2] * 0.40 + 0.04)
    for y in range(c.h):
        for x in range(c.w):
            if _in_poly(x, y, pts):
                c.blend(x, y, *dark, 0.95)
    for i in range(6):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % 6]
        c.line(x0, y0, x1, y1, (1, 1, 1), 0.9, width=2.2)
    c.glow(cx, cy, c.w * 0.50, color, 0.16, soft=1.9)

# ---------------- 底盘 2：圆角方面板（技能图标专用） ----------------
def _in_rrect(x, y, cx, cy, half, corner):
    ax, ay = abs(x - cx), abs(y - cy)
    if max(ax, ay) > half:
        return False
    if ax > half - corner and ay > half - corner:
        dx, dy = ax - (half - corner), ay - (half - corner)
        if dx * dx + dy * dy > corner * corner:
            return False
    return True

def panel(c, color):
    """圆角方技能面板：白色外描边 + 元素色竖向渐变内填充 + 元素色外柔晕。"""
    cx = cy = c.w / 2
    R = c.w * 0.44
    corner = c.w * 0.15
    for y in range(c.h):
        for x in range(c.w):
            if _in_rrect(x, y, cx, cy, R, corner):
                c.blend(x, y, 1.0, 1.0, 1.0, 0.95)
    R2 = R - 2.4
    corner2 = corner * 0.9
    base = (color[0] * 0.32 + 0.04, color[1] * 0.32 + 0.04, color[2] * 0.32 + 0.05)
    topc = (color[0] * 0.75 + 0.18, color[1] * 0.75 + 0.20, color[2] * 0.75 + 0.20)
    for y in range(c.h):
        for x in range(c.w):
            if not _in_rrect(x, y, cx, cy, R2, corner2):
                continue
            f = (y - (cy - R2)) / (2 * R2)
            rr = base[0] + (topc[0] - base[0]) * f
            gg = base[1] + (topc[1] - base[1]) * f
            bb = base[2] + (topc[2] - base[2]) * f
            edge = max(0.0, (max(abs(x - cx), abs(y - cy)) - (R2 - 1.4)) / 1.4)
            c.blend(x, y, rr, gg, bb, 0.96 * (1 - edge))
    c.glow(cx, cy, c.w * 0.50, color, 0.15, soft=1.9)

# ---------------- 元素 / 技能专用符号 ----------------
def g_leaf(c, cx, cy, L):
    """木元素 / 藤缚：沿「/」向的尖头叶片 + 中脉 + 叶柄（叶轴与中脉同向，勿再垂直）。"""
    ca, sa = math.cos(-math.pi / 4), math.sin(-math.pi / 4)   # rx 轴指向右上
    for yi in range(int(cy - L * 0.95), int(cy + L * 0.95)):
        for xi in range(int(cx - L * 0.72), int(cx + L * 0.72)):
            rx = (xi - cx) * ca + (yi - cy) * sa
            ry = -(xi - cx) * sa + (yi - cy) * ca
            t = rx / (L * 0.85)
            if t < -1.0 or t > 1.0:
                continue
            w = L * 0.42 * math.sin(math.pi * min(1.0, (t + 1.0) * 0.55)) * (1 - max(0.0, t) * 0.55)
            if abs(ry) <= w:
                c.blend(xi, yi, *W(), 0.92)
    c.line(cx - L * 0.50, cy + L * 0.50, cx + L * 0.72, cy - L * 0.72, W(), 0.95, width=1.8)
    c.line(cx - L * 0.72, cy + L * 0.72, cx - L * 0.50, cy + L * 0.50, W(), 0.9, width=2.4)
    c.glow(cx + L * 0.10, cy - L * 0.10, L * 0.22, W(), 0.55, soft=1.8)

def g_rock(c, cx, cy, L):
    """土元素 / 地震：多边形岩块轮廓 + 内亮 + 裂隙。"""
    pts = [(cx - L * 0.70, cy + L * 0.30), (cx - L * 0.50, cy - L * 0.40),
           (cx + L * 0.10, cy - L * 0.55), (cx + L * 0.65, cy - L * 0.10),
           (cx + L * 0.50, cy + L * 0.50), (cx - L * 0.20, cy + L * 0.60)]
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        c.line(x0, y0, x1, y1, W(), 0.95, width=2.2)
    c.glow(cx, cy, L * 0.22, W(), 0.35, soft=1.8)
    c.line(cx - L * 0.20, cy + L * 0.60, cx + L * 0.10, cy - L * 0.10, W(), 0.8, width=1.4)

def g_dash(c, cx, cy, L):
    """瞬步：向右渐隐运动线 + 箭头头。"""
    for k in range(3):
        ox = (k - 1) * L * 0.18
        c.line(cx - L * 0.55 + ox, cy - L * 0.30, cx + L * 0.20 + ox, cy - L * 0.30, W(), 0.9 - 0.15 * k, width=2.6)
    c.line(cx + L * 0.20, cy - L * 0.30, cx + L * 0.55, cy, W(), 0.95, width=2.6)
    c.line(cx + L * 0.20, cy + L * 0.30, cx + L * 0.55, cy, W(), 0.95, width=2.6)
    c.glow(cx + L * 0.10, cy, L * 0.22, W(), 0.5, soft=1.8)

def g_star(c, cx, cy, L):
    """召唤：四角星芒（加粗加亮）+ 中心高光。"""
    for axis in (0, math.pi / 2):
        for t in range(22):
            r = L * 0.88 * (t / 22.0)
            x = cx + math.cos(axis) * r
            y = cy + math.sin(axis) * r
            c.glow(x, y, L * 0.10, W(), 0.85 * (1 - t / 22.0) + 0.15, soft=1.6)
    c.glow(cx, cy, L * 0.26, W(), 0.9, soft=2.0)

# ---------------- 主表 ----------------
EMBLEMS = [
    ('el_fire',  '火', (1.00, 0.45, 0.15), g_flame, hexplate),
    ('el_water', '水', (0.35, 0.75, 1.00), g_drop,  hexplate),
    ('el_earth', '土', (0.55, 0.42, 0.25), g_rock,  hexplate),
    ('el_light', '光', (1.00, 0.85, 0.25), g_bolt,  hexplate),
    ('el_wood',  '木', (0.40, 0.85, 0.35), g_leaf,  hexplate),
]
ABILITIES = [
    ('ab_fireball', '火球术', (1.00, 0.45, 0.15), g_flame, panel),
    ('ab_heal',     '治疗',   (0.30, 1.00, 0.55), g_cross, panel),
    ('ab_frost',    '霜冻',   (0.55, 0.85, 1.00), g_snow,  panel),
    ('ab_chain',    '链雷',   (1.00, 0.85, 0.25), g_bolt,  panel),
    ('ab_vine',     '藤缚',   (0.45, 0.85, 0.35), g_leaf,  panel),
    ('ab_quake',    '地震',   (0.55, 0.42, 0.25), g_rock,  panel),
    ('ab_dash',     '瞬步',   (0.35, 0.85, 1.00), g_dash,  panel),
    ('ab_summon',   '召唤',   (0.70, 0.40, 0.95), g_star,  panel),
]

def make_icon(path, color, glyph, chassis):
    c = Canvas(SIZE, SIZE)
    chassis(c, color)
    glyph(c, SIZE / 2, SIZE / 2, SIZE * 0.30)
    save(c, path)

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for fn, zh, color, glyph, chassis in EMBLEMS + ABILITIES:
        make_icon(f'{OUT}/{fn}.png', color, glyph, chassis)
        print('SKILL ICON OK:', fn, '/', zh)
