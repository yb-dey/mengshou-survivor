# 森灵萌兽 · 独立内容包（Forest Sprite Pack）

> **定位**：本包是《萌兽消消岛》的**独立命名空间内容扩展**，由 WorkBuddy 设计助手在自有目录 `_content_pack/` 内生成。**不修改也不依赖主游戏文件 `game/萌兽消消岛.html`**，因此与 GROK 的制作路线零冲突、可并行推进。
>
> **生成方式**：萌兽贴图由云端 Miora 文生图生成（512²），再用项目同源的**边缘洪水填充**算法（`tools/cutout.py`，改编自 `ci/cutout-art.py`）做透底抠图，保证角色内部白色高光不被误删。

---

## 1. 资产清单

| 文件 key | 中文名 | 英文名 | 元素 | 类型 | 稀有度 | HP | 速度 | 特性 |
|---|---|---|---|---|---|---|---|---|
| `sprout_bunny` | 芽芽兔 | Sprout Bunny | 木 | 敌方·小兵 | 普通 | 低 | 中 | 分裂：被击杀原地留芽，短暂后萌出小兔 |
| `flame_fox` | 火苗狐 | Flame Fox | 火 | 敌方·快速 | 普通 | 低 | 高 | 灼烧：接触玩家附加持续灼烧 |
| `water_frog` | 水滴蛙 | Water Frog | 水 | 敌方·远程 | 普通 | 中 | 中 | 吐水弹：周期发射追踪水弹 |
| `stone_turtle` | 石甲龟 | Stone Turtle | 土 | 敌方·坦克 | 稀有 | 高 | 低 | 减伤护盾：受伤 −40% |
| `star_bird` | 星羽鸟 | Star Bird | 光 | 敌方·飞行 | 稀有 | 中 | 极高 | 俯冲：高空蓄力后向玩家俯冲 |
| `cotton_sheep` | 棉花羊 | Cotton Sheep | 光/治愈 | 友方·宠物(可捕捉) | 史诗 | 中 | 低 | 掉落羊毛：概率掉落回血羊毛 |
| `forest_ancient` | 森林古木 | Forest Ancient | 木/土 | **敌方·BOSS** | 传说 | 极高 | 极低 | 召唤藤蔓：周期召唤小藤蔓掩护，释放范围践踏 |
| `spirit_deer` | 灵鹿祭司 | Spirit Deer | 光 | **可玩英雄** | 史诗 | 中 | 中 | 星辉治疗：持续回血友军，并施放净化 |

## 2. 资产规格（已校验）

- **尺寸**：小兵/宠物统一 512 × 512；Boss 与英雄为 1024 × 1024（更高清，匹配主文件 hero_* 规格）。全部 `colorType=6` RGBA，已透底，非死白背景。
- **双格式**：`sprites_alpha/` 下同时提供 `.png`（无损透明）与 `.webp`（q84 透明）。游戏接入推荐用 WebP（与主文件既有 hero/gem 一致）。
- **原始生成图**：`sprites/` 为 Miora 直出（RGB，未抠），保留备查。
- **抠图比例**：55%–65% 背景已清除（角色居中占比正常，未误删主体）。
- **展示页**：`showcase.html` 为**自包含单文件**（8 张精灵 base64 内联），双击即开，已实际“用上”资产，规避死资产陷阱。

## 2.1 音频资产（本轮新增 · 独立命名空间）

> 与 §5 的「复用 game/audio/ 接线」并不矛盾：§5 说的是**不在争议文件上接线**、不往 `game/audio/` 塞文件；本包的音效是**在 `_content_pack/audio/` 自己的命名空间里新生成的原型**，零接线、零冲突，可独立试听与替换。

| 文件 | 用途 | 规格 / 音色设计 | 时长 |
|---|---|---|---|
| `audio/cp_bgm_forest.wav` | 森林主题 BGM（循环） | 44.1k/16bit 单声道，柔 pad+三角波 lead+轻贝斯+铃+软底鼓，无缝循环 | 35.6s |
| `audio/cp_bgm_battle.wav` | 战斗主题 BGM（循环） | 同上规格，128 BPM 驱动贝斯+能量琶音+鼓组(kick/snare/hi-hat)，Am–F–C–G 进行，无缝循环 | 30.0s |
| `audio/cp_bgm_boss.wav`   | BOSS 主题 BGM（循环） | 同上规格，92 BPM 厚低频+铜管感锯齿 lead+定音鼓 kick+不祥钟声，Am–F–C–G 进行，无缝循环 | 31.3s |
| `audio/cp_bgm_tide.wav`  | 潮次涌动 BGM（循环） | 同上规格，116 BPM 森林主题升级层：滚动八分贝斯+十六分水花琶音+4/4 轻底鼓+拍手军鼓+八分 hi-hat，叠加「潮涌」幅度 LFO，I–vi–IV–V 进行，无缝循环 | 33.1s |
| `audio/cp_bgm_elite.wav` | 精英遭遇 BGM（循环） | 同上规格，124 BPM 紧张对立项：持续低音 drone+小二度摩擦 ostinato+16 分 hi-hat 织体+每小节警报 ping，Am–F–C–G 进行，无缝循环 | 31.0s |
| `audio/cp_bgm_boss2.wav` | BOSS 二阶段 BGM（循环） | 同上规格，124 BPM 狂暴对立项：四踩底鼓+双倍驱动贝斯+八度叠加锯齿英雄动机+切分军鼓+整体升半音「狂暴」转调，Am–F–C–G（+1 半音）进行，无缝循环 | 23.2s |
| `audio/cp_sfx_summon.wav` | 召唤音效 | 上行魔法琶音 + 微光泛音（三角波+正弦泛音） | 0.92s |
| `audio/cp_sfx_heal.wav`  | 治疗音效 | 暖色上行和弦 swell（正弦） | 1.38s |
| `audio/cp_sfx_hit.wav`    | 受击·命中 | 低频 thump + 噪声瞬态 + 高频 square click | 0.16s |
| `audio/cp_sfx_kill.wav`   | 击杀 | 下行锯齿扫频 whoosh + 明亮三角 ding | 0.34s |
| `audio/cp_sfx_levelup.wav`| 升级 | 上行大三和弦琶音 C-E-G-C（三角波） | 0.61s |
| `audio/cp_sfx_pickup.wav` | 拾取 | 双段上行 bloop（正弦扫频） | 0.18s |
| `audio/cp_sfx_hurt.wav`   | 受伤 | 下行锯齿 harsh sweep + 噪声毛刺 | 0.26s |
| `audio/cp_sfx_evolve.wav` | 进化 | 宏大上行琶音 + 收尾和弦 swell（比升级隆重） | 1.05s |
| `audio/cp_sfx_win.wav`    | 胜利 | 号角式上行琶音 + 尾部和弦 | 1.10s |
| `audio/cp_sfx_lose.wav`   | 失败 | 下行小调叹息 G-E-C-G + 低沉余音 | 0.99s |
| `audio/cp_sfx_ui.wav`     | UI 点击 | 极短柔 sine tick，克制不抢戏 | 0.06s |
| `audio/cp_sfx_explosion.wav` | 爆炸 / 范围冲击 | 低频 boom + 噪声爆破 + 碎片脆响（配套 fx_explosion / fx_shockwave） | 0.40s |
| `audio/cp_sfx_dash.wav`   | 位移 / 闪避 | 快速上行扫频 + 风噪 whoosh（配套 fx_dash_trail） | 0.22s |
| `audio/cp_sfx_portal.wav` | 召唤门 / 传送 | 失谐正弦琶音 + 缓慢调制漩涡感（配套 fx_portal） | 0.70s |
| `audio/cp_sfx_coin.wav`   | 金币 / 得分 | 经典双音叮 B5→E6（配套 fx_coin_burst） | 0.18s |
| `audio/cp_sfx_warning.wav`| 预警 / 警示 | 紧张双音警报（小二度叠置），急促（配套 fx_telegraph） | 0.44s |
| `audio/cp_sfx_freeze.wav`| 冻结 / 碎冰 | 玻璃质碎裂叮 + 冷色下扫 + 霜噪微闪（配套 fx_freeze_shatter） | 0.34s |
| `audio/cp_sfx_buff.wav`  | 增益 / 强化 | 上行大三和弦 + 金光泛音（配套 fx_buff） | 0.54s |
| `audio/cp_sfx_debuff.wav`| 减益 / 诅咒 | 下行阴郁小调 + 低频闷响（配套 fx_debuff） | 0.70s |

- **合成方式**：`tools/synth_audio.py`（纯 Python 标准库，零依赖、零生成额度、不卡机），确定性种子可复现；复用 `midi_freq / env_adsr / tone / write_wav` 四个基础件，新增 `sawtooth` 波形与 `sweep` 扫频原语。
- **试听页**：`audio_demo.html` 引用相对路径 `audio/*.wav`，双击即听，同样规避死资产；现已改为数据驱动网格，覆盖全部 35 条（6 BGM + 29 SFX）。
- **校验**：35/35 峰值均 = 85%（未削波），RMS 13.4%–30.0%（非空、非静音）；6 首 BGM（35.6s / 30.0s / 31.3s / 33.1s / 31.0s / 23.2s）无缝循环，29 个 SFX 0.06s–1.38s 覆盖战斗全事件、五元素命中与音画配套特效，另含 5 条五元素主题动机 4.00s–5.71s（元素身份听觉签名，无缝短循环）。

