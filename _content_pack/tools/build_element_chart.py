# -*- coding: utf-8 -*-
"""build_element_chart.py — 由 data/*.json 生成元素克制 + 技能数值可视化参考页
纯本地、零依赖、不卡机；输出 element_chart.html（内联 SVG，无需图片生成）。
"""
import os, json, math

ROOT = 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou/_content_pack'
DATA = os.path.join(ROOT, 'data')

EM = json.load(open(os.path.join(DATA, 'element_matrix.json'), encoding='utf-8'))
SK = json.load(open(os.path.join(DATA, 'skill_cooldowns.json'), encoding='utf-8'))

ELEMS = EM['elements']
CN = EM['cn']
COLORS = EM['colors']
CYCLE = EM['cycle']
MUL = EM['multipliers']

def hexc(rgb):
    return '#%02x%02x%02x' % (int(rgb[0]*255), int(rgb[1]*255), int(rgb[2]*255))

def rel(a, d):
    """attacker a vs defender d multiplier key"""
    if a == d:
        return 'same'
    if CYCLE.get(a) == d:
        return 'strong'
    if CYCLE.get(d) == a:
        return 'weak'
    return 'neutral'

# ---- pentagon geometry ----
cx, cy, r = 200, 200, 140
pts = {}
for i, e in enumerate(ELEMS):
    ang = -math.pi/2 + i * (2*math.pi/len(ELEMS))
    pts[e] = (cx + r*math.cos(ang), cy + r*math.sin(ang))

# ---- pentagon svg ----
nodes_svg = []
for e in ELEMS:
    x, y = pts[e]
    nodes_svg.append(
        '<g><circle cx="%.1f" cy="%.1f" r="34" fill="%s" stroke="#fff" stroke-width="3"/>'
        '<text x="%.1f" y="%.1f" text-anchor="middle" dominant-baseline="central" '
        'font-size="26" font-weight="700" fill="#1a1a1a">%s</text></g>'
        % (x, y, hexc(COLORS[e]), x, y, CN[e]))
nodes = ''.join(nodes_svg)

edges_svg = []
marker = ('<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" '
          'markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" '
          'fill="#ffffff"/></marker></defs>')
for e in ELEMS:
    t = CYCLE[e]
    x1, y1 = pts[e]; x2, y2 = pts[t]
    # pull line ends back so it starts/ends outside the node circles
    dx, dy = x2-x1, y2-y1
    L = math.hypot(dx, dy)
    ux, uy = dx/L, dy/L
    ax, ay = x1 + ux*42, y1 + uy*42
    bx, by = x2 - ux*42, y2 - uy*42
    edges_svg.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="#ffffff" '
                     'stroke-width="4" stroke-opacity="0.85" marker-end="url(#arrow)"/>'
                     % (ax, ay, bx, by))
edges = ''.join(edges_svg)
pentagon = ('<svg viewBox="0 0 400 400" width="360" height="360" xmlns="http://www.w3.org/2000/svg">'
            + marker + edges + nodes + '</svg>')

# ---- counter matrix ----
cell_style = {
    'strong': 'background:rgba(229,72,77,.28);color:#ff8a8a;border-color:#e5484d',
    'weak':   'background:rgba(63,166,106,.28);color:#9be8b8;border-color:#3fa66a',
    'same':   'background:rgba(232,196,99,.18);color:#e8c463;border-color:#e8c463',
    'neutral':'background:rgba(255,255,255,.06);color:rgba(243,247,238,.7);border-color:rgba(159,224,180,.25)',
}
matrix_rows = []
matrix_rows.append('<tr><th></th>' + ''.join('<th>%s</th>' % CN[e] for e in ELEMS) + '</tr>')
for a in ELEMS:
    cells = ['<th>%s</th>' % CN[a]]
    for d in ELEMS:
        k = rel(a, d)
        v = MUL[k]
        cells.append('<td style="%s">×%.2f</td>' % (cell_style[k], v))
    matrix_rows.append('<tr>' + ''.join(cells) + '</tr>')
matrix = '<table class="grid">' + ''.join(matrix_rows) + '</table>'

# ---- cooldown bars ----
maxcd = max(b['cooldown'] for b in SK['abilities'])
bars = []
for b in SK['abilities']:
    w = (b['cooldown'] / maxcd) * 100
    ec = hexc(COLORS[b['element']]) if b['element'] in COLORS else '#9fb8d8'
    bars.append(
        '<div class="row"><div class="nm">%s<small>%s</small></div>'
        '<div class="track"><div class="fill" style="width:%.1f%%;background:%s"></div></div>'
        '<div class="val">%.1fs · %d 法力</div></div>'
        % (b['cn'], CN.get(b['element'], '无'), w, ec, b['cooldown'], b['mana']))
