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
}
BGM_CN = {
    'cp_bgm_forest': '森林主题', 'cp_bgm_battle': '战斗主题', 'cp_bgm_boss': 'BOSS 主题',
}
SFX_CN = {}

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
    <div class="stat"><b>{len(audio)}</b><span>音频（{len(bgm)} BGM + {len(sfx)} SFX）</span></div>
  </div>
  <div class="nav">
    <a class="ncard" href="showcase.html" target="_blank">
      <div class="ico">🐾</div><div class="t">角色精灵展示</div>
      <div class="d">{len(sprites)} 张萌兽贴图（已透底，双倍 png/webp），双击即看。</div></a>
    <a class="ncard" href="vfx_demo.html" target="_blank">
      <div class="ico">✨</div><div class="t">特效试看</div>
      <div class="d">{len(vfx)} 个程序化 RGBA 特效（真透底），带 CSS 动效。</div></a>
    <a class="ncard" href="audio_demo.html" target="_blank">
      <div class="ico">🎵</div><div class="t">音频试听</div>
      <div class="d">{len(audio)} 条音频（{len(bgm)} BGM 可循环 + {len(sfx)} SFX），单击即听。</div></a>
  </div>
  <div class="inv">
    <div class="blk"><h2>🐾 角色精灵 <small>{len(sprites)} 个 key</small></h2>
      {chips(sprites, SPRITE_CN)}</div>
    <div class="blk"><h2>✨ 特效精灵 <small>{len(vfx)} 个</small></h2>
      {chips(vfx, VFX_CN)}</div>
    <div class="blk"><h2>🎵 音频 <small>{len(bgm)} BGM + {len(sfx)} SFX</small></h2>
      {chips(bgm, BGM_CN)}{chips(sfx, SFX_CN)}</div>
    <div class="blk"><h2>📖 图鉴 <small>1 页</small></h2>
      <a class="ncard" style="display:inline-block" href="codex.html" target="_blank">
        <div class="ico">📖</div><div class="t">角色图鉴 Codex</div>
        <div class="d">8 角色背景 / 属性 / 克制关系。</div></a></div>
  </div>
  <footer>萌兽消消岛 · 森灵内容包 · 独立命名空间（_content_pack/）<br>
  资产清单与接入路径详见 README.md；本页由 tools/build_index.py 扫描真实目录生成，零依赖、不卡机。</footer>
</body>
</html>'''

out = os.path.join(ROOT, 'index.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('index.html written:', os.path.getsize(out), 'bytes;',
      len(sprites), 'sprites /', len(vfx), 'vfx /', len(audio), 'audio')