## 2.2 VFX 特效精灵（本轮新增 · 程序化真透底）

> 与 AI 抠图不同，特效（辉光/星芒/护盾环）需要**柔和的 alpha**，AI 直出无 alpha 且抠图会破坏光晕。因此本包用**纯程序化**（几何 + 径向渐变，零依赖、零额度、不卡机）生成，得到干净可控的 RGBA。

| 文件 | 中文名 | 用途 | 尺寸 |
|---|---|---|---|
| `vfx/fx_hit_spark.png` | 命中火花 | 敌人受击 / 暴击反馈 | 96² |
| `vfx/fx_fireball.png`  | 火球 | 远程弹道 / 灼烧弹 | 96² |
| `vfx/fx_shield.png`    | 护盾泡 | 召唤 / 护盾增益 | 128² |
| `vfx/fx_heal.png`      | 治疗光环 | 英雄治疗 / 回血 | 128² |
| `vfx/fx_slash.png`     | 斩击弧 | 近战挥砍 | 128² |
| `vfx/fx_star.png`      | 星爆 | 击杀 / 得分 / 拾取 | 96² |
| `vfx/fx_frost.png`     | 霜晶 | 冰冻 / 减速 | 96² |
| `vfx/fx_levelup.png`   | 升级星环 | 升级 / 强化 | 128² |
| `vfx/fx_pickup.png`    | 拾取闪光 | 宝石 / 金币拾取 | 96² |
| `vfx/fx_poison.png`    | 毒云 | 中毒 / 持续伤害 | 96² |
| `vfx/fx_explosion.png` | 大爆裂 | 范围伤害 / 爆炸 | 128² |
| `vfx/fx_lightning.png` | 雷击 | 雷元素 / 链击 | 96² |
| `vfx/fx_heal_burst.png`| 治疗爆发 | 群体治疗 / 回血爆发 | 128² |
| `vfx/fx_dash_trail.png`| 冲刺残影 | 位移 / 闪避 | 128² |
| `vfx/fx_telegraph.png` | 预警圈 | Boss AoE / 地面警示 | 128² |
| `vfx/fx_shockwave.png`| 冲击波环 | AoE 释放 / 范围冲击 | 128² |
| `vfx/fx_portal.png`   | 召唤门 | 召唤 / 传送 | 128² |
| `vfx/fx_coin_burst.png`| 金币迸发 | 金币 / 得分拾取 | 96² |
| `vfx/fx_freeze_shatter.png` | 冰碎 | 冻结命中 / 碎冰解控 | 96² |
| `vfx/fx_buff.png` | 增益光环 | 攻防增益 / 强化生效 | 96² |
| `vfx/fx_debuff.png` | 减益光环 | 减速 / 虚弱 / 诅咒 | 96² |
| `vfx/fx_water_splash.png` | 水花 | 水元素命中 / 水弹溅落 | 128² |
| `vfx/fx_earth_shard.png` | 碎石 | 土元素命中 / 地震冲击 | 128² |
| `vfx/fx_leaf_burst.png` | 叶爆 | 木元素命中 / 藤蔓迸发 | 128² |

- **生成器**：`tools/gen_vfx.py`（仅标准库：自写 PNG 写出 + 加性辉光/柔边环/放射尖刺），`tools/build_vfx_demo.py` 产出内联展示页。
- **试看页**：`vfx_demo.html`（24 张 base64 内联，深色背景 + CSS 动效，双击即看）。
- **校验**：24/24 均为 `colorType=6` RGBA；非空白像素占比 8%–64%（锐利型如斩击/星爆稀疏、辉光型饱满），透明区域正确保留；涵盖命中/弹道/护盾/治疗/斩击/星爆/霜/升级/拾取/毒/爆炸/雷/群疗/位移/预警/冲击波/召唤门/金币/冰碎/增益/减益/水花/碎石/叶爆等全机制。

## 2.3 状态图标（本轮新增 · 常驻 HUD 指示）

> 与 §2.2 的「瞬时爆发特效」互补：状态图标是**常驻在角色头顶/角落的 HUD 指示**（debuff/buff/控制），需要清晰可读的徽章轮廓（实心圆盘 + 白色符号），而非柔光。统一 64² 真透底 RGBA，纯程序化生成。

| 文件 | 中文名 | 类别 | 用途 |
|---|---|---|---|
| `icons/st_freeze.png` | 冰冻 | 控制 | 冻结 / 定身 |
| `icons/st_stun.png` | 眩晕 | 控制 | 短时无法行动 |
| `icons/st_burn.png` | 灼烧 | 持续伤害 | 每秒扣血（火） |
| `icons/st_poison.png` | 中毒 | 持续伤害 | 每秒扣血（毒） |
| `icons/st_bleed.png` | 流血 | 持续伤害 | 叠加层数持续掉血 |
| `icons/st_slow.png` | 减速 | 负面 | 移动 / 攻速下降 |
| `icons/st_mark.png` | 标记 | 负面 | 受击增伤 / 易伤 |
| `icons/st_atk_up.png` | 攻击强化 | 增益 | 伤害提升 |
| `icons/st_def_up.png` | 防御强化 | 增益 | 减伤提升 |
| `icons/st_haste.png` | 急速 | 增益 | 攻速 / 移速提升 |
| `icons/st_heal.png` | 持续治疗 | 增益 | 每秒回血 |
| `icons/st_shield.png` | 护盾 | 增益 | 吸收伤害的护盾 |

- **生成器**：`tools/gen_icons.py`（纯标准库，复用 `gen_vfx.Canvas`；自写 `disc` 徽章底盘 + 12 个 `g_*` 符号函数），`tools/build_icons_demo.py` 产出内联分组展示页。
- **试看页**：`icons_demo.html`（12 张 base64 内联，按 控制 / 持续伤害 / 负面 / 增益 四组彩色标签分类，双击即看）。
- **校验**：12/12 均为 `colorType=6` RGBA（64×64），文件体积 1.46KB–2.52KB（实心徽章 + 符号，内容饱满非空白）；与 vfx/ 的 21 个爆发特效共同构成「状态机制」的完整视觉闭环（图标=常驻指示，特效=触发瞬间，音效=听觉反馈）。

## 2.4 技能 / 元素图标（本轮新增 · 英雄技能栏 + 五元素身份）

> 与 §2.3 的「状态图标（圆牌）」互补但**底盘分明**：元素徽章用**六边符印**底盘（元素身份 / 克制图例 / 选择 UI），技能图标用**圆角方面板**底盘（英雄技能栏按钮）——圆牌（状态）、六边（元素）、方面板（技能）三系 UI 语言互不混淆。

| 文件 | 中文名 | 底盘 | 用途 |
|---|---|---|---|
| `skill_icons/el_fire.png` | 火 | 六边符印 | 火元素身份 · 灼烧系 · 强克木 |
| `skill_icons/el_water.png` | 水 | 六边符印 | 水元素身份 · 水弹系 · 强克光 |
| `skill_icons/el_earth.png` | 土 | 六边符印 | 土元素身份 · 岩甲系 · 强克水 |
| `skill_icons/el_light.png` | 光 | 六边符印 | 光元素身份 · 圣辉系 · 强克火 |
| `skill_icons/el_wood.png` | 木 | 六边符印 | 木元素身份 · 藤蔓系 · 强克土 |
| `skill_icons/ab_fireball.png` | 火球术 | 圆角方面板 | 英雄主动技 · 火球弹道伤害 |
| `skill_icons/ab_heal.png` | 治疗 | 圆角方面板 | 英雄主动技 · 单体/群体回血 |
| `skill_icons/ab_frost.png` | 霜冻 | 圆角方面板 | 英雄主动技 · 冰冻减速控场 |
| `skill_icons/ab_chain.png` | 链雷 | 圆角方面板 | 英雄主动技 · 链式跳跃雷击 |
| `skill_icons/ab_vine.png` | 藤缚 | 圆角方面板 | 英雄主动技 · 藤蔓缠绕定身 |
| `skill_icons/ab_quake.png` | 地震 | 圆角方面板 | 英雄主动技 · 范围震荡击退 |
| `skill_icons/ab_dash.png` | 瞬步 | 圆角方面板 | 英雄位移技 · 短距冲刺闪避 |
| `skill_icons/ab_summon.png` | 召唤 | 圆角方面板 | 英雄召唤技 · 召唤萌兽协战 |

- **生成器**：`tools/gen_skill_icons.py`（纯标准库，复用 `gen_vfx.Canvas` 与 `gen_icons` 符号；新增 `hexplate` 六边符印底盘 + `panel` 圆角方面板底盘 + `g_leaf / g_rock / g_dash / g_star` 四个新符号），`tools/build_skill_icons_demo.py` 产出内联分组展示页。
- **试看页**：`skill_icons_demo.html`（13 张 base64 内联，按 元素徽章 / 技能图标 两组彩色标签分类，双击即看）。
- **设计要点**：元素徽章与 R18 的元素命中 VFX（fx_water_splash / fx_earth_shard / fx_leaf_burst）+ 元素命中音效（cp_sfx_hit_fire/water/earth/light/wood）构成「元素身份 → 命中反馈」闭环；生成器已做**底盘去重**（曾发现 el_fire 与 st_burn 同盘同色同符号导致视觉重复，遂改为六边符印）。
- **校验**：13/13 均为 `colorType=6` RGBA（64×64），体积 1.6KB–4.6KB；逐张目检通过（叶符号叶轴/中脉同向、星芒可见、面板元素色可辨）。

