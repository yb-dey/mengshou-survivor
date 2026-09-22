# -*- coding: utf-8 -*-
"""build_hero_chart.py — 由 data/heroes.json 生成英雄对比参考页
纯本地、零依赖、不卡机；输出 hero_chart.html（属性条形对比 + 被动 + 技能绑定 + DPS 天平）。
"""
import os, json

ROOT = 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou/_content_pack'

H = json.load(open(os.path.join(ROOT, 'data', 'heroes.json'), encoding='utf-8'))
S = json.load(open(os.path.join(ROOT, 'data', 'skill_cooldowns.json'), encoding='utf-8'))
EM = json.load(open(os.path.join(ROOT, 'data', 'element_matrix.json'), encoding='utf-8'))
M = json.load(open(os.path.join(ROOT, 'data', 'meta_upgrades.json'), encoding='utf-8'))

HEROES = H['heroes']
AB_CN = {a['key']: a['cn'] for a in S['abilities']}
ELEM_CN = EM['cn']
ELEM_COLOR = EM['colors']
CN_FIX = {'fire': '火', 'water': '水', 'earth': '土', 'light': '光', 'wood': '木'}


def elem_hex(e):
    c = ELEM_COLOR[e]
    return '#%02x%02x%02x' % (int(c[0] * 255), int(c[1] * 255), int(c[2] * 255))


def bar(label, v, vmax, color, txt):
    pct = v / vmax * 100
    return ('<div class="tb"><span class="tb-n">%s</span>'
            '<span class="tb-bar"><i style="width:%.0f%%;background:%s"></i></span>'
            '<span class="tb-v">%s</span></div>' % (label, pct, color, txt))


cards = []
for k, v in HEROES.items():
    b = v['base']
    dps = b['atk'] / b['atkIntervalSec']
    col = elem_hex(v['element'])
    unlock = '初始英雄' if v['unlockCost'] == 0 else '解锁 %d 🍀' % v['unlockCost']
    skills = ''.join('<span class="eff el" style="border-color:{c};color:{c}">{n}</span>'.format(c=col, n=AB_CN[sk]) for sk in v['skills'])
    passive_html = ('<div class="uc-e"><span class="eff">{}</span></div>'
                    '<div class="uc-d">{}</div>').format(v['passive']['cn'], v['passive']['desc'])
    bars = (bar('生命', b['hp'], 150, col, str(b['hp'])) +
            bar('移速', b['moveSpd'], 1.25, col, '×%.2f' % b['moveSpd']) +
            bar('攻击', b['atk'], 24, col, str(b['atk'])) +
            bar('攻速间隔', 0.9 - b['atkIntervalSec'], 0.9 - 0.30, col, '%.2fs' % b['atkIntervalSec']) +
            bar('基础 DPS', dps, 53.3, '#e8c463', '%.1f' % dps))
    sp_note = ' · ' + v['spriteNote'] if 'spriteNote' in v else ''
    card = ('<div class="tier" style="border-color:{c}66">'
            '<div class="tier-h" style="color:{c}"><img src="{pt}" class="himg" alt="">{cn} '
            '<small>{el} · {un} · {ps0}</small></div>'
            '{passive}'
            '{bars}'
            '<div class="uc-e">{skills}</div>'
            '<div class="uc-d" style="margin-top:6px"><b>玩法：</b>{ps}</div>'
            '<div class="uc-k" style="margin-top:6px"><code>{k}{spn}</code></div>'
            '</div>').format(c=col, sp=v['sprite'], cn=v['cn'], el=ELEM_CN[v['element']],
                             un=unlock, ps0=v['playstyle'].split('：')[0], passive=passive_html, pt=v['portrait'],
                             bars=bars, skills=skills, ps=v['playstyle'], k=k, spn=sp_note)
    cards.append(card)
tier_html = ''.join(cards)

html = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>森灵萌兽 · 英雄图鉴</title>
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
  .tier{ border:1px solid; border-radius:12px; padding:14px 16px; margin:12px 0; background:rgba(255,255,255,.03) }
  .tier-h{ font-size:17px; font-weight:700; display:flex; align-items:center; gap:10px; margin-bottom:10px }
  .tier-h small{ opacity:.7; font-weight:400; font-size:12px }
  .himg{ width:52px; height:52px; border-radius:10px; background:rgba(0,0,0,.3) }
  .uc-e{ margin:6px 0; display:flex; flex-wrap:wrap; gap:5px }
  .eff{ font-size:11.5px; background:rgba(255,255,255,.06); border:1px solid rgba(159,224,180,.3);
    border-radius:6px; padding:1px 7px }
  .eff.el{ background:transparent; border:1px solid }
  .tb{ display:flex; align-items:center; gap:10px; margin:5px 0; font-size:12.5px }
  .tb-n{ width:64px; flex:none; opacity:.85 }
  .tb-bar{ flex:1; height:12px; background:rgba(255,255,255,.07); border-radius:6px; overflow:hidden }
  .tb-bar i{ display:block; height:100% }
  .tb-v{ width:56px; text-align:right; color:var(--gold); font-weight:700 }
  .uc-d{ font-size:12.5px; opacity:.78; line-height:1.5 }
  .uc-k code{ font-size:11px; opacity:.45 }
  .note{ font-size:12.5px; opacity:.82; line-height:1.75 }
  .note b{ color:var(--gold) }
  footer{ margin-top:26px; font-size:12px; opacity:.5; text-align:center; line-height:1.7; max-width:820px }
</style>
</head>
<body>
  <h1>🦌 英雄图鉴</h1>
  <div class="sub">《萌兽消消岛》英雄差异化规格（纯设计数据，非游戏代码）：4 位英雄各绑定一个元素身份、一套基础数值与一个被动天赋，主动技能从 8 技能池各取 2 个。数值天平：基础 DPS 31–53 的跨度由生命/移速/被动补偿（玻璃炮跑得快、坦克打得慢），<b>没有全方位上位替代</b>。元素口径统一：雷→light、冰→water。数据来自 <code>data/heroes.json</code>，本页由 <code>tools/build_hero_chart.py</code> 生成。</div>
  <div class="wrap">
    <div class="card">
      <h2>⚖️ 数值天平 <small>差异补偿设计</small></h2>
      <div class="note">__BALANCE__</div>
      <div class="note" style="margin-top:8px">__ELEMENT_FIX__</div>
    </div>
    <div class="card">
      <h2>🦌 英雄对比 <small>共 4 位 · 属性条形对比</small></h2>
      __TIER_HTML__
    </div>
    <div class="card">
      <h2>🔗 解锁联动 <small>与 §2.11 局外成长</small></h2>
      <div class="note">三位新英雄对应 <code>data/meta_upgrades.json</code> 的解锁项：雷羽鹰 = <code>unlock_eagle</code>（800 🍀）· 霜甲熊 = <code>unlock_bear</code>（1200 🍀）· 焰心术士 = <code>unlock_mage</code>（1500 🍀）；立绘均为现有精灵占位，待云端出图替换。消费点：<code>endless_lab.html</code> 已挂英雄选择器，4 英雄参数与被动在无尽循环中真实生效。</div>
    </div>
  </div>
  <footer>萌兽消消岛 · 森灵内容包 · 独立命名空间（_content_pack/）<br>设计数值规格（非游戏代码），技能绑定 skill_cooldowns、解锁联动 meta_upgrades、元素对齐 element_matrix，零新资产；为 §4 接入主游戏时的英雄系统提供数据底座。</footer>
</body>
</html>'''

html = (html.replace('__BALANCE__', H['balanceNote'])
            .replace('__ELEMENT_FIX__', H['elementFix']['note'])
            .replace('__TIER_HTML__', tier_html))

out = os.path.join(ROOT, 'hero_chart.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('hero_chart.html written:', os.path.getsize(out), 'bytes;', len(HEROES), 'heroes')
