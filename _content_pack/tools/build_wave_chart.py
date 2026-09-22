# -*- coding: utf-8 -*-
"""build_wave_chart.py — 由 data/wave_design.json + data/boss_phases.json 生成关卡波次与 BOSS 多阶段可视化参考页
纯本地、零依赖、不卡机；输出 wave_chart.html（内联 SVG/HTML，无需图片生成）。
配色复用 data/element_matrix.json 的五元素归一化 RGB，保证与克制环/数值页视觉一致。
"""
import os, json, math

ROOT = 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou/_content_pack'
DATA = os.path.join(ROOT, 'data')

EM = json.load(open(os.path.join(DATA, 'element_matrix.json'), encoding='utf-8'))
WD = json.load(open(os.path.join(DATA, 'wave_design.json'), encoding='utf-8'))
BP = json.load(open(os.path.join(DATA, 'boss_phases.json'), encoding='utf-8'))

COLORS = EM['colors']
CN = EM['cn']                       # element key -> 中文
ELEMS = EM['elements']

def hexc(rgb):
    return '#%02x%02x%02x' % (int(rgb[0]*255), int(rgb[1]*255), int(rgb[2]*255))

def ecolor(el):
    return hexc(COLORS[el]) if el in COLORS else '#9fb8d8'

# 敌种 key -> (中文, 元素)
EN = WD['enemies']
def enemy_cn(k):
    return EN[k]['cn'] if k in EN else k
def enemy_el(k):
    return EN[k]['element'] if k in EN else 'neutral'

# ---------------------------------------------------------------------------
# Section 1: 关卡卡片（每关敌种按元素聚合的堆叠条）
# ---------------------------------------------------------------------------
def level_total(waves):
    return sum(s['count'] for w in waves for s in w['spawns'])

def level_elem_stack(waves):
    agg = {}
    for w in waves:
        for s in w['spawns']:
            el = enemy_el(s['key'])
            agg[el] = agg.get(el, 0) + s['count']
    return agg

level_cards = []
for lv in WD['levels']:
    total = level_total(lv['waves'])
    agg = level_elem_stack(lv['waves'])
    maxv = max(agg.values()) if agg else 1
    segs = []
    for el in ELEMS:                       # 固定五元素顺序，避免漂移
        if el in agg:
            c = agg[el]
            wpct = (c / maxv) * 100
            segs.append('<span style="width:%.2f%%;background:%s" title="%s ×%d"></span>'
                        % (wpct, ecolor(el), CN[el], c))
    focus = ''.join('<i style="background:%s">%s</i>' % (ecolor(e), CN[e]) for e in lv['elementFocus'])
    waves_n = len(lv['waves'])
    spawns_detail = ' · '.join('%s×%d' % (enemy_cn(s['key']), s['count'])
                              for w in lv['waves'] for s in w['spawns'])
    is_boss = (lv['id'] == 10)
    badge = '<span class="boss">BOSS</span>' if is_boss else ''
    level_cards.append(
        '<div class="lv%s">'
        '<div class="lvh"><b>L%d</b> %s %s<span class="theme">%s</span></div>'
        '<div class="stack">%s</div>'
        '<div class="meta"><span>%d 波 · %d 敌</span><span class="rw">%s</span></div>'
        '<div class="spawns">%s</div>'
        '</div>' % ((' boss' if is_boss else ''), lv['id'], lv['name'], badge, lv['theme'],
                    ''.join(segs), waves_n, total, lv['reward'], spawns_detail))
levels_html = ''.join(level_cards)

# legend for element colors
elem_legend = ''.join('<span><i style="background:%s"></i>%s</span>' % (ecolor(e), CN[e]) for e in ELEMS)

# ---------------------------------------------------------------------------
# Section 2: 难度曲线（每关总敌数柱状，BOSS 关高亮）
# ---------------------------------------------------------------------------
totals = [(lv['id'], level_total(lv['waves']), lv['id'] == 10) for lv in WD['levels']]
peak = max(t for _, t, _ in totals)
bars = []
for lid, t, is_boss in totals:
    h = (t / peak) * 170
    col = '#e5484d' if is_boss else '#3fa66a'
    bars.append(
        '<div class="cb"><div class="cbar" style="height:%.1fpx;background:%s"></div>'
        '<div class="clbl">%d</div><div class="cval">%d</div></div>' % (h, col, lid, t))
curve_html = ''.join(bars)

# ---------------------------------------------------------------------------
# Section 3: BOSS 三阶段
# ---------------------------------------------------------------------------
boss = BP['boss']; bossCn = BP['bossCn']; bossEl = BP['element']; baseHp = BP['baseHp']
phase_colors = ['#3fa66a', '#e8c463', '#e5484d']   # 绿→琥珀→红， escalation 直观
# HP 分段宽度（百分比）
segs_def = [
    (100, BP['phases'][0]['hpLow']),     # p1 100->66
    (BP['phases'][0]['hpLow'], BP['phases'][1]['hpLow']),  # p2 66->33
    (BP['phases'][1]['hpLow'], 0),       # p3 33->0
]
hp_segs = []
for i, (hi, lo) in enumerate(segs_def):
    pct = hi - lo
    hp_segs.append('<div class="hps" style="width:%.2f%%;background:%s" title="阶段%d %d%%–%d%%">%d%%</div>'
                   % (pct, phase_colors[i], i+1, hi, lo, pct))
