# -*- coding: utf-8 -*-
"""extend_codex.py — 向 codex.html 注入四大数据区块（英雄/拾取物/成就里程碑/模式速查）
数据驱动（读 heroes/pickups/achievements/endless 四份 JSON），幂等（已注入则跳过）。
纯标准库、零依赖。
"""
import io
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, 'codex.html')
s = io.open(P, encoding='utf-8').read()

if '英雄图鉴' in s and 'portrait_' in s:
    print('codex already extended — skip')
    raise SystemExit(0)

HJ = json.load(open(os.path.join(ROOT, 'data', 'heroes.json'), encoding='utf-8'))
PJ = json.load(open(os.path.join(ROOT, 'data', 'pickups.json'), encoding='utf-8'))
AJ = json.load(open(os.path.join(ROOT, 'data', 'achievements.json'), encoding='utf-8'))
EJ = json.load(open(os.path.join(ROOT, 'data', 'endless.json'), encoding='utf-8'))

ELEM_CN = {'fire': '火', 'water': '水', 'earth': '土', 'light': '光', 'wood': '木'}

# ---- 区块样式（追加到 </style> 前）----
style_add = '''
  .sec-title{ font-size:22px; letter-spacing:2px; margin:34px 0 4px; display:flex; align-items:center; gap:8px }
  .sec-sub{ opacity:.65; font-size:12.5px; margin-bottom:14px }
  .mini{ display:flex; gap:10px; background:rgba(255,255,255,.05); border:1px solid rgba(159,224,180,.2);
    border-radius:10px; padding:9px 12px; margin:6px 0; align-items:center }
  .mini img{ width:42px; height:42px; border-radius:8px; flex:none }
  .mini .nm{ font-size:14px; font-weight:700 }
  .mini .ds{ font-size:11.5px; opacity:.75; margin-top:2px }
  .tagx{ font-size:10.5px; border:1px solid rgba(232,196,99,.45); color:#e8c463; border-radius:6px; padding:1px 6px; margin-left:6px }
  .grid2{ display:grid; grid-template-columns:1fr 1fr; gap:10px }
  @media(max-width:720px){ .grid2{ grid-template-columns:1fr } }
  .mrow{ display:flex; align-items:center; gap:8px; margin:5px 0; font-size:12.5px }
  .mrow .lb{ width:150px; flex:none; opacity:.85 }
  .mrow .bar{ flex:1; height:10px; background:rgba(255,255,255,.08); border-radius:5px; overflow:hidden }
  .mrow .bar i{ display:block; height:100% }
  .mrow .vv{ width:44px; text-align:right; color:#e8c463; font-weight:700 }
'''
s = s.replace('</style>', style_add + '</style>')

# ---- 区块 1：英雄图鉴 ----
hero_cards = []
for k, v in HJ['heroes'].items():
    b = v['base']
    dps = b['atk'] / b['atkIntervalSec']
    hero_cards.append(
        '<div class="mini"><img src="{pt}" alt="{cn}">'
        '<div><div class="nm">{cn}<span class="tagx">{el}</span><span class="tagx">{un}</span></div>'
        '<div class="ds">{pc} · {ps}</div>'
        '<div class="ds">HP {hp} · 移速 ×{spd} · DPS {dps:.1f} · 技能 {sk}</div></div></div>'.format(
            pt=v['portrait'], cn=v['cn'], el=ELEM_CN[v['element']],
            un=('初始' if v['unlockCost'] == 0 else '解锁 %d🍀' % v['unlockCost']),
            pc=v['passive']['cn'], ps=v['playstyle'].split('：')[0],
            hp=b['hp'], spd=b['moveSpd'], dps=dps,
            sk='、'.join({'ab_heal': '治疗', 'ab_vine': '藤缚', 'ab_dash': '瞬步', 'ab_chain': '链雷',
                          'ab_frost': '霜冻', 'ab_quake': '地震', 'ab_fireball': '火球', 'ab_summon': '召唤'}[x]
                         for x in v['skills'])))
