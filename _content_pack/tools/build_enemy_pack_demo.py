# -*- coding: utf-8 -*-
"""build_enemy_pack_demo.py — 由 data/enemy_candidates.json 生成候选敌种展示页
纯本地、零依赖、不卡机。展示 6 个候选敌种的精灵/数值/定位/机制与建议接入阶段。
"""
import os
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

C = json.load(open(os.path.join(ROOT, 'data', 'enemy_candidates.json'), encoding='utf-8'))
W = json.load(open(os.path.join(ROOT, 'data', 'wave_design.json'), encoding='utf-8'))
E = json.load(open(os.path.join(ROOT, 'data', 'element_matrix.json'), encoding='utf-8'))

CANDS = C['candidates']
ELEM_CN = E['cn']
ELEM_COLOR = E['colors']

PHASE_CN = {1: '阶段 1（w1–4 单元素巡林）', 2: '阶段 2（w5–9 双元素混编）', 3: '阶段 3（w10–14 三元素+精英）', 4: '阶段 4（w15+ 五元素狂潮）'}


def elem_hex(e):
    c = ELEM_COLOR[e]
    return '#%02x%02x%02x' % (int(c[0] * 255), int(c[1] * 255), int(c[2] * 255))


cards = []
for k, v in CANDS.items():
    col = elem_hex(v['element'])
    hp_w = int(v['hp'] / 90 * 100)
    sp_w = int((v['speed'] - 0.6) / 0.8 * 100)
    phases = ' · '.join('w%d+' % {2: 5, 3: 10, 4: 15}.get(p, p) for p in v['suggestedPhases'])
    cards.append(
        '<div class="tier" style="border-color:{c}66">'
        '<div class="tier-h" style="color:{c}"><img src="{sp}" class="eimg" alt="">{cn} '
        '<small>{el} · {role}</small></div>'
        '<div class="mrow"><span class="lb">HP</span><span class="bar"><i style="width:{hp}%;background:{c}"></i></span><span class="vv">{hpv}</span></div>'
        '<div class="mrow"><span class="lb">移速</span><span class="bar"><i style="width:{spbw}%;background:#5ab6ff"></i></span><span class="vv">×{spv}</span></div>'
        '<div class="uc-e"><span class="eff">{ph}</span></div>'
        '<div class="uc-d"><b>机制：</b>{mech}</div>'
        '<div class="uc-d" style="margin-top:4px"><b>设计意图：</b>{ds}</div>'
        '<div class="uc-k" style="margin-top:5px"><code>{k}</code></div>'
        '</div>'.format(c=col, sp=v['sprite'], cn=v['cn'], el=ELEM_CN[v['element']], role=v['role'],
                        hp=hp_w, hpv=v['hp'], spbw=sp_w, spv=v['speed'],
                        ph='建议接入：' + phases, mech=v['mechanism'], ds=v['desc'], k=k))
cards_html = ''.join(cards)

exist_rows = ''.join(
    '<tr><td>%s</td><td>%s</td><td>%d</td><td>%s</td></tr>'
    % (v['cn'], ELEM_CN[v['element']], v['hp'], v['role']) for k, v in W['enemies'].items())

html = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>森灵萌兽 · 候选敌种包</title>
<style>
  :root{ --leaf:#3fa66a; --gold:#e8c463; --cream:#f3f7ee; }
  *{ box-sizing:border-box;margin:0;padding:0 }
  body{ font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    background:radial-gradient(130% 120% at 50% -10%, #2f6b45 0%, #1c4a30 45%, #0f2f1f 100%);
    color:var(--cream); min-height:100vh; padding:40px 18px; display:flex; flex-direction:column; align-items:center; }
  h1{ font-size:30px; letter-spacing:2px; margin-bottom:6px }
  .sub{ opacity:.8; margin-bottom:26px; font-size:14px; text-align:center; max-width:860px; line-height:1.6 }
  .wrap{ width:100%; max-width:920px; display:flex; flex-direction:column; gap:22px }
  .card{ background:rgba(15,47,31,.55); border:1px solid rgba(159,224,180,.25); border-radius:16px; padding:22px 24px }
  .card h2{ font-size:18px; margin-bottom:12px }
  .card h2 small{ opacity:.6; font-weight:400; font-size:13px }
  table.tbl{ border-collapse:collapse; width:100%; font-size:12.5px; margin-top:6px }
  table.tbl th,table.tbl td{ border:1px solid rgba(159,224,180,.25); padding:6px 10px; text-align:center }
  table.tbl th{ background:rgba(232,196,99,.12); font-weight:700 }
  .tier{ border:1px solid; border-radius:12px; padding:12px 14px; margin:10px 0; background:rgba(255,255,255,.03) }
  .tier-h{ font-size:16px; font-weight:700; display:flex; align-items:center; gap:10px; margin-bottom:8px }
  .tier-h small{ opacity:.7; font-weight:400; font-size:12px }
  .eimg{ width:52px; height:52px; border-radius:9px; background:rgba(0,0,0,.25) }
  .mrow{ display:flex; align-items:center; gap:8px; margin:4px 0; font-size:12px }
  .mrow .lb{ width:34px; flex:none; opacity:.8 }
  .mrow .bar{ flex:1; height:9px; background:rgba(255,255,255,.08); border-radius:5px; overflow:hidden }
  .mrow .bar i{ display:block; height:100% }
  .mrow .vv{ width:36px; text-align:right; color:var(--gold); font-weight:700 }
  .uc-e{ margin:7px 0 4px }
  .eff{ font-size:11.5px; background:rgba(255,255,255,.06); border:1px solid rgba(159,224,180,.3); border-radius:6px; padding:1px 7px }
  .uc-d{ font-size:12.5px; opacity:.8; line-height:1.55 }
  .uc-k code{ font-size:11px; opacity:.45 }
  .note{ font-size:12.5px; opacity:.82; line-height:1.75 }
  .note b{ color:var(--gold) }
  .warn{ border-left:4px solid var(--gold); background:rgba(232,196,99,.07); border-radius:8px; padding:10px 14px; font-size:12.5px; line-height:1.7 }
  footer{ margin-top:26px; font-size:12px; opacity:.5; text-align:center; line-height:1.7; max-width:840px }
</style>
</head>
<body>
  <h1>🐾 候选敌种包</h1>
  <div class="sub">《萌兽消消岛》候选敌种（纯设计数据，非游戏代码）：6 个候选敌种，每个都有<b>非数值机制</b>（自爆/减速/格挡/治疗/冲锋/后撤）而非纯数值堆叠。__STATUS__。数据来自 <code>data/enemy_candidates.json</code>，本页由 <code>tools/build_enemy_pack_demo.py</code> 生成。</div>
  <div class="wrap">
    <div class="card">
      <h2>⚠️ 接入约束 <small>为什么独立成表</small></h2>
      <div class="warn">__INTEG__</div>
      <div class="note" style="margin-top:8px">__BAL__</div>
    </div>
    <div class="card">
      <h2>🐾 候选清单 <small>6 个 · 五元素全覆盖</small></h2>
      __CARDS__
    </div>
    <div class="card">
      <h2>📚 现有敌种（wave_design.json 6 个） <small>同量纲对照</small></h2>
      <table class="tbl"><tr><th>名称</th><th>元素</th><th>HP</th><th>定位</th></tr>__EXIST__</table>
    </div>
  </div>
  <footer>萌兽消消岛 · 森灵内容包 · 独立命名空间（_content_pack/）<br>候选包精灵由 gen_enemy_candidates.py 纯标准库程序化生成（零外部素材），风格与现有 6 敌种 Q 版一致；本页为评估与展示用，不改变任何既有玩法数据。</footer>
</body>
</html>'''

html = (html.replace('__STATUS__', C['status'])
            .replace('__INTEG__', C['integrationNote'])
            .replace('__BAL__', C['balanceNote'])
            .replace('__CARDS__', cards_html)
            .replace('__EXIST__', exist_rows))

out = os.path.join(ROOT, 'enemy_pack_demo.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('enemy_pack_demo.html written:', os.path.getsize(out), 'bytes;', len(CANDS), 'candidates')
