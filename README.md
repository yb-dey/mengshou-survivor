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
- **试听页**：`audio_demo.html` 引用相对路径 `audio/*.wav`，双击即听，同样规避死资产；现已改为数据驱动网格，覆盖全部 25 条（6 BGM + 19 SFX）。
- **校验**：25/25 峰值均 = 85%（未削波），RMS 13.4%–30.0%（非空、非静音）；6 首 BGM（35.6s / 30.0s / 31.3s / 33.1s / 31.0s / 23.2s）无缝循环，19 个 SFX 0.06s–1.38s 覆盖战斗全事件与音画配套特效。

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

- **生成器**：`tools/gen_vfx.py`（仅标准库：自写 PNG 写出 + 加性辉光/柔边环/放射尖刺），`tools/build_vfx_demo.py` 产出内联展示页。
- **试看页**：`vfx_demo.html`（21 张 base64 内联，深色背景 + CSS 动效，双击即看）。
- **校验**：21/21 均为 `colorType=6` RGBA；非空白像素占比 8%–64%（锐利型如斩击/星爆稀疏、辉光型饱满），透明区域正确保留；涵盖命中/弹道/护盾/治疗/斩击/星爆/霜/升级/拾取/毒/爆炸/雷/群疗/位移/预警/冲击波/召唤门/金币/冰碎/增益/减益等全机制。

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
├── sprites/               # 原始生成图（RGB，未抠）
│   └── <key>.png
├── sprites_alpha/         # 透底资产（RGBA，游戏可直接用）
│   └── <key>.png / <key>.webp
├── audio/                 # 本包专属音频原型（独立命名空间，零接线，25 条）
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
│   └── cp_sfx_debuff.wav  # 减益 / 诅咒（配套 fx_debuff）
├── vfx/                   # 程序化特效精灵（RGBA 真透底）
│   └── fx_*.png（21 个）
├── icons/                 # 状态图标（RGBA 真透底，常驻 HUD 指示）
│   └── st_*.png（12 个）
└── tools/
    ├── cutout.py          # 通用边缘洪水填充抠图（文件进/出）
    ├── build_showcase.mjs # 构建自包含展示页
    ├── build_index.py     # 生成 index.html（扫描真实目录，零依赖）
    ├── build_manifest.py  # 生成 manifest.json（扫描真实目录，零依赖）
    ├── synth_audio.py     # 音频合成（6 首 BGM：森林/战斗/BOSS/潮次涌动/精英遭遇/BOSS二阶段 + 19 个游戏事件音效）
    ├── gen_vfx.py         # VFX 特效生成（纯标准库）
    ├── build_vfx_demo.py  # 构建 VFX 内联展示页
    ├── gen_icons.py       # 状态图标生成（纯标准库，复用 gen_vfx.Canvas）
    └── build_icons_demo.py# 构建状态图标内联展示页
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
- 音频：25/25 合成成功并校验——峰值均 85%（未削波），RMS 13.4%–30.0%（非空非静音）；试听页 `audio_demo.html` 数据驱动网格覆盖全部 25 条（6 BGM + 19 SFX），引用相对路径可双击播放。
- VFX：21/21 程序化生成成功并校验——均为 `colorType=6` RGBA，非空白像素占比 8%–64%（锐利型稀疏、辉光型饱满），透明区正确保留；展示页内联校验通过（21 张 `data:image/png`）。
- 状态图标：12/12 程序化生成成功并校验——均为 `colorType=6` RGBA（64×64），体积 1.46KB–2.52KB（实心徽章 + 白色符号，内容饱满非空白）；按 控制 / 持续伤害 / 负面 / 增益 四组分类，与 21 个 VFX 爆发特效共同构成「状态机制」视觉闭环；试看页 `icons_demo.html` 内联校验通过（12 张 `data:image/png`）。
- 清单：`manifest.json` 由 `tools/build_manifest.py` 扫描真实目录生成（零依赖），含 8 精灵（尺寸 / PNG+WebP 体积）、21 VFX（尺寸 / 体积）、12 状态图标（尺寸 / 体积）、25 音频（格式 / 采样率 / 时长）；为 §4 接入主游戏的「脚本化索引」提供机器可读依据。
- 不变量：未触碰 `game/萌兽消消岛.html` 及任何 GROK 相关文件；所有产物位于 `_content_pack/` 独立命名空间。

## 7. 后续内容方向（规划中，下一轮执行）

本内容包已覆盖**美术（8 张精灵）+ 音乐（6 首 BGM + 19 SFX）+ 特效（21 个 VFX）+ 状态图标（12 个）+ 图鉴（codex）**五支柱。下一轮继续在独立命名空间扩展：

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

> 风格对齐原则：新音乐与音效仅作**原型与占位**，待主文件音频接线（gains/sfxFiles/DATA_SFX 四方一致）完成后，再决定是否替换为制作级音轨，绝不在争议文件上擅自接线。
