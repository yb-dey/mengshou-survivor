# -*- coding: utf-8 -*-
"""build_ambience_chart.py — 由 data/ambience.json 生成可视化参考页（轻量）
纯本地、零依赖、不卡机；输出 ambience_chart.html（双通道分层说明 + 环境音卡 + 场景映射表）。
"""
import os, json

ROOT = 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou/_content_pack'

A = json.load(open(os.path.join(ROOT, 'data', 'ambience.json'), encoding='utf-8'))
EM = json.load(open(os.path.join(ROOT, 'data', 'element_matrix.json'), encoding='utf-8'))
TR = A['tracks']
LAY = A['layers']
SM = A['sceneMapping']
ELEM_CN = EM['cn']
ELEM_COLOR = EM['colors']


def elem_hex(e):
    c = ELEM_COLOR[e]
    return '#%02x%02x%02x' % (int(c[0] * 255), int(c[1] * 255), int(c[2] * 255))


ICO = {'cp_amb_forest': '🌲', 'cp_amb_night': '🌙', 'cp_amb_river': '🏞️', 'cp_amb_cave': '🕯️'}

track_cards = []
for k, v in TR.items():
    elems = ''.join('<span class="eff el" style="border-color:%s;color:%s">%s</span>'
                    % (elem_hex(e), elem_hex(e), ELEM_CN[e]) for e in v['elements'])
    track_cards.append(
        '<div class="uc" style="border-left-color:#5ab6ff">'
        '<div class="ico-big">%s</div>'
        '<div class="uc-b">'
        '<div class="uc-h"><b style="color:#5ab6ff">%s</b><code>%s</code></div>'
        '<div class="uc-e"><span class="eff">%s</span>%s<span class="eff">24s 无缝循环</span></div>'
        '<div class="uc-d">%s</div>'
        '</div></div>'
        % (ICO[k], v['cn'], k, v['mood'], elems, v['sound']))
track_html = ''.join(track_cards)

map_rows = ''.join(
    '<tr><td>P%d</td><td>%s</td><td><code>%s</code></td></tr>'
    % (m['priority'], m['when'], m['amb']) for m in SM)

html = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>森灵萌兽 · 环境氛围音层</title>
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
  .card h2{ font-size:18px; margin-bottom:14px; display:flex; align-items:center; gap:8px }
  .card h2 small{ opacity:.6; font-weight:400; font-size:13px }
  table.tbl{ border-collapse:collapse; width:100%; font-size:13px; margin-top:6px }
  table.tbl th,table.tbl td{ border:1px solid rgba(159,224,180,.25); padding:7px 10px; text-align:left }
  table.tbl th{ background:rgba(232,196,99,.12); font-weight:700; text-align:center }
  table.tbl td:first-child{ text-align:center; font-weight:700; color:var(--gold) }
  .uc{ display:flex; gap:12px; background:rgba(255,255,255,.04); border-left:4px solid #5ab6ff;
    border-radius:10px; padding:10px 14px; margin:8px 0; align-items:flex-start }
  .ico-big{ font-size:30px; flex:none; width:48px; text-align:center }
  .uc-b{ flex:1; min-width:0 }
  .uc-h{ font-size:15px; display:flex; align-items:center; gap:8px; flex-wrap:wrap }
  .uc-h code{ font-size:11px; opacity:.5 }
  .uc-e{ margin:6px 0 4px; display:flex; flex-wrap:wrap; gap:5px }
  .eff{ font-size:11.5px; background:rgba(255,255,255,.06); border:1px solid rgba(159,224,180,.3);
    border-radius:6px; padding:1px 7px }
  .eff.el{ background:transparent; border:1px solid }
  .uc-d{ font-size:12.5px; opacity:.78; line-height:1.5 }
  .note{ font-size:12.5px; opacity:.82; line-height:1.7 }
  .note b{ color:var(--gold) }
  footer{ margin-top:26px; font-size:12px; opacity:.5; text-align:center; line-height:1.7; max-width:820px }
</style>
</head>
<body>
  <h1>🎧 环境氛围音层</h1>
  <div class="sub">《萌兽消消岛》Ambience 分层音频规格（纯设计数据，非游戏代码）：与 BGM 构成<b>双通道</b>——BGM 负责旋律情绪（战斗强度），Ambience 负责空间沉浸（场景/昼夜），两通道独立增益叠加、互不抢戏。4 条环境音均为 24s 纯标准库合成无缝循环（风底 + 随机 chirp / 调幅脉冲 / 水滴回响），零外部素材。数据来自 <code>data/ambience.json</code>，本页由 <code>tools/build_ambience_chart.py</code> 生成。</div>
  <div class="wrap">
    <div class="card">
      <h2>🎚️ 双通道分层 <small>旋律层 × 氛围层</small></h2>
      <div class="note">Music 通道（BGM × __BGMGAIN__）：探索 → 交战 → 精英 → Boss 的情绪曲线，随<b>战斗强度</b>切换；<br>Ambience 通道（× __AMBGAIN__）：本页 4 条环境音，随<b>场景与昼夜</b>切换——战斗再激烈，森林的鸟鸣也一直在，这就是「世界活着」的感觉。</div>
    </div>
    <div class="card">
      <h2>🌲 环境音清单 <small>共 4 条 · 24s 无缝循环</small></h2>
      __TRACK_HTML__
    </div>
    <div class="card">
      <h2>🗺️ 场景映射 <small>按优先级取第一条命中 · 同一时刻仅一条激活（切换 1s 交叉淡化）</small></h2>
      <table class="tbl"><tr><th>优先级</th><th>命中条件</th><th>环境音</th></tr>__MAP_ROWS__</table>
      <div class="note" style="margin-top:10px">__DAYNIGHT__</div>
    </div>
  </div>
  <footer>萌兽消消岛 · 森灵内容包 · 独立命名空间（_content_pack/）<br>设计数值规格（非游戏代码），音频原型由 synth_audio.py 纯标准库合成（cp_amb_* 独立前缀），试听见 audio_demo.html；meta_lab.html 大厅开关已同时驱动 BGM + Ambience 双通道，为 §4 接入主游戏时的分层音频提供规格底座。</footer>
</body>
</html>'''

html = (html.replace('__TRACK_HTML__', track_html)
            .replace('__MAP_ROWS__', map_rows)
            .replace('__DAYNIGHT__', A['dayNightRule'])
            .replace('__BGMGAIN__', str(LAY['bgmGain']))
            .replace('__AMBGAIN__', str(LAY['ambGain'])))

out = os.path.join(ROOT, 'ambience_chart.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('ambience_chart.html written:', os.path.getsize(out), 'bytes;', len(TR), 'tracks')
