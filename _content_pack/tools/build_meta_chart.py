# -*- coding: utf-8 -*-
"""build_meta_chart.py — 由 data/meta_upgrades.json + data/economy.json 生成可视化参考页
纯本地、零依赖、不卡机；输出 meta_chart.html（内联 HTML/SVG，无需图片生成）。
复用 data/element_matrix.json 五元素配色，与 element_chart / reaction_chart / upgrade_chart 视觉对齐。
"""
import os, json

ROOT = 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou/_content_pack'
DATA = os.path.join(ROOT, 'data')

MU = json.load(open(os.path.join(DATA, 'meta_upgrades.json'), encoding='utf-8'))
EC = json.load(open(os.path.join(DATA, 'economy.json'), encoding='utf-8'))
EM = json.load(open(os.path.join(DATA, 'element_matrix.json'), encoding='utf-8'))

UP = MU['metaUpgrades']
CATS = MU['categories']
STATS = MU['stats']
COST = MU['costModel']
ELEM_CN = EM['cn']
ELEM_COLOR = EM['colors']

CAT_ORDER = ['basic', 'element', 'economy', 'survival', 'unlock']
CAT_COLOR = {
    'basic': '#3fa66a', 'element': '#5ab6ff', 'economy': '#e8c463',
    'survival': '#e06666', 'unlock': '#b06cf0'
}


def hexa(h, a=1.0):
    h = h.lstrip('#')
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return 'rgba(%d,%d,%d,%.2f)' % (r, g, b, a)


def elem_hex(e):
    c = ELEM_COLOR[e]
    return '#%02x%02x%02x' % (int(c[0] * 255), int(c[1] * 255), int(c[2] * 255))


def cost_l(base, growth, l):
    return round(base * growth ** (l - 1))


def total_cost(base, growth, mx):
    return sum(cost_l(base, growth, l) for l in range(1, mx + 1))


# ---- 经济水槽模型 ----
def money(n):
    return format(n, ',')


faucet_rows = ''.join(
    '<tr><td>%s</td><td>%s</td><td>%s</td><td>%.0f%%</td><td class="l">%s</td></tr>'
    % (f['cn'], f['scope'], money(f['coins']), f['share'] * 100, f['note'])
    for f in EC['faucets'])
drain_rows = ''.join(
    '<tr><td>%s</td><td>%s</td><td>%s</td><td class="l">%s</td></tr>'
    % (d['cn'], d['scope'], money(d['coins']), d['note'])
    for d in EC['drains'])

hr = EC['hoarding_rate']
hr_pct = hr * 100
# 积压率仪表：0~0.5 量程，0.3 为阈值线，0.22 为当前
G_W, G_H = 640, 90
g_x = lambda v: 30 + v / 0.5 * (G_W - 60)
gauge = ('<svg viewBox="0 0 %d %d" style="width:100%%;height:auto">'
         '<rect x="30" y="30" width="%d" height="20" rx="10" fill="rgba(255,255,255,.08)"/>'
         '<rect x="30" y="30" width="%.1f" height="20" rx="10" fill="%s"/>'
         '<rect x="%.1f" y="24" width="2" height="32" fill="#e8c463"/>'
         '<text x="%.1f" y="72" font-size="11" fill="#e8c463" text-anchor="middle">阈值 30%%</text>'
         '<text x="%.1f" y="18" font-size="12" fill="#6fe39a" text-anchor="middle">当前 %.0f%%（健康）</text>'
         '</svg>'
         % (G_W, G_H, G_W - 60, (G_W - 60) * hr / 0.5, '#6fe39a',
            g_x(0.3), g_x(0.3), g_x(hr), hr_pct))

# ---- 分类总消耗 ----
cat_total = {c: sum(total_cost(v['cost']['base'], v['cost']['growth'], v['maxLevel'])
                    for k, v in UP.items() if v['category'] == c) for c in CAT_ORDER}
c_max = max(cat_total.values())
cat_bars = []
for c in CAT_ORDER:
    n = cat_total[c]
    pct = n / c_max * 100
    cat_bars.append(
        '<div class="tb"><span class="tb-n">%s</span>'
        '<span class="tb-bar"><i style="width:%.0f%%;background:%s"></i></span>'
        '<span class="tb-v">%s</span></div>'
        % (CATS[c], pct, CAT_COLOR[c], money(n)))
cat_bar_html = ''.join(cat_bars)

