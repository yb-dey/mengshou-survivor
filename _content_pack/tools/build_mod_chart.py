# -*- coding: utf-8 -*-
"""build_mod_chart.py — 由 data/challenge_mods.json 生成挑战修饰符规格页（轻量）"""
import os, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
C = json.load(open(os.path.join(ROOT, 'data', 'challenge_mods.json'), encoding='utf-8'))
MODS = C['mods']

SIDE_CN = {'player': '🟢 玩家侧', 'enemy': '🔴 敌人侧'}

cards = []
for side in ['player', 'enemy']:
    items = [(k, v) for k, v in MODS.items() if v['side'] == side]
    col = '#3fa66a' if side == 'player' else '#e06666'
    for k, v in items:
        eff = ' · '.join('%s %+g%%' % (kk, vv) for kk, vv in v['effects'].items())
        cards.append(
            '<div class="mini" style="border-left-color:{c}"><img src="{ic}" alt="">'
            '<div><div class="nm">{cn}<span class="tagx">{tag}</span></div>'
            '<div class="ds">{eff}</div><div class="ds">{ds}</div></div></div>'.format(
                c=col, ic=v['icon'], cn=v['cn'], tag=v['tag'], eff=eff, ds=v['desc']))
side_html = ''
for side in ['player', 'enemy']:
    items = [c for k, c in enumerate(cards)]
side_html = cards[0] + cards[1] + cards[2] + cards[3] + cards[4] + cards[5] + cards[6] + cards[7]

html = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>森灵萌兽 · 挑战修饰符</title>
<style>
  body{ font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    background:radial-gradient(130% 120% at 50%% -10%%, #2f6b45 0%%, #1c4a30 45%%, #0f2f1f 100%%);
    color:#f3f7ee; min-height:100vh; padding:40px 18px; display:flex; flex-direction:column; align-items:center; }
  h1{ font-size:30px; letter-spacing:2px; margin-bottom:6px }
  .sub{ opacity:.8; margin-bottom:24px; font-size:14px; text-align:center; max-width:840px; line-height:1.6 }
  .wrap{ width:100%%; max-width:880px; display:flex; flex-direction:column; gap:20px }
  .card{ background:rgba(15,47,31,.55); border:1px solid rgba(159,224,180,.25); border-radius:16px; padding:20px 24px }
  .card h2{ font-size:17px; margin-bottom:10px }
  .mini{ display:flex; gap:10px; background:rgba(255,255,255,.05); border:1px solid rgba(159,224,180,.2);
    border-left-width:4px; border-radius:10px; padding:9px 12px; margin:6px 0; align-items:center }
  .mini img{ width:42px; height:42px; border-radius:8px; flex:none }
  .mini .nm{ font-size:14px; font-weight:700 }
  .mini .ds{ font-size:11.5px; opacity:.75; margin-top:2px }
  .tagx{ font-size:10.5px; border:1px solid rgba(232,196,99,.45); color:#e8c463; border-radius:6px; padding:1px 6px; margin-left:6px }
  .note{ font-size:12.5px; opacity:.82; line-height:1.7 }
  .note b{ color:#e8c463 }
  footer{ margin-top:24px; font-size:12px; opacity:.5; text-align:center; line-height:1.7; max-width:820px }
</style>
</head>
<body>
  <h1>🎲 挑战修饰符</h1>
  <div class="sub">《萌兽消消岛》全局挑战修饰符规格（纯设计数据，非游戏代码）：8 个修饰符按「玩家增益 × 敌人增强」成对设计，<b>每周按 ISO 周数种子自动选中 1+1</b>（同周一致、跨周轮换）——为无尽模式提供「本周玩点」。消费点：endless_lab.html 本周挑战选择器（真实生效于敌伤/敌HP/生成速率/币产出）。数据来自 <code>data/challenge_mods.json</code>，本页由 <code>tools/build_mod_chart.py</code> 生成。</div>
  <div class="wrap">
    <div class="card"><h2>🎲 轮换规则</h2><div class="note">__ROT__</div></div>
    <div class="card"><h2>⚖️ 平衡口径</h2><div class="note">__BAL__</div></div>
    <div class="card"><h2>修饰符清单 <small>共 8 个（玩家 4 / 敌人 4）</small></h2>__CARDS__</div>
  </div>
  <footer>萌兽消消岛 · 森灵内容包 · 独立命名空间（_content_pack/）<br>修饰符改变的是变量起点、不改变难度曲线本身（与 R37 校准兼容）；icon/sfx 全部复用既有资产（零新素材）；真机消费点见 endless_lab.html 本周挑战选择器。</footer>
</body>
</html>'''

html = (html.replace('__ROT__', C['rotation']['rule'] + '（' + C['rotation']['note'] + '）')
            .replace('__BAL__', C['balanceNote'])
            .replace('__CARDS__', side_html))

out = os.path.join(ROOT, 'mod_chart.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('mod_chart.html written:', os.path.getsize(out), 'bytes;', len(MODS), 'mods')
