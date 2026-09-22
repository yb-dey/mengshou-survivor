# -*- coding: utf-8 -*-
"""build_upgrade_chart.py — 由 data/upgrades.json（局内成长系统）生成可视化参考页
纯本地、零依赖、不卡机；输出 upgrade_chart.html（内联 HTML/SVG，无需图片生成）。
复用 data/element_matrix.json 五元素配色，与 element_chart / reaction_chart 视觉对齐。
"""
import os, json

ROOT = 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou/_content_pack'
DATA = os.path.join(ROOT, 'data')

UJ = json.load(open(os.path.join(DATA, 'upgrades.json'), encoding='utf-8'))
EM = json.load(open(os.path.join(DATA, 'element_matrix.json'), encoding='utf-8'))

UP = UJ['upgrades']
RARITY = UJ['rarity']
LEVELUP = UJ['levelUp']
CURVE = UJ['expCurve']
STATS = UJ['stats']
ELEM_CN = EM['cn']
ELEM_COLOR = EM['colors']

RAR_ORDER = ['common', 'rare', 'epic', 'legendary']


def hexa(h, a=1.0):
    h = h.lstrip('#')
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return 'rgba(%d,%d,%d,%.2f)' % (r, g, b, a)


def elem_hex(e):
    c = ELEM_COLOR[e]
    return '#%02x%02x%02x' % (int(c[0] * 255), int(c[1] * 255), int(c[2] * 255))


# ---- 经验曲线（升到 L+1 所需经验，L=1..maxLevel-1）----
def required(lv):
    return round(CURVE['base'] + CURVE['linear'] * (lv - 1) + CURVE['quad'] * (lv - 1) ** 2)


levels = list(range(1, CURVE['maxLevel']))
reqs = [required(l) for l in levels]
mx = max(reqs)
SVG_W, SVG_H, PAD_L, PAD_B = 880, 240, 34, 34
gap = 5
bw = (SVG_W - PAD_L - 14) / len(levels) - gap
bars = []
for i, (lv, r) in enumerate(zip(levels, reqs)):
    h = (SVG_H - PAD_B - 18) * r / mx
    x = PAD_L + i * (bw + gap)
    y = SVG_H - PAD_B - h
    bars.append(
        '<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="3" fill="%s" opacity="0.85"/>'
        '<text x="%.1f" y="%.1f" font-size="10" fill="rgba(243,247,238,.75)" text-anchor="middle">%d</text>'
        '<text x="%.1f" y="%d" font-size="9" fill="rgba(243,247,238,.5)" text-anchor="middle">%d</text>'
        % (x, y, bw, h, '#3fa66a', x + bw / 2, y - 4, r, x + bw / 2, SVG_H - PAD_B + 14, lv))
exp_svg = ('<svg viewBox="0 0 %d %d" style="width:100%%;height:auto">'
           '<text x="%d" y="18" font-size="12" fill="rgba(243,247,238,.7)">升到下一级所需经验</text>'
           '%s</svg>' % (SVG_W, SVG_H, PAD_L, ''.join(bars)))

# ---- 稀有度权重 + 等级缩放 ----
w = LEVELUP['weights']
sc = LEVELUP['scaling']
scale_rows = []
for lv in [1, 5, 10, 15, 20]:
    ep = w['epic'] + sc['epicPerLevel'] * (lv - 1)
    lg = w['legendary'] + sc['legendaryPerLevel'] * (lv - 1)
    tot = w['common'] + w['rare'] + ep + lg
    scale_rows.append(
        '<tr><td>Lv.%d</td><td>%.0f</td><td>%.0f</td><td>%.0f</td><td>%.1f</td>'
        '<td>%.1f%%</td><td>%.1f%%</td></tr>'
        % (lv, w['common'], w['rare'], ep, lg, ep / tot * 100, lg / tot * 100))
scale_tbl = ('<table class="tbl"><tr><th>等级</th><th>普通</th><th>稀有</th><th>史诗</th><th>传说</th>'
             '<th>史诗占比</th><th>传说占比</th></tr>' + ''.join(scale_rows) + '</table>')

# ---- 升级卡清单（按稀有度分组）----
def effect_text(eff):
    parts = []
    STAT_LABEL = {
        'atkPct': '伤害+%s%%', 'maxHp': '生命+%s', 'armorFlat': '减伤+%s',
        'moveSpdPct': '移速+%s%%', 'cdrPct': '冷却缩减+%s%%', 'critRate': '暴击率+%s%%',
        'critDmg': '暴伤+%s', 'lifestealPct': '吸血+%s%%', 'expGainPct': '经验+%s%%',
        'projectiles': '投射物+%s', 'shieldOnLevel': '升级获盾+%s', 'revive': '复活+%s',
        'reactionDmgPct': '反应伤害+%s%%', 'reactionDurPct': '状态时长+%s%%',
        'auraDurPct': '附著时长+%s%%', 'dotDmgPct': '持续伤害+%s%%', 'summonCount': '召唤物+%s',
    }
    for k, v in eff.items():
        if k == 'elementDmgPct':
            for e, p in v.items():
                parts.append('<span class="eff el" style="border-color:%s;color:%s">%s伤+%s%%</span>'
                             % (elem_hex(e), elem_hex(e), ELEM_CN[e], p))
        else:
            disp = int(v * 100) if k in ('critRate',) else v
            parts.append('<span class="eff">%s</span>' % (STAT_LABEL.get(k, k) % disp))
    return ''.join(parts)


