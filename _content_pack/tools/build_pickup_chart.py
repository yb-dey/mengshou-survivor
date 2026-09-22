# -*- coding: utf-8 -*-
"""build_pickup_chart.py — 由 data/pickups.json 生成可视化参考页
纯本地、零依赖、不卡机；输出 pickup_chart.html（内联 HTML/SVG）。
与 element_chart / upgrade_chart / meta_chart / achievement_chart 视觉对齐。
"""
import os, json

ROOT = 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou/_content_pack'

P = json.load(open(os.path.join(ROOT, 'data', 'pickups.json'), encoding='utf-8'))
UPS = P['pickups']
RARS = P['rarity']
DR = P['dropRules']

RAR_CN = {k: v['cn'] for k, v in RARS.items()}
RAR_COLOR = {k: v['color'] for k, v in RARS.items()}

EFFECT_LABEL = {
    'healPct': '回复 {v}% 生命', 'coins': '+{v} 森灵币', 'exp': '+{v} 经验',
    'magnetSec': '吸附 {v} 秒', 'screenDamage': '全屏 {v} 伤害',
    'shieldCharges': '抵挡 {v} 次', 'shieldSec': '持续 {v} 秒',
    'reroll': '重抽 +{v}', 'openTable': '按 {v} 表结算',
}

CHEST_LABEL = {
    'coins_small': '金币小袋 +30 币', 'coins_big': '金币大袋 +80 币',
    'heal_full': '生命全满', 'shield': '灵盾花效果', 'reroll': '幸运骰 ×1', 'bomb': '震地菇效果',
}


def eff_html(eff):
    parts = []
    for k, v in eff.items():
        if k == 'openTable':
            parts.append('<span class="eff">按开箱表结算</span>')
            continue
        lab = EFFECT_LABEL.get(k, k).replace('{v}', str(int(v * 100) if k == 'healPct' else v))
        parts.append('<span class="eff">%s</span>' % lab)
    return ''.join(parts)


def bar_tbl(title, weights, note):
    mx = max(weights.values())
    rows = []
    for k, v in weights.items():
        label = CHEST_LABEL.get(k, UPS[k]['cn'] if k in UPS else k)
        rows.append('<div class="tb"><span class="tb-n">%s</span>'
                    '<span class="tb-bar"><i style="width:%.0f%%"></i></span>'
                    '<span class="tb-v">%d%%</span></div>'
                    % (label, v / mx * 100, v))
    return ('<h2 style="margin-top:16px">%s</h2>'
            '<div style="font-size:12px;opacity:.7;margin-bottom:8px">%s</div>%s'
            % (title, note, ''.join(rows)))


# 拾取物卡（按稀有度分组）
sections = []
for rar in ['common', 'rare']:
    items = [(k, v) for k, v in UPS.items() if v['rarity'] == rar]
    items.sort(key=lambda x: x[0])
    col = RAR_COLOR[rar]
    cards = []
    for k, v in items:
        cards.append(
            '<div class="uc" style="border-left-color:%s">'
            '<img src="%s" alt="%s">'
            '<div class="uc-b">'
            '<div class="uc-h"><b style="color:%s">%s</b>'
            '<span class="stk">%s</span></div>'
            '<div class="uc-e">%s</div>'
            '<div class="uc-d">%s</div>'
            '<div class="uc-k"><code>%s</code> · 音效 <code>%s</code></div>'
            '</div></div>'
            % (col, v['icon'], v['cn'], col, v['cn'], RAR_CN[rar],
               eff_html(v['effect']), v['desc'], k, v['sfx']))
    sections.append(
        '<div class="tier" style="border-color:%s">'
        '<div class="tier-h" style="color:%s">%s拾取 <small>%d 种</small></div>'
        '%s</div>' % (col + '88', col, RAR_CN[rar], len(items), ''.join(cards)))
tier_html = ''.join(sections)

enemy_tbl = bar_tbl('🎲 击杀掉落表 <small>每击杀 6%% 概率掉落</small>', DR['enemyDrop']['weights'], DR['enemyDrop']['note'])
chest_tbl = bar_tbl('🎁 宝箱开箱表 <small>精英 / Boss 必掉宝箱</small>', DR['chestOpen']['weights'], DR['chestOpen']['note'])

html = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>森灵萌兽 · 局内拾取物系统</title>
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
  .card h2{ font-size:18px; margin-bottom:16px; display:flex; align-items:center; gap:8px }
  .card h2 small{ opacity:.6; font-weight:400; font-size:13px }
  .tier{ border:1px solid; border-radius:12px; padding:14px 16px; margin:12px 0; background:rgba(255,255,255,.03) }
  .tier-h{ font-size:16px; font-weight:700; margin-bottom:10px }
  .tier-h small{ opacity:.7; font-weight:400; font-size:12px; margin-left:6px }
  .uc{ display:flex; gap:12px; background:rgba(255,255,255,.04); border-left:4px solid var(--leaf);
    border-radius:10px; padding:10px 14px; margin:8px 0; align-items:flex-start }
  .uc img{ width:48px; height:48px; flex:none; border-radius:8px }
  .uc-b{ flex:1; min-width:0 }
  .uc-h{ font-size:15px; display:flex; align-items:center; gap:8px; flex-wrap:wrap }
  .uc-h .stk{ font-size:11px; opacity:.7; border:1px solid rgba(243,247,238,.3); border-radius:6px; padding:1px 7px }
  .uc-e{ margin:6px 0 4px; display:flex; flex-wrap:wrap; gap:5px }
  .uc-e .eff{ font-size:11.5px; background:rgba(255,255,255,.06); border:1px solid rgba(159,224,180,.3);
    border-radius:6px; padding:1px 7px }
  .uc-d{ font-size:12.5px; opacity:.78; line-height:1.5 }
  .uc-k code{ font-size:11px; opacity:.45 }
  .tb{ display:flex; align-items:center; gap:10px; margin:6px 0; font-size:13px }
  .tb-n{ width:150px; flex:none; opacity:.85 }
  .tb-bar{ flex:1; height:14px; background:rgba(255,255,255,.07); border-radius:7px; overflow:hidden }
  .tb-bar i{ display:block; height:100%; background:linear-gradient(90deg,#6fe39a,#3fa66a) }
  .tb-v{ width:40px; text-align:right; color:var(--gold); font-weight:700 }
  footer{ margin-top:26px; font-size:12px; opacity:.5; text-align:center; line-height:1.7; max-width:820px }
</style>
</head>
<body>
  <h1>🍒 局内拾取物系统</h1>
  <div class="sub">《萌兽消消岛》局内拾取物规格（纯设计数据，非游戏代码）。敌人死亡 6% 概率掉落、精英/Boss 必掉宝箱，玩家走位触碰即生效——「走位即决策」的核心反馈层。8 种拾取物由 <code>tools/gen_pickups.py</code> 程序化生成（64×64 RGBA 真透底，零外部素材）；所有货币型产出计入 <code>data/economy.json</code> 既有 faucet，不新增水龙头。数据来自 <code>data/pickups.json</code>，本页由 <code>tools/build_pickup_chart.py</code> 生成。</div>
  <div class="wrap">
    <div class="card">
      __ENEMY_TBL__
      __CHEST_TBL__
    </div>
    <div class="card">
      <h2>🍒 拾取物清单 <small>共 __N__ 种，按稀有度分组</small></h2>
      __TIER_HTML__
    </div>
  </div>
  <footer>萌兽消消岛 · 森灵内容包 · 独立命名空间（_content_pack/）<br>设计数值规格（非游戏代码），与 §2.10 局内成长（幸运骰↔三选一）、§2.11 经济表（金币袋/宝箱币→既有 faucet）、§2.6 波次（精英/Boss 掉宝箱）联动；8 个精灵由 gen_pickups.py 程序化生成（零外部素材），音效全部复用既有 cp_sfx_*（零新音频）；含可玩实验室 pickup_lab.html，为 §4 接入主游戏时的拾取物系统提供端到端验证样本。</footer>
</body>
</html>'''

html = (html.replace('__ENEMY_TBL__', enemy_tbl)
            .replace('__CHEST_TBL__', chest_tbl)
            .replace('__TIER_HTML__', tier_html)
            .replace('__N__', str(len(UPS))))

out = os.path.join(ROOT, 'pickup_chart.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('pickup_chart.html written:', os.path.getsize(out), 'bytes;', len(UPS), 'pickups')
