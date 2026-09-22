# -*- coding: utf-8 -*-
"""build_endless_chart.py — 由 data/endless.json 生成可视化参考页
纯本地、零依赖、不卡机；输出 endless_chart.html（内联 SVG 难度曲线 + 阶段池 + 里程碑）。
与 wave_chart / element_chart 等参考页视觉对齐。
"""
import os, json

ROOT = 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou/_content_pack'

E = json.load(open(os.path.join(ROOT, 'data', 'endless.json'), encoding='utf-8'))
W = json.load(open(os.path.join(ROOT, 'data', 'wave_design.json'), encoding='utf-8'))
EM = json.load(open(os.path.join(ROOT, 'data', 'element_matrix.json'), encoding='utf-8'))

RU = E['rules']
CY = E['cycles']
PH = E['phases']
MS = E['milestones']
ENEMIES = W['enemies']
ELEM_CN = EM['cn']
ELEM_COLOR = EM['colors']


def elem_hex(e):
    c = ELEM_COLOR[e]
    return '#%02x%02x%02x' % (int(c[0] * 255), int(c[1] * 255), int(c[2] * 255))


def budget(w):
    return round(6 + 2 * (w - 1) + 0.15 * (w - 1) ** 2)


def hpMul(w):
    return 1 + 0.22 * (w - 1) + 0.012 * (w - 1) ** 2


def dmgMul(w):
    return 1 + 0.10 * (w - 1) + 0.005 * (w - 1) ** 2