## 2.5 元素克制与技能数值（设计规格 · 本轮新增）

> 与 §2.4 的「元素身份 UI」、R18 的「元素命中反馈」配套的**战斗规则规格**（非游戏代码，仅作平衡参考与后续 playground 机制深化的数据底座）。五元素采用**单一 5 环克制链**——每个元素强克 1 个、弱于 1 个，保证对称平衡：火→木→土→水→光→火（强克方向；反方向即被克）。

| 文件 | 内容 | 用途 |
|---|---|---|
| `data/element_matrix.json` | 五元素环 / 倍率 / 配色 / 克制理由 | 攻击方对防守方的伤害倍率（强克 ×1.6 / 被克 ×0.6 / 同元素 ×0.85 / 中性 ×1.0）数据底座 |
| `data/skill_cooldowns.json` | 8 技能冷却 / 法力 / 元素 / 类型 | 与 `skill_icons/ab_*` 一一对应，驱动 playground 技能释放节奏 |
| `element_chart.html` | 五边形克制环 + 倍率矩阵 + 冷却条 | 由两份 JSON 数据驱动生成的可视化参考页（内联 SVG，零图片生成） |

- **生成器**：`tools/build_element_chart.py`（读 `data/*.json`，纯标准库渲染 SVG 与表格，零依赖、不卡机）。
- **设计要点**：元素配色复用 §2.4 的徽章色（火/水/土/光/木），克制环与元素身份 UI、元素命中 VFX/SFX 三件套在视觉与规则层完全对齐；倍率矩阵可直接被 §4 接入主游戏时读取为伤害公式参数。
- **校验**：两份 JSON 均为合法 JSON（`json.load` 通过）；`element_chart.html` 由脚本校验（含 `<svg>` 节点、5×5 克制矩阵 6 行、8 技能冷却条）。

## 2.6 关卡波次与 BOSS 多阶段（设计规格 · 本轮新增）

> 与 §2.5 的「战斗规则数值」配套的**关卡流程规格**（非游戏代码，仅作平衡参考与后续 playground 机制深化的数据底座）。定义 10 关难度曲线（单元素教学 → 双元素混编 → 五元素精英 → BOSS）与森林古木（木属性，基础 HP 200）的三阶段 Boss 状态机，供 §4 接入主游戏时直接读取为波次生成参数与 Boss AI 状态机。

| 文件 | 内容 | 用途 |
|---|---|---|
| `data/wave_design.json` | 10 关 × 多波次敌种组合 + 元素分布 | 每关 `elementFocus / waves[{index,spawns:[{key,count}],note}] / reward`；难度曲线由单元素 → 双元素混编 → 五元素精英 → BOSS |
| `data/boss_phases.json` | 森林古木三阶段脚本 | `baseHp:200` + 3 阶段（阈值 66% / 33%），每阶段 `abilities[{name,element,cooldown,cn}] / summon[{key,count}] / notes`，冷却随阶段压缩 |
| `wave_chart.html` | 关卡地图 + 难度曲线 + BOSS 三阶段可视化 | 由两份 JSON 数据驱动生成的可视化参考页（内联 SVG/HTML，零图片生成） |

- **生成器**：`tools/build_wave_chart.py`（读 `data/wave_design.json` + `data/boss_phases.json`，复用 `data/element_matrix.json` 五元素配色，纯标准库渲染，零依赖、不卡机）。
- **设计要点**：敌种 6 种（芽芽兔/火苗狐/水滴蛙/星羽鸟/石甲龟/森林古木）与主文件潜在敌种表一一对应（`element / role / hp`）；关卡元素分布与 §2.5 五元素克制链对齐（教学关单元素、后期关逼迫切元素）；Boss 三阶段机制（藤蔓召唤 → 范围践踏 → 缠绕+木刺 → 古木狂暴）随血量压缩冷却、混召多属性增援，形成「输出与生存终局考验」。
- **校验**：两份 JSON 均为合法 JSON（`json.load` 通过）；`wave_chart.html` 由脚本生成（含 10 关卡片、难度曲线柱状、BOSS HP 三段分段条、3 阶段能力卡 + 冷却压缩对比）。

## 2.7 BOSS 竞技场（Boss 阶段脚本 · 可玩校验场）

> 把 §2.6 的 `data/boss_phases.json` **真正跑起来**的迷你 Boss 战（非游戏代码，纯前端，`file://` 双击即开），用于验证三阶段脚本在「可玩」形态下是否成立：阶段阈值、能力冷却、召唤增援、冷却压缩是否如规格所述联动。

| 文件 | 内容 | 用途 |
|---|---|---|
| `boss_arena.html` | 森林古木三阶段 Boss 战 | 点击 Boss / 召唤物输出（元素克制倍率结算），Boss 按 `boss_phases.json` 的冷却自动触发能力、按阈值切阶段、按 `summon` 混召增援；英雄有独立血条，Boss 倒下=胜利、英雄阵亡=失败 |

- **机制对齐**：Boss 阶段切换按 `hpLow`（66% / 33%）触发；每阶段 `abilities` 按各自 `cooldown` 在 250ms tick 循环里自动释放（藤蔓召唤→范围践踏→藤蔓缠绕+木刺喷射→古木狂暴），后期阶段冷却数值更小（压缩）；`summon` 在阶段登场与每 8s 周期混召（芽芽兔/火苗狐/星羽鸟，受 6 只上限约束）；玩家选「攻击元素」后伤害按 §2.5 `element_matrix.json` 倍率结算（火 强克 木 Boss ×1.6）。
- **资产复用**：英雄用 `spirit_deer`、Boss 用 `forest_ancient`、召唤物用 `sprout_bunny/flame_fox/star_bird`（均 `sprites_alpha/`）；能力触发播 `fx_telegraph` 预警圈 + 对应元素 `cp_sfx_hit_*`；通关/失败播 `cp_sfx_win/lose`。
- **校验**：内联 `<script>` 经 `node --check` 语法校验通过（无 fetch，file:// 双击可用）；与 §2.6 规格在阶段阈值 / 能力冷却 / 召唤增援三处逐一对应。

## 2.8 战役模式（关卡波次 · 可玩校验场）

> 把 §2.6 的 `data/wave_design.json` **真正跑起来**的关卡流程 demo（非游戏代码，纯前端，`file://` 双击即开），用于验证 10 关 × 多波次设计在「可玩」形态下是否成立：逐关逐波刷怪节奏、元素聚焦、弱点提示、奖励、过关/失败/重试是否如规格所述联动。

| 文件 | 内容 | 用途 |
|---|---|---|
| `campaign.html` | 10 关 × 多波次战役流程 | 每关按 `waves` 顺序刷怪，清空一波→下一波、清空一关→下一关；先选「攻击元素」再点敌人输出，伤害按 `element_matrix.json` 倍率结算；英雄独立血条，撑过 10 关=通关、英雄阵亡=重试本关；第 10 关含 Boss（森林古木 200HP 木） |

- **机制对齐**：关卡顺序 / 波次刷怪 / 元素聚焦 / 奖励与 `wave_design.json` 一致；弱点提示用 `counterOf()` 算每波最多敌种元素的最强克元素（强克 ×1.6）；过关按 `lv.id*10` 计分 + levelup sfx；失败自动重置本关（英雄 HP 满、重新 `loadLevel`）。第 10 关 Boss 按 §2.6 高 HP 木敌呈现（森林古木 200HP 木，弱火），与 `boss_arena.html` 共享同一五元素系统。
- **资产复用**：敌种用 `sprites_alpha`（芽芽兔/火苗狐/水滴蛙/星羽鸟/石甲龟/森林古木）；命中/击杀播 `fx_hit_spark`/`fx_slash`/`fx_star` + `fx_explosion`/`fx_coin_burst` + `cp_sfx_hit_*`/`cp_sfx_kill`/`cp_sfx_levelup`/`cp_sfx_win`/`cp_sfx_lose`，可开 `cp_bgm_battle` 循环。
- **校验**：内联 `<script>` 经 `node --check` 语法校验通过（无 fetch，file:// 双击可用）；内联 `WAVE` 数据已与 `wave_design.json` 逐项比对一致（6 敌种 key/hp/element、10 关 id/波次数/每关总敌数 均无漂移）；11 项引用资产（6 精灵 png + 5 vfx png + 12 音频 wav）路径经 `ls` 核验存在，无断裂引用。

## 2.9 元素反应系统（设计规格 + 可玩实验室 · 本轮新增）

> 在 §2.5 的「五元素克制链」基础上延伸出的**战斗反应机制**（非游戏代码，纯设计数据 + 纯前端可玩校验场）。设计锚定业界成熟框架：Genshin 的 aura/trigger（附著/触发）顺序决定增幅倍率、聚变类附著状态；Soulstone Survivors 的状态基于「独立 debuff 相乘 + 递减」；Deep Rock Galactic: Survivor 的 DoT 以「叠层 + 衰减」形式。本包取其「顺序决定倍率 / 状态叠层」内核，落地为 10 组元素对 × 7 状态的自有规格。

