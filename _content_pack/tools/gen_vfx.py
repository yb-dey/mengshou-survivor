# -*- coding: utf-8 -*-
"""
gen_vfx.py — 森灵内容包 VFX 特效精灵生成器（纯 Python 标准库，零依赖，不消耗额度，不卡机）

产出（落在 _content_pack/vfx/，全部 RGBA 透明、柔和 alpha）：
  fx_hit_spark.png    命中火花（白黄核心 + 放射尖刺）
  fx_fireball.png     火球（橙红辉光球 + 亮核）
  fx_shield.png       护盾泡（青色柔环 + 半透内充）
  fx_heal.png         治疗光环（绿色径向辉光 + 十字）
  fx_slash.png        斩击弧（白色新月弧光）
  fx_star.png         星爆（黄色四角星芒，击杀/得分）
  fx_frost.png        霜晶（浅蓝六边碎片）

皆为原创程序化生成，无第三方权利，可自由商用。
"""
import math, struct, zlib, random

# ---------------- PNG 写出（8bit RGBA, color type 6） ----------------
def write_png(path, w, h, pixels):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw.extend(pixels[y*w*4:(y+1)*w*4])
    comp = zlib.compress(bytes(raw), 9)
    def chunk(typ, data):
        return struct.pack('>I', len(data)) + typ + data + struct.pack('>I', zlib.crc32(typ+data) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)))
        f.write(chunk(b'IDAT', comp))
        f.write(chunk(b'IEND', b''))

# ---------------- 画布（RGBA 浮点，additive 辉光 + src-over 实体） ----------------
class Canvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.buf = [[0.0, 0.0, 0.0, 0.0] for _ in range(w*h)]
    def _idx(self, x, y):
        return y*self.w + x
    def blend(self, x, y, r, g, b, a):  # 普通源覆盖（带 alpha）
        if a <= 0: return
        if x < 0 or y < 0 or x >= self.w or y >= self.h: return
        i = self._idx(int(x), int(y))
        sa = min(1.0, a)
        d = self.buf[i]
        da = d[3]
        out_a = sa + da*(1-sa)
        if out_a <= 0: return
        for k in range(3):
            d[k] = (r*sa + d[k]*da*(1-sa)) / out_a
        d[3] = out_a
    def glow(self, cx, cy, radius, rgb, intensity, soft=1.6):  # 加性辉光（光叠加）
        for y in range(self.h):
            for x in range(self.w):
                dx, dy = x-cx, y-cy
                d = math.hypot(dx, dy)
                if d > radius: continue
                t = 1.0 - d/radius
                a = intensity * (t**soft)
                i = self._idx(x, y)
                self.buf[i][0] = min(1.0, self.buf[i][0] + rgb[0]*a)
                self.buf[i][1] = min(1.0, self.buf[i][1] + rgb[1]*a)
                self.buf[i][2] = min(1.0, self.buf[i][2] + rgb[2]*a)
                self.buf[i][3] = min(1.0, self.buf[i][3] + a)
    def ring(self, cx, cy, r0, r1, rgb, alpha):  # 柔边环（源覆盖）
        mid = (r0+r1)/2.0
        half = (r1-r0)/2.0
        for y in range(self.h):
            for x in range(self.w):
                d = math.hypot(x-cx, y-cy)
                edge = abs(d-mid)/half
                if edge > 1.0: continue
                a = alpha * (1.0 - edge*edge)
                self.blend(x, y, rgb[0], rgb[1], rgb[2], a)
    def line(self, x0, y0, x1, y1, rgb, alpha, width=1.0):
        n = int(max(abs(x1-x0), abs(y1-y0))) + 1
        for s in range(n+1):
            t = s/n
            x = x0 + (x1-x0)*t
            y = y0 + (y1-y0)*t
            for oy in range(int(-width), int(width)+1):
                for ox in range(int(-width), int(width)+1):
                    self.blend(x+ox, y+oy, rgb[0], rgb[1], rgb[2], alpha/( (abs(ox)+abs(oy))*0.5+1))
    def to_bytes(self):
        out = bytearray()
        for p in self.buf:
            a = min(1.0, p[3])
            out += struct.pack('<BBBB', int(p[0]*255), int(p[1]*255), int(p[2]*255), int(a*255))
        return out

