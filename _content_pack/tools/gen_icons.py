# -*- coding: utf-8 -*-
"""
gen_icons.py — 森灵内容包「状态图标」生成器（纯 Python 标准库，零依赖，不消耗额度，不卡机）

与 vfx/ 的「瞬时爆发特效」互补：状态图标是**常驻 HUD 指示**（debuff/buff/控制），
需要清晰可读的徽章轮廓（实心圆盘 + 白色符号），而非柔光。尺寸统一 64²，真透底 RGBA。

产出落在 _content_pack/icons/：
  st_freeze   冰冻（控制·冰晶雪片）
  st_burn     灼烧（持续伤害·火苗）
  st_poison   中毒（持续伤害·骷髅）
  st_bleed    流血（持续伤害·血滴）
  st_slow     减速（负面·时钟）
  st_stun     眩晕（控制·星爆）
  st_atk_up   攻击强化（增益·上箭头）
  st_def_up   防御强化（增益·盾形）
  st_haste    急速（增益·闪电）
  st_heal     持续治疗（增益·十字）
  st_mark     标记（负面·靶心）
  st_shield   护盾（增益·六边屏障）

全部原创程序化生成，无第三方权利。
"""
import math, random
from gen_vfx import Canvas, save

SIZE = 64

# ---------------- 徽章底盘 ----------------
def disc(c, color, alpha=0.92):
    cx = cy = c.w / 2
    R = c.w * 0.40
    dark = (color[0] * 0.42, color[1] * 0.42, color[2] * 0.42)
    for y in range(c.h):
        for x in range(c.w):
            d = math.hypot(x - cx, y - cy)
            if d <= R:
                edge = max(0.0, (d - (R - 1.4)) / 1.4)
                c.blend(x, y, dark[0], dark[1], dark[2], alpha * (1 - edge))
    c.glow(cx, cy, c.w * 0.50, color, 0.16, soft=1.8)   # 盘外柔晕
    c.ring(cx, cy, R * 0.90, R, (1, 1, 1), 0.55)        # 白色描边

def W():  # 符号主色（暖白）
    return (1.0, 1.0, 1.0)

# ---------------- 各符号 ----------------
def g_snow(c, cx, cy, L):
    for k in range(6):
        a = k * math.pi / 3
        c.line(cx, cy, cx + math.cos(a) * L, cy + math.sin(a) * L, W(), 0.95, width=2.0)
        for t in (0.5, 0.74):
            bx, by = cx + math.cos(a) * L * t, cy + math.sin(a) * L * t
            for sgn in (-1, 1):
                ba = a + sgn * 0.55
                c.line(bx, by, bx + math.cos(ba) * L * 0.24, by + math.sin(ba) * L * 0.24, W(), 0.9, width=1.5)
    c.glow(cx, cy, L * 0.22, W(), 0.7, soft=2.0)

def g_flame(c, cx, cy, L):
    top, bot = cy - L, cy + L * 0.72
    for yi in range(int(top), int(bot)):
        f = (yi - top) / (bot - top)
        w = L * 0.62 * math.sin(math.pi * min(1.0, f * 1.05)) * (1 - f * 0.32)
        for ox in range(int(-w), int(w) + 1):
            c.blend(cx + ox, yi, *W(), 0.92)
    c.glow(cx, cy - L * 0.1, L * 0.22, (1.0, 0.9, 0.6), 0.6, soft=1.8)  # 内焰高光

def g_skull(c, cx, cy, L):
    top, bot = cy - L * 0.72, cy + L * 0.62
    for yi in range(int(top), int(bot)):
        f = (yi - top) / (bot - top)
        w = L * 0.72 * math.sin(math.pi * min(1.0, f * 1.1)) * (1 - f * 0.18)
        for ox in range(int(-w), int(w) + 1):
            c.blend(cx + ox, yi, *W(), 0.92)
    for (ex, ey) in [(cx - L * 0.30, cy - L * 0.05), (cx + L * 0.30, cy - L * 0.05)]:
        c.glow(ex, ey, L * 0.20, (0.05, 0.18, 0.06), 0.95, soft=1.2)   # 暗眼窝（glow 加不上，改用 blend 暗化）
        for yy in range(int(ey - L * 0.13), int(ey + L * 0.13)):
            for xx in range(int(ex - L * 0.11), int(ex + L * 0.11)):
                c.blend(xx, yy, 0.04, 0.16, 0.05, 0.95)
    c.glow(cx, cy + L * 0.30, L * 0.16, W(), 0.5, soft=1.6)

def g_drop(c, cx, cy, L):
    top, bot = cy - L * 0.72, cy + L * 0.72
    for yi in range(int(top), int(bot)):
        f = (yi - top) / (bot - top)
        w = L * 0.55 * math.sin(math.pi * f * 0.92) * (1 - f * 0.2)
        for ox in range(int(-w), int(w) + 1):
            c.blend(cx + ox, yi, *W(), 0.92)
    c.glow(cx, cy - L * 0.12, L * 0.20, (1.0, 0.7, 0.7), 0.5, soft=1.6)  # 高光