| 文件 | 内容 | 用途 |
|---|---|---|
| `data/reactions.json` | 五元素反应系统规格 | `elements`(5) / `statuses`(7) / `reactions`(10 组无序对)；增幅类(蒸发)按 `multByTrigger` 放大触发那一击、聚变类附著状态；顺/逆以元素名字母序判定，逆触发 +20% 状态时长 |
| `reaction_chart.html` | 反应矩阵 + 反应清单 + 状态图例可视化 | 由 `data/reactions.json` 数据驱动生成（5×5 反应矩阵 + 10 反应卡 + 7 状态图标图例，内联 SVG/HTML，零图片生成） |
| `reaction_lab.html` | 元素反应可玩实验室 | 把规格真跑起来的纯前端 `file://` 校验场：先点元素附著木桩、再点另一元素触发反应；增幅/聚变按规格结算，逆触发 +20% 时长可见，状态 HUD 实时倒计时 |

- **生成器**：`tools/build_reaction_chart.py`（读 `data/reactions.json`，复用 `data/element_matrix.json` 五元素配色，纯标准库渲染，零依赖、不卡机）。
- **设计要点**：7 状态全部映射到既有 `icons/st_*.png` 图标 + `fx_*`/`cp_sfx_*` 资产（零新资产）；反应「消耗附著、需重新附著」复刻 Genshin 的 aura/trigger 循环；与 §2.5 五元素克制链、§2.3 状态图标、§2.1 状态音效在规则与素材层完全对齐。
- **校验**：`data/reactions.json` 为合法 JSON（C(5,2)=10 对全覆盖、无多余、status 引用均存在，amplifying 的 `fire+water` 状态为 null 即无状态，符合设计）；`reaction_chart.html` 由脚本校验（0 占位符、10 反应名全在、7 状态图标路径均存在）；`reaction_lab.html` 内联 `<script>` 经 `node --check` 语法校验通过（file:// 双击可用，无 fetch），内联 `REACT`/`STATUS`/`ELEMENTS` 已与 `reactions.json` 逐项比对一致（5 元素 / 7 状态 / 10 反应 均无漂移），逆触发 +20% 时长已在 `applyStatus` 真正生效。

## 2.10 局内成长系统（设计规格 + 可玩实验室 · 本轮新增）

> 填补内容包缺失的一环：已有波次(wave_design)、Boss(boss_phases)、元素(element_matrix)、反应(reactions)，但缺少**幸存品类的核心循环——局内「升级三选一 + 构筑」**。本规格定义升级卡池、稀有度加权抽取、叠层上限与经验曲线，让玩家在单局内把角色从「基础五元素」构筑成某一流派（元素专精 / 反应连锁 / 生存续航 / 召唤兽群）。设计锚定：Vampire Survivors 的三选一 + 叠层上限、Soulstone Survivors 的稀有度分档与独立乘区、Brotato 的「围绕 1–2 个乘区深挖」构筑思路。

| 文件 | 内容 | 用途 |
|---|---|---|
| `data/upgrades.json` | 局内成长系统规格 | 24 张升级卡（普通 5 / 稀有 11 / 史诗 6 / 传说 2），每张含 `rarity / maxStacks / tags / effects / icon / sfx`；另含 `levelUp`（抽 3 张、稀有度权重 + 等级缩放）、`expCurve`（二次曲线，上限 Lv.20）、`stats`（18 个属性字段口径） |
| `upgrade_chart.html` | 经验曲线 + 权重缩放 + 升级卡清单可视化 | 由 `data/upgrades.json` 数据驱动生成（内联 SVG 柱状 + 稀有度分层卡组 + 流派标签分布，零图片生成） |
| `upgrade_lab.html` | 局内成长可玩实验室 | 把规格真跑起来的纯前端 `file://` 校验场：英雄自动攻击木桩累积经验 → 升级弹三选一 → 选卡立刻改变属性面板与 DPS；用它验证「构筑是否真的带来成长」 |

- **生成器**：`tools/build_upgrade_chart.py`（读 `data/upgrades.json`，复用 `data/element_matrix.json` 五元素配色，纯标准库渲染，零依赖、不卡机）。
- **设计要点**：三类乘区分明——**元素专精**（5 张单元素卡，与 §2.5 克制链、§2.9 反应一一联动）、**反应连锁**（共鸣 / 绵延 / 附著大师 / 剧毒蔓延，放大 §2.9 反应结算）、**生存续航**（厚皮 / 硬壳 / 汲取 / 护体 / 不灭）；传说卡「元素共鸣」不再挑元素，是通用终极乘区。全部 24 张卡的图标复用既有 `icons/st_*` / `skill_icons/el_*·ab_*` / `vfx/fx_*`、音效复用 `cp_sfx_*`（**零新资产**）。
- **校验**：`data/upgrades.json` 为合法 JSON；24 张卡的 icon / sfx 引用经 `os.path.exists` 核验**零缺失**；`upgrade_chart.html` 由脚本校验（0 占位符、含 `<svg>`、24 张卡名全在、19 个图标引用均存在）；`upgrade_lab.html` 内联 `<script>` 经 `node --check` 语法校验通过（file:// 双击可用，无 fetch），内联 `UP` / `RARITY` / `LEVELUP` / `CURVE` 已与 `upgrades.json` 逐项比对一致（24 卡 / 4 稀有度 / 抽卡规则 / 经验曲线 均无漂移）。

## 2.11 局外成长系统（设计规格 + 可玩实验室 · 本轮新增）

> 补齐幸存品类「局内构筑 + 局外养成」双层循环的另一半：已有局内成长(upgrades)，独缺**跨局永久强化**。本规格定义「森灵币」产出-消耗闭环与 18 项永久强化（基础属性 / 元素亲和 / 经济加成 / 生存续航 / 英雄解锁），让每局战斗都为下一局变强铺路。设计锚定：Vampire Survivors PowerUp（金币购永久强化）、Hades 夜之镜（局内资源→局外成长→更强局内表现）、Rogue Legacy 庄园（死亡也累积永久收益，消除挫败感）。

| 文件 | 内容 | 用途 |
|---|---|---|
| `data/meta_upgrades.json` | 局外成长系统规格 | 18 项永久强化（基础 5 / 元素 5 / 经济 3 / 生存 2 / 解锁 3），每项含 `category / maxLevel / cost{base,growth} / effects / icon`；几何成本 `cost(l)=round(base*growth^(l-1))`；另含 `currency`（森灵币）、`stats`（12 个字段口径） |
| `data/economy.json` | 森灵币经济水槽模型 | 货币(1) + 产出入口(4：击杀/通关/首次通关/每日) + 回收水槽(2：永久强化/英雄解锁) + 积压率 0.22（<0.3 健康），经 `game-economy check` E1–E4 全 PASS |
| `meta_chart.html` | 经济水槽 + 分类消耗 + 永久强化清单可视化 | 由两份 JSON 数据驱动生成（积压率仪表 SVG + 五类总消耗对比 + 18 项强化卡组，零图片生成） |
| `meta_lab.html` | 局外成长可玩实验室 | 纯前端 `file://` 校验场：本局自动战斗 20s 赚币 → 局外大厅买永久强化 → 下一局伤害/生命/金币收益更高，验证「跨局养成」闭环 |

- **生成器**：`tools/build_meta_chart.py`（读 `data/meta_upgrades.json` + `data/economy.json`，复用 `data/element_matrix.json` 五元素配色，纯标准库渲染，零依赖、不卡机）。
- **设计要点**：五类乘区分明——**基础属性**（生命/攻击/移速/拾取/暴击）、**元素亲和**（五元素各 2%/级，与 §2.5 克制链、§2.9 反应叠乘）、**经济加成**（金币/经验/开局金币，加速养成回本）、**生存续航**（减伤/复活）、**英雄解锁**（雷羽鹰/霜甲熊/焰心术士，占位图待云端出图替换）。全部 18 项复用既有 `icons/st_*` / `skill_icons/el_*·ab_*` / `vfx/fx_*` / `sprites/*` / `cp_sfx_*` 资产（**零新资产**）。
- **经济闭环**：全流程总产出 41,946 森灵币，总消耗 32,718 币（永久强化 29,218 + 解锁 3,500），积压率 0.22——消耗吃掉 78%，留 22% 作「存币待购」余量，既不通胀也不枯竭；`data/economy.json` 经 `game-economy` 技能 `check` 校验（E1 货币≥1 / E2 产出≥1 / E3 水槽≥1 / E4 积压率≤0.3）全 PASS。
- **校验**：两份 JSON 合法；18 项 icon/sfx 引用 `os.path.exists` 核验零缺失；`economy.json` 内部自洽（faucets 求和=total_faucet、drains 求和=total_drain、积压率匹配、drains 与 meta_upgrades 总成本跨表一致）；`meta_chart.html` 0 占位符、含 `<svg>`、18 项名全在、16 图标引用均存在；`meta_lab.html` 内联 `<script>` 经 `node --check` 通过（file:// 双击可用），内联 `MU`/`EC` 与两份 JSON 逐项比对一致（18 项 / 积压率 0.22 无漂移）。
## 3. 目录结构