def save(c, path):
    write_png(path, c.w, c.h, c.to_bytes())

# ---------------- 各特效 ----------------
def fx_hit_spark(path, size=96):
    c = Canvas(size, size)
    cx = cy = size/2
    c.glow(cx, cy, size*0.22, (1.0, 0.95, 0.6), 1.0, soft=2.0)   # 暖白核心
    c.glow(cx, cy, size*0.40, (1.0, 0.7, 0.2), 0.5, soft=1.4)   # 外晕
    rng = random.Random(7)
    for _ in range(8):                                            # 放射尖刺
        ang = rng.uniform(0, 2*math.pi)
        r = size*(0.18 + rng.random()*0.30)
        c.line(cx, cy, cx+math.cos(ang)*r, cy+math.sin(ang)*r, (1.0, 0.9, 0.5), 0.9, width=size*0.02)
    save(c, path)

def fx_fireball(path, size=96):
    c = Canvas(size, size)
    cx = cy = size/2
    c.glow(cx, cy, size*0.46, (1.0, 0.35, 0.05), 0.7, soft=1.3)  # 橙红外焰
    c.glow(cx, cy, size*0.30, (1.0, 0.6, 0.1), 0.9, soft=1.6)    # 中层
    c.glow(cx- size*0.04, cy - size*0.04, size*0.14, (1.0, 0.95, 0.6), 1.0, soft=2.2)  # 亮核
    save(c, path)

def fx_shield(path, size=128):
    c = Canvas(size, size)
    cx = cy = size/2
    c.glow(cx, cy, size*0.42, (0.3, 0.85, 1.0), 0.18, soft=1.2)  # 内充淡光
    c.ring(cx, cy, size*0.30, size*0.44, (0.5, 0.95, 1.0), 0.8)   # 主环
    c.ring(cx, cy, size*0.22, size*0.25, (0.7, 1.0, 1.0), 0.5)    # 内细环
    save(c, path)

def fx_heal(path, size=128):
    c = Canvas(size, size)
    cx = cy = size/2
    c.glow(cx, cy, size*0.44, (0.3, 1.0, 0.5), 0.45, soft=1.5)    # 绿辉光
    # 十字
    thick = size*0.07
    for y in range(int(cy-size*0.22), int(cy+size*0.22)):
        for ox in range(int(-thick), int(thick)+1):
            c.blend(cx+ox, y, 0.6, 1.0, 0.7, 0.9)
    for x in range(int(cx-size*0.22), int(cx+size*0.22)):
        for oy in range(int(-thick), int(thick)+1):
            c.blend(x, cy+oy, 0.6, 1.0, 0.7, 0.9)
    c.glow(cx, cy, size*0.10, (0.8, 1.0, 0.85), 1.0, soft=2.0)    # 中心亮点
    save(c, path)

def fx_slash(path, size=128):
    c = Canvas(size, size)
    cx = cy = size/2
    r = size*0.40
    for i, ang in enumerate([a*math.pi/180 for a in range(-55, 56, 2)]):  # 新月弧
        x = cx + math.cos(ang-math.pi/2)*r
        y = cy + math.sin(ang-math.pi/2)*r
        a = 0.9*(1 - abs(i-55)/55.0*0.4)
        c.glow(x, y, size*0.05, (1.0, 1.0, 1.0), a*0.9, soft=1.8)
    # 两条刃缘
    for off in (-size*0.03, size*0.03):
        for ang in [a*math.pi/180 for a in range(-55, 56, 3)]:
            x = cx + math.cos(ang-math.pi/2)*(r+off)
            y = cy + math.sin(ang-math.pi/2)*(r+off)
            c.blend(x, y, 1.0, 1.0, 1.0, 0.95)
    save(c, path)

