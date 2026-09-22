# -*- coding: utf-8 -*-
"""build_vfx_demo.py — 生成自包含 VFX 试看页（PNG base64 内联）"""
import base64, os

ROOT = 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou/_content_pack'
VFX = os.path.join(ROOT, 'vfx')

meta = [
    ('fx_hit_spark', '命中火花', '敌人受击 / 暴击反馈', 'pulse'),
    ('fx_fireball',  '火球',     '远程弹道 / 灼烧弹',   'float'),
    ('fx_shield',    '护盾泡',   '召唤 / 护盾增益',     'breathe'),
    ('fx_heal',      '治疗光环', '英雄治疗 / 回血',     'pulse'),
    ('fx_slash',     '斩击弧',   '近战挥砍',           'swing'),
    ('fx_star',      '星爆',     '击杀 / 得分 / 拾取',  'pop'),
    ('fx_frost',     '霜晶',     '冰冻 / 减速',         'spin'),
    ('fx_levelup',   '升级星环', '升级 / 强化',         'pop'),
    ('fx_pickup',    '拾取闪光', '宝石 / 金币拾取',     'pulse'),
    ('fx_poison',    '毒云',     '中毒 / 持续伤害',     'breathe'),
    ('fx_explosion', '大爆裂',   '范围伤害 / 爆炸',     'pop'),
    ('fx_lightning', '雷击',     '雷元素 / 链击',       'pop'),
    ('fx_heal_burst','治疗爆发', '群体治疗 / 回血爆发', 'pulse'),
    ('fx_dash_trail','冲刺残影', '位移 / 闪避',         'swing'),
    ('fx_telegraph', '预警圈',   'Boss AoE / 地面警示', 'breathe'),
]

def b64(name):
    with open(os.path.join(VFX, name + '.png'), 'rb') as f:
        return base64.b64encode(f.read()).decode()

cards = []
for fn, zh, use, anim in meta:
    cards.append(f'''
    <div class="card">
      <div class="stage {anim}"><img src="data:image/png;base64,{b64(fn)}" alt="{zh}"></div>
      <div class="t">{zh}</div>
      <div class="d">{use}</div>
      <div class="fname">{fn}.png</div>
    </div>''')

html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>森灵萌兽 · 特效素材试看</title>
<style>
  :root{{ --gold:#e8c463; }}
  *{{ box-sizing:border-box;margin:0;padding:0 }}
  body{{ font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    background:radial-gradient(120% 120% at 50% -10%, #15324a 0%, #0b1c2c 45%, #05090f 100%);
    color:#eaf2ff; min-height:100vh; padding:48px 20px;
    display:flex; flex-direction:column; align-items:center; }}
  h1{{ font-size:30px; letter-spacing:2px; margin-bottom:6px; text-shadow:0 2px 8px rgba(0,0,0,.5) }}
  .sub{{ opacity:.75; margin-bottom:34px; font-size:14px }}
  .grid{{ display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:20px;
    width:100%; max-width:980px }}
  .card{{ background:linear-gradient(160deg,#13283c,#0a1722);
    border:1px solid rgba(120,180,255,.25); border-radius:16px; padding:18px;
    display:flex; flex-direction:column; align-items:center; gap:10px;
    box-shadow:0 10px 26px rgba(0,0,0,.4); }}
  .stage{{ width:128px; height:128px; display:flex; align-items:center; justify-content:center;
    background:radial-gradient(circle at 50% 50%, #0c1a28 0%, #060c14 70%); border-radius:12px; }}
  .stage img{{ width:112px; height:112px; object-fit:contain; filter:drop-shadow(0 0 6px rgba(120,200,255,.25)); }}
  .t{{ font-size:17px; font-weight:700 }}
  .d{{ font-size:12px; opacity:.7; text-align:center; min-height:32px }}
  .fname{{ font-size:11px; opacity:.45; font-family:monospace }}
  @keyframes pulse{{ 0%,100%{{ transform:scale(1) }} 50%{{ transform:scale(1.18) }} }}
  @keyframes breathe{{ 0%,100%{{ transform:scale(.92); opacity:.8 }} 50%{{ transform:scale(1.08); opacity:1 }} }}
  @keyframes float{{ 0%,100%{{ transform:translateY(0) }} 50%{{ transform:translateY(-8px) }} }}
  @keyframes swing{{ 0%,100%{{ transform:rotate(-18deg) }} 50%{{ transform:rotate(18deg) }} }}
  @keyframes pop{{ 0%,100%{{ transform:scale(1) rotate(0) }} 50%{{ transform:scale(1.25) rotate(20deg) }} }}
  @keyframes spin{{ 0%{{ transform:rotate(0) }} 100%{{ transform:rotate(360deg) }} }}
  .pulse{{ animation:pulse 1.6s ease-in-out infinite }}
  .breathe{{ animation:breathe 2.4s ease-in-out infinite }}
  .float{{ animation:float 2.2s ease-in-out infinite }}
  .swing{{ animation:swing 1.4s ease-in-out infinite }}
  .pop{{ animation:pop 1.8s ease-in-out infinite }}
  .spin{{ animation:spin 9s linear infinite }}
  footer{{ margin-top:36px; font-size:12px; opacity:.45 }}
</style>
</head>
<body>
  <h1>✦ 森灵萌兽 · 特效素材试看</h1>
  <div class="sub">独立内容包 VFX（程序化生成 · 真透底 RGBA · 双击即看）</div>
  <div class="grid">{''.join(cards)}
  </div>
  <footer>萌兽消消岛 · 森灵内容包 · 特效精灵（独立命名空间，不改动主游戏文件）</footer>
</body>
</html>'''

out = os.path.join(ROOT, 'vfx_demo.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('vfx_demo.html written:', os.path.getsize(out), 'bytes,', len(meta), 'effects')