```
_content_pack/
├── README.md              # 本文件
├── index.html             # 内容包总览·入口页（导航 4 大展示页 + 资产清单，零依赖生成）
├── manifest.json          # 机器可读资产清单（贴图尺寸 / VFX 尺寸 / 音效时长与格式 / 接入 key）
├── playground.html        # 实战演练场（真实资产搭的迷你战斗场景，验证内容包可用性）
├── showcase.html          # 自包含展示页（精灵已内联，8 张）
├── audio_demo.html        # 音频试听页（引用 audio/*.wav）
├── codex.html             # 图鉴页（8 角色 背景/属性/对策 + 元素克制环）
├── vfx_demo.html          # VFX 试看页（PNG base64 内联，21 个）
├── icons_demo.html         # 状态图标试看页（PNG base64 内联，12 个，按类别分组）
├── skill_icons_demo.html  # 技能 / 元素图标试看页（PNG base64 内联，13 个，按 元素徽章/技能图标 分组）
├── element_chart.html      # 元素克制环 + 倍率矩阵 + 技能冷却条（数据驱动，内联 SVG）
├── wave_chart.html         # 关卡波次 + BOSS 三阶段可视化（数据驱动，内联 SVG/HTML）
├── reaction_chart.html     # 元素反应系统：5×5 反应矩阵 + 10 反应卡 + 7 状态图例（数据驱动，内联 SVG/HTML）
├── reaction_lab.html       # 元素反应可玩实验室（reactions.json 真跑起来，纯前端 file:// 双击即开）
├── upgrade_chart.html      # 局内成长系统：经验曲线 + 稀有度权重缩放 + 24 张升级卡（数据驱动，内联 SVG/HTML）
├── upgrade_lab.html        # 局内成长可玩实验室（upgrades.json 真跑起来，升级三选一 + DPS 验证，纯前端 file:// 双击即开）
├── meta_chart.html         # 局外成长系统：经济水槽 + 五类总消耗 + 18 项永久强化（数据驱动，内联 SVG/HTML）
├── meta_lab.html           # 局外成长可玩实验室（meta_upgrades.json 真跑起来，赚币→永久强化→更强，纯前端 file:// 双击即开）
├── boss_arena.html         # BOSS 竞技场（boss_phases.json 三阶段可玩校验场，纯前端 file:// 双击即开）
├── campaign.html          # 战役模式（wave_design.json 10 关 × 多波次可玩校验场，逐波刷怪，纯前端 file:// 双击即开）
├── sprites/               # 原始生成图（RGB，未抠）
│   └── <key>.png
├── sprites_alpha/         # 透底资产（RGBA，游戏可直接用）
│   └── <key>.png / <key>.webp
├── audio/                 # 本包专属音频原型（独立命名空间，零接线，35 条）
│   ├── cp_bgm_forest.wav  # 森林主题 BGM（无缝循环）
│   ├── cp_bgm_battle.wav  # 战斗主题 BGM（128 BPM，无缝循环）
│   ├── cp_bgm_boss.wav    # BOSS 主题 BGM（92 BPM，无缝循环）
│   ├── cp_bgm_tide.wav    # 潮次涌动 BGM（116 BPM，森林主题升级层，无缝循环）
│   ├── cp_bgm_elite.wav   # 精英遭遇 BGM（124 BPM，紧张对立项，无缝循环）
│   ├── cp_bgm_boss2.wav   # BOSS 二阶段 BGM（124 BPM，狂暴对立项，无缝循环）
│   ├── cp_sfx_summon.wav  # 召唤
│   ├── cp_sfx_heal.wav    # 治疗
│   ├── cp_sfx_hit.wav     # 受击·命中
│   ├── cp_sfx_kill.wav    # 击杀
│   ├── cp_sfx_levelup.wav # 升级
│   ├── cp_sfx_pickup.wav  # 拾取
│   ├── cp_sfx_hurt.wav    # 受伤
│   ├── cp_sfx_evolve.wav  # 进化
│   ├── cp_sfx_win.wav     # 胜利
│   ├── cp_sfx_lose.wav    # 失败
│   ├── cp_sfx_ui.wav      # UI 点击
│   ├── cp_sfx_freeze.wav  # 冻结 / 碎冰（配套 fx_freeze_shatter）
│   ├── cp_sfx_buff.wav    # 增益 / 强化（配套 fx_buff）
│   ├── cp_sfx_debuff.wav  # 减益 / 诅咒（配套 fx_debuff）
│   ├── cp_sfx_elem_fire.wav  # 火元素主题动机（听觉签名，无缝短循环）
│   ├── cp_sfx_elem_water.wav # 水元素主题动机（听觉签名，无缝短循环）
│   ├── cp_sfx_elem_earth.wav # 土元素主题动机（听觉签名，无缝短循环）
│   ├── cp_sfx_elem_light.wav # 光元素主题动机（听觉签名，无缝短循环）
│   └── cp_sfx_elem_wood.wav  # 木元素主题动机（听觉签名，无缝短循环）
├── vfx/                   # 程序化特效精灵（RGBA 真透底）
│   └── fx_*.png（24 个）
├── icons/                 # 状态图标（RGBA 真透底，常驻 HUD 指示）
│   └── st_*.png（12 个）
├── skill_icons/           # 技能 / 元素图标（RGBA 真透底，六边符印 + 圆角方面板双底盘）
│   ├── el_*.png（5 个元素徽章）
│   └── ab_*.png（8 个技能按钮）
├── data/                  # 设计数值规格（JSON，非图片/音频）
│   ├── element_matrix.json    # 五元素克制环 / 倍率 / 配色 / 克制理由
│   ├── skill_cooldowns.json   # 8 技能 冷却/法力/元素/类型
│   ├── wave_design.json       # 10 关 × 多波次敌种组合 + 元素分布
│   ├── boss_phases.json       # 森林古木三阶段 Boss 脚本（baseHp 200，3 阶段）
│   ├── reactions.json         # 五元素反应系统：10 组元素对 × 5 元素 × 7 状态
│   ├── upgrades.json          # 局内成长系统：24 张升级卡 × 4 稀有度 + 经验曲线 + 抽卡权重
│   ├── meta_upgrades.json     # 局外成长系统：18 项永久强化 × 5 类 + 几何成本曲线
│   └── economy.json           # 森灵币经济水槽模型：1 货币 / 4 产出 / 2 水槽 / 积压率 0.22
└── tools/
    ├── cutout.py          # 通用边缘洪水填充抠图（文件进/出）
    ├── build_showcase.mjs # 构建自包含展示页
    ├── build_index.py     # 生成 index.html（扫描真实目录，零依赖）
    ├── build_manifest.py  # 生成 manifest.json（扫描真实目录，零依赖）
    ├── synth_audio.py     # 音频合成（6 首 BGM：森林/战斗/BOSS/潮次涌动/精英遭遇/BOSS二阶段 + 24 个游戏事件音效）
    ├── gen_vfx.py         # VFX 特效生成（纯标准库）
    ├── build_vfx_demo.py  # 构建 VFX 内联展示页
    ├── gen_icons.py       # 状态图标生成（纯标准库，复用 gen_vfx.Canvas）
    ├── build_icons_demo.py# 构建状态图标内联展示页
    ├── gen_skill_icons.py # 技能 / 元素图标生成（纯标准库，hexplate + panel 双底盘）
    ├── build_skill_icons_demo.py # 构建技能 / 元素图标内联展示页
    ├── build_element_chart.py # 由 data/*.json 生成元素克制环 + 倍率矩阵 + 冷却条参考页
    ├── build_wave_chart.py   # 由 data/wave_design.json + data/boss_phases.json 生成关卡/Boss 参考页
    ├── build_reaction_chart.py # 由 data/reactions.json 生成 5×5 反应矩阵 + 反应卡 + 状态图例参考页
    ├── build_upgrade_chart.py  # 由 data/upgrades.json 生成 经验曲线 + 权重缩放 + 24 张升级卡参考页
    └── build_meta_chart.py    # 由 data/meta_upgrades.json + data/economy.json 生成 经济水槽 + 永久强化参考页
```

## 4. 接入游戏路径（待主文件释放后）

> 主文件 `game/萌兽消消岛.html` 当前为争议文件（含未提交改动），本包**不触碰**。以下步骤在主文件可编辑时执行。

1. **贴图入库**（二选一）：
   - **方案 A（文件流，推荐）**：把 `sprites_alpha/*.webp` 复制到 `game/assets/enemies/`，与现有 `hero_*`/`gem_*` 同管理；在加载清单中登记 6 个 key。
   - **方案 B（内联流）**：用 `ci/batch-inject.js` 将 6 张 base64 注入 `AI_ART_TABLE`（主文件现有机制）。
2. **敌人数据扩展**：在主文件的敌种/波次表中为上述 6 个 key 登记 `elem / type / hp / spd / trait`，复用现有 `makeEnemySprite` 与 `buildSprites` 管线（其 `drawImage(aiA,…,aiD,aiD)` 拉伸逻辑与图片尺寸无关，接入不改变显示尺寸）。
3. **音效映射**（复用仓库已就位的 29 音源集，无需新生成）：
   - 出场/受击/死亡 → `sfx_start / sfx_hurt / sfx_kill`
   - 分裂/进化/拾取 → `sfx_evo / sfx_evo / sfx_gem, sfx_chest`
   - 灼烧/水弹/俯冲命中 → `sfx_hit, sfx_fire`
   - 棉花羊回血 → `sfx_revive` 或 `sfx_cardshow`