def fx_star(path, size=96):
    c = Canvas(size, size)
    cx = cy = size/2
    c.glow(cx, cy, size*0.20, (1.0, 0.95, 0.4), 1.0, soft=2.2)    # 核心
    for ang0 in (0, math.pi/2):
        for s in range(40):                                         # 四角星芒
            t = s/40.0
            ang = ang0 + t*math.pi/2 * 0.0  # 沿轴
            r = size*0.46*t
            for axis in (ang0, ang0+math.pi):
                x = cx + math.cos(axis)*r
                y = cy + math.sin(axis)*r
                a = 0.9*(1-t)
                c.glow(x, y, size*0.035, (1.0, 0.92, 0.35), a, soft=1.6)
    save(c, path)

def fx_frost(path, size=96):
    c = Canvas(size, size)
    cx = cy = size/2
    c.glow(cx, cy, size*0.40, (0.6, 0.85, 1.0), 0.22, soft=1.3)    # 冷蓝辉光
    rng = random.Random(11)
    for _ in range(6):                                              # 六边碎片
        ang = rng.uniform(0, 2*math.pi)
        r = size*(0.10 + rng.random()*0.22)
        x = cx + math.cos(ang)*r
        y = cy + math.sin(ang)*r
        sz = size*0.06
        for k in range(6):
            a2 = ang + k*math.pi/3
            x2 = x + math.cos(a2)*sz
            y2 = y + math.sin(a2)*sz
            c.line(x, y, x2, y2, (0.75, 0.92, 1.0), 0.85, width=size*0.015)
    save(c, path)

def fx_levelup(path, size=128):
    c = Canvas(size, size)
    cx = cy = size/2
    c.glow(cx, cy, size*0.30, (1.0, 0.85, 0.3), 0.9, soft=2.0)     # 金辉核心
    c.ring(cx, cy, size*0.18, size*0.30, (1.0, 0.9, 0.4), 0.7)     # 升阶环
    rng = random.Random(3)
    for _ in range(9):                                              # 向上星芒
        ang = -math.pi/2 + rng.uniform(-0.7, 0.7)
        r = size*(0.30 + rng.random()*0.18)
        c.line(cx, cy, cx+math.cos(ang)*r, cy+math.sin(ang)*r, (1.0, 0.92, 0.45), 0.85, width=size*0.018)
    save(c, path)

def fx_pickup(path, size=96):
    c = Canvas(size, size)
    cx = cy = size/2
    c.glow(cx, cy, size*0.34, (1.0, 0.85, 0.25), 0.55, soft=1.6)   # 暖黄辉光
    # 菱形宝石
    d = size*0.20
    for t in range(-20, 21):
        f = t/20.0
        x = cx + f*d
        y = cy + abs(f)*d*0.0
        yy = cy + (1-abs(f))*d
        c.line(cx, cy-d, x, yy, (1.0, 0.9, 0.4), 0.9, width=size*0.03)
        c.line(cx, cy+d, x, yy, (1.0, 0.9, 0.4), 0.9, width=size*0.03)
        c.line(cx-d, cy, x, yy, (1.0, 0.95, 0.5), 0.9, width=size*0.03)
        c.line(cx+d, cy, x, yy, (1.0, 0.95, 0.5), 0.9, width=size*0.03)
    c.glow(cx, cy, size*0.08, (1.0, 1.0, 0.8), 1.0, soft=2.2)     # 高光
    save(c, path)

