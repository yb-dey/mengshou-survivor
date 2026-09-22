# -*- coding: utf-8 -*-
"""build_index.py — 生成内容包总览/入口页 index.html（纯本地，扫描真实目录，避免漂移）"""
import os, json

ROOT = 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou/_content_pack'

def uniq_keys(folder, exts):
    keys = set()
    for f in os.listdir(folder):
        for e in exts:
            if f.lower().endswith(e):
                keys.add(f[: -len(e)])
    return sorted(keys)

sprites = uniq_keys(os.path.join(ROOT, 'sprites_alpha'), ('.png', '.webp'))
vfx = uniq_keys(os.path.join(ROOT, 'vfx'), ('.png',))
icons = uniq_keys(os.path.join(ROOT, 'icons'), ('.png',))
skill = uniq_keys(os.path.join(ROOT, 'skill_icons'), ('.png',))
pickups = uniq_keys(os.path.join(ROOT, 'pickups'), ('.png',))
portraits = uniq_keys(os.path.join(ROOT, 'hero_portraits'), ('.png',))
data = uniq_keys(os.path.join(ROOT, 'data'), ('.json',))
audio = uniq_keys(os.path.join(ROOT, 'audio'), ('.wav',))

bgm = [k for k in audio if k.startswith('cp_bgm_')]
sfx = [k for k in audio if k.startswith('cp_sfx_')]

# 中文名映射（与 README / 试看页保持一致）
SPRITE_CN = {
    'sprout_bunny': '芽芽兔', 'flame_fox': '火苗狐', 'water_frog': '水滴蛙',
    'stone_turtle': '石甲龟', 'star_bird': '星羽鸟', 'cotton_sheep': '棉花羊',
    'forest_ancient': '森林古木', 'spirit_deer': '灵鹿祭司',
}
VFX_CN = {
    'fx_hit_spark': '命中火花', 'fx_fireball': '火球', 'fx_shield': '护盾泡',
    'fx_heal': '治疗光环', 'fx_slash': '斩击弧', 'fx_star': '星爆', 'fx_frost': '霜晶',
    'fx_levelup': '升级星环', 'fx_pickup': '拾取闪光', 'fx_poison': '毒云',
    'fx_explosion': '大爆裂', 'fx_lightning': '雷击', 'fx_heal_burst': '治疗爆发',
    'fx_dash_trail': '冲刺残影', 'fx_telegraph': '预警圈', 'fx_shockwave': '冲击波环',
    'fx_portal': '召唤门', 'fx_coin_burst': '金币迸发',
    'fx_freeze_shatter': '冰碎', 'fx_buff': '增益光环', 'fx_debuff': '减益光环',
    'fx_water_splash': '水花', 'fx_earth_shard': '碎石', 'fx_leaf_burst': '叶爆',
}
BGM_CN = {
    'cp_bgm_forest': '森林主题', 'cp_bgm_battle': '战斗主题', 'cp_bgm_boss': 'BOSS 主题',
    'cp_bgm_tide': '潮次涌动', 'cp_bgm_elite': '精英遭遇', 'cp_bgm_boss2': 'BOSS 二阶段',
}
SFX_CN = {
    'cp_sfx_freeze': '冻结碎冰', 'cp_sfx_buff': '增益强化', 'cp_sfx_debuff': '减益诅咒',
    'cp_sfx_hit_fire': '火元素命中', 'cp_sfx_hit_water': '水元素命中',
    'cp_sfx_hit_earth': '土元素命中', 'cp_sfx_hit_light': '光元素命中',
    'cp_sfx_hit_wood': '木元素命中',
}
ICON_CN = {
    'st_freeze': '冰冻', 'st_stun': '眩晕', 'st_burn': '灼烧', 'st_poison': '中毒',
    'st_bleed': '流血', 'st_slow': '减速', 'st_mark': '标记', 'st_atk_up': '攻击强化',
    'st_def_up': '防御强化', 'st_haste': '急速', 'st_heal': '持续治疗', 'st_shield': '护盾',
}
SKILL_CN = {
    'el_fire': '火', 'el_water': '水', 'el_earth': '土', 'el_light': '光', 'el_wood': '木',
    'ab_fireball': '火球术', 'ab_heal': '治疗', 'ab_frost': '霜冻', 'ab_chain': '链雷',
    'ab_vine': '藤缚', 'ab_quake': '地震', 'ab_dash': '瞬步', 'ab_summon': '召唤',
}
DATA_CN = {
    'element_matrix': '五元素克制矩阵', 'skill_cooldowns': '技能冷却数值',
    'wave_design': '关卡波次设计', 'boss_phases': 'BOSS 多阶段脚本',
    'reactions': '元素反应系统', 'upgrades': '局内成长系统',
    'meta_upgrades': '局外成长系统', 'economy': '经济系统',
    'achievements': '成就与任务系统', 'pickups': '局内拾取物系统',
    'endless': '无尽模式', 'ambience': '环境氛围音层',
    'heroes': '英雄图鉴',
}
PICKUP_CN = {
    'pickup_heal': '治愈果实', 'pickup_coin': '金币袋', 'pickup_exp': '经验晶露',
    'pickup_magnet': '磁石', 'pickup_bomb': '震地菇', 'pickup_shield': '灵盾花',
    'pickup_reroll': '幸运骰', 'pickup_chest': '宝箱',
}