hp_html = ''.join(hp_segs)

phase_cards = []
for i, ph in enumerate(BP['phases']):
    ab = []
    for a in ph['abilities']:
        ab.append('<div class="ab" style="border-color:%s"><span class="abn" style="color:%s">%s</span>'
                  '<span class="abc">%ds</span><em>%s · %s</em></div>'
                  % (ecolor(a['element']), ecolor(a['element']), a['name'], a['cooldown'], a['cn'], CN.get(a['element'], '')))
    sm = ' · '.join('%s×%d' % (enemy_cn(s['key']), s['count']) for s in ph['summon'])
    avg = sum(a['cooldown'] for a in ph['abilities']) / len(ph['abilities'])
    phase_cards.append(
        '<div class="pc" style="border-top:4px solid %s">'
        '<div class="ph-h"><b>阶段 %d</b><span class="thr">%s</span></div>'
        '<div class="abs">%s</div>'
        '<div class="sm">召唤：%s</div>'
        '<div class="note">%s</div>'
        '<div class="avg">平均冷却 %.2fs</div>'
        '</div>' % (phase_colors[i], ph['phase'], ph['hpThreshold'],
                    ''.join(ab), sm if sm else '无', ph['notes'], avg))
phases_html = ''.join(phase_cards)

# 冷却压缩（每阶段平均冷却柱状，向下=更凶）已在阶段卡平均冷却处体现，额外给一条总对比条
avg_cds = [sum(a['cooldown'] for a in ph['abilities']) / len(ph['abilities']) for ph in BP['phases']]
maxcd = max(avg_cds)
comp_bars = []
for i, ac in enumerate(avg_cds):
    h = (ac / maxcd) * 90
    comp_bars.append('<div class="cmp"><div class="cmpb" style="height:%.1fpx;background:%s"></div>'
                     '<div class="cmpl">阶段%d</div><div class="cmpv">%.2fs</div></div>'
                     % (h, phase_colors[i], i+1, ac))
comp_html = ''.join(comp_bars)

html = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>森灵萌兽 · 关卡波次与 BOSS 多阶段</title>
<style>
  :root{ --leaf:#3fa66a; --gold:#e8c463; --cream:#f3f7ee; }
  *{ box-sizing:border-box;margin:0;padding:0 }
  body{ font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    background:radial-gradient(130% 120% at 50% -10%, #2f6b45 0%, #1c4a30 45%, #0f2f1f 100%);
    color:var(--cream); min-height:100vh; padding:40px 18px; display:flex; flex-direction:column; align-items:center; }
  h1{ font-size:30px; letter-spacing:2px; margin-bottom:6px }
  .sub{ opacity:.8; margin-bottom:26px; font-size:14px; text-align:center; max-width:720px; line-height:1.6 }
  .wrap{ width:100%; max-width:1000px; display:flex; flex-direction:column; gap:22px }
  .card{ background:rgba(15,47,31,.55); border:1px solid rgba(159,224,180,.25); border-radius:16px; padding:22px 24px }
  .card h2{ font-size:18px; margin-bottom:8px; display:flex; align-items:center; gap:8px }
  .card h2 small{ opacity:.6; font-weight:400; font-size:13px }
  .legend{ display:flex; gap:14px; flex-wrap:wrap; margin-top:14px; font-size:12px; opacity:.85 }
  .legend span{ display:inline-flex; align-items:center; gap:6px }
  .legend i{ width:14px;height:14px;border-radius:4px;display:inline-block }
  /* level cards */
  .lvgrid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:14px; margin-top:14px }
  .lv{ background:rgba(255,255,255,.05); border:1px solid rgba(159,224,180,.22); border-radius:12px; padding:12px 14px }
  .lv.boss{ border-color:var(--gold); box-shadow:0 0 0 1px rgba(232,196,99,.3) inset }
  .lvh{ display:flex; align-items:center; gap:6px; font-size:15px; margin-bottom:8px }
  .lvh b{ color:var(--gold) }
  .lvh .theme{ margin-left:auto; font-size:12px; opacity:.7 }
  .lvh .boss{ background:var(--gold); color:#22331f; font-size:11px; font-weight:700; padding:1px 7px; border-radius:6px }
  .stack{ display:flex; height:16px; border-radius:8px; overflow:hidden; background:rgba(255,255,255,.08) }
  .stack span{ height:100% }
  .meta{ display:flex; justify-content:space-between; font-size:12px; margin-top:8px; opacity:.85 }
  .meta .rw{ color:var(--gold) }
  .spawns{ font-size:11px; opacity:.65; margin-top:6px; line-height:1.5 }
  /* difficulty curve */
  .curve{ display:flex; align-items:flex-end; gap:10px; height:210px; margin-top:16px; padding-bottom:26px; position:relative }
  .cb{ display:flex; flex-direction:column; align-items:center; flex:1; height:100%; justify-content:flex-end; position:relative }
  .cbar{ width:26px; border-radius:6px 6px 0 0; transition:height .3s }
  .clbl{ position:absolute; bottom:-22px; font-size:11px; opacity:.7 }
  .cval{ font-size:11px; opacity:.85; margin-bottom:3px }
  /* boss */
  .hpbar{ display:flex; height:30px; border-radius:8px; overflow:hidden; margin:8px 0 6px; font-size:12px; font-weight:700; color:#10241a }
  .hps{ display:flex; align-items:center; justify-content:center }
  .phgrid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:14px; margin-top:8px }
  .pc{ background:rgba(255,255,255,.05); border:1px solid rgba(159,224,180,.22); border-radius:12px; padding:14px }
  .ph-h{ display:flex; justify-content:space-between; align-items:center; margin-bottom:10px }
  .ph-h b{ font-size:16px; color:var(--gold) }
  .ph-h .thr{ font-size:12px; opacity:.8 }
  .abs{ display:flex; flex-wrap:wrap; gap:8px }
  .ab{ background:rgba(0,0,0,.22); border:1px solid; border-radius:9px; padding:6px 9px; min-width:96px }
  .ab .abn{ font-weight:700; font-size:13px }
  .ab .abc{ float:right; font-size:12px; opacity:.85; margin-left:8px }
  .ab em{ display:block; font-style:normal; font-size:11px; opacity:.7; margin-top:2px }
  .sm{ font-size:12px; margin-top:10px; opacity:.85 }
  .note{ font-size:12px; opacity:.72; margin-top:8px; line-height:1.55 }
  .avg{ font-size:11px; opacity:.6; margin-top:8px; text-align:right }
  .comp{ display:flex; align-items:flex-end; gap:18px; height:130px; margin-top:14px; padding-bottom:24px }
  .cmp{ display:flex; flex-direction:column; align-items:center; flex:1; height:100%; justify-content:flex-end; position:relative }
  .cmpb{ width:34px; border-radius:6px 6px 0 0 }
  .cmpl{ position:absolute; bottom:-20px; font-size:11px; opacity:.7 }
  .cmpv{ font-size:11px; opacity:.85; margin-bottom:3px }
  footer{ margin-top:26px; font-size:12px; opacity:.5; text-align:center; line-height:1.7; max-width:760px }
</style>
</head>
<body>
  <h1>🗺️ 关卡波次与 BOSS 多阶段</h1>
  <div class="sub">10 关难度曲线（单元素教学 → 双元素混编 → 五元素精英 → BOSS）+ 森林古木三阶段 Boss 状态机。数据来自 <code>data/wave_design.json</code> 与 <code>data/boss_phases.json</code>，本页由 <code>tools/build_wave_chart.py</code> 扫描生成。配色与 <code>data/element_matrix.json</code> 五元素一致。</div>
  <div class="wrap">
    <div class="card">
      <h2>🗺️ 关卡地图 <small>每关敌种按元素聚合（堆叠条）</small></h2>
      <div class="lvgrid">__LEVELS__</div>
      <div class="legend">__ELEM_LEGEND__</div>
    </div>
    <div class="card">
      <h2>📈 难度曲线 <small>每关总敌数（红=BOSS 关）</small></h2>
      <div class="curve">__CURVE__</div>
    </div>
    <div class="card">
      <h2>🌳 BOSS · __BOSSCN__ <small>__BOSSEL__ 属性 · 基础 HP __BOSSHP__</small></h2>
      <div class="hpbar">__HP__</div>
      <div class="phgrid">__PHASES__</div>
      <h2 style="margin-top:18px">🔥 冷却压缩 <small>每阶段平均冷却（越低越凶）</small></h2>
      <div class="comp">__COMP__</div>
    </div>
  </div>
  <footer>萌兽消消岛 · 森灵内容包 · 独立命名空间（_content_pack/）<br>设计数值规格（非游戏代码），用于平衡参考与后续 playground 机制深化（按波次实跑 / 按阶段跑 Boss）。</footer>
</body>
</html>'''

html = (html.replace('__LEVELS__', levels_html)
            .replace('__ELEM_LEGEND__', elem_legend)
            .replace('__CURVE__', curve_html)
            .replace('__HP__', hp_html)
            .replace('__PHASES__', phases_html)
            .replace('__COMP__', comp_html)
            .replace('__BOSSCN__', bossCn)
            .replace('__BOSSEL__', CN.get(bossEl, bossEl))
            .replace('__BOSSHP__', str(baseHp)))

out = os.path.join(ROOT, 'wave_chart.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('wave_chart.html written:', os.path.getsize(out), 'bytes;',
      len(WD['levels']), 'levels /', len(BP['phases']), 'boss phases')
