# -*- coding: utf-8 -*-
"""build_icons_demo.py — 生成自包含「状态图标」试看页（PNG base64 内联）"""
import base64, os

ROOT = 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou/_content_pack'
ICONS = os.path.join(ROOT, 'icons')

# 顺序即展示顺序；category 用于分组（控制 / 持续伤害 / 负面 / 增益）
meta = [
    ('st_freeze',  '冰冻',     '控制',     '冻结 / 定身，限制移动与攻击'),
    ('st_stun',    '眩晕',     '控制',     '短时无法行动'),
    ('st_burn',    '灼烧',     '持续伤害', '每秒扣血（火）'),
    ('st_poison',  '中毒',     '持续伤害', '每秒扣血（毒）'),
    ('st_bleed',   '流血',     '持续伤害', '叠加层数持续掉血'),
    ('st_slow',    '减速',     '负面',     '移动 / 攻速下降'),
    ('st_mark',    '标记',     '负面',     '受击增伤 / 易伤'),
    ('st_atk_up',  '攻击强化', '增益',     '伤害提升'),
    ('st_def_up',  '防御强化', '增益',     '减伤提升'),
    ('st_haste',   '急速',     '增益',     '攻速 / 移速提升'),
    ('st_heal',    '持续治疗', '增益',     '每秒回血'),
    ('st_shield',  '护盾',     '增益',     '吸收伤害的护盾'),
]

CATEGORY_ORDER = ['控制', '持续伤害', '负面', '增益']
CAT_COLOR = {
    '控制':     '#7d6bff',
    '持续伤害': '#ff7a3c',
    '负面':     '#ff5a8a',
    '增益':     '#3fd98a',
}

def b64(name):
    with open(os.path.join(ICONS, name + '.png'), 'rb') as f:
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
for cat in CATEGORY_ORDER:
    items = [m for m in meta if m[2] == cat]
    cards = ''.join(card(m[0], m[1], m[3]) for m in items)
    sections.append(f'''
  <div class="sec">
    <h2><span class="tag" style="background:{CAT_COLOR[cat]}">{cat}</span></h2>
    <div class="grid">{cards}</div>
  </div>''')

html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>森灵萌兽 · 状态图标试看</title>
<style>
  :root{{ --gold:#e8c463; }}
  *{{ box-sizing:border-box;margin:0;padding:0 }}
  body{{ font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    background:radial-gradient(120% 120% at 50% -10%, #15324a 0%, #0b1c2c 45%, #05090f 100%);
    color:#eaf2ff; min-height:100vh; padding:48px 20px;
    display:flex; flex-direction:column; align-items:center; }}
  h1{{ font-size:30px; letter-spacing:2px; margin-bottom:6px; text-shadow:0 2px 8px rgba(0,0,0,.5) }}
  .sub{{ opacity:.75; margin-bottom:34px; font-size:14px; text-align:center; max-width:680px; line-height:1.6 }}
  .sec{{ width:100%; max-width:980px; margin-bottom:30px }}
  .sec h2{{ display:flex; align-items:center; gap:10px; margin-bottom:16px; font-size:18px }}
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
  footer{{ margin-top:30px; font-size:12px; opacity:.45 }}
</style>
</head>
<body>
  <h1>🛡️ 森灵萌兽 · 状态图标试看</h1>
  <div class="sub">独立内容包「状态机制」UI 层 —— 常驻 HUD 指示图标（程序化生成 · 真透底 RGBA · 与 VFX 爆发特效互补）。{len(meta)} 个：控制 / 持续伤害 / 负面 / 增益 四组。</div>
  {''.join(sections)}
  <footer>萌兽消消岛 · 森灵内容包 · 状态图标（独立命名空间，不改动主游戏文件）</footer>
</body>
</html>'''

out = os.path.join(ROOT, 'icons_demo.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('icons_demo.html written:', os.path.getsize(out), 'bytes,', len(meta), 'icons')