block_hero = ('\n\n  <div class="sec-title">🦌 英雄图鉴</div>\n'
              '  <div class="sec-sub">4 位英雄差异化（数据来自 data/heroes.json）——基础 DPS 由生存/机动补偿，无全方位上位替代；徽章为程序化生成（hero_portraits/）。</div>\n'
              + ''.join(hero_cards))

# ---- 区块 2：拾取物图鉴 ----
RAR_CN = {k: v['cn'] for k, v in PJ['rarity'].items()}
pk_cards = []
for k, v in PJ['pickups'].items():
    eff = v['effect']
    if 'openTable' in eff:
        eff_txt = '按开箱权重表结算'
    else:
        eff_txt = ' · '.join('%s %+g' % (kk, vv) for kk, vv in eff.items())
    pk_cards.append(
        '<div class="mini"><img src="{ic}" alt="{cn}">'
        '<div><div class="nm">{cn}<span class="tagx">{rar}</span></div>'
        '<div class="ds">{eff}</div>'
        '<div class="ds">{ds}</div></div></div>'.format(
            ic=v['icon'], cn=v['cn'], rar=RAR_CN[v['rarity']], eff=eff_txt, ds=v['desc'][:34] + '…'))
block_pk = ('\n\n  <div class="sec-title">🍒 拾取物图鉴</div>\n'
            '  <div class="sec-sub">8 种局内拾取物（data/pickups.json）——敌人 6% 概率掉落、精英/Boss 必掉宝箱；货币产出计入 economy.json 既有口径。</div>\n'
            + ''.join(pk_cards))

# ---- 区块 3：成就与里程碑 ----
from collections import Counter
grp = Counter(v['group'] for v in AJ['achievements'].values())
GRP = AJ['groups']
total = len(AJ['achievements'])
gmx = max(grp.values())
grows = []
for g, n in grp.items():
    grows.append('<div class="mrow"><span class="lb">{}</span><span class="bar"><i style="width:{:.0f}%;background:#3fa66a"></i></span><span class="vv">{}</span></div>'.format(
        GRP[g], n / gmx * 100, n))
ms_rows = ''.join('<div class="mrow"><span class="lb">存活 {} 分钟 · {}</span><span class="bar"><i style="width:{:.0f}%;background:#e8c463"></i></span><span class="vv">🏅</span></div>'.format(
    m['atSec'] // 60, m['reward'], m['atSec'] / 1200 * 100) for m in EJ['milestones'])
block_ach = ('\n\n  <div class="sec-title">🏅 成就与里程碑概览</div>\n'
             '  <div class="sec-sub">成就 {t} 个 × 5 组 + 无尽存活里程碑（data/achievements.json + data/endless.json）；奖励以称号/图鉴/头像框等非货币荣誉为主，与本图鉴联动。</div>\n'
             '<div class="grid2"><div>{g}</div><div>{m}</div></div>'.format(t=total, g=''.join(grows), m=ms_rows))

# ---- 区块 4：模式速查 ----
n_levels = 10
block_mode = ('\n\n  <div class="sec-title">♾️ 模式速查</div>\n'
              '  <div class="sec-sub">两种游玩模式（data/wave_design.json + data/endless.json）。</div>\n'
              '  <div class="mini"><div><div class="nm">🗺️ 战役模式<span class="tagx">{n} 关</span></div>'
              '<div class="ds">单元素教学 → 双元素混编 → 五元素精英 → 古木 Boss（HP 200 三阶段），过关计分与首通双倍结算。</div></div></div>\n'
              '  <div class="mini"><div><div class="nm">♾️ 无尽模式<span class="tagx">每波 20s</span></div>'
              '<div class="ds">难度二次曲线缩放（预算/生命/伤害），敌种池四阶段轮换，精英每 5 波、Boss 每 10 波；币产出递减防刷取，存活里程碑给非货币荣誉。</div></div></div>'.format(n=n_levels))

block_all = block_hero + block_pk + block_ach + block_mode

# ---- 注入（卡片容器闭合前）----
anchor = '  </div>\n\n  <footer>'
assert s.count(anchor) == 1, ('anchor', s.count(anchor))
s = s.replace(anchor, block_all + '\n' + anchor)

io.open(P, 'w', encoding='utf-8').write(s)
print('codex.html extended:', os.path.getsize(P), 'bytes; +4 blocks')