def fx_poison(path, size=96):
    c = Canvas(size, size)
    cx = cy = size/2
    rng = random.Random(5)
    for _ in range(5):                                              # 毒云团
        ang = rng.uniform(0, 2*math.pi)
        r = size*(0.05 + rng.random()*0.20)
        x = cx + math.cos(ang)*r
        y = cy + math.sin(ang)*r
        c.glow(x, y, size*0.22, (0.45, 0.85, 0.25), 0.4, soft=1.2)
    for _ in range(8):                                              # 深色毒点
        ang = rng.uniform(0, 2*math.pi)
        r = size*(0.05 + rng.random()*0.18)
        x = cx + math.cos(ang)*r
        y = cy + math.sin(ang)*r
        c.glow(x, y, size*0.05, (0.25, 0.55, 0.15), 0.7, soft=1.6)
    save(c, path)

def fx_explosion(path, size=128):
    """大爆裂 / 范围伤害：橙红外焰 + 亮核 + 冲击环 + 放射碎片。"""
    c = Canvas(size, size)
    cx = cy = size/2
    c.glow(cx, cy, size*0.42, (1.0, 0.45, 0.10), 0.70, soft=1.2)
    c.glow(cx, cy, size*0.22, (1.0, 0.90, 0.50), 1.00, soft=2.0)
    c.ring(cx, cy, size*0.30, size*0.40, (1.0, 0.70, 0.25), 0.6)
    rng = random.Random(9)
    for _ in range(12):
        ang = rng.uniform(0, 2*math.pi)
        r = size*(0.30 + rng.random()*0.34)
        c.line(cx, cy, cx+math.cos(ang)*r, cy+math.sin(ang)*r, (1.0, 0.85, 0.40), 0.9, width=size*0.02)
    for _ in range(10):
        ang = rng.uniform(0, 2*math.pi)
        r = size*(0.20 + rng.random()*0.30)
        x = cx + math.cos(ang)*r; y = cy + math.sin(ang)*r
        c.glow(x, y, size*0.04, (1.0, 0.80, 0.30), 0.8, soft=1.8)
    save(c, path)

def fx_lightning(path, size=96):
    """雷击 / 雷元素：锯齿状闪电 + 冷蓝辉光包裹。"""
    c = Canvas(size, size)
    cx = cy = size/2
    rng = random.Random(21)
    pts = [(cx + size*0.04, size*0.10)]
    y = size*0.10
    while y < size*0.92:
        y += size*rng.uniform(0.10, 0.16)
        x = cx + rng.uniform(-size*0.16, size*0.16)
        pts.append((x, min(y, size*0.92)))
    for i in range(len(pts)-1):
        c.line(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1], (0.70, 0.90, 1.0), 0.95, width=size*0.035)
    for (x, y) in pts:
        c.glow(x, y, size*0.10, (0.60, 0.85, 1.0), 0.6, soft=1.6)
    c.glow(cx, cy, size*0.30, (0.40, 0.70, 1.0), 0.18, soft=1.2)
    save(c, path)

def fx_heal_burst(path, size=128):
    """治疗爆发（比 fx_heal 更张扬）：绿辉光 + 双环 + 向上星芒。"""
    c = Canvas(size, size)
    cx = cy = size/2
    c.glow(cx, cy, size*0.40, (0.30, 1.0, 0.55), 0.50, soft=1.5)
    c.ring(cx, cy, size*0.16, size*0.26, (0.50, 1.0, 0.70), 0.7)
    c.ring(cx, cy, size*0.30, size*0.40, (0.50, 1.0, 0.70), 0.45)
    rng = random.Random(13)
    for _ in range(10):
        ang = -math.pi/2 + rng.uniform(-0.9, 0.9)
        r = size*(0.28 + rng.random()*0.18)
        c.line(cx, cy, cx+math.cos(ang)*r, cy+math.sin(ang)*r, (0.70, 1.0, 0.80), 0.85, width=size*0.016)
    c.glow(cx, cy, size*0.10, (0.85, 1.0, 0.90), 1.0, soft=2.0)
    save(c, path)

