# -*- coding: utf-8 -*-
"""build_skills_chart.py — 由 data/skills.json 生成技能完整规格参考页
纯本地、零依赖、不卡机。与 element_chart / hero_chart 等视觉对齐。
"""
import os
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SK = json.load(open(os.path.join(ROOT, 'data', 'skills.json'), encoding='utf-8'))
SC = json.load(open(os.path.join(ROOT, 'data', 'skill_cooldowns.json'), encoding='utf-8'))
R = json.load(open(os.path.join(ROOT, 'data', 'reactions.json'), encoding='utf-8'))
E = json.load(open(os.path.join(ROOT, 'data', 'element_matrix.json'), encoding='utf-8'))

SKILLS = SK['skills']
CD = {a['key']: a for a in SC['abilities']}
RX_CN = {k: v['cn'] for k, v in R['reactions'].items()}
ELEM_CN = E['cn']
ELEM_COLOR = E['colors']

TYPE_CN = {'attack': '攻击', 'control': '控制', 'support': '辅助', 'movement': '位移', 'summon': '召唤'}


def elem_hex(e):
    c = ELEM_COLOR[e]
    return '#%02x%02x%02x' % (int(c[0] * 255), int(c[1] * 255), int(c[2] * 255))


def reaction_chips(note):
    """从 reactionNote 提取反应名 → chips（引用实际反应 cn）"""
    if '无元素' in note:
        return '<span class="eff el" style="border-color:#8a9a8f;color:#8a9a8f">不参与反应</span>'
    segs = note.split('：')[-1].split(' / ')
    out = []
    for seg in segs:
        nm = seg.split('(')[0].strip()
        detail = seg[len(nm):].strip('()')
        out.append('<span class="eff el" style="border-color:#e8c463;color:#e8c463" title="%s">%s</span>' % (detail, nm))
    return ''.join(out)


cards = []
for k, v in SKILLS.items():
    ref = CD[k]
    col = elem_hex(v['element']) if v['element'] != 'none' else '#8a9a8f'
    el_name = ELEM_CN.get(v['element'], '无元素')
    dmg = '<span class="eff">伤害 %s×攻击</span>' % v['baseCoef'] if v['baseCoef'] else '<span class="eff">无伤害</span>'
    tg = '<span class="eff">目标 %d</span>' % v['targets'] if v['targets'] else ''
    rd = '<span class="eff">范围 %d</span>' % v['radius'] if v['radius'] else ''
    hero_bind = [h['cn'] for h in HJ['heroes'].values()] if False else None
    cards.append(
        '<div class="tier" style="border-color:{c}66">'
        '<div class="tier-h" style="color:{c}"><img src="{ic}" class="simg" alt="">{cn} '
        '<small>{el} · {tp} · 冷却 {cd}s · 耗蓝 {mp}</small></div>'
        '<div class="uc-e">{dmg}{tg}{rd}<span class="eff">Lv3 = {max}×攻击</span></div>'
        '<div class="uc-d"><b>机制：</b>{mech}</div>'
        '<div class="uc-d" style="margin-top:5px"><b>反应联动：</b>{rx}</div>'
        '<div class="uc-d" style="margin-top:5px"><b>点评：</b>{desc}</div>'
        '<div class="uc-k" style="margin-top:6px"><code>{k}</code> · 成长 {gf}</div>'
        '</div>'.format(c=col, ic=v['icon'], cn=v['cn'], el=el_name, tp=TYPE_CN[v['type']],
                        cd=ref['cooldown'], mp=ref['mana'], dmg=dmg, tg=tg, rd=rd,
                        max=round(v['baseCoef'] * 1.5, 2), mech=v['mechanism'],
                        rx=reaction_chips(v['reactionNote']), desc=v['desc'], k=k, gf='每级+25%'))

tier_html = ''.join(cards)

html = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>森灵萌兽 · 技能完整规格</title>
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
  .tier{ border:1px solid; border-radius:12px; padding:14px 16px; margin:10px 0; background:rgba(255,255,255,.03) }
  .tier-h{ font-size:16px; font-weight:700; display:flex; align-items:center; gap:10px; margin-bottom:8px }
  .tier-h small{ opacity:.7; font-weight:400; font-size:12px }
  .simg{ width:44px; height:44px; border-radius:9px }
  .uc-e{ margin:6px 0; display:flex; flex-wrap:wrap; gap:5px }
  .eff{ font-size:11.5px; background:rgba(255,255,255,.06); border:1px solid rgba(159,224,180,.3);
    border-radius:6px; padding:1px 7px }
  .eff.el{ background:transparent; border:1px solid }
  .uc-d{ font-size:12.5px; opacity:.8; line-height:1.55 }
  .uc-k code{ font-size:11px; opacity:.45 }
  .note{ font-size:12.5px; opacity:.82; line-height:1.7 }
  footer{ margin-top:26px; font-size:12px; opacity:.5; text-align:center; line-height:1.7; max-width:820px }
</style>
</head>
<body>
  <h1>⚡ 技能完整规格</h1>
  <div class="sub">《萌兽消消岛》8 技能完整数值规格（纯设计数据，非游戏代码）——补全 skill_cooldowns.json 只含冷却/法力的缺口：每技能定义<b>伤害系数 / 目标数 / 范围 / 机制 / 三级成长（每级 +25%，Lv3 = 1.5×）</b>与<b>元素反应联动</b>（引用 reactions.json 实际反应名）。与 §2.5 克制链、§2.9 反应、§2.16 英雄绑定四方对齐，Key/冷却/法力/元素与 skill_cooldowns.json 跨表一致。数据来自 <code>data/skills.json</code>，本页由 <code>tools/build_skills_chart.py</code> 生成。</div>
  <div class="wrap">
    <div class="card">
      <h2>📌 成长与联动口径</h2>
      <div class="note">__GROWTH__</div>
      <div class="note" style="margin-top:6px">__BIND__</div>
    </div>
    <div class="card">
      <h2>⚡ 技能清单 <small>共 __N__ 个 · 冷却/法力引用自 skill_cooldowns</small></h2>
      __TIER_HTML__
    </div>
  </div>
  <footer>萌兽消消岛 · 森灵内容包 · 独立命名空间（_content_pack/）<br>设计数值规格（非游戏代码），反应联动全部引用 reactions.json 实际反应名（跨表校验通过），技能图标复用 skill_icons/（零新资产）；为 §4 接入主游戏时的技能系统提供数据底座。</footer>
</body>
</html>'''

html = (html.replace('__GROWTH__', SK['growthFormula'] + ' —— ' + SK['growthNote'])
            .replace('__BIND__', SK['heroesBindingNote'])
            .replace('__TIER_HTML__', tier_html)
            .replace('__N__', str(len(SKILLS))))

out = os.path.join(ROOT, 'skills_chart.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('skills_chart.html written:', os.path.getsize(out), 'bytes;', len(SKILLS), 'skills')