# ---- 永久强化清单（按 category 分组）----
def effect_text(eff):
    parts = []
    LABEL = {
        'maxHpPct': '生命+%s%%/级', 'atkPct': '伤害+%s%%/级', 'moveSpdPct': '移速+%s%%/级',
        'pickupRangePct': '拾取范围+%s%%/级', 'critRate': '暴击率+%s%%/级',
        'coinGainPct': '金币+%s%%/级', 'expGainPct': '经验+%s%%/级',
        'startingCoins': '开局+%s币/级', 'armorPct': '减伤+%s%%/级', 'revive': '复活+%s/级',
    }
    for k, v in eff.items():
        if k == 'elementDmgPct':
            for e, p in v.items():
                parts.append('<span class="eff el" style="border-color:%s;color:%s">%s伤+%s%%/级</span>'
                             % (elem_hex(e), elem_hex(e), ELEM_CN[e], p))
        elif k == 'unlock':
            parts.append('<span class="eff">解锁新英雄</span>')
        else:
            disp = int(v * 100) if k == 'critRate' else v
            parts.append('<span class="eff">%s</span>' % (LABEL.get(k, k) % disp))
    return ''.join(parts)


def tag_html(tag, color):
    return ''.join('<span class="tg" style="border-color:%s;color:%s">%s</span>' % (color, color, t) for t in [tag])


cat_sections = []
for c in CAT_ORDER:
    items = [(k, v) for k, v in UP.items() if v['category'] == c]
    items.sort(key=lambda x: x[0])
    col = CAT_COLOR[c]
    cards = []
    for k, v in items:
        mx = v['maxLevel']
        first = cost_l(v['cost']['base'], v['cost']['growth'], 1)
        last = cost_l(v['cost']['base'], v['cost']['growth'], mx)
        tot = total_cost(v['cost']['base'], v['cost']['growth'], mx)
        cost_txt = ('Lv1=%s' % money(first)) if mx == 1 else (
            'Lv1=%s → Lv%d=%s · 满级总投入 %s' % (money(first), mx, money(last), money(tot)))
        cards.append(
            '<div class="uc" style="border-left-color:%s">'
            '<img src="%s" alt="%s">'
            '<div class="uc-b">'
            '<div class="uc-h"><b style="color:%s">%s</b>'
            '<span class="stk">满级 %d 级</span>%s</div>'
            '<div class="uc-e">%s</div>'
            '<div class="uc-d">%s</div>'
            '<div class="uc-k"><code>%s</code> · %s</div>'
            '</div></div>'
            % (col, v['icon'], v['cn'], col, v['cn'], mx,
               tag_html(v['tag'], col), effect_text(v['effects']), v['desc'], k, cost_txt))
    cat_sections.append(
        '<div class="tier" style="border-color:%s">'
        '<div class="tier-h" style="color:%s">%s <small>%d 项 · 总投入 %s 币</small></div>'
        '%s</div>' % (hexa(col, .55), col, CATS[c], len(items), money(cat_total[c]), ''.join(cards)))
tier_html = ''.join(cat_sections)

# ---- 属性词汇表 ----
stat_rows = ''.join('<tr><td><code>%s</code></td><td>%s</td></tr>' % (k, v) for k, v in STATS.items())

html = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>森灵萌兽 · 局外成长系统</title>
<style>
  :root{ --leaf:#3fa66a; --gold:#e8c463; --cream:#f3f7ee; }
  *{ box-sizing:border-box;margin:0;padding:0 }
  body{ font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    background:radial-gradient(130% 120% at 50% -10%, #2f6b45 0%, #1c4a30 45%, #0f2f1f 100%);
    color:var(--cream); min-height:100vh; padding:40px 18px; display:flex; flex-direction:column; align-items:center; }
  h1{ font-size:30px; letter-spacing:2px; margin-bottom:6px }
  .sub{ opacity:.8; margin-bottom:26px; font-size:14px; text-align:center; max-width:820px; line-height:1.6 }
  .wrap{ width:100%; max-width:920px; display:flex; flex-direction:column; gap:22px }
  .card{ background:rgba(15,47,31,.55); border:1px solid rgba(159,224,180,.25); border-radius:16px; padding:22px 24px }
  .card h2{ font-size:18px; margin-bottom:16px; display:flex; align-items:center; gap:8px }
  .card h2 small{ opacity:.6; font-weight:400; font-size:13px }
  table.tbl{ border-collapse:collapse; width:100%; font-size:13px; margin-top:6px }
  table.tbl th,table.tbl td{ border:1px solid rgba(159,224,180,.25); padding:7px 10px; text-align:center }
  table.tbl th{ background:rgba(232,196,99,.12); font-weight:700 }
  table.tbl td:first-child,table.tbl th:first-child{ text-align:left }
  table.tbl td.l{ text-align:left; opacity:.8 }
  .tier{ border:1px solid; border-radius:12px; padding:14px 16px; margin:12px 0; background:rgba(255,255,255,.03) }
  .tier-h{ font-size:16px; font-weight:700; margin-bottom:10px }
  .tier-h small{ opacity:.7; font-weight:400; font-size:12px; margin-left:6px }
  .uc{ display:flex; gap:12px; background:rgba(255,255,255,.04); border-left:4px solid var(--leaf);
    border-radius:10px; padding:10px 14px; margin:8px 0; align-items:flex-start }
  .uc img{ width:48px; height:48px; flex:none; border-radius:8px }
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
  .tb-n{ width:72px; flex:none; opacity:.85 }
  .tb-bar{ flex:1; height:16px; background:rgba(255,255,255,.07); border-radius:8px; overflow:hidden }
  .tb-bar i{ display:block; height:100% }
  .tb-v{ width:88px; text-align:right; color:var(--gold); font-weight:700 }
  footer{ margin-top:26px; font-size:12px; opacity:.5; text-align:center; line-height:1.7; max-width:800px }
</style>
</head>
<body>
  <h1>🌱 局外成长系统</h1>
  <div class="sub">《萌兽消消岛》跨局永久强化规格（纯设计数据，非游戏代码）。局内表现获取 <b>森灵币</b>（跨局累积），在局外大厅购买 <b>基础属性 / 元素亲和 / 经济加成 / 生存续航 / 英雄解锁</b> 五类永久强化。与 <code>data/upgrades.json</code>（局内成长）构成幸存品类「局内构筑 + 局外养成」双层循环。数据来自 <code>data/meta_upgrades.json</code> + <code>data/economy.json</code>，本页由 <code>tools/build_meta_chart.py</code> 生成。</div>
  <div class="wrap">
    <div class="card">
      <h2>💰 经济水槽模型 <small>森灵币产出 → 消耗闭环</small></h2>
      __GAUGE__
      <h2 style="margin-top:18px">产出（水龙头）</h2>
      <table class="tbl"><tr><th>来源</th><th>作用域</th><th>全流程产出</th><th>占比</th><th>说明</th></tr>__FAUCET_ROWS__</table>
      <h2 style="margin-top:18px">消耗（下水道）</h2>
      <table class="tbl"><tr><th>去向</th><th>作用域</th><th>全流程消耗</th><th>说明</th></tr>__DRAIN_ROWS__</table>
      <div style="font-size:12px;opacity:.75;line-height:1.6;margin-top:8px">__MODEL_NOTE__</div>
    </div>
    <div class="card">
      <h2>📊 分类总消耗 <small>五类永久强化的森灵币投入对比</small></h2>
      __CAT_BARS__
    </div>
    <div class="card">
      <h2>🌿 永久强化清单 <small>共 __N__ 项，按分类分组 · 成本几何增长</small></h2>
      <div style="font-size:12px;opacity:.7;margin-bottom:10px">__COST_FORMULA__</div>
      __TIER_HTML__
    </div>
    <div class="card">
      <h2>📐 属性词汇表 <small>永久强化 effects 字段口径</small></h2>
      <table class="tbl"><tr><th>字段</th><th>含义</th></tr>__STAT_ROWS__</table>
    </div>
  </div>
  <footer>萌兽消消岛 · 森灵内容包 · 独立命名空间（_content_pack/）<br>设计数值规格（非游戏代码），与 §2.5 五元素克制链、§2.10 局内成长系统对齐；永久强化全部复用既有 icons/ · skill_icons/ · vfx/ · sprites/ · audio/ 资产（零新资产，英雄解锁项用现有精灵作占位图，待云端出图替换）；经济表经 game-economy 校验（E1–E4 PASS，积压率 0.22 &lt; 0.3 健康），为 §4 接入主游戏时的局外养成与货币系统提供数据底座。</footer>
</body>
</html>'''

html = (html.replace('__GAUGE__', gauge)
            .replace('__FAUCET_ROWS__', faucet_rows)
            .replace('__DRAIN_ROWS__', drain_rows)
            .replace('__MODEL_NOTE__', EC['model']['note'])
            .replace('__CAT_BARS__', cat_bar_html)
            .replace('__TIER_HTML__', tier_html)
            .replace('__STAT_ROWS__', stat_rows)
            .replace('__COST_FORMULA__', COST['formula'])
            .replace('__N__', str(len(UP))))

out = os.path.join(ROOT, 'meta_chart.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('meta_chart.html written:', os.path.getsize(out), 'bytes;',
      len(UP), 'meta upgrades /', len(CATS), 'categories /', len(STATS), 'stats')