def coins(w):
    return max(2, 10 - w // 3)


# ---- 难度曲线 SVG（w=1..30，三条曲线 + 币产出）----
WMAX = 30
SW, SH, PL, PB, PT = 860, 260, 40, 36, 16
PW = SW - PL - 16


def curve(vals, color, label, vmax, dash=''):
    pts = []
    for i, v in enumerate(vals):
        x = PL + i / (WMAX - 1) * PW
        y = SH - PB - (v / vmax) * (SH - PB - PT - 14)
        pts.append('%.1f,%.1f' % (x, y))
    return ('<polyline points="%s" fill="none" stroke="%s" stroke-width="2.2" %s opacity="0.95"/>'
            '<text x="%s" y="%s" font-size="11" fill="%s">%s</text>'
            % (' '.join(pts), color, 'stroke-dasharray="%s"' % dash if dash else '',
               PL + PW - 2, SH - PB - (vals[-1] / vmax) * (SH - PB - PT - 14) - 6, color, label))


ws = list(range(1, WMAX + 1))
b_vals = [budget(w) for w in ws]
h_vals = [hpMul(w) * 10 for w in ws]   # ×10 与 budget 同量纲显示
d_vals = [dmgMul(w) * 10 for w in ws]
c_vals = [coins(w) for w in ws]
VM = max(max(b_vals), max(h_vals)) * 1.05

grid = []
for gy in range(5):
    y = PT + gy * (SH - PB - PT - 14) / 4
    grid.append('<line x1="%d" y1="%.1f" x2="%d" y2="%.1f" stroke="rgba(159,224,180,.12)" stroke-width="1"/>'
                % (PL, y, PL + PW, y))
xlabels = ''.join('<text x="%.1f" y="%d" font-size="9.5" fill="rgba(243,247,238,.45)" text-anchor="middle">w%d</text>'
                  % (PL + (w - 1) / (WMAX - 1) * PW, SH - PB + 14, w) for w in [1, 5, 10, 15, 20, 25, 30])

svg = ('<svg viewBox="0 0 %d %d" style="width:100%%;height:auto">'
       '<text x="%d" y="12" font-size="12" fill="rgba(243,247,238,.7)">无尽难度曲线（w = 波次，1→30）</text>%s%s%s%s%s</svg>'
       % (SW, SH, PL,
          ''.join(grid),
          curve(b_vals, '#e8c463', '刷怪预算 budget', VM),
          curve(h_vals, '#e06666', '生命倍率 hpMul×10', VM),
          curve(d_vals, '#5ab6ff', '伤害倍率 dmgMul×10', VM),
          xlabels))

# ---- 币产出递减表 ----
coin_rows = ''.join('<tr><td>w%d</td><td>%d 币/波</td></tr>' % (w, coins(w)) for w in [1, 5, 10, 15, 20, 25, 30, 40])

# ---- 阶段池 ----
phase_rows = []
for ph in PH:
    chips = ''.join(
        '<span class="pc" style="border-color:%s"><img src="sprites_alpha/%s.png" alt="">%s <small style="color:%s">%s</small></span>'
        % (elem_hex(ENEMIES[k]['element']), k, ENEMIES[k]['cn'],
           elem_hex(ENEMIES[k]['element']), ELEM_CN[ENEMIES[k]['element']])
        for k in ph['pool'])
    rng = 'w%d 起 · 永续' % ph['from'] if ph['to'] is None else 'w%d–%d' % (ph['from'], ph['to'])
    phase_rows.append(
        '<div class="tier" style="border-color:rgba(159,224,180,.4)">'
        '<div class="tier-h">阶段 %d · %s <small>%s</small></div>%s</div>'
        % (ph['id'], ph['name'], rng, chips))
phase_html = ''.join(phase_rows)

# ---- 里程碑 ----
ms_rows = ''.join('<tr><td>%d 分钟</td><td>%s</td><td>%s</td></tr>'
                  % (m['atSec'] // 60, m['cn'], m['reward']) for m in MS)

html = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>森灵萌兽 · 无尽模式</title>
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
  .card h2{ font-size:18px; margin-bottom:14px; display:flex; align-items:center; gap:8px }
  .card h2 small{ opacity:.6; font-weight:400; font-size:13px }
  table.tbl{ border-collapse:collapse; width:auto; min-width:46%%; font-size:13px; margin-top:6px }
  table.tbl th,table.tbl td{ border:1px solid rgba(159,224,180,.25); padding:6px 12px; text-align:center }
  table.tbl th{ background:rgba(232,196,99,.12); font-weight:700 }
  .cols2{ display:grid; grid-template-columns:1fr 1fr; gap:20px }
  @media(max-width:760px){ .cols2{ grid-template-columns:1fr } }
  .tier{ border:1px solid; border-radius:12px; padding:12px 14px; margin:10px 0; background:rgba(255,255,255,.03) }
  .tier-h{ font-size:15px; font-weight:700; margin-bottom:8px }
  .tier-h small{ opacity:.7; font-weight:400; font-size:12px; margin-left:6px }
  .pc{ display:inline-flex; align-items:center; gap:5px; border:1px solid; border-radius:8px; padding:3px 9px 3px 4px; margin:3px; font-size:12.5px }
  .pc img{ width:26px; height:26px; border-radius:5px }
  .note{ font-size:12.5px; opacity:.78; line-height:1.7 }
  .note b{ color:var(--gold) }
  footer{ margin-top:26px; font-size:12px; opacity:.5; text-align:center; line-height:1.7; max-width:820px }
</style>
</head>
<body>
  <h1>♾️ 无尽模式</h1>
  <div class="sub">《萌兽消消岛》通关战役 10 关后的长线挑战（纯设计数据，非游戏代码）：波次无限推进，<b>刷怪预算 / 生命 / 伤害</b>按二次曲线缩放，敌种池四阶段轮换，精英每 __ELITE__ 波、Boss 每 __BOSS__ 波周期登场。复用 wave_design 全部敌种与 pickups 掉落（零新资产）；<b>币产出递减</b>防刷取、里程碑只发非货币荣誉——不突破 economy.json 四 faucet 总口径。数据来自 <code>data/endless.json</code>，本页由 <code>tools/build_endless_chart.py</code> 生成。</div>
  <div class="wrap">
    <div class="card">
      <h2>📈 难度曲线 <small>每波 __INTERVAL__ 秒</small></h2>
      __CURVE_SVG__
      <div class="note" style="margin-top:10px">__BUDGET_FORMULA__<br>__HP_FORMULA__<br>__DMG_FORMULA__</div>
    </div>
    <div class="card">
      <div class="cols2">
        <div>
          <h2>💰 币产出递减 <small>防刷取边界</small></h2>
          <table class="tbl"><tr><th>波次</th><th>产出</th></tr>__COIN_ROWS__</table>
          <div class="note" style="margin-top:8px">__ECONOMY_NOTE__</div>
        </div>
        <div>
          <h2>🏅 存活里程碑 <small>非货币荣誉（与成就同口径）</small></h2>
          <table class="tbl"><tr><th>存活</th><th>里程碑</th><th>奖励</th></tr>__MS_ROWS__</table>
          <h2 style="margin-top:16px">🔁 精英 / Boss 周期</h2>
          <div class="note">每 <b>__ELITE__</b> 波精英（HP×__ELITEHP__，必掉宝箱）<br>每 <b>__BOSS__</b> 波 Boss（森林古木强化版，掉双宝箱）</div>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>🌊 敌种池四阶段轮换 <small>教学 → 全混编</small></h2>
      __PHASE_HTML__
    </div>
  </div>
  <footer>萌兽消消岛 · 森灵内容包 · 独立命名空间（_content_pack/）<br>设计数值规格（非游戏代码），敌种/元素/掉落全部复用既有规格（wave_design · element_matrix · pickups），零新资产；经济递减边界与 §2.11 联动，为 §4 接入主游戏时的无尽模式提供端到端验证样本（可玩实验室 endless_lab.html）。</footer>
</body>
</html>'''

html = (html.replace('__CURVE_SVG__', svg)
            .replace('__COIN_ROWS__', coin_rows)
            .replace('__MS_ROWS__', ms_rows)
            .replace('__PHASE_HTML__', phase_html)
            .replace('__BUDGET_FORMULA__', RU['budgetFormula'])
            .replace('__HP_FORMULA__', RU['hpScaleFormula'])
            .replace('__DMG_FORMULA__', RU['dmgScaleFormula'])
            .replace('__ECONOMY_NOTE__', E['economyNote'])
            .replace('__INTERVAL__', str(RU['waveIntervalSec']))
            .replace('__ELITE__', str(CY['eliteEveryWaves']))
            .replace('__ELITEHP__', str(CY['eliteHpMul']))
            .replace('__BOSS__', str(CY['bossEveryWaves'])))

out = os.path.join(ROOT, 'endless_chart.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('endless_chart.html written:', os.path.getsize(out), 'bytes;',
      len(PH), 'phases /', len(MS), 'milestones')