def fx_dash_trail(path, size=128):
    """冲刺残影 / 位移：斜向渐隐弧线残影。"""
    c = Canvas(size, size)
    cx = cy = size/2
    rng = random.Random(17)
    for k in range(5):
        off = (k-2)*size*0.05
        a0 = -math.pi*0.78
        r = size*0.40
        for s in range(30):
            t = s/30.0
            ang = a0 + t*math.pi*0.56
            x = cx + math.cos(ang)*r
            y = cy + math.sin(ang)*r*0.8 - off
            a = 0.7*(1-t)*(1 - abs(k-2)/4.0)
            c.glow(x, y, size*0.04, (0.60, 0.95, 1.0), a, soft=1.7)
    save(c, path)

def fx_telegraph(path, size=128):
    """Boss 预警圈 / 地面警示（AoE 指示）：橙红警示环 + 内淡填充 + 中心危机符。"""
    c = Canvas(size, size)
    cx = cy = size/2
    c.glow(cx, cy, size*0.42, (1.0, 0.35, 0.20), 0.12, soft=1.1)
    c.ring(cx, cy, size*0.30, size*0.44, (1.0, 0.45, 0.25), 0.85)
    c.ring(cx, cy, size*0.24, size*0.27, (1.0, 0.60, 0.35), 0.5)
    for y in range(int(cy-size*0.11), int(cy-size*0.01)):
        for ox in range(int(-size*0.03), int(size*0.03)+1):
            c.blend(cx+ox, y, 1.0, 0.85, 0.40, 0.9)
    for y in range(int(cy+size*0.05), int(cy+size*0.09)):
        for ox in range(int(-size*0.03), int(size*0.03)+1):
            c.blend(cx+ox, y, 1.0, 0.85, 0.40, 0.9)
    save(c, path)

def fx_shockwave(path, size=128):
    """冲击波环 / AoE 释放：青白同心环 + 放射脉冲（区别于 fx_explosion 的火核，作通用冲击标记）。"""
    c = Canvas(size, size)
    cx = cy = size/2
    c.ring(cx, cy, size*0.34, size*0.46, (0.60, 0.95, 1.0), 0.8)   # 主冲击环
    c.ring(cx, cy, size*0.20, size*0.27, (0.80, 1.0, 1.0), 0.55)   # 内环
    rng = random.Random(31)
    for _ in range(16):                                              # 径向脉冲
        ang = rng.uniform(0, 2*math.pi)
        r0 = size*0.26; r1 = size*(0.40 + rng.random()*0.10)
        c.line(cx+math.cos(ang)*r0, cy+math.sin(ang)*r0,
               cx+math.cos(ang)*r1, cy+math.sin(ang)*r1, (0.70, 0.95, 1.0), 0.6, width=size*0.012)
    c.glow(cx, cy, size*0.10, (0.85, 1.0, 1.0), 0.35, soft=1.8)
    save(c, path)

def fx_portal(path, size=128):
    """召唤门 / 传送：紫罗兰旋涡 + 内吸亮核（召唤/传送事件，与 summon 音效配套）。"""
    c = Canvas(size, size)
    cx = cy = size/2
    c.glow(cx, cy, size*0.44, (0.65, 0.35, 1.0), 0.22, soft=1.2)    # 紫晕
    c.ring(cx, cy, size*0.30, size*0.44, (0.78, 0.45, 1.0), 0.7)    # 外环
    rng = random.Random(27)
    for k in range(3):                                               # 三段螺旋弧
        base = k*2*math.pi/3
        for s in range(28):
            t = s/28.0
            ang = base + t*math.pi*1.6
            r = size*(0.10 + t*0.30)
            x = cx + math.cos(ang)*r; y = cy + math.sin(ang)*r
            c.glow(x, y, size*0.03, (0.85, 0.55, 1.0), 0.7*(1-t)+0.2, soft=1.7)
    c.glow(cx, cy, size*0.09, (0.95, 0.80, 1.0), 0.9, soft=2.0)     # 内吸亮核
    save(c, path)

