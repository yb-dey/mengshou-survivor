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

## 2. 资产规格（已校验）

- **尺寸**：统一 512 × 512（`colorType=6` RGBA，已透底，非死白背景）。
- **双格式**：`sprites_alpha/` 下同时提供 `.png`（无损透明）与 `.webp`（q84 透明）。游戏接入推荐用 WebP（与主文件既有 hero/gem 一致）。
- **原始生成图**：`sprites/` 为 Miora 直出（RGB，未抠），保留备查。
- **抠图比例**：55%–65% 背景已清除（角色居中占比正常，未误删主体）。
- **展示页**：`showcase.html` 为**自包含单文件**（6 张精灵 base64 内联），双击即开，已实际“用上”资产，规避死资产陷阱。

## 3. 目录结构

```
_content_pack/
├── README.md              # 本文件
├── showcase.html          # 自包含展示页（精灵已内联）
├── sprites/               # 原始生成图（RGB，未抠）
│   └── <key>.png
├── sprites_alpha/         # 透底资产（RGBA，游戏可直接用）
│   └── <key>.png / <key>.webp
└── tools/
    ├── cutout.py          # 通用边缘洪水填充抠图（文件进/出）
    └── build_showcase.mjs # 构建自包含展示页
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

- 贴图：6/6 生成成功；6/6 透底为 RGBA；尺寸 512² 一致；展示页内联校验通过（6 张 `data:image/webp`）。
- 不变量：未触碰 `game/萌兽消消岛.html` 及任何 GROK 相关文件；所有产物位于 `_content_pack/` 独立命名空间。