cooldown = ''.join(bars)

html = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>森灵萌兽 · 元素克制与技能数值</title>
<style>
  :root{ --leaf:#3fa66a; --gold:#e8c463; --cream:#f3f7ee; }
  *{ box-sizing:border-box;margin:0;padding:0 }
  body{ font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    background:radial-gradient(130% 120% at 50% -10%, #2f6b45 0%, #1c4a30 45%, #0f2f1f 100%);
    color:var(--cream); min-height:100vh; padding:40px 18px; display:flex; flex-direction:column; align-items:center; }
  h1{ font-size:30px; letter-spacing:2px; margin-bottom:6px }
  .sub{ opacity:.8; margin-bottom:26px; font-size:14px; text-align:center; max-width:640px; line-height:1.6 }
  .wrap{ width:100%; max-width:880px; display:flex; flex-direction:column; gap:22px }
  .card{ background:rgba(15,47,31,.55); border:1px solid rgba(159,224,180,.25); border-radius:16px; padding:22px 24px }
  .card h2{ font-size:18px; margin-bottom:16px; display:flex; align-items:center; gap:8px }
  .card h2 small{ opacity:.6; font-weight:400; font-size:13px }
  table.grid{ border-collapse:collapse; margin:0 auto; font-size:15px }
  table.grid th,table.grid td{ border:1px solid rgba(159,224,180,.25); padding:10px 14px; text-align:center; min-width:54px }
  table.grid th{ background:rgba(232,196,99,.12); color:var(--gold); font-weight:700 }
  .legend{ display:flex; gap:14px; flex-wrap:wrap; justify-content:center; margin-top:14px; font-size:12px; opacity:.85 }
  .legend span{ display:inline-flex; align-items:center; gap:6px }
  .legend i{ width:14px;height:14px;border-radius:4px;display:inline-block }
  .row{ display:flex; align-items:center; gap:12px; margin:10px 0 }
  .row .nm{ width:96px; font-weight:600 }
  .row .nm small{ display:block; opacity:.6; font-size:11px; font-weight:400 }
  .row .track{ flex:1; height:16px; background:rgba(255,255,255,.08); border-radius:8px; overflow:hidden }
  .row .fill{ height:100%; border-radius:8px }
  .row .val{ width:130px; text-align:right; font-size:12px; opacity:.85 }
  footer{ margin-top:26px; font-size:12px; opacity:.5; text-align:center; line-height:1.7; max-width:760px }
</style>
</head>
<body>
  <h1>⚖️ 元素克制与技能数值</h1>
  <div class="sub">五元素单一 5 环克制链（强克 1 / 弱于 1，平衡对称），与英雄 8 技能冷却/消耗规格联动。数据来自 <code>data/element_matrix.json</code> 与 <code>data/skill_cooldowns.json</code>，本页由 <code>tools/build_element_chart.py</code> 扫描生成。</div>
  <div class="wrap">
    <div class="card">
      <h2>🔥 五元素克制环 <small>箭头 = 强克方向</small></h2>
      <div style="display:flex;justify-content:center">__PENTAGON__</div>
      <div class="legend">
        <span><i style="background:#e5484d"></i>强克 ×1.60</span>
        <span><i style="background:#3fa66a"></i>被克 ×0.60</span>
        <span><i style="background:#e8c463"></i>同元素 ×0.85</span>
        <span><i style="background:rgba(255,255,255,.18)"></i>中性 ×1.00</span>
      </div>
    </div>
    <div class="card">
      <h2>🎯 克制倍率矩阵 <small>行=攻击方 / 列=防守方</small></h2>
      __MATRIX__
    </div>
    <div class="card">
      <h2>⏱️ 技能冷却与法力 <small>8 技能，按冷却比例</small></h2>
      __COOLDOWN__
    </div>
  </div>
  <footer>萌兽消消岛 · 森灵内容包 · 独立命名空间（_content_pack/）<br>设计数值规格（非游戏代码），用于平衡参考与后续 playground 机制深化。</footer>
</body>
</html>'''

html = (html.replace('__PENTAGON__', pentagon)
            .replace('__MATRIX__', matrix)
            .replace('__COOLDOWN__', cooldown))

out = os.path.join(ROOT, 'element_chart.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('element_chart.html written:', os.path.getsize(out), 'bytes;',
      len(ELEMS), 'elements /', len(SK['abilities']), 'abilities')