def fx_coin_burst(path, size=96):
    """金币迸发 / 得分：金色币粒四散 + 暖辉（金币/分数拾取，区别于 fx_pickup 的宝石菱形）。"""
    c = Canvas(size, size)
    cx = cy = size/2
    c.glow(cx, cy, size*0.30, (1.0, 0.82, 0.25), 0.45, soft=1.6)
    rng = random.Random(41)
    for _ in range(10):                                              # 四散金币
        ang = rng.uniform(0, 2*math.pi)
        r = size*(0.18 + rng.random()*0.26)
        x = cx + math.cos(ang)*r; y = cy + math.sin(ang)*r
        c.glow(x, y, size*0.07, (1.0, 0.85, 0.35), 0.85, soft=1.8)
        c.ring(x, y, size*0.045, size*0.065, (1.0, 0.95, 0.55), 0.7)
    c.glow(cx, cy, size*0.07, (1.0, 1.0, 0.85), 1.0, soft=2.2)
    save(c, path)

def fx_freeze_shatter(path, size=96):
    """冰碎 / 冻结碎裂：冷蓝冰晶中心 + 放射冰碴 + 破碎环（冻结命中 / 碎冰解控）。"""
    c = Canvas(size, size)
    cx = cy = size/2
    c.glow(cx, cy, size*0.34, (0.55, 0.85, 1.0), 0.35, soft=1.3)   # 冷蓝辉光
    c.ring(cx, cy, size*0.20, size*0.30, (0.75, 0.95, 1.0), 0.6)   # 冰核环
    rng = random.Random(53)
    for k in range(6):                                              # 中心六边冰晶
        a2 = k*math.pi/3
        c.line(cx, cy, cx+math.cos(a2)*size*0.16, cy+math.sin(a2)*size*0.16, (0.85, 0.97, 1.0), 0.9, width=size*0.02)
    for _ in range(10):                                            # 放射冰碴
        ang = rng.uniform(0, 2*math.pi)
        r = size*(0.24 + rng.random()*0.22)
        x = cx + math.cos(ang)*r; y = cy + math.sin(ang)*r
        sz = size*(0.04 + rng.random()*0.04)
        for k in range(6):
            a2 = ang + k*math.pi/3
            c.line(x, y, x+math.cos(a2)*sz, y+math.sin(a2)*sz, (0.70, 0.92, 1.0), 0.8, width=size*0.012)
    c.glow(cx, cy, size*0.08, (0.90, 1.0, 1.0), 0.9, soft=2.0)
    save(c, path)

def fx_buff(path, size=96):
    """增益光环：青绿上升符环 + 上升三角 + 上升光点（攻防增益 / 强化生效）。"""
    c = Canvas(size, size)
    cx = cy = size/2
    c.glow(cx, cy, size*0.40, (0.55, 0.90, 0.55), 0.28, soft=1.4)  # 青绿增益辉光
    c.ring(cx, cy, size*0.26, size*0.36, (0.70, 1.0, 0.75), 0.7)   # 主环
    for k in range(3):                                             # 上升三角箭头
        yy = cy + size*0.16 - k*size*0.16
        wd = size*0.10
        c.line(cx-wd, yy+wd*0.5, cx, yy-wd*0.5, (0.85, 1.0, 0.85), 0.9, width=size*0.02)
        c.line(cx+wd, yy+wd*0.5, cx, yy-wd*0.5, (0.85, 1.0, 0.85), 0.9, width=size*0.02)
    rng = random.Random(59)
    for _ in range(8):                                             # 上升光点
        ang = rng.uniform(0, 2*math.pi)
        r = size*(0.10 + rng.random()*0.18)
        x = cx + math.cos(ang)*r; y = cy + math.sin(ang)*r
        c.glow(x, y, size*0.04, (0.80, 1.0, 0.85), 0.7, soft=1.8)
    save(c, path)