4. **BGM 关联**：森林系萌兽推荐主战场 BGM 复用 `bgm_meadow`（已升级）；若新增“森林”主题，可用 `bgm_abyss / bgm_horde` 做精英/潮次变体。

## 5. 音乐与音效设计建议（文本方案，待接线）

仓库 `game/audio/` 已存在完整 29 音源集（10 BGM + 19 SFX，约 7.10MB，其中 8 个已升级、21 个新增待接线）。本内容包**接入主游戏时**的音乐策略是**复用现有集，不新增音频文件**，避免与主文件音频接线冲突（§2.1 在 `_content_pack/audio/` 独立命名空间另做了 19 条原型，仅作占位与试听，不进入主游戏音频表）：

- **基调**：森灵主题 = 明亮五声音阶 + 轻快木管，与 `bgm_meadow` 风格对齐。
- **战斗张力**：用 `bgm_horde`（潮次）做高压段落，`bgm_win / bgm_lose` 做结算。
- **角色音色联想**：芽芽兔=木琴拨奏；火苗狐=短促火焰噪声+高频；水滴蛙=水滴合成音；石甲龟=低频脉冲；星羽鸟=铃铛颤音；棉花羊=柔和 pad。
- **落地前提**：上述 BGM/SFX 当前为未跟踪文件，需在主文件音频接线（gains/sfxFiles/DATA_SFX 四方一致）完成后才能发声；本包仅提供映射建议，不改动任何音频或主文件。

## 6. 验证记录

- 贴图：8/8 生成成功（6 萌兽 + Boss 森林古木 + Hero 灵鹿祭司）；8/8 透底为 RGBA；小兵/宠物 512²、Boss/Hero 1024²；展示页内联校验通过（8 张 `data:image/webp`）。
- 音频：35/35 合成成功并校验——峰值均 85%（未削波），RMS 13.4%–30.0%（非空非静音）；试听页 `audio_demo.html` 数据驱动网格覆盖全部 35 条（6 BGM + 29 SFX），引用相对路径可双击播放。
- VFX：24/24 程序化生成成功并校验——均为 `colorType=6` RGBA，非空白像素占比 8%–64%（锐利型稀疏、辉光型饱满），透明区正确保留；展示页内联校验通过（24 张 `data:image/png`）。
- 状态图标：12/12 程序化生成成功并校验——均为 `colorType=6` RGBA（64×64），体积 1.46KB–2.52KB（实心徽章 + 白色符号，内容饱满非空白）；按 控制 / 持续伤害 / 负面 / 增益 四组分类，与 24 个 VFX 爆发特效共同构成「状态机制」视觉闭环；试看页 `icons_demo.html` 内联校验通过（12 张 `data:image/png`）。
- 技能 / 元素图标：13/13 程序化生成成功并校验——均为 `colorType=6` RGBA（64×64），体积 1.6KB–4.6KB；逐张目检通过（叶片轴与中脉同向、星芒可见、面板元素色可辨、六边符印与圆盘/方面板三底盘不混淆）；试看页 `skill_icons_demo.html` 内联校验通过（13 张 `data:image/png`）。
- 清单：`manifest.json` 由 `tools/build_manifest.py` 扫描真实目录生成（零依赖），含 8 精灵（尺寸 / PNG+WebP 体积）、24 VFX（尺寸 / 体积）、12 状态图标（尺寸 / 体积）、13 技能/元素图标（尺寸 / 体积 / 分组）、4 设计数值 JSON（字节数）、35 音频（格式 / 采样率 / 时长）；为 §4 接入主游戏的「脚本化索引」提供机器可读依据。
- 设计数值：`data/element_matrix.json`、`data/skill_cooldowns.json`、`data/wave_design.json`、`data/boss_phases.json` 均为合法 JSON（`json.load` 通过）；`element_chart.html` 由 `tools/build_element_chart.py` 数据驱动生成，校验含 `<svg>` 节点、5×5 倍率矩阵（6 行）、8 技能冷却条；`wave_chart.html` 由 `tools/build_wave_chart.py` 数据驱动生成，校验含 10 关卡片、难度曲线柱状、BOSS HP 三段分段条、3 阶段能力卡 + 冷却压缩对比；五元素 5 环克制链对称（火→木→土→水→光→火），与 §2.4 元素徽章「强克」文案一致；关卡/Boss 规格与 §2.5 克制链、敌种表对齐（教学关单元素 → 后期逼迫切元素；Boss 三阶段随血量压缩冷却）。
- 可玩校验：`boss_arena.html` 为 `data/boss_phases.json` 三阶段脚本的可玩校验场，内联 `<script>` 经 `node --check` 语法校验通过（file:// 双击可用，无 fetch）；阶段阈值（66% / 33%）、能力冷却（随阶段压缩）、召唤增援（阶段登场 + 每 8s 周期混召，6 只上限）与规格逐一对应；英雄/BOSS 血条独立，元素克制倍率（火 强克 木 Boss ×1.6）接入 §2.5 矩阵，复用 `sprites_alpha`/`vfx`/`audio` 真实资产。
- 可玩校验：`campaign.html` 为 `data/wave_design.json` 10 关 × 多波次的可玩校验场，内联 `<script>` 经 `node --check` 语法校验通过（file:// 双击可用，无 fetch）；逐关逐波刷怪（清空一波→下一波、清空一关→下一关）、元素聚焦 HUD、弱点提示（`counterOf()` 算最强克元素）、过关计分 + levelup、失败自动重试本关；内联 `WAVE` 数据已与 `wave_design.json` 逐项比对一致（6 敌种 key/hp/element、10 关 id/波次数/每关总敌数 均无漂移）；第 10 关含 Boss（森林古木 200HP 木）按 §2.6 高 HP 木敌呈现；元素克制倍率接入 §2.5 矩阵，复用 `sprites_alpha`/`vfx`/`audio` 真实资产。
- 演练场机制深化：`playground.html` 已接入五元素系统——每个敌种带 `element` 属性并显示元素徽章，玩家选攻击元素后伤害按 `element_matrix.json` 倍率结算（强克 ×1.6 / 被克 ×0.6 / 同元素 ×0.85 / 中性 ×1.0），并启用该元素代表技能的冷却（`skill_cooldowns.json` 数据）；命中飘字显示克制倍率。脚本经 `node --check` 语法校验通过（内联数据，file:// 双击可用，无需 fetch）。
- 元素反应系统：`data/reactions.json` 为合法 JSON（C(5,2)=10 对全覆盖、无多余、status 引用均存在，`fire+water` 增幅类状态为 null 符合设计）；`reaction_chart.html` 由 `tools/build_reaction_chart.py` 数据驱动生成，校验 0 占位符、10 反应名全在、7 状态图标路径均存在；`reaction_lab.html` 为可玩实验室，内联 `<script>` 经 `node --check` 语法校验通过（file:// 双击可用，无 fetch），内联 `REACT`/`STATUS`/`ELEMENTS` 已与 `reactions.json` 逐项比对一致（5 元素 / 7 状态 / 10 反应 均无漂移），逆触发 +20% 状态时长已在 `applyStatus` 真正生效；7 状态全部映射到既有 `icons/st_*.png` + `fx_*`/`cp_sfx_*` 资产（零新资产）。
- 局内成长系统：`data/upgrades.json` 为合法 JSON（24 张升级卡：普通 5 / 稀有 11 / 史诗 6 / 传说 2，每张含 rarity / maxStacks / tags / effects / icon / sfx）；24 张卡的 icon / sfx 引用经 `os.path.exists` 核验零缺失；`upgrade_chart.html` 由 `tools/build_upgrade_chart.py` 数据驱动生成，校验 0 占位符、含 `<svg>`、24 张卡名全在、19 个图标引用均存在；`upgrade_lab.html` 为可玩实验室，内联 `<script>` 经 `node --check` 语法校验通过（file:// 双击可用，无 fetch），内联 `UP`/`RARITY`/`LEVELUP`/`CURVE` 已与 `upgrades.json` 逐项比对一致（24 卡 / 4 稀有度 / 抽卡规则 / 经验曲线 均无漂移）。
- 局外成长系统：`data/meta_upgrades.json` 为合法 JSON（18 项永久强化：基础 5 / 元素 5 / 经济 3 / 生存 2 / 解锁 3，每项含 category / maxLevel / cost{base,growth} / effects / icon）；18 项 icon / sfx 引用经 `os.path.exists` 核验零缺失；`meta_chart.html` 由 `tools/build_meta_chart.py` 数据驱动生成，校验 0 占位符、含 `<svg>`、18 项名全在、16 个图标引用均存在；`meta_lab.html` 为可玩实验室，内联 `<script>` 经 `node --check` 语法校验通过（file:// 双击可用，无 fetch），内联 `MU`/`EC` 已与 `meta_upgrades.json`/`economy.json` 逐项比对一致（18 项 / 积压率 0.22 均无漂移）。
- 经济系统：`data/economy.json` 经 `game-economy` 技能 `check` 校验 E1–E4 全 PASS（货币 1 / 产出入口 4 / 回收水槽 2 / 积压率 0.22 ≤ 0.3）；内部自洽（faucets 求和=total_faucet 41,946、drains 求和=total_drain 32,718、积压率=(产出-消耗)/产出 一致、drains 与 meta_upgrades 总成本跨表一致），经济不通胀、不枯竭。
- 不变量：未触碰 `game/萌兽消消岛.html` 及任何 GROK 相关文件；所有产物位于 `_content_pack/` 独立命名空间。

