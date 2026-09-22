# -*- coding: utf-8 -*-
"""build_reaction_chart.py — 由 data/reactions.json（五元素反应系统）生成可视化参考页
纯本地、零依赖、不卡机；输出 reaction_chart.html（内联 HTML/SVG，无需图片生成）。
复用 data/element_matrix.json 的五元素配色与克制链，与 §2.5/element_chart.html 视觉对齐。
"""
import os, json

ROOT = 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou/_content_pack'
DATA = os.path.join(ROOT, 'data')

RJ = json.load(open(os.path.join(DATA, 'reactions.json'), encoding='utf-8'))
EM = json.load(open(os.path.join(DATA, 'element_matrix.json'), encoding='utf-8'))

ELEMS = RJ['elements']              # {fire:{cn,color}, ...}
CN = {k: v['cn'] for k, v in ELEMS.items()}
COLOR = {k: v['color'] for k, v in ELEMS.items()}
STATUS = RJ['statuses']
REACT = RJ['reactions']
# 显示顺序（与 element_chart 五边形一致：火→水→土→光→木）
ORDER = ['fire', 'water', 'earth', 'light', 'wood']

def pair_key(a, b):
    return '+'.join(sorted([a, b]))

def hexa(h, a=1.0):
    # 接收 #rrggbb，返回 rgba
    h = h.lstrip('#')
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return 'rgba(%d,%d,%d,%.2f)' % (r, g, b, a)

# ---- 5x5 反应矩阵（行=附著/aura 先手，列=触发/trigger 后手）----
KIND_COLOR = {'amplifying': COLOR['gold'] if 'gold' in COLOR else '#e8c463',
              'transformative': COLOR['wood']}
KIND_CN = {'amplifying': '增幅', 'transformative': '聚变'}

matrix_rows = ['<tr><th></th>' + ''.join('<th style="color:%s">%s</th>' % (COLOR[e], CN[e]) for e in ORDER) + '</tr>']
for r in ORDER:
    cells = ['<th style="color:%s">%s</th>' % (COLOR[r], CN[r])]
    for c in ORDER:
        if r == c:
            cells.append('<td style="background:rgba(255,255,255,.05);color:rgba(243,247,238,.4)">—</td>')
            continue
        key = pair_key(r, c)
        rj = REACT[key]
        kind = rj['kind']
        kc = KIND_COLOR.get(kind, '#e8c463')
        if kind == 'amplifying':
            mult = rj['multByTrigger'][c]
            body = '<b style="color:%s">%s</b><br><span class="mini">增幅 · 触发%s ×%.1f</span>' % (kc, rj['cn'], CN[c], mult)
        else:
            st = rj['status']
            st = [st] if isinstance(st, str) else st
            sttxt = ' / '.join(STATUS[s]['cn'] for s in st)
            body = '<b style="color:%s">%s</b><br><span class="mini">聚变 · %s</span>' % (kc, rj['cn'], sttxt)
        cells.append('<td style="background:%s;border-color:%s">%s</td>' % (hexa(kc, 0.16), hexa(kc, 0.6), body))
    matrix_rows.append('<tr>' + ''.join(cells) + '</tr>')
matrix = '<table class="grid">' + ''.join(matrix_rows) + '</table>'

# ---- 反应清单（10 条）----
def mult_text(rj):
    if rj['kind'] == 'amplifying':
        m = rj['multByTrigger']
        return ' · '.join('%s触发 ×%.1f' % (CN[k], v) for k, v in m.items())
    return ''

react_cards = []
for key in sorted(REACT):
    rj = REACT[key]
    a, b = key.split('+')
    kind = rj['kind']
    kc = KIND_COLOR.get(kind, '#e8c463')
    st = rj['status']
    if st is None:
        st_html = '<span class="tag none">无状态</span>'
    else:
        st = [st] if isinstance(st, str) else st
        st_html = ''.join('<span class="tag" style="border-color:%s;color:%s">%s</span>' % (kc, kc, STATUS[s]['cn']) for s in st)
    react_cards.append(
        '<div class="rc" style="border-left-color:%s">'
        '<div class="rc-h"><b style="color:%s">%s</b> <span class="kind" style="background:%s">%s</span></div>'
        '<div class="rc-p">%s + %s</div>'
        '<div class="rc-s">%s %s</div>'
        '<div class="rc-n">%s</div>'
        '</div>' % (kc, kc, rj['cn'], kc, KIND_CN[kind], CN[a], CN[b],
                    st_html, mult_text(rj), rj['note']))
react_list = ''.join(react_cards)

# ---- 状态图例（7 个被引用的状态）----
used_status = set()
for rj in REACT.values():
    if rj['status']:
        s = rj['status']
        used_status.update([s] if isinstance(s, str) else s)
used_status = sorted(used_status)
status_cards = []
for s in used_status:
    meta = STATUS[s]
    if meta['type'] == 'dot':
        typ = '持续伤害 DoT'
        extra = '每跳 %d/s · 持续 %ds' % (meta['dmgPerSec'], meta['duration'])
    elif meta['type'] == 'debuff':
        typ = '减益'
        extra = '持续 %ds' % meta['duration']
    else:
        typ = '增益'
        extra = '持续 %ds' % meta['duration']
    status_cards.append(
        '<div class="sc">'
        '<img src="icons/%s" alt="%s"><div class="sc-b"><b>%s</b>'
        '<span class="sc-t">%s</span><span class="sc-e">%s</span>'
        '<span class="sc-n">%s</span></div></div>'
        % (meta['icon'], meta['cn'], meta['cn'], typ, extra, meta['note']))
status_legend = ''.join(status_cards)

html = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>森灵萌兽 · 元素反应系统</title>
<style>
  :root{ --leaf:#3fa66a; --gold:#e8c463; --cream:#f3f7ee; }
  *{ box-sizing:border-box;margin:0;padding:0 }
  body{ font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    background:radial-gradient(130% 120% at 50% -10%, #2f6b45 0%, #1c4a30 45%, #0f2f1f 100%);
    color:var(--cream); min-height:100vh; padding:40px 18px; display:flex; flex-direction:column; align-items:center; }
  h1{ font-size:30px; letter-spacing:2px; margin-bottom:6px }
  .sub{ opacity:.8; margin-bottom:26px; font-size:14px; text-align:center; max-width:680px; line-height:1.6 }
  .wrap{ width:100%; max-width:900px; display:flex; flex-direction:column; gap:22px }
  .card{ background:rgba(15,47,31,.55); border:1px solid rgba(159,224,180,.25); border-radius:16px; padding:22px 24px }
  .card h2{ font-size:18px; margin-bottom:16px; display:flex; align-items:center; gap:8px }
  .card h2 small{ opacity:.6; font-weight:400; font-size:13px }
  table.grid{ border-collapse:collapse; margin:0 auto; font-size:14px }
  table.grid th,table.grid td{ border:1px solid rgba(159,224,180,.25); padding:9px 11px; text-align:center; min-width:88px; vertical-align:middle }
  table.grid th{ background:rgba(232,196,99,.12); font-weight:700 }
  table.grid td .mini{ font-size:11px; opacity:.85; display:block; margin-top:3px }
  .legend{ display:flex; gap:14px; flex-wrap:wrap; justify-content:center; margin-top:14px; font-size:12px; opacity:.85 }
  .legend span{ display:inline-flex; align-items:center; gap:6px }
  .legend i{ width:14px;height:14px;border-radius:4px;display:inline-block }
  .rc{ background:rgba(255,255,255,.04); border-left:4px solid var(--leaf); border-radius:10px; padding:10px 14px; margin:9px 0 }
  .rc-h{ font-size:15px; display:flex; align-items:center; gap:8px }
  .rc-h .kind{ font-size:11px; color:#0f2f1f; padding:2px 8px; border-radius:6px; font-weight:700 }
  .rc-p{ font-size:13px; opacity:.8; margin:4px 0 }
  .rc-s{ font-size:12px; margin:4px 0 }
  .rc-s .tag{ display:inline-block; border:1px solid var(--leaf); border-radius:6px; padding:1px 7px; font-size:11px; margin-right:5px }
  .rc-s .tag.none{ opacity:.5; border-color:rgba(243,247,238,.3) }
  .rc-n{ font-size:12px; opacity:.7; line-height:1.5; margin-top:3px }
  .sc{ display:inline-flex; align-items:center; gap:12px; background:rgba(255,255,255,.04);
    border:1px solid rgba(159,224,180,.22); border-radius:12px; padding:10px 14px; margin:8px; width:calc(50%% - 16px) }
  .sc img{ width:54px; height:54px; flex:none }
  .sc-b{ display:flex; flex-direction:column; gap:2px }
  .sc-b b{ font-size:15px }
  .sc-b .sc-t{ font-size:12px; color:var(--gold) }
  .sc-b .sc-e{ font-size:12px; opacity:.8 }
  .sc-b .sc-n{ font-size:11px; opacity:.65; line-height:1.45; margin-top:2px }
  footer{ margin-top:26px; font-size:12px; opacity:.5; text-align:center; line-height:1.7; max-width:780px }
</style>
</head>
<body>
  <h1>⚗️ 元素反应系统</h1>
  <div class="sub">在 <code>data/element_matrix.json</code> 五元素克制链基础上扩展的「元素反应」机制规格（纯设计数据，非游戏代码）。先施加的元素为<b>附著(aura)</b>、后施加为<b>触发(trigger)</b>；增幅类反应的倍率随触发方向而变，聚变类反应附著状态。数据来自 <code>data/reactions.json</code>，本页由 <code>tools/build_reaction_chart.py</code> 生成。</div>
  <div class="wrap">
    <div class="card">
      <h2>🔀 五元素反应矩阵 <small>行=附著先手 / 列=触发后手</small></h2>
      __MATRIX__
      <div class="legend">
        <span><i style="background:#e8c463"></i>增幅（放大触发那一击）</span>
        <span><i style="background:#66d957"></i>聚变（附加状态）</span>
      </div>
    </div>
    <div class="card">
      <h2>📜 反应清单 <small>10 组无序元素对</small></h2>
      __REACT_LIST__
    </div>
    <div class="card">
      <h2>🩸 状态图例 <small>7 个被反应引用的状态（图标 = icons/）</small></h2>
      <div style="display:flex;flex-wrap:wrap;justify-content:center">__STATUS_LEGEND__</div>
    </div>
  </div>
  <footer>萌兽消消岛 · 森灵内容包 · 独立命名空间（_content_pack/）<br>设计数值规格（非游戏代码），与 §2.5 五元素克制链、§2.4 元素身份 UI、R12/R14 状态图标+音效三件套对齐，为 §4 接入主游戏时的反应结算与状态机提供数据底座。</footer>
</body>
</html>'''

html = (html.replace('__MATRIX__', matrix)
            .replace('__REACT_LIST__', react_list)
            .replace('__STATUS_LEGEND__', status_legend))

out = os.path.join(ROOT, 'reaction_chart.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('reaction_chart.html written:', os.path.getsize(out), 'bytes;',
      len(ORDER), 'elements /', len(REACT), 'reactions /', len(used_status), 'statuses')