def tag_html(tags, color):
    return ''.join('<span class="tg" style="border-color:%s;color:%s">%s</span>' % (color, color, t) for t in tags)


tier_sections = []
for rar in RAR_ORDER:
    items = [(k, v) for k, v in UP.items() if v['rarity'] == rar]
    items.sort(key=lambda x: x[0])
    col = RARITY[rar]['color']
    cards = []
    for k, v in items:
        cards.append(
            '<div class="uc" style="border-left-color:%s">'
            '<img src="%s" alt="%s">'
            '<div class="uc-b">'
            '<div class="uc-h"><b style="color:%s">%s</b>'
            '<span class="stk">可叠 %d 层</span>%s</div>'
            '<div class="uc-e">%s</div>'
            '<div class="uc-d">%s</div>'
            '<div class="uc-k"><code>%s</code></div>'
            '</div></div>'
            % (col, v['icon'], v['cn'], col, v['cn'], v['maxStacks'],
               tag_html(v['tags'], col), effect_text(v['effects']), v['desc'], k))
    tier_sections.append(
        '<div class="tier" style="border-color:%s">'
        '<div class="tier-h" style="color:%s">%s <small>%s · 权重 %d · %d 张</small></div>'
        '%s</div>' % (hexa(col, .55), col, RARITY[rar]['cn'], RARITY[rar]['cn'],
                      RARITY[rar]['weight'], len(items), ''.join(cards)))
tier_html = ''.join(tier_sections)

# ---- 标签分布 ----
tag_count = {}
for v in UP.values():
    for t in v['tags']:
        tag_count[t] = tag_count.get(t, 0) + 1
TAG_CN = {'damage': '输出', 'defense': '生存', 'utility': '功能', 'element': '元素', 'reaction': '反应'}
tag_bars = []
tmax = max(tag_count.values())
for t, n in sorted(tag_count.items(), key=lambda x: -x[1]):
    pct = n / tmax * 100
    tag_bars.append('<div class="tb"><span class="tb-n">%s</span>'
                    '<span class="tb-bar"><i style="width:%.0f%%"></i></span>'
                    '<span class="tb-v">%d</span></div>' % (TAG_CN.get(t, t), pct, n))
tag_html = ''.join(tag_bars)

# ---- 属性词汇表 ----
stat_rows = ''.join('<tr><td><code>%s</code></td><td>%s</td></tr>' % (k, v) for k, v in STATS.items())

html = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>森灵萌兽 · 局内成长系统</title>
<style>
  :root{ --leaf:#3fa66a; --gold:#e8c463; --cream:#f3f7ee; }
  *{ box-sizing:border-box;margin:0;padding:0 }
  body{ font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    background:radial-gradient(130% 120% at 50% -10%, #2f6b45 0%, #1c4a30 45%, #0f2f1f 100%);
    color:var(--cream); min-height:100vh; padding:40px 18px; display:flex; flex-direction:column; align-items:center; }
  h1{ font-size:30px; letter-spacing:2px; margin-bottom:6px }
  .sub{ opacity:.8; margin-bottom:26px; font-size:14px; text-align:center; max-width:760px; line-height:1.6 }
  .wrap{ width:100%; max-width:920px; display:flex; flex-direction:column; gap:22px }
  .card{ background:rgba(15,47,31,.55); border:1px solid rgba(159,224,180,.25); border-radius:16px; padding:22px 24px }
  .card h2{ font-size:18px; margin-bottom:16px; display:flex; align-items:center; gap:8px }
  .card h2 small{ opacity:.6; font-weight:400; font-size:13px }
  table.tbl{ border-collapse:collapse; width:100%; font-size:13px; margin-top:6px }
  table.tbl th,table.tbl td{ border:1px solid rgba(159,224,180,.25); padding:7px 10px; text-align:center }
  table.tbl th{ background:rgba(232,196,99,.12); font-weight:700 }
  table.tbl td:first-child,table.tbl th:first-child{ text-align:left }
  .tier{ border:1px solid; border-radius:12px; padding:14px 16px; margin:12px 0; background:rgba(255,255,255,.03) }
  .tier-h{ font-size:16px; font-weight:700; margin-bottom:10px }
  .tier-h small{ opacity:.7; font-weight:400; font-size:12px; margin-left:6px }
  .uc{ display:flex; gap:12px; background:rgba(255,255,255,.04); border-left:4px solid var(--leaf);
    border-radius:10px; padding:10px 14px; margin:8px 0; align-items:flex-start }
  .uc img{ width:48px; height:48px; flex:none }
  .uc-b{ flex:1; min-width:0 }
  .uc-h{ font-size:15px; display:flex; align-items:center; gap:8px; flex-wrap:wrap }
  .uc-h .stk{ font-size:11px; opacity:.7; border:1px solid rgba(243,247,238,.3); border-radius:6px; padding:1px 7px }
  .uc-h .tg{ font-size:11px; border:1px solid; border-radius:6px; padding:1px 7px }
  .uc-e{ margin:6px 0 4px; display:flex; flex-wrap:wrap; gap:5px }
  .uc-e .eff{ font-size:11.5px; background:rgba(255,255,255,.06); border:1px solid rgba(159,224,180,.3);
    border-radius:6px; padding:1px 7px }
  .uc-e .eff.el{ background:transparent; border:1px solid }
  .uc-d{ font-size:12.5px; opacity:.78; line-height:1.5 }
  .uc-k code{ font-size:11px; opacity:.45 }
  .tb{ display:flex; align-items:center; gap:10px; margin:6px 0; font-size:13px }
  .tb-n{ width:52px; flex:none; opacity:.85 }
  .tb-bar{ flex:1; height:14px; background:rgba(255,255,255,.07); border-radius:7px; overflow:hidden }
  .tb-bar i{ display:block; height:100%; background:linear-gradient(90deg,#6fe39a,#3fa66a) }
  .tb-v{ width:24px; text-align:right; color:var(--gold); font-weight:700 }
  footer{ margin-top:26px; font-size:12px; opacity:.5; text-align:center; line-height:1.7; max-width:800px }
</style>
</head>
<body>
  <h1>🎲 局内成长系统</h1>
  <div class="sub">《萌兽消消岛》单局内的「升级三选一 + 构筑」成长规格（纯设计数据，非游戏代码）。局内累积经验升级，每次升级从加权池抽 __CARDS__ 张卡选 1，围绕 <b>元素专精 / 反应连锁 / 生存续航 / 召唤兽群</b> 逐步成型。数据来自 <code>data/upgrades.json</code>，本页由 <code>tools/build_upgrade_chart.py</code> 生成。</div>
  <div class="wrap">
    <div class="card">
      <h2>📈 经验曲线 <small>__FORMULA__</small></h2>
      __EXP_SVG__
    </div>
    <div class="card">
      <h2>⚖️ 稀有度权重与等级缩放 <small>每次升级抽 __CARDS__ 张</small></h2>
      __SCALE_TBL__
      <div style="font-size:12px;opacity:.75;line-height:1.6;margin-top:8px">__SCALING_NOTE__</div>
    </div>
    <div class="card">
      <h2>🏷️ 流派标签分布 <small>按升级卡可归入的构筑方向统计</small></h2>
      __TAG_HTML__
    </div>
    <div class="card">
      <h2>🃏 升级卡清单 <small>共 __N__ 张，按稀有度分组</small></h2>
      __TIER_HTML__
    </div>
    <div class="card">
      <h2>📐 属性词汇表 <small>升级卡 effects 字段口径</small></h2>
      <table class="tbl"><tr><th>字段</th><th>含义</th></tr>__STAT_ROWS__</table>
    </div>
  </div>
  <footer>萌兽消消岛 · 森灵内容包 · 独立命名空间（_content_pack/）<br>设计数值规格（非游戏代码），与 §2.5 五元素克制链、§2.9 元素反应系统、§2.4 元素身份 UI 对齐；升级卡全部复用既有 icons/ · skill_icons/ · vfx/ · audio/ 资产（零新资产），为 §4 接入主游戏时的升级流程与构筑系统提供数据底座。</footer>
</body>
</html>'''

html = (html.replace('__EXP_SVG__', exp_svg)
            .replace('__SCALE_TBL__', scale_tbl)
            .replace('__SCALING_NOTE__', LEVELUP['scalingNote'])
            .replace('__TAG_HTML__', tag_html)
            .replace('__TIER_HTML__', tier_html)
            .replace('__STAT_ROWS__', stat_rows)
            .replace('__FORMULA__', CURVE['formula'])
            .replace('__CARDS__', str(LEVELUP['cards']))
            .replace('__N__', str(len(UP))))

out = os.path.join(ROOT, 'upgrade_chart.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('upgrade_chart.html written:', os.path.getsize(out), 'bytes;',
      len(UP), 'upgrades /', len(RARITY), 'rarities /', len(STATS), 'stats')