## 7. 后续内容方向（规划中，下一轮执行）

本内容包已覆盖**美术（8 张精灵）+ 音乐（6 首 BGM + 29 SFX）+ 特效（24 个 VFX）+ 状态图标（12 个）+ 技能/元素图标（13 个）+ 图鉴（codex）+ 设计数值规格（8 份 JSON）+ 可视化参考页与可玩校验场（5 参考页 + 3 实验室 + 竞技场 + 战役 + 演练场）**八大支柱。下一轮继续在独立命名空间扩展：

1. ~~**森林主题 BGM 原型**~~ ✅ 已交付 `cp_bgm_forest.wav`（无缝循环 35.6s）。
2. ~~**战斗 / BOSS 主题 BGM 原型**~~ ✅ 已交付 `cp_bgm_battle.wav`（128 BPM 驱动，30.0s）+ `cp_bgm_boss.wav`（92 BPM 厚重史诗小调，31.3s），三首 BGM 形成「探索→交战→首领」情绪曲线。
3. ~~**游戏事件音效库（19 个 SFX）**~~ ✅ 已交付 `cp_sfx_summon / heal / hit / kill / levelup / pickup / hurt / evolve / win / lose / ui.wav` + 音画配套 5 条（`explosion / dash / portal / coin / warning`，与 fx_explosion·fx_dash_trail·fx_portal·fx_coin_burst·fx_telegraph 成套）+ 状态机制 3 条（`freeze / buff / debuff`，与 fx_freeze_shatter·fx_buff·fx_debuff 成套）；试听页 `audio_demo.html` 升级为数据驱动网格（22 条）。
4. ~~**VFX 精灵包**~~ ✅ 已交付 21 个程序化 RGBA 特效（10 基础：命中火花/火球/护盾泡/治疗光环/斩击弧/星爆/霜晶/升级星环/拾取闪光/毒云；+5 战斗向：大爆裂/雷击/治疗爆发/冲刺残影/预警圈；+3 通用向：冲击波环/召唤门/金币迸发；+3 机制向：冰碎/增益光环/减益光环）+ `vfx_demo.html` 试看页（21 张）。
5. ~~**角色图鉴 Codex**~~ ✅ 已交付 `codex.html`（8 角色背景/属性/对策 + 元素克制环）。
6. **更多敌种/英雄（待云端出图恢复）**：原计划经云端 Miora 文生图扩种（雷羽鹰/霜甲熊/焰心术士等以补齐元素），但本环境 `miora_text_to_image` 暂不可用；将在云端图像生成恢复后继续，沿用同一 chibi 语言 + 抠图流程。
7. **音频接线桥接（待主文件释放）**：当 `game/萌兽消消岛.html` 可编辑时，将 `cp_*` 三条原型音轨以「独立 key」登记进 `sfxFiles/DATA_SFX`（不影响现有 29 音源集），实现零冲突接入。
8. ~~**内容包总览入口页**~~ ✅ 已交付 `index.html`（扫描真实目录生成，导航 showcase/vfx_demo/audio_demo/codex 四页 + 资产清单 8 精灵/21 VFX/22 音频，零依赖、不卡机）。
9. ~~**机器可读资产清单 manifest.json**~~ ✅ 已交付 `manifest.json`（tools/build_manifest.py 扫描生成，含贴图尺寸 / 双格式体积、VFX 尺寸、音频格式与时长，零依赖），为 §4 接入步骤提供脚本化索引。
10. ~~**实战演练场 playground.html**~~ ✅ 已交付 `playground.html`（纯前端，用真实资产搭的迷你战斗场景：点击萌兽触发 fx_hit_spark/fx_slash/fx_star + cp_sfx_hit/kill、击杀播 fx_explosion/fx_coin_burst + cp_sfx_kill/coin/win、可开 cp_bgm_forest 循环；验证内容包「美术+音乐+特效」三支柱可用性，规避死资产）。
11. ~~**状态机制音画闭环**~~ ✅ 已交付 `cp_sfx_freeze / buff / debuff.wav`（3 条），与 Round-14 的 `fx_freeze_shatter / fx_buff / fx_debuff` 三特效成套；`synth_audio.py` 加 3 合成函数、`audio_demo.html` 加 3 试听卡（共 22 条）、README/manifest 同步；VFX↔SFX 全机制配对补齐。
12. ~~**状态图标（常驻 HUD 指示）**~~ ✅ 已交付 12 个程序化 RGBA 状态图标（`st_freeze / st_stun / st_burn / st_poison / st_bleed / st_slow / st_mark / st_atk_up / st_def_up / st_haste / st_heal / st_shield`），覆盖 控制 / 持续伤害 / 负面 / 增益 四组；`tools/gen_icons.py`（复用 gen_vfx.Canvas）+ `tools/build_icons_demo.py` 产出分组展示页；与 VFX（触发瞬间）+ SFX（听觉反馈）共同补全「状态机制」的视觉闭环，使内容包从「爆发特效」升级到「持续状态可视化」。
13. ~~**BGM 升级变体（音乐深化·wave→elite→boss 听觉层次）**~~ ✅ 已交付 3 首升级层 BGM：`cp_bgm_tide.wav`（116 BPM 森林主题升级层，潮涌 LFO，常规波次涌动感）、`cp_bgm_elite.wav`（124 BPM 紧张对立项，低音 drone+小二度摩擦 ostinato+警报 ping，精英来袭不安张力）、`cp_bgm_boss2.wav`（124 BPM 狂暴对立项，四踩底鼓+双倍贝斯+八度叠加锯齿 lead+升半音转调，Boss 二阶段狂暴）；`synth_audio.py` 加 3 合成函数（复用 kick/clap/snare/hat 鼓组与 bass/lead/pad 骨架并提升紧张度）、`audio_demo.html` 加 3 试听卡（共 25 条）、README/manifest/index 同步；6 首 BGM 形成「探索→交战→首领→潮次涌动→精英→二阶段」完整情绪曲线。
14. ~~**元素克制听觉/视觉签名（五元素系统补全）**~~ ✅ 已交付 3 个缺失元素的命中 VFX（水花 / 碎石 / 叶爆，128² RGBA 真透底，程序化生成）与 5 个元素命中音效（火/水/土/光/木，0.22s–0.34s，纯标准库合成），补足原 fx_fireball/fx_lightning/fx_frost 仅覆盖火/光/冰、缺 水/土/木 的空白；`gen_vfx.py` 加 3 特效函数、`synth_audio.py` 加 5 合成函数、`audio_demo.html` 加 5 试听卡（共 30 条）、`vfx_demo.html` 加 3 展示卡、README/manifest/index 同步；五元素命中反馈（视觉 VFX + 听觉 SFX）全配对，为后续按元素分发伤害与克制倍率提供素材基础。
15. ~~**技能 / 元素图标（英雄技能栏 + 五元素身份 UI）**~~ ✅ 已交付 13 个程序化 RGBA 图标（`skill_icons/`）：5 个元素徽章（`el_fire/water/earth/light/wood`，六边符印底盘，与 R18 元素命中 VFX/SFX 构成「元素身份→命中反馈」闭环）+ 8 个技能按钮（`ab_fireball/heal/frost/chain/vine/quake/dash/summon`，圆角方面板底盘，覆盖 火球/治疗/霜冻/链雷/藤缚/地震/瞬步/召唤）；`tools/gen_skill_icons.py`（hexplate + panel 双底盘 + 4 新符号）+ `tools/build_skill_icons_demo.py` 分组展示页；与状态图标（圆牌）形成「圆牌=状态 / 六边=元素 / 方板=技能」三系 UI 语言；生成期发现 el_fire 与 st_burn 同盘同色同符号的视觉重复，已通过底盘去重解决。
16. ~~**元素克制与技能数值（设计规格）**~~ ✅ 已交付 2 份设计数值 JSON（`data/element_matrix.json` 五元素 5 环克制链 + 倍率 + 配色 + 克制理由；`data/skill_cooldowns.json` 8 技能冷却/法力/元素/类型）+ 数据驱动可视化参考页 `element_chart.html`（五边形克制环 SVG + 5×5 倍率矩阵 + 8 技能冷却条）；`tools/build_element_chart.py` 读 JSON 纯标准库渲染，零依赖、不卡机；与 §2.4 元素身份 UI、R18 元素命中反馈三件套在规则与视觉层对齐，为 §4 接入主游戏时的伤害公式与技能节奏提供数据底座。
17. ~~**演练场机制深化（playground 接入元素系统）**~~ ✅ `playground.html` 已升级为「机制演示」：6 敌种带 `element` 属性 + 元素徽章；玩家选攻击元素 → 伤害按 `element_matrix.json` 倍率结算（强克 ×1.6 / 被克 ×0.6 / 同元素 ×0.85 / 中性 ×1.0）并显示克制飘字；启用该元素代表技能冷却（`skill_cooldowns.json` 数据，按钮带实时倒计时遮罩）；`node --check` 语法校验通过，内联数据保证 file:// 双击可用。内容包从「资产可用性演示」进化为「元素克制规则可玩预览」。