def g_clock(c, cx, cy, L):
    c.ring(cx, cy, L * 0.72, L * 0.82, W(), 0.92)
    c.line(cx, cy, cx, cy - L * 0.52, W(), 0.95, width=2.4)   # 时针
    c.line(cx, cy, cx + L * 0.42, cy, W(), 0.95, width=2.4)    # 分针
    c.glow(cx, cy, L * 0.10, W(), 0.9, soft=2.0)
    # 顺时针小箭头尾（强调「慢」）
    c.line(cx + L * 0.42, cy, cx + L * 0.30, cy + L * 0.10, W(), 0.9, width=1.8)

def g_stun(c, cx, cy, L):
    for k in range(8):
        a = k * math.pi / 4
        c.line(cx, cy, cx + math.cos(a) * L * 0.82, cy + math.sin(a) * L * 0.82, W(), 0.85, width=2.0)
    c.glow(cx, cy, L * 0.26, W(), 0.8, soft=1.6)
    c.glow(cx, cy, L * 0.12, W(), 0.9, soft=2.2)

def g_arrow_up(c, cx, cy, L):
    c.line(cx, cy + L * 0.62, cx, cy - L * 0.18, W(), 0.95, width=3.0)
    for s in range(int(L * 0.42)):
        t = s / (L * 0.42)
        w = (L * 0.42) * t
        for ox in range(int(-w), int(w) + 1):
            c.blend(cx + ox, cy - L * 0.18 - s, *W(), 0.95)
    c.glow(cx, cy, L * 0.12, W(), 0.6, soft=1.8)

def g_shield(c, cx, cy, L):
    top, bot = cy - L * 0.72, cy + L * 0.82
    for yi in range(int(top), int(bot)):
        f = (yi - top) / (bot - top)
        w = L * 0.62 if f < 0.45 else L * 0.62 * (1 - (f - 0.45) / 0.55)
        for ox in range(int(-w), int(w) + 1):
            c.blend(cx + ox, yi, *W(), 0.92)
    c.glow(cx, cy + L * 0.05, L * 0.18, W(), 0.4, soft=1.8)

def g_bolt(c, cx, cy, L):
    pts = [(cx + L * 0.12, cy - L * 0.72), (cx - L * 0.32, cy + L * 0.06),
           (cx + L * 0.06, cy + L * 0.06), (cx - L * 0.16, cy + L * 0.72)]
    for i in range(len(pts) - 1):
        c.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], W(), 0.95, width=3.6)
    c.glow(cx, cy + L * 0.05, L * 0.20, (1.0, 0.95, 0.6), 0.5, soft=1.8)

def g_cross(c, cx, cy, L):
    t = L * 0.20
    for yy in range(int(cy - L * 0.62), int(cy + L * 0.62)):
        for ox in range(int(-t), int(t) + 1):
            c.blend(cx + ox, yy, *W(), 0.95)
    for xx in range(int(cx - L * 0.62), int(cx + L * 0.62)):
        for oy in range(int(-t), int(t) + 1):
            c.blend(xx, cy + oy, *W(), 0.95)
    c.glow(cx, cy, L * 0.18, W(), 0.5, soft=1.8)

def g_target(c, cx, cy, L):
    c.ring(cx, cy, L * 0.74, L * 0.84, W(), 0.88)
    c.ring(cx, cy, L * 0.44, L * 0.52, W(), 0.88)
    c.glow(cx, cy, L * 0.22, W(), 0.9, soft=1.8)

def g_hex(c, cx, cy, L):
    pts = [(cx + math.cos(a) * L * 0.82, cy + math.sin(a) * L * 0.82)
           for a in [math.pi / 6 + k * math.pi / 3 for k in range(6)]]
    for i in range(6):
        c.line(pts[i][0], pts[i][1], pts[(i + 1) % 6][0], pts[(i + 1) % 6][1], W(), 0.95, width=3.0)
    c.glow(cx, cy, L * 0.42, W(), 0.32, soft=1.6)

# ---------------- 主表 ----------------
JOBS = [
    ('st_freeze',  '冰冻',     (0.55, 0.85, 1.00), g_snow),
    ('st_burn',    '灼烧',     (1.00, 0.45, 0.15), g_flame),
    ('st_poison',  '中毒',     (0.45, 0.85, 0.25), g_skull),
    ('st_bleed',   '流血',     (0.90, 0.22, 0.27), g_drop),
    ('st_slow',    '减速',     (0.40, 0.80, 1.00), g_clock),
    ('st_stun',    '眩晕',     (0.70, 0.40, 0.92), g_stun),
    ('st_atk_up',  '攻击强化', (1.00, 0.52, 0.20), g_arrow_up),
    ('st_def_up',  '防御强化', (0.35, 0.55, 1.00), g_shield),
    ('st_haste',   '急速',     (1.00, 0.85, 0.20), g_bolt),
    ('st_heal',    '持续治疗', (0.30, 1.00, 0.55), g_cross),
    ('st_mark',    '标记',     (1.00, 0.50, 0.80), g_target),
    ('st_shield',  '护盾',     (0.30, 0.90, 0.90), g_hex),
]

def make_icon(path, color, glyph):
    c = Canvas(SIZE, SIZE)
    disc(c, color)
    glyph(c, SIZE / 2, SIZE / 2, SIZE * 0.30)
    save(c, path)

if __name__ == '__main__':
    import os
    out_dir = 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou/_content_pack/icons'
    os.makedirs(out_dir, exist_ok=True)
    for fn, zh, color, glyph in JOBS:
        make_icon(f'{out_dir}/{fn}.png', color, glyph)
        print('ICON OK:', fn, '/', zh)