def fx_debuff(path, size=96):
    """减益光环：紫红下沉符环 + 下降倒三角 + 滴落暗点（减速 / 虚弱 / 诅咒）。"""
    c = Canvas(size, size)
    cx = cy = size/2
    c.glow(cx, cy, size*0.40, (0.70, 0.25, 0.65), 0.26, soft=1.3)  # 紫红暗晕
    c.ring(cx, cy, size*0.26, size*0.36, (0.90, 0.35, 0.80), 0.7)  # 主环
    for k in range(3):                                             # 下降倒三角
        yy = cy - size*0.16 + k*size*0.16
        wd = size*0.10
        c.line(cx-wd, yy-wd*0.5, cx, yy+wd*0.5, (1.0, 0.55, 0.90), 0.9, width=size*0.02)
        c.line(cx+wd, yy-wd*0.5, cx, yy+wd*0.5, (1.0, 0.55, 0.90), 0.9, width=size*0.02)
    rng = random.Random(67)
    for _ in range(8):                                             # 滴落暗点
        ang = rng.uniform(0, 2*math.pi)
        r = size*(0.10 + rng.random()*0.18)
        x = cx + math.cos(ang)*r; y = cy + math.sin(ang)*r
        c.glow(x, y, size*0.04, (0.85, 0.35, 0.75), 0.7, soft=1.6)
    save(c, path)

def fx_water_splash(path, size=128):
    """水元素迸溅 / 水弹命中：青蓝水花 + 同心涟漪 + 放射水滴（水元素命中 / 水弹溅落）。"""
    c = Canvas(size, size)
    cx = cy = size/2
    c.glow(cx, cy, size*0.40, (0.35, 0.75, 1.0), 0.28, soft=1.3)   # 青蓝水晕
    c.ring(cx, cy, size*0.26, size*0.38, (0.55, 0.88, 1.0), 0.7)   # 主涟漪
    c.ring(cx, cy, size*0.12, size*0.18, (0.70, 0.95, 1.0), 0.55)  # 内涟漪
    rng = random.Random(71)
    for _ in range(11):                                            # 放射水滴 + 拖尾
        ang = rng.uniform(0, 2*math.pi)
        r = size*(0.24 + rng.random()*0.24)
        x = cx + math.cos(ang)*r; y = cy + math.sin(ang)*r
        c.line(cx + math.cos(ang)*size*0.12, cy + math.sin(ang)*size*0.12, x, y, (0.55, 0.88, 1.0), 0.5, width=size*0.012)
        c.glow(x, y, size*0.05, (0.65, 0.92, 1.0), 0.8, soft=1.7)
    c.glow(cx, cy, size*0.08, (0.85, 1.0, 1.0), 0.9, soft=2.0)    # 高光核
    save(c, path)

def fx_earth_shard(path, size=128):
    """土元素碎裂 / 岩石冲击：土褐碎石 + 放射岩片 + 中央岩核（土元素命中 / 地震）。"""
    c = Canvas(size, size)
    cx = cy = size/2
    c.glow(cx, cy, size*0.40, (0.55, 0.42, 0.25), 0.30, soft=1.2)  # 土褐晕
    rng = random.Random(73)
    for _ in range(12):                                            # 放射岩片 + 端头亮点
        ang = rng.uniform(0, 2*math.pi)
        r = size*(0.22 + rng.random()*0.28)
        x = cx + math.cos(ang)*r; y = cy + math.sin(ang)*r
        c.line(cx + math.cos(ang)*size*0.10, cy + math.sin(ang)*size*0.10, x, y, (0.62, 0.48, 0.28), 0.85, width=size*0.03)
        c.glow(x, y, size*(0.06 + rng.random()*0.05), (0.72, 0.58, 0.35), 0.8, soft=1.5)
    for k in range(6):                                            # 中央岩核（六边）
        a2 = k*math.pi/3
        c.line(cx, cy, cx+math.cos(a2)*size*0.15, cy+math.sin(a2)*size*0.15, (0.78, 0.62, 0.38), 0.9, width=size*0.025)
    c.glow(cx, cy, size*0.12, (0.85, 0.68, 0.42), 0.85, soft=1.8)
    save(c, path)

