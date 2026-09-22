# -*- coding: utf-8 -*-
"""build_music_layers.py — 由 data/music_layers.json 生成分层音乐参考页
纯本地、零依赖、不卡机。
"""
import os
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

M = json.load(open(os.path.join(ROOT, 'data', 'music_layers.json'), encoding='utf-8'))
LAY = M['layers']
BASE = M['base']

ICO = {'L1': '🥁', 'L2': '🎸', 'L3': '🎹'}


def trig_txt(t):
    if t['type'] == 'always':
        return '常开'
    return '%s（淡入 %.1fs）' % (t['note'].split('，')[0], t['fadeSec'])


layer_cards = []
for l in LAY:
    layer_cards.append(
        '<div class="tier" style="border-color:#5ab6ff66">'
        '<div class="tier-h" style="color:#5ab6ff">{ico} {id} · {cn} <small><code>{f}</code></small></div>'
        '<div class="uc-e"><span class="eff">增益 {g}</span><span class="eff">{trig}</span><span class="eff">33.10s 循环</span></div>'
        '<div class="uc-d"><b>乐器：</b>{inst}</div>'
        '</div>'.format(ico=ICO[l['id']], id=l['id'], cn=l['cn'], f=l['file'],
                        g=l['gain'], trig=trig_txt(l['trigger']), inst=l['instruments']))
layer_html = ''.join(layer_cards)

BOSS = M.get('bossGroup')
boss_html = ''
if BOSS:
    MIX = BOSS['mixByPhase']
    mix_rows = ''.join('<tr><th>阶段 %d</th><td>L1 %s · L2 %s · L3 %s</td></tr>' % (
        pid, ph['L1'], ph['L2'], ph['L3']) for pid, ph in enumerate([MIX['phase1'], MIX['phase2'], MIX['phase3']], 1))
    bcards = ''.join(
        '<div class="tier" style="border-color:#e0666666">'
        '<div class="tier-h" style="color:#e06666">{ico} {id} · {cn} <small><code>{f}</code></small></div>'
        '<div class="uc-e"><span class="eff">增益 {g}</span><span class="eff">31.30s 循环</span></div>'
        '<div class="uc-d"><b>乐器：</b>{inst}</div>'
        '</div>'.format(ico=ICO.get(l['id'], '🎺'), id=l['id'], cn=l['cn'], f=l['file'],
                        g=l['gain'], inst=l['instruments']) for l in BOSS['layers'])
    boss_html = ('<div class="card"><h2>👹 Boss 分层组 <small>92 BPM · 31.30s · 按 Boss 阶段混音（boss_arena 消费点）</small></h2>'
                 '<table class="tbl">' + mix_rows + '</table>' + bcards +
                 '<div class="note" style="margin-top:8px">' + BOSS['note'] + '</div></div>')

html = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>森灵萌兽 · 战斗分层自适应音乐</title>
<style>
  :root{ --leaf:#3fa66a; --gold:#e8c463; --cream:#f3f7ee; }
  *{ box-sizing:border-box;margin:0;padding:0 }
  body{ font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    background:radial-gradient(130% 120% at 50% -10%, #2f6b45 0%, #1c4a30 45%, #0f2f1f 100%);
    color:var(--cream); min-height:100vh; padding:40px 18px; display:flex; flex-direction:column; align-items:center; }
  h1{ font-size:30px; letter-spacing:2px; margin-bottom:6px }
  .sub{ opacity:.8; margin-bottom:26px; font-size:14px; text-align:center; max-width:840px; line-height:1.6 }
  .wrap{ width:100%; max-width:880px; display:flex; flex-direction:column; gap:22px }
  .card{ background:rgba(15,47,31,.55); border:1px solid rgba(159,224,180,.25); border-radius:16px; padding:22px 24px }
  .card h2{ font-size:18px; margin-bottom:14px }
  .card h2 small{ opacity:.6; font-weight:400; font-size:13px }
  table.tbl{ border-collapse:collapse; width:100%; font-size:13px; margin-top:6px }
  table.tbl th,table.tbl td{ border:1px solid rgba(159,224,180,.25); padding:7px 10px; text-align:left }
  table.tbl th{ background:rgba(232,196,99,.12); font-weight:700; text-align:center }
  table.tbl td:first-child{ text-align:center; font-weight:700; color:var(--gold) }
  .tier{ border:1px solid; border-radius:12px; padding:12px 14px; margin:10px 0; background:rgba(255,255,255,.03) }
  .tier-h{ font-size:15px; font-weight:700; margin-bottom:8px }
  .tier-h small{ opacity:.6; font-weight:400; font-size:11px }
  .uc-e{ margin:6px 0; display:flex; flex-wrap:wrap; gap:5px }
  .eff{ font-size:11.5px; background:rgba(255,255,255,.06); border:1px solid rgba(159,224,180,.3); border-radius:6px; padding:1px 7px }
  .uc-d{ font-size:12.5px; opacity:.8; line-height:1.55 }
  .note{ font-size:12.5px; opacity:.82; line-height:1.7 }
  .note b{ color:var(--gold) }
  code{ font-size:11px; opacity:.7 }
  footer{ margin-top:26px; font-size:12px; opacity:.5; text-align:center; line-height:1.7; max-width:820px }
</style>
</head>
<body>
  <h1>🎚️ 战斗分层自适应音乐</h1>
  <div class="sub">《萌兽消消岛》Adaptive Music 分层规格（纯设计数据，非游戏代码）：3 条**同和声（C-Am-F-G）同 BPM（__BPM__）同长度（__DUR__s）**的三层轨，叠播即完整曲；按<b>场上敌数</b>实时调层（L1 常开 / L2 敌≥8 / L3 敌≥15 或 Boss）——压力越大音乐越满，<b>编曲变满而非换曲</b>。属于 §2.15 Music 通道内部的自适应子层。数据来自 <code>data/music_layers.json</code>，本页由 <code>tools/build_music_layers.py</code> 生成。</div>
  <div class="wrap">
    __BOSS_HTML__
    <div class="card">
      <h2>🎼 基础参数 <small>三轨对齐的充要条件</small></h2>
      <table class="tbl">
        <tr><th>BPM</th><th>小节</th><th>时长</th><th>调性/和声</th><th>循环</th></tr>
        <tr><td>__BPM__</td><td>__BARS__</td><td>33.10s</td><td>__KEY__</td><td>无缝（实测三轨时长差 &lt;0.001s）</td></tr>
      </table>
      <div class="note" style="margin-top:8px">__MIX__</div>
    </div>
    <div class="card">
      <h2>🎹 三层清单</h2>
      __LAYERS__
    </div>
    <div class="card">
      <h2>🔗 体系位置与消费点</h2>
      <div class="note">__RELATION__</div>
      <div class="note" style="margin-top:8px">__CONSUMER__</div>
    </div>
  </div>
  <footer>萌兽消消岛 · 森灵内容包 · 独立命名空间（_content_pack/）<br>设计数值规格（非游戏代码），三层轨由 synth_audio.py 共享时间网格纯标准库合成（零外部素材）；试听见 audio_demo.html（分层·L1/L2/L3），真机混音演示见 endless_lab.html「🎵 自适应分层」开关。</footer>
</body>
</html>'''

html = (html.replace('__BOSS_HTML__', boss_html)
            .replace('__BPM__', str(BASE['bpm']))
            .replace('__BARS__', str(BASE['bars']))
            .replace('__DUR__', str(BASE['durationSec']))
            .replace('__KEY__', BASE['key'])
            .replace('__MIX__', M['mixRule'])
            .replace('__RELATION__', M['relation'])
            .replace('__CONSUMER__', M['consumerNote'])
            .replace('__LAYERS__', layer_html))

out = os.path.join(ROOT, 'music_layers.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('music_layers.html written:', os.path.getsize(out), 'bytes;', len(LAY), 'layers')
