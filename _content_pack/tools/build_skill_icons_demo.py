# -*- coding: utf-8 -*-
"""build_skill_icons_demo.py — 生成自包含「技能 / 元素图标」试看页（PNG base64 内联）"""
import base64, os

ROOT = 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou/_content_pack'
SKILL = os.path.join(ROOT, 'skill_icons')

# (key, 中文名, 分组, 用途说明)；顺序即展示顺序
meta = [
    ('el_fire',     '火',     '元素徽章', '火元素身份 · 灼烧系 · 克制木'),
    ('el_water',    '水',     '元素徽章', '水元素身份 · 水弹系 · 克制火'),
    ('el_earth',    '土',     '元素徽章', '土元素身份 · 岩甲系 · 克制雷'),
    ('el_light',    '光',     '元素徽章', '光元素身份 · 圣辉系 · 克制暗'),
    ('el_wood',     '木',     '元素徽章', '木元素身份 · 藤蔓系 · 克制水'),
    ('ab_fireball', '火球术', '技能图标', '英雄主动技 · 火球弹道伤害'),
    ('ab_heal',     '治疗',   '技能图标', '英雄主动技 · 单体/群体回血'),
    ('ab_frost',    '霜冻',   '技能图标', '英雄主动技 · 冰冻减速控场'),
    ('ab_chain',    '链雷',   '技能图标', '英雄主动技 · 链式跳跃雷击'),
    ('ab_vine',     '藤缚',   '技能图标', '英雄主动技 · 藤蔓缠绕定身'),
    ('ab_quake',    '地震',   '技能图标', '英雄主动技 · 范围震荡击退'),
    ('ab_dash',     '瞬步',   '技能图标', '英雄位移技 · 短距冲刺闪避'),
    ('ab_summon',   '召唤',   '技能图标', '英雄召唤技 · 召唤萌兽协战'),
]

GROUPS = [
    ('元素徽章', '五元素系统的统一视觉身份（六边符印）—— 与元素命中 VFX / 音效配对，用于元素指示、选择 UI 与克制图例', '#ff9d4d'),
    ('技能图标', '英雄技能栏按钮（圆角方面板）—— 与状态图标（圆牌）底盘区分，用于战斗 HUD 技能位', '#4dc3ff'),
]

def b64(name):
    with open(os.path.join(SKILL, name + '.png'), 'rb') as f:
        return base64.b64encode(f.read()).decode()

def card(fn, zh, use):
    return f'''
    <div class="card">
      <div class="stage"><img src="data:image/png;base64,{b64(fn)}" alt="{zh}"></div>
      <div class="t">{zh}</div>
      <div class="d">{use}</div>
      <div class="fname">{fn}.png</div>
    </div>'''

sections = []
for gname, gdesc, gcolor in GROUPS:
    items = [m for m in meta if m[2] == gname]
    cards = ''.join(card(m[0], m[1], m[3]) for m in items)
    sections.append(f'''
  <div class="sec">
    <h2><span class="tag" style="background:{gcolor}">{gname}</span>
        <small>{len(items)} 个 · {gdesc}</small></h2>
    <div class="grid">{cards}</div>
  </div>''')

html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>森灵萌兽 · 技能 / 元素图标试看</title>
<style>
  :root{{ --gold:#e8c463; }}
  *{{ box-sizing:border-box;margin:0;padding:0 }}
  body{{ font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    background:radial-gradient(120% 120% at 50% -10%, #15324a 0%, #0b1c2c 45%, #05090f 100%);
    color:#eaf2ff; min-height:100vh; padding:48px 20px;
    display:flex; flex-direction:column; align-items:center; }}
  h1{{ font-size:30px; letter-spacing:2px; margin-bottom:6px; text-shadow:0 2px 8px rgba(0,0,0,.5) }}
  .sub{{ opacity:.75; margin-bottom:34px; font-size:14px; text-align:center; max-width:720px; line-height:1.6 }}
  .sec{{ width:100%; max-width:980px; margin-bottom:30px }}
  .sec h2{{ display:flex; align-items:center; gap:10px; margin-bottom:6px; font-size:18px; flex-wrap:wrap }}
  .sec h2 small{{ font-size:12px; opacity:.6; font-weight:400 }}
  .tag{{ display:inline-block; padding:3px 12px; border-radius:999px; color:#06121f;
    font-size:13px; font-weight:700 }}
  .grid{{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:18px }}
  .card{{ background:linear-gradient(160deg,#13283c,#0a1722);
    border:1px solid rgba(120,180,255,.25); border-radius:16px; padding:18px;
    display:flex; flex-direction:column; align-items:center; gap:10px;
    box-shadow:0 10px 26px rgba(0,0,0,.4); }}
  .stage{{ width:96px; height:96px; display:flex; align-items:center; justify-content:center;
    background:radial-gradient(circle at 50% 50%, #0c1a28 0%, #060c14 70%); border-radius:12px; }}
  .stage img{{ width:78px; height:78px; object-fit:contain; filter:drop-shadow(0 0 6px rgba(120,200,255,.3)); }}
  .t{{ font-size:16px; font-weight:700 }}
  .d{{ font-size:12px; opacity:.7; text-align:center; min-height:32px }}
  .fname{{ font-size:11px; opacity:.45; font-family:monospace }}
  footer{{ margin-top:30px; font-size:12px; opacity:.45; text-align:center }}
</style>
</head>
<body>
  <h1>⚡ 森灵萌兽 · 技能 / 元素图标试看</h1>
  <div class="sub">独立内容包「英雄技能 + 元素身份」UI 层 —— 元素徽章（六边符印）+ 技能图标（圆角方面板），程序化生成 · 真透底 RGBA。共 {len(meta)} 个，与状态图标（圆牌）、VFX、音效构成四层视觉语言。</div>
  {''.join(sections)}
  <footer>萌兽消消岛 · 森灵内容包 · 技能 / 元素图标（独立命名空间，不改动主游戏文件）</footer>
</body>
</html>'''

out = os.path.join(ROOT, 'skill_icons_demo.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('skill_icons_demo.html written:', os.path.getsize(out), 'bytes,', len(meta), 'icons')