def fx_leaf_burst(path, size=128):
    """木元素迸发 / 草木冲击：翠绿叶簇 + 放射叶脉 + 上升光点（木元素命中 / 藤蔓迸发）。"""
    c = Canvas(size, size)
    cx = cy = size/2
    c.glow(cx, cy, size*0.40, (0.40, 0.85, 0.35), 0.28, soft=1.4)  # 翠绿晕
    rng = random.Random(79)
    for _ in range(9):                                            # 放射叶脉 + 叶尖点
        ang = rng.uniform(0, 2*math.pi)
        r = size*(0.20 + rng.random()*0.26)
        x = cx + math.cos(ang)*r; y = cy + math.sin(ang)*r
        c.line(cx, cy, x, y, (0.50, 0.88, 0.40), 0.7, width=size*0.018)
        c.glow(x, y, size*0.05, (0.65, 0.95, 0.45), 0.8, soft=1.7)
    thick = size*0.05                                            # 中央叶簇十字
    for y in range(int(cy-size*0.20), int(cy+size*0.20)):
        for ox in range(int(-thick), int(thick)+1):
            c.blend(cx+ox, y, 0.55, 0.92, 0.45, 0.85)
    for x in range(int(cx-size*0.20), int(cx+size*0.20)):
        for oy in range(int(-thick), int(thick)+1):
            c.blend(x, cy+oy, 0.55, 0.92, 0.45, 0.85)
    c.glow(cx, cy, size*0.08, (0.80, 1.0, 0.65), 1.0, soft=2.0)
    save(c, path)

if __name__ == '__main__':
    out_dir = 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou/_content_pack/vfx'
    import os
    os.makedirs(out_dir, exist_ok=True)
    fx_hit_spark(f'{out_dir}/fx_hit_spark.png')
    fx_fireball(f'{out_dir}/fx_fireball.png')
    fx_shield(f'{out_dir}/fx_shield.png')
    fx_heal(f'{out_dir}/fx_heal.png')
    fx_slash(f'{out_dir}/fx_slash.png')
    fx_star(f'{out_dir}/fx_star.png')
    fx_frost(f'{out_dir}/fx_frost.png')
    fx_levelup(f'{out_dir}/fx_levelup.png')
    fx_pickup(f'{out_dir}/fx_pickup.png')
    fx_poison(f'{out_dir}/fx_poison.png')
    fx_explosion(f'{out_dir}/fx_explosion.png')
    fx_lightning(f'{out_dir}/fx_lightning.png')
    fx_heal_burst(f'{out_dir}/fx_heal_burst.png')
    fx_dash_trail(f'{out_dir}/fx_dash_trail.png')
    fx_telegraph(f'{out_dir}/fx_telegraph.png')
    fx_shockwave(f'{out_dir}/fx_shockwave.png')
    fx_portal(f'{out_dir}/fx_portal.png')
    fx_coin_burst(f'{out_dir}/fx_coin_burst.png')
    fx_freeze_shatter(f'{out_dir}/fx_freeze_shatter.png')
    fx_buff(f'{out_dir}/fx_buff.png')
    fx_debuff(f'{out_dir}/fx_debuff.png')
    fx_water_splash(f'{out_dir}/fx_water_splash.png')
    fx_earth_shard(f'{out_dir}/fx_earth_shard.png')
    fx_leaf_burst(f'{out_dir}/fx_leaf_burst.png')
    for f in ['fx_hit_spark','fx_fireball','fx_shield','fx_heal','fx_slash','fx_star','fx_frost',
              'fx_levelup','fx_pickup','fx_poison','fx_explosion','fx_lightning','fx_heal_burst',
              'fx_dash_trail','fx_telegraph','fx_shockwave','fx_portal','fx_coin_burst',
              'fx_freeze_shatter','fx_buff','fx_debuff','fx_water_splash','fx_earth_shard','fx_leaf_burst']:
        print('PNG OK:', f)