def chips(keys, cn):
    return ''.join('<span class="chip">%s<em>%s</em></span>' % (k, cn.get(k, '')) for k in keys)

html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>森灵萌兽 · 内容包总览</title>
<style>
  :root{{ --leaf:#3fa66a; --gold:#e8c463; --cream:#f3f7ee; }}
  *{{ box-sizing:border-box;margin:0;padding:0 }}
  body{{ font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    background:radial-gradient(130% 120% at 50% -10%, #2f6b45 0%, #1c4a30 45%, #0f2f1f 100%);
    color:var(--cream); min-height:100vh; padding:46px 20px;
    display:flex; flex-direction:column; align-items:center; }}
  h1{{ font-size:34px; letter-spacing:3px; margin-bottom:8px; text-shadow:0 2px 10px rgba(0,0,0,.45) }}
  .sub{{ opacity:.8; margin-bottom:26px; font-size:15px; text-align:center; max-width:680px; line-height:1.6 }}
  .stats{{ display:flex; gap:16px; margin-bottom:30px; flex-wrap:wrap; justify-content:center }}
  .stat{{ background:rgba(232,196,99,.12); border:1px solid rgba(232,196,99,.4);
    border-radius:14px; padding:16px 22px; text-align:center; min-width:120px }}
  .stat b{{ display:block; font-size:30px; color:var(--gold) }}
  .stat span{{ font-size:13px; opacity:.8 }}
  .nav{{ display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:20px;
    width:100%; max-width:860px; margin-bottom:34px }}
  .ncard{{ background:linear-gradient(160deg,#1f5c3a,#143e28); border:1px solid rgba(232,196,99,.35);
    border-radius:18px; padding:24px; text-decoration:none; color:var(--cream);
    box-shadow:0 12px 30px rgba(0,0,0,.35); transition:transform .25s, box-shadow .25s; display:block }}
  .ncard:hover{{ transform:translateY(-4px); box-shadow:0 18px 40px rgba(0,0,0,.45) }}
  .ncard .ico{{ font-size:34px }} .ncard .t{{ font-size:19px; font-weight:700; margin:8px 0 6px }}
  .ncard .d{{ font-size:13px; opacity:.78; line-height:1.5 }}
  .inv{{ width:100%; max-width:860px }}
  .blk{{ background:rgba(15,47,31,.55); border:1px solid rgba(159,224,180,.25);
    border-radius:16px; padding:20px 22px; margin-bottom:18px }}
  .blk h2{{ font-size:18px; margin-bottom:14px; display:flex; align-items:center; gap:8px }}
  .blk h2 small{{ opacity:.6; font-weight:400; font-size:13px }}
  .chip{{ display:inline-flex; flex-direction:column; align-items:center; gap:2px;
    background:rgba(232,196,99,.1); border:1px solid rgba(232,196,99,.3); border-radius:10px;
    padding:8px 12px; margin:5px; font-family:monospace; font-size:12px; min-width:96px }}
  .chip em{{ font-style:normal; opacity:.7; font-size:11px; font-family:inherit }}
  footer{{ margin-top:28px; font-size:12px; opacity:.5; text-align:center; line-height:1.7; max-width:760px }}
</style>
</head>
<body>
  <h1>🌿 森灵萌兽 · 内容包总览</h1>
  <div class="sub">《萌兽消消岛》独立命名空间内容扩展 —— 美术 / 音乐 / 特效 一站式入口。全部资产在自有目录生成，不修改也不依赖主游戏文件，与 GROK 制作路线零冲突。</div>
  <div class="stats">
    <div class="stat"><b>{len(sprites)}</b><span>角色精灵</span></div>
    <div class="stat"><b>{len(vfx)}</b><span>特效精灵</span></div>
    <div class="stat"><b>{len(icons)}</b><span>状态图标</span></div>
    <div class="stat"><b>{len(skill)}</b><span>技能/元素图标</span></div>
    <div class="stat"><b>{len(pickups)}</b><span>拾取物精灵</span></div>
    <div class="stat"><b>{len(portraits)}</b><span>英雄徽章</span></div>
    <div class="stat"><b>{len(audio)}</b><span>音频（{len(bgm)} BGM + {len(sfx)} SFX）</span></div>
  </div>
  <div class="nav">
    <a class="ncard" href="showcase.html" target="_blank">
      <div class="ico">🐾</div><div class="t">角色精灵展示</div>
      <div class="d">{len(sprites)} 张萌兽贴图（已透底，双倍 png/webp），双击即看。</div></a>
    <a class="ncard" href="vfx_demo.html" target="_blank">
      <div class="ico">✨</div><div class="t">特效试看</div>
      <div class="d">{len(vfx)} 个程序化 RGBA 特效（真透底），带 CSS 动效。</div></a>
    <a class="ncard" href="icons_demo.html" target="_blank">
      <div class="ico">🛡️</div><div class="t">状态图标</div>
      <div class="d">{len(icons)} 个常驻 HUD 状态指示（控制 / 持续伤害 / 负面 / 增益），真透底。</div></a>
    <a class="ncard" href="skill_icons_demo.html" target="_blank">
      <div class="ico">⚡</div><div class="t">技能 / 元素图标</div>
      <div class="d">{len(skill)} 个（5 元素徽章 + 8 技能按钮），六边符印与方面板双底盘。</div></a>
    <a class="ncard" href="element_chart.html" target="_blank">
      <div class="ico">⚖️</div><div class="t">元素克制 / 技能数值</div>
      <div class="d">五元素 5 环克制环 + 倍率矩阵 + 8 技能冷却/法力条，设计参考。</div></a>
    <a class="ncard" href="wave_chart.html" target="_blank">
      <div class="ico">🗺️</div><div class="t">关卡波次 / BOSS 阶段</div>
      <div class="d">10 关难度曲线（单→双→五元素）+ 森林古木三阶段 Boss 状态机，设计参考。</div></a>
    <a class="ncard" href="reaction_chart.html" target="_blank">
      <div class="ico">⚗️</div><div class="t">元素反应系统</div>
      <div class="d">五元素克制链延伸的可玩反应机制：10 组元素对 × 7 状态（增幅/聚变），附著(aura)→触发(trigger) 顺序决定倍率；含可玩实验室 reaction_lab.html。</div></a>
    <a class="ncard" href="boss_arena.html" target="_blank">
      <div class="ico">🌳</div><div class="t">BOSS 竞技场</div>
      <div class="d">把 boss_phases.json 三阶段真跑起来的迷你 Boss 战：阶段阈值 / 能力冷却 / 召唤增援。</div></a>
    <a class="ncard" href="campaign.html" target="_blank">
      <div class="ico">🗺️</div><div class="t">战役模式</div>
      <div class="d">把 wave_design.json 10 关 × 多波次真跑起来的关卡流程 demo：逐波刷怪 / 元素聚焦 / 奖励，第 10 关含 Boss。</div></a>
    <a class="ncard" href="upgrade_chart.html" target="_blank">
      <div class="ico">🎲</div><div class="t">局内成长系统</div>
      <div class="d">升级三选一 + 构筑：24 张升级卡 × 4 稀有度（加权抽取 / 可叠层 / 流派标签），含可玩实验室 upgrade_lab.html。</div></a>
    <a class="ncard" href="meta_chart.html" target="_blank">
      <div class="ico">🌱</div><div class="t">局外成长系统</div>
      <div class="d">跨局永久强化 + 森灵币经济闭环：18 项永久强化 × 5 类（几何成本），产出-消耗水槽（积压率 0.22 健康），含可玩实验室 meta_lab.html。</div></a>
    <a class="ncard" href="hero_chart.html" target="_blank">
      <div class="ico">🦌</div><div class="t">英雄图鉴</div>
      <div class="d">4 位英雄差异化规格（灵鹿祭司/雷羽鹰/霜甲熊/焰心术士）：属性条形对比 + 被动天赋 + 技能绑定 + DPS 天平，endless_lab 已挂英雄选择器。</div></a>
    <a class="ncard" href="ambience_chart.html" target="_blank">
      <div class="ico">🎧</div><div class="t">环境氛围音层</div>
      <div class="d">BGM×环境音双通道分层音频：4 条 24s 无缝循环氛围音（森林日间/夜间/浅滩/洞窟）+ 场景映射优先级 + 增益配比。</div></a>
    <a class="ncard" href="endless_chart.html" target="_blank">
      <div class="ico">♾️</div><div class="t">无尽模式</div>
      <div class="d">通关 10 关后的长线挑战：难度二次曲线缩放 + 敌种池四阶段轮换 + 精英/Boss 周期 + 币产出递减防刷取，含可玩实验室 endless_lab.html。</div></a>
    <a class="ncard" href="pickup_chart.html" target="_blank">
      <div class="ico">🍒</div><div class="t">局内拾取物系统</div>
      <div class="d">8 种拾取物精灵（程序化生成）+ 击杀掉落表 / 宝箱开箱表，走位即决策的反馈层，含可玩实验室 pickup_lab.html。</div></a>
    <a class="ncard" href="achievement_chart.html" target="_blank">
      <div class="ico">🏅</div><div class="t">成就与任务系统</div>
      <div class="d">19 个一次性成就 × 5 组 + 每日任务池（抽 3/天），指标取自全部既有系统；首通/每日任务即 economy 两水龙头的判定来源，含可玩实验室 achievement_lab.html。</div></a>
    <a class="ncard" href="audio_demo.html" target="_blank">
      <div class="ico">🎵</div><div class="t">音频试听</div>
      <div class="d">{len(audio)} 条音频（{len(bgm)} BGM 可循环 + {len(sfx)} SFX），单击即听。</div></a>
    <a class="ncard" href="playground.html" target="_blank">
      <div class="ico">⚔️</div><div class="t">实战演练场</div>
      <div class="d">用真实资产搭的迷你战斗场景：点击萌兽触发特效+音效，验证内容包可用性。</div></a>
  </div>
  <div class="inv">
    <div class="blk"><h2>🐾 角色精灵 <small>{len(sprites)} 个 key</small></h2>
      {chips(sprites, SPRITE_CN)}</div>
    <div class="blk"><h2>✨ 特效精灵 <small>{len(vfx)} 个</small></h2>
      {chips(vfx, VFX_CN)}</div>
    <div class="blk"><h2>🛡️ 状态图标 <small>{len(icons)} 个 key</small></h2>
      {chips(icons, ICON_CN)}</div>
    <div class="blk"><h2>⚡ 技能 / 元素图标 <small>{len(skill)} 个</small></h2>
      {chips(skill, SKILL_CN)}</div>
    <div class="blk"><h2>🍒 拾取物精灵 <small>{len(pickups)} 个</small></h2>
      {chips(pickups, PICKUP_CN)}</div>
    <div class="blk"><h2>⚖️ 设计数值规格 <small>{len(data)} 份 JSON</small></h2>
      {chips(data, DATA_CN)}</div>
    <div class="blk"><h2>🎵 音频 <small>{len(bgm)} BGM + {len(sfx)} SFX</small></h2>
      {chips(bgm, BGM_CN)}{chips(sfx, SFX_CN)}</div>
    <div class="blk"><h2>📖 图鉴 <small>1 页</small></h2>
      <a class="ncard" style="display:inline-block" href="codex.html" target="_blank">
        <div class="ico">📖</div><div class="t">角色图鉴 Codex</div>
        <div class="d">8 角色背景 / 属性 / 克制关系。</div></a></div>
  </div>
  <footer>萌兽消消岛 · 森灵内容包 · 独立命名空间（_content_pack/）<br>
  资产清单与接入路径详见 README.md；机器可读资产清单见 <a href="manifest.json" style="color:var(--gold)">manifest.json</a>（tools/build_manifest.py 生成）。本页由 tools/build_index.py 扫描真实目录生成，零依赖、不卡机。</footer>
</body>
</html>'''

out = os.path.join(ROOT, 'index.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('index.html written:', os.path.getsize(out), 'bytes;',
      len(sprites), 'sprites /', len(vfx), 'vfx /', len(icons), 'icons /',
      len(skill), 'skill /', len(pickups), 'pickups /', len(data), 'data /', len(audio), 'audio')