18. ~~**五元素主题动机（元素身份听觉签名 · 音乐侧闭合）**~~ ✅ 已交付 5 条五元素主题动机（`cp_sfx_elem_fire/water/earth/light/wood`，4.00s–5.71s，纯标准库合成，无缝短循环）：火=明亮上行五声 sparkle、水=柔 sine 涟漪滑音+气泡、土=厚重低频脉冲、光=闪亮铃音琶音+shimmer、木=有机叩击 rustle。它们与 R18 的「元素命中 SFX（cp_sfx_hit_*）」定位不同——命中 SFX 是战斗瞬时反馈，主题动机是**元素身份的长期听觉签名**；二者共同构成「五元素听觉系统」的层次。`synth_audio.py` 加 `_loop_crossfade` 辅助 + 5 合成函数、`audio_demo.html` 加 5 试听卡（共 35 条）、`playground.html` 在选攻击元素时播对应动机作提示、`README/manifest/index` 同步；audio 30→35（6 BGM + 29 SFX），为 §4 接入主游戏时按元素分发 BGM/提示音提供素材底座。

19. ~~**关卡波次与 BOSS 多阶段（设计规格 · 关卡/Boss 数据底座）**~~ ✅ 已交付 2 份设计数值 JSON（`data/wave_design.json` 10 关 × 多波次敌种组合 + 元素分布，难度曲线 单元素教学→双元素混编→五元素精英→BOSS；`data/boss_phases.json` 森林古木三阶段脚本，baseHp 200，阈值 66%/33%，冷却随阶段压缩 + 混召多属性增援）+ 数据驱动可视化参考页 `wave_chart.html`（关卡地图卡片 + 难度曲线柱状 + BOSS HP 三段分段条 + 3 阶段能力卡 + 冷却压缩对比）；`tools/build_wave_chart.py` 读两份 JSON 并复用 `data/element_matrix.json` 五元素配色纯标准库渲染，零依赖、不卡机；与 §2.5 克制链、敌种表对齐，为 §4 接入主游戏时的波次生成与 Boss AI 状态机提供数据底座。

20. ~~**BOSS 竞技场（Boss 阶段脚本 · 可玩校验场）**~~ ✅ 已交付 `boss_arena.html`（纯前端，`file://` 双击即开，无 fetch）：把 §2.6 的 `data/boss_phases.json` 三阶段真跑起来的迷你 Boss 战——Boss 按 `hpLow`（66%/33%）切阶段、每阶段 `abilities` 按各自 `cooldown` 在 250ms tick 自动释放（藤蔓召唤→范围践踏→藤蔓缠绕+木刺喷射→古木狂暴，后期冷却压缩）、`summon` 在阶段登场与每 8s 周期混召（6 只上限）；玩家选攻击元素后伤害按 §2.5 `element_matrix.json` 倍率结算（火 强克 木 Boss ×1.6）。资产复用 `sprites_alpha`（灵鹿祭司/森林古木/芽芽兔/火苗狐/星羽鸟）+ `vfx/fx_telegraph` 预警圈 + `cp_sfx_hit_*`/`cp_sfx_win/lose`；内联 `<script>` 经 `node --check` 语法校验通过；`index.html` 加 🌳 导航卡、`README` §2.7/§3/§6/§7 同步。设计规格→可视化→可玩校验 闭环，为 §4 接入主游戏时的 Boss AI 提供端到端验证样本。

21. ~~**战役模式（关卡波次 · 可玩校验场）**~~ ✅ 已交付 `campaign.html`（纯前端，`file://` 双击即开，无 fetch）：把 §2.6 的 `data/wave_design.json` 10 关 × 多波次真跑起来的关卡流程 demo——逐关逐波刷怪（清空一波→下一波、清空一关→下一关）、元素聚焦 HUD、弱点提示（`counterOf()` 算最强克元素，强克 ×1.6）、过关按 `lv.id*10` 计分 + levelup、失败后自动重试本关；第 10 关含 Boss（森林古木 200HP 木，弱火）按 §2.6 高 HP 木敌呈现。内联 `<script>` 经 `node --check` 语法校验通过；内联 `WAVE` 数据已与 `wave_design.json` 逐项比对一致（敌种 key/hp/element、10 关 id/波次数/每关总敌数均无漂移）；11 项引用资产（6 精灵 png + 5 vfx png + 12 音频 wav）路径核验存在，无断裂引用；`index.html` 加 🗺️ 导航卡、`README` §2.8/§3/§6/§7 同步。与 `boss_arena.html` 共同构成「设计规格→可视化→可玩校验」双闭环，为 §4 接入主游戏时的波次生成器与逐波推进状态机提供端到端验证样本。

22. ~~**元素反应系统（设计规格 + 可玩实验室）**~~ ✅ 已交付 `data/reactions.json`（五元素反应系统规格：5 元素 / 7 状态 / 10 组元素对；增幅类按触发方向倍率、聚变类附著状态，顺/逆以元素名字母序判定、逆触发 +20% 状态时长）+ 数据驱动可视化 `reaction_chart.html`（5×5 反应矩阵 + 10 反应卡 + 7 状态图例）+ 可玩实验室 `reaction_lab.html`（纯前端 `file://` 双击即开，把规格真跑起来：附著→触发结算增幅/聚变、逆触发 +20% 时长可见、状态 HUD 实时倒计时）。`tools/build_reaction_chart.py` 读 JSON 纯标准库渲染（零依赖、不卡机）；7 状态全部映射到既有 `icons/st_*.png` + `fx_*`/`cp_sfx_*` 资产（零新资产）；`data/reactions.json` 合法 JSON（C(5,2)=10 对全覆盖），`reaction_lab.html` 内联数据与 JSON 逐项比对一致（5 元素 / 7 状态 / 10 反应 均无漂移）、内联脚本 `node --check` 语法校验通过；`index.html` 加 ⚗️ 导航卡、`README` §2.9/§3/§6/§7 同步。在 §2.5 五元素克制链 + §2.3 状态图标 + §2.1 状态音效 基础上接入「元素反应」新设计支柱，为 §4 接入主游戏时的反应结算与状态机提供端到端验证样本。

23. ~~**局内成长系统（设计规格 + 可玩实验室）**~~ ✅ 已交付 `data/upgrades.json`（24 张升级卡 × 4 稀有度；抽 3 选 1、稀有度权重随等级缩放、叠层上限、二次经验曲线至 Lv.20）+ 数据驱动可视化 `upgrade_chart.html`（经验曲线 SVG + 权重缩放表 + 流派标签分布 + 分层卡组）+ 可玩实验室 `upgrade_lab.html`（纯前端 `file://` 双击即开：自动攻击累积经验 → 升级弹三选一 → 选卡立刻改变属性面板与 DPS，验证「构筑是否真带来成长」）。`tools/build_upgrade_chart.py` 读 JSON 纯标准库渲染（零依赖、不卡机）；三类乘区分明（元素专精 5 卡 / 反应连锁 4 卡 / 生存续航 5 卡 / 功能 5 卡），与 §2.5 克制链、§2.9 元素反应一一联动；24 张卡通通复用既有 `icons/st_*` + `skill_icons/el_*·ab_*` + `vfx/fx_*` + `cp_sfx_*` 资产（零新资产）；`upgrade_lab.html` 内联数据与 JSON 逐项比对一致、内联脚本 `node --check` 通过；`index.html` 加 🎲 导航卡、`README` §2.10/§3/§6/§7 同步。填补内容包长期缺失的一环（此前有波次 / Boss / 元素 / 反应，独缺局内成长），为 §4 接入主游戏时的升级流程与构筑系统提供端到端验证样本。

24. ~~**局外成长系统（设计规格 + 可玩实验室）**~~ ✅ 已交付 `data/meta_upgrades.json`（18 项永久强化 × 5 类：基础属性 / 元素亲和 / 经济加成 / 生存续航 / 英雄解锁；几何成本 `cost(l)=round(base*growth^(l-1))`）+ `data/economy.json`（森灵币产出-消耗水槽模型：1 货币 / 4 产出入口 / 2 回收水槽 / 积压率 0.22）+ 数据驱动可视化 `meta_chart.html`（积压率仪表 SVG + 五类总消耗对比 + 18 项强化卡组）+ 可玩实验室 `meta_lab.html`（纯前端 `file://` 双击即开：本局自动战斗 20s 赚币 → 局外大厅买永久强化 → 下一局伤害/生命/金币收益更高，验证「跨局养成」闭环）。`tools/build_meta_chart.py` 读两份 JSON 纯标准库渲染（零依赖、不卡机）；经济表经 `game-economy` 技能 `check` E1–E4 全 PASS（积压率 0.22 < 0.3 健康）；18 项复用既有 `icons/`+`skill_icons/`+`vfx/`+`sprites/`+`cp_sfx_*` 资产（零新资产，英雄解锁项用现有精灵作占位图待云端出图替换）；`meta_lab.html` 内联数据与 JSON 逐项比对一致、内联脚本 `node --check` 通过；`index.html` 加 🌱 导航卡、`README` §2.11/§3/§6/§7 同步。与 §2.10 局内成长共同构成幸存品类「局内构筑 + 局外养成」双层循环，为 §4 接入主游戏时的局外养成与货币系统提供端到端验证样本。
> 风格对齐原则：新音乐与音效仅作**原型与占位**，待主文件音频接线（gains/sfxFiles/DATA_SFX 四方一致）完成后，再决定是否替换为制作级音轨，绝不在争议文件上擅自接线。
