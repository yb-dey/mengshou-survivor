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

| 文件 | 用途 | 规格 | 时长 |
|---|---|---|---|
| `audio/cp_bgm_forest.wav` | 森林主题 BGM（循环） | 44.1k/16bit 单声道，柔 pad+三角波 lead+轻贝斯+铃+软底鼓，无缝循环 | 35.6s |
| `audio/cp_sfx_summon.wav` | 召唤音效（Boss 召唤藤蔓 / 英雄召唤） | 同上，上行魔法琶音+微光泛音 | 0.92s |
| `audio/cp_sfx_heal.wav`  | 治疗音效（英雄星辉治疗 / 净化） | 同上，暖色上行和弦 swell | 1.38s |

- **合成方式**：`tools/synth_audio.py`（纯 Python 标准库，零依赖、零生成额度、不卡机），确定性种子可复现。
- **试听页**：`audio_demo.html` 引用相对路径 `audio/*.wav`，双击即听，同样规避死资产。
- **校验**：三曲峰值均 = 85%（未削波），RMS 15.9% / 22.3% / 23.6%（非空、非静音）。

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

- **生成器**：`tools/gen_vfx.py`（仅标准库：自写 PNG 写出 + 加性辉光/柔边环/放射尖刺），`tools/build_vfx_demo.py` 产出内联展示页。
- **试看页**：`vfx_demo.html`（7 张 base64 内联，深色背景 + CSS 动效，双击即看）。
- **校验**：7/7 均为 `colorType=6` RGBA；非空白像素占比 8%–64%（锐利型如斩击/星爆稀疏、辉光型饱满），透明区域正确保留。

## 3. 目录结构

```
_content_pack/
├── README.md              # 本文件
├── showcase.html          # 自包含展示页（精灵已内联，8 张）
├── audio_demo.html        # 音频试听页（引用 audio/*.wav）
├── vfx_demo.html          # VFX 试看页（PNG base64 内联，7 个）
├── sprites/               # 原始生成图（RGB，未抠）
│   └── <key>.png
├── sprites_alpha/         # 透底资产（RGBA，游戏可直接用）
│   └── <key>.png / <key>.webp
├── audio/                 # 本包专属音频原型（独立命名空间，零接线）
│   ├── cp_bgm_forest.wav
│   ├── cp_sfx_summon.wav
│   └── cp_sfx_heal.wav
├── vfx/                   # 程序化特效精灵（RGBA 真透底）
│   └── fx_*.png（7 个）
└── tools/
    ├── cutout.py          # 通用边缘洪水填充抠图（文件进/出）
    ├── build_showcase.mjs # 构建自包含展示页
    ├── synth_audio.py     # 森林 BGM + 召唤/治疗音效合成
    ├── gen_vfx.py         # VFX 特效生成（纯标准库）
    └── build_vfx_demo.py  # 构建 VFX 内联展示页
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

仓库 `game/audio/` 已存在完整 29 音源集（10 BGM + 19 SFX，约 7.10MB，其中 8 个已升级、21 个新增待接线）。本内容包的音乐策略是**复用现有集，不新增音频文件**，避免与主文件音频接线冲突：

- **基调**：森灵主题 = 明亮五声音阶 + 轻快木管，与 `bgm_meadow` 风格对齐。
- **战斗张力**：用 `bgm_horde`（潮次）做高压段落，`bgm_win / bgm_lose` 做结算。
- **角色音色联想**：芽芽兔=木琴拨奏；火苗狐=短促火焰噪声+高频；水滴蛙=水滴合成音；石甲龟=低频脉冲；星羽鸟=铃铛颤音；棉花羊=柔和 pad。
- **落地前提**：上述 BGM/SFX 当前为未跟踪文件，需在主文件音频接线（gains/sfxFiles/DATA_SFX 四方一致）完成后才能发声；本包仅提供映射建议，不改动任何音频或主文件。

## 6. 验证记录

- 贴图：8/8 生成成功（6 萌兽 + Boss 森林古木 + Hero 灵鹿祭司）；8/8 透底为 RGBA；小兵/宠物 512²、Boss/Hero 1024²；展示页内联校验通过（8 张 `data:image/webp`）。
- 音频：3/3 合成成功并校验——峰值均 85%（未削波），RMS 15.9% / 22.3% / 23.6%（非空非静音）；试听页引用相对路径可双击播放。
- VFX：7/7 程序化生成成功并校验——均为 `colorType=6` RGBA，非空白像素占比 8%–64%（锐利型稀疏、辉光型饱满），透明区正确保留；展示页内联校验通过（7 张 `data:image/png`）。
- 不变量：未触碰 `game/萌兽消消岛.html` 及任何 GROK 相关文件；所有产物位于 `_content_pack/` 独立命名空间。

## 7. 后续内容方向（规划中，下一轮执行）

本内容包已覆盖**美术（8 张精灵）+ 音乐（BGM + 2 SFX）**双支柱。下一轮继续在独立命名空间扩展：

1. ~~**森林主题 BGM 原型**~~ ✅ 已交付 `cp_bgm_forest.wav`（无缝循环 35.6s）。
2. ~~**新 creature 行为音效**~~ ✅ 已交付 `cp_sfx_summon.wav` / `cp_sfx_heal.wav`。
3. ~~**VFX 精灵包**~~ ✅ 已交付 7 个程序化 RGBA 特效（命中火花/火球/护盾泡/治疗光环/斩击弧/星爆/霜晶）+ `vfx_demo.html` 试看页。
4. **更多敌种/英雄**：按同一 chibi 语言与抠图流程持续扩充图鉴。
5. **音频接线桥接（待主文件释放）**：当 `game/萌兽消消岛.html` 可编辑时，将 `cp_*` 三条原型音轨以「独立 key」登记进 `sfxFiles/DATA_SFX`（不影响现有 29 音源集），实现零冲突接入。

> 风格对齐原则：新音乐与音效仅作**原型与占位**，待主文件音频接线（gains/sfxFiles/DATA_SFX 四方一致）完成后，再决定是否替换为制作级音轨，绝不在争议文件上擅自接线。
