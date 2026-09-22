# -*- coding: utf-8 -*-
"""build_manifest.py — 扫描真实目录，生成机器可读资产清单 manifest.json（零依赖，不卡机）
用于未来接入主游戏时的脚本化索引：贴图入库 / 音效映射 / VFX 登记 均可直接读取本清单。
"""
import os, json, struct, datetime

ROOT = 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou/_content_pack'

def uniq_keys(folder, exts):
    keys = set()
    for f in os.listdir(folder):
        for e in exts:
            if f.lower().endswith(e):
                keys.add(f[: -len(e)])
    return sorted(keys)

def png_size(path):
    with open(path, 'rb') as fh:
        fh.read(16)
        w, h = struct.unpack('>II', fh.read(8))
    return w, h

def wav_info(path):
    with open(path, 'rb') as fh:
        data = fh.read()
    if data[:4] != b'RIFF' or data[8:12] != b'WAVE':
        return None
    i, sr, bps, ch, dsize = 12, 44100, 16, 1, 0
    while i < len(data) - 8:
        cid = data[i:i+4]
        sz = struct.unpack('<I', data[i+4:i+8])[0]
        if cid == b'fmt ':
            _, ch, sr, _, _, bps = struct.unpack('<HHIIHH', data[i+8:i+24])
        elif cid == b'data':
            dsize = sz
        i += 8 + sz + (sz & 1)
    dur = round(dsize / (sr * ch * (bps // 8)), 2) if sr and bps else 0
    return {'sampleRate': sr, 'bits': bps, 'channels': ch, 'duration': dur}

sprites = uniq_keys(os.path.join(ROOT, 'sprites_alpha'), ('.png',))
vfx = uniq_keys(os.path.join(ROOT, 'vfx'), ('.png',))
icons = uniq_keys(os.path.join(ROOT, 'icons'), ('.png',))
skill = uniq_keys(os.path.join(ROOT, 'skill_icons'), ('.png',))
pickups = uniq_keys(os.path.join(ROOT, 'pickups'), ('.png',))
portraits = uniq_keys(os.path.join(ROOT, 'hero_portraits'), ('.png',))
data = uniq_keys(os.path.join(ROOT, 'data'), ('.json',))
audio = uniq_keys(os.path.join(ROOT, 'audio'), ('.wav',))
bgm = [k for k in audio if k.startswith('cp_bgm_')]
sfx = [k for k in audio if k.startswith('cp_sfx_')]

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
    'heroes': '英雄图鉴', 'skills': '技能完整规格',
    'music_layers': '战斗分层自适应音乐',
}
PICKUP_CN = {
    'pickup_heal': '治愈果实', 'pickup_coin': '金币袋', 'pickup_exp': '经验晶露',
    'pickup_magnet': '磁石', 'pickup_bomb': '震地菇', 'pickup_shield': '灵盾花',
    'pickup_reroll': '幸运骰', 'pickup_chest': '宝箱',
}

sprite_list = []
for k in sprites:
    png = os.path.join(ROOT, 'sprites_alpha', k + '.png')
    webp = os.path.join(ROOT, 'sprites_alpha', k + '.webp')
    w, h = png_size(png)
    sprite_list.append({
        'key': k, 'cn': SPRITE_CN.get(k, ''), 'w': w, 'h': h,
        'png': os.path.getsize(png),
        'webp': os.path.getsize(webp) if os.path.exists(webp) else None,
    })

vfx_list = []
for k in vfx:
    p = os.path.join(ROOT, 'vfx', k + '.png')
    w, h = png_size(p)
    vfx_list.append({'key': k, 'cn': VFX_CN.get(k, ''), 'w': w, 'h': h, 'bytes': os.path.getsize(p)})

icon_list = []
for k in icons:
    p = os.path.join(ROOT, 'icons', k + '.png')
    w, h = png_size(p)
    icon_list.append({'key': k, 'cn': ICON_CN.get(k, ''), 'w': w, 'h': h, 'bytes': os.path.getsize(p)})

skill_list = []
for k in skill:
    p = os.path.join(ROOT, 'skill_icons', k + '.png')
    w, h = png_size(p)
    skill_list.append({'key': k, 'cn': SKILL_CN.get(k, ''), 'group': 'element' if k.startswith('el_') else 'ability',
                       'w': w, 'h': h, 'bytes': os.path.getsize(p)})

portrait_list = []
for k in portraits:
    p = os.path.join(ROOT, 'hero_portraits', k + '.png')
    w, h = png_size(p)
    portrait_list.append({'key': k, 'w': w, 'h': h, 'bytes': os.path.getsize(p)})

pickup_list = []
for k in pickups:
    p = os.path.join(ROOT, 'pickups', k + '.png')
    w, h = png_size(p)
    pickup_list.append({'key': k, 'cn': PICKUP_CN.get(k, ''), 'w': w, 'h': h, 'bytes': os.path.getsize(p)})

audio_list = []
for k in audio:
    p = os.path.join(ROOT, 'audio', k + '.wav')
    info = wav_info(p) or {}
    audio_list.append({
        'key': k, 'cn': BGM_CN.get(k) or '', 'kind': 'bgm' if k in bgm else 'sfx',
        'bytes': os.path.getsize(p), **info,
    })

data_list = []
for k in data:
    p = os.path.join(ROOT, 'data', k + '.json')
    data_list.append({'key': k, 'cn': DATA_CN.get(k, ''), 'bytes': os.path.getsize(p)})

manifest = {
    'generated_at': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    'namespace': '_content_pack',
    'counts': {
        'sprites': len(sprites), 'vfx': len(vfx), 'icons': len(icons),
        'skill_icons': len(skill), 'pickups': len(pickups), 'hero_portraits': len(portraits),
        'design_data': len(data), 'audio': len(audio),
        'bgm': len(bgm), 'sfx': len(sfx),
    },
    'sprites': sprite_list, 'vfx': vfx_list, 'icons': icon_list,
    'skill_icons': skill_list, 'pickups': pickup_list, 'hero_portraits': portrait_list,
    'design_data': data_list, 'audio': audio_list,
}

out = os.path.join(ROOT, 'manifest.json')
with open(out, 'w', encoding='utf-8') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)
print('manifest.json written:', os.path.getsize(out), 'bytes;',
      len(sprites), 'sprites /', len(vfx), 'vfx /', len(icons), 'icons /',
      len(skill), 'skill /', len(pickups), 'pickups /', len(data), 'data /', len(audio), 'audio')
