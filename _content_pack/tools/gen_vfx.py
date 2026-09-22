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
    for f in ['fx_hit_spark','fx_fireball','fx_shield','fx_heal','fx_slash','fx_star','fx_frost']:
        print('PNG OK:', f)

