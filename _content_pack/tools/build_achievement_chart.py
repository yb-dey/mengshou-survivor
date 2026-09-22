# -*- coding: utf-8 -*-
"""build_achievement_chart.py — 由 data/achievements.json 生成可视化参考页
纯本地、零依赖、不卡机；输出 achievement_chart.html（内联 HTML/SVG，无需图片生成）。
与 element_chart / reaction_chart / upgrade_chart / meta_chart 视觉对齐。
"""
import os, json

ROOT = 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou/_content_pack'
DATA = os.path.join(ROOT, 'data')

A = json.load(open(os.path.join(DATA, 'achievements.json'), encoding='utf-8'))
W = json.load(open(os.path.join(DATA, 'wave_design.json'), encoding='utf-8'))
R = json.load(open(os.path.join(DATA, 'reactions.json'), encoding='utf-8'))

ACH = A['achievements']
DAILY = A['daily']
DPOOL = DAILY['pool']
GROUPS = A['groups']
TYPES = A['metricTypes']
REWARDS = A['rewards']

GROUP_ORDER = ['battle', 'explore', 'build', 'reaction', 'meta']
GROUP_COLOR = {
    'battle': '#e06666', 'explore': '#5ab6ff', 'build': '#b06cf0',
    'reaction': '#3fa66a', 'meta': '#e8c463'
}


def hexa(h, a=1.0):
    h = h.lstrip('#')
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return 'rgba(%d,%d,%d,%.2f)' % (r, g, b, a)


TYPE_CN = TYPES

# ---- 奖励流向（成就 ↔ economy faucet 对应关系）----
eco_rows = (
    '<tr><td>首通类成就（森灵初胜 / 十境全踏破）</td>'
    '<td>economy.faucets[first_clear]</td><td>2,097 币（全流程累计）</td></tr>'
    '<tr><td>每日任务（池抽 3 个/天，各 20 币）</td>'
    '<td>economy.faucets[daily]</td><td>1,259 币（全流程累计，20 币/日）</td></tr>'
    '<tr><td>其余 17 个成就</td><td>—（非货币）</td><td>称号 / 图鉴条目 / 头像框</td></tr>')

# ---- 成就卡组（按 group 分组）----
group_sections = []
for g in GROUP_ORDER:
    items = [(k, v) for k, v in ACH.items() if v['group'] == g]
    items.sort(key=lambda x: x[0])
    col = GROUP_COLOR[g]
    cards = []
    for k, v in items:
        m = v['metric']
        cards.append(
            '<div class="uc" style="border-left-color:%s">'
            '<img src="%s" alt="%s">'
            '<div class="uc-b">'
            '<div class="uc-h"><b style="color:%s">%s</b>'
            '<span class="stk">%s × %s</span>'
            '<span class="rw">%s</span></div>'
            '<div class="uc-d">%s</div>'
            '<div class="uc-k"><code>%s</code></div>'
            '</div></div>'
            % (col, v['icon'], v['cn'], col, v['cn'],
               TYPE_CN.get(m['type'], m['type']).split('（')[0], m['target'],
               v['reward']['value'], v['desc'], k))
    group_sections.append(
        '<div class="tier" style="border-color:%s">'
        '<div class="tier-h" style="color:%s">%s <small>%d 项</small></div>'
        '%s</div>' % (hexa(col, .55), col, GROUPS[g], len(items), ''.join(cards)))
tier_html = ''.join(group_sections)

# ---- 每日任务池 ----
daily_cards = []
for k, v in DPOOL.items():
    m = v['metric']
    daily_cards.append(
        '<div class="uc" style="border-left-color:#e8c463">'
        '<img src="%s" alt="%s">'
        '<div class="uc-b">'
        '<div class="uc-h"><b style="color:#e8c463">%s</b>'
        '<span class="stk">%s × %s</span>'
        '<span class="rw">+20 🍀</span></div>'
        '<div class="uc-d">%s</div>'
        '<div class="uc-k"><code>%s</code></div>'
        '</div></div>'
        % (v['icon'], v['cn'], v['cn'],
           TYPE_CN.get(m['type'], m['type']).split('（')[0], m['target'],
           v['desc'], k))
daily_html = ''.join(daily_cards)

# ---- 指标词汇表 ----
stat_rows = ''.join('<tr><td><code>%s</code></td><td>%s</td></tr>' % (k, v) for k, v in TYPES.items())

html = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>森灵萌兽 · 成就与任务系统</title>
<style>
  :root{ --leaf:#3fa66a; --gold:#e8c463; --cream:#f3f7ee; }
  *{ box-sizing:border-box;margin:0;padding:0 }
  body{ font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    background:radial-gradient(130% 120% at 50% -10%, #2f6b45 0%, #1c4a30 45%, #0f2f1f 100%);
    color:var(--cream); min-height:100vh; padding:40px 18px; display:flex; flex-direction:column; align-items:center; }
  h1{ font-size:30px; letter-spacing:2px; margin-bottom:6px }
  .sub{ opacity:.8; margin-bottom:26px; font-size:14px; text-align:center; max-width:840px; line-height:1.6 }
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
  .uc img{ width:48px; height:48px; flex:none; border-radius:8px }
  .uc-b{ flex:1; min-width:0 }
  .uc-h{ font-size:15px; display:flex; align-items:center; gap:8px; flex-wrap:wrap }
  .uc-h .stk{ font-size:11px; opacity:.7; border:1px solid rgba(243,247,238,.3); border-radius:6px; padding:1px 7px }
  .uc-h .rw{ font-size:11px; color:var(--gold); border:1px solid rgba(232,196,99,.4); border-radius:6px; padding:1px 7px }
  .uc-d{ font-size:12.5px; opacity:.78; line-height:1.5; margin-top:5px }
  .uc-k code{ font-size:11px; opacity:.45 }
  .pol{ font-size:13px; line-height:1.7; opacity:.85 }
  .pol b{ color:var(--gold) }
  footer{ margin-top:26px; font-size:12px; opacity:.5; text-align:center; line-height:1.7; max-width:820px }
</style>
</head>
<body>
  <h1>🏅 成就与任务系统</h1>
  <div class="sub">《萌兽消消岛》跨局留存系统规格（纯设计数据，非游戏代码）。__N_ACH__ 个一次性成就 × 5 组 + 每日任务池（抽 __PICK__ 个/天），指标全部取自既有系统（波次击杀 / 反应触发 / 构筑拿卡 / 永久强化 / 货币积累）。它是 <code>data/economy.json</code> 中 <b>first_clear</b> 与 <b>daily</b> 两个水龙头的判定与发放来源——不新增货币水龙头、不突破经济表总量。数据来自 <code>data/achievements.json</code>，本页由 <code>tools/build_achievement_chart.py</code> 生成。</div>
  <div class="wrap">
    <div class="card">
      <h2>💰 奖励政策 <small>与经济表的边界</small></h2>
      <div class="pol">__POLICY__</div>
      <table class="tbl" style="margin-top:12px"><tr><th>触发源</th><th>去向</th><th>额度</th></tr>__ECO_ROWS__</table>
    </div>
    <div class="card">
      <h2>🏅 成就清单 <small>共 __N_ACH__ 个，按 5 组分组（一次性，永久达成）</small></h2>
      __TIER_HTML__
    </div>
    <div class="card">
      <h2>📋 每日任务池 <small>__PICK__ 个/天 · 各 +20 🍀 · 0 点刷新不累计</small></h2>
      __DAILY_HTML__
      <div style="font-size:12px;opacity:.75;line-height:1.6;margin-top:8px">__DAILY_NOTE__</div>
    </div>
    <div class="card">
      <h2>📐 指标词汇表 <small>metric.type 字段口径（全部可从既有系统采集）</small></h2>
      <table class="tbl"><tr><th>字段</th><th>含义</th></tr>__STAT_ROWS__</table>
    </div>
  </div>
  <footer>萌兽消消岛 · 森灵内容包 · 独立命名空间（_content_pack/）<br>设计数值规格（非游戏代码），指标口径与 §2.6 关卡波次、§2.9 元素反应、§2.10 局内成长、§2.11 局外成长对齐；全部图标复用既有 vfx/ · icons/ · sprites/ 资产（零新资产）；货币奖励严格限定在 economy.json 既有水龙头内（含可玩实验室 achievement_lab.html），为 §4 接入主游戏时的留存系统提供数据底座。</footer>
</body>
</html>'''

html = (html.replace('__POLICY__', REWARDS['policy'])
            .replace('__ECO_ROWS__', eco_rows)
            .replace('__TIER_HTML__', tier_html)
            .replace('__DAILY_HTML__', daily_html)
            .replace('__DAILY_NOTE__', DAILY['note'])
            .replace('__STAT_ROWS__', stat_rows)
            .replace('__N_ACH__', str(len(ACH)))
            .replace('__PICK__', str(DAILY['pickPerDay'])))

out = os.path.join(ROOT, 'achievement_chart.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('achievement_chart.html written:', os.path.getsize(out), 'bytes;',
      len(ACH), 'achievements /', len(DPOOL), 'dailies /', len(TYPES), 'metric types')
