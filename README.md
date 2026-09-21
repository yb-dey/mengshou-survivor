# 萌兽消消岛 · 云端开发仓库

单文件 HTML5 游戏《萌兽消消岛》，零运行时依赖，双击即玩。

把**重活（浏览器渲染、构建、静态分析）外移到 GitHub 服务器**，本机只做轻活（文本编辑）。

| 能力 | 在哪跑 |
|---|---|
| 改代码（文本编辑） | 本机 |
| 浏览器验证 / 截图 / 采样 / 构建 / 分析 | **GitHub Actions（云端）** |
| 代码备份 | **GitHub 仓库（云端）** |

---

## 1. 目录

```
game/
  萌兽消消岛.html     内联母版（贴图 base64 全内联，双击即玩）
  assets/            AI 贴图（7 个精灵图集 / 2.17MB）
  audio/             BGM + SFX（25 个 wav / 6.80MB）
ci/                  云端脚本（在 Actions 上跑）
  out/               产物目录（截图 / 报告，git 忽略）
.github/workflows/   8 条流水线
dist/                外链分发版（由 ci/build-dist.js 生成，不手工改）
```

**三形态同步**（改任何一处都要横向对照）：

| 形态 | 生成方式 | 用途 |
|---|---|---|
| `game/萌兽消消岛.html` | **手改（真身）** | 双击即玩 / 微信小游戏内联 |
| `dist/` | `node ci/build-dist.js` | 外链分发（主包小、贴图音频走文件） |
| `deploy/` | `_qc/sync-deploy.js`（本地，仅发布时） | 线上发布目录 |

> ⚠️ **`dist/` 与 `deploy/` 都是生成物，不要手工编辑** —— 改完母版重新构建即可。

---

## 2. 流水线清单（8 条）

跑完在 Actions 页面下载对应 artifact。

| 流水线 | 触发 | 跑什么 | 守住什么 |
|---|---|---|---|
| **verify** | push main / 手动 | `ci/verify.mjs` 双通道（file:// 与 http:// 对照） | 页面无 JS 报错 + Canvas 非空白 |
| **verify-dist** | push main（改 game/ci）/ 手动 | build → 断言自包含 → 三形态复核 → 跟宠接线 → 验证 dist | **发布形态内容完整**（音频不许静默降级） |
| **art-audit** | 手动 | `ci/art-audit.mjs` 导出美术联系表 | 贴图是否真的被画出来 |
| **audio-audit** | 手动 | `ci/audio-audit.mjs`（音源创建可计数） | 音频格式 / 削波 / RMS / 循环接缝 |
| **fx-audit** | 手动 | `ci/fx-audit.mjs` 逐个触发特效钩子 + 帧间差对照 | 特效是否真的可见 |
| **screen-sweep** | 手动 | `ci/screen-sweep.mjs` 全界面巡检 + `screen-analyze.py` 端分析 | 哪一屏做得差（事实而非印象） |
| **death-frames** | 手动 | `ci/build-dead-frames.py` 抠图→缩图→注入 | 死亡帧 / 受击帧贴图构建 |
| **optimize-art** | 手动 | `ci/cutout-art.py` 批量抠图 + 验证 | AI 贴图去白底 |

**日常只需关心前两条**（push 自动跑）；后六条是专项体检，按需手动触发。

---

## 3. ci/ 脚本索引

### 验证类（守门禁）

| 脚本 | 作用 | 何时跑 |
|---|---|---|
| `verify.mjs` | 双通道加载验证（file:// vs http://），产出 `report.json/md` + 截图 | push 自动 |
| `assert-dist-audio.mjs` | 断言 `dist/audio` 与源目录**逐字节大小一致**，缺失 exit 1 | verify-dist |
| `final-audit.mjs` | 三形态**内容级**复核：音频 md5 + 贴图键数 + 外链化 + 体积口径 | verify-dist |
| `beast-art-audit.mjs` | 跟宠贴图入库体检（`TABLE_MODE=1` 只跑接线级，免浏览器） | verify-dist |
| `find-dead-art.mjs` | AI 表死数据扫描（**只报不删**；"被跳过 ≠ 死"） | 手动 |
| `audio-local-check.mjs` | 本地全量音频体检（格式 / 削波 / 接缝），云端 audio-audit 的离线前置 | 本地/手动 |
| `content-gap-scan.mjs` | 内容缺口全维度扫描（12 个维度，声明数 vs 实际覆盖） | 手动 |
| `loop-seam.py` | **BGM 循环接缝**体检（`ratio = |首−末| ÷ P90(首尾各128样本差分)`，阈值 4.0） | verify-dist（GATE） |
| `bgm-spectrum.py` | **BGM 频谱重心与编排平衡**（跨曲中位数+MAD 离群，**不用绝对阈值**） | verify-dist（仅提示） |
| `sfx-loudness.py` | **SFX 响度层级**（简化 K 加权能量响度，非峰值；按事件频率档分组比较） | verify-dist（仅提示） |
| `text-legibility.py` | ⛔ **已实测证伪**，仅留痕 + `--selftest` 作回归（**不得据此改画面**） | screen-sweep（continue-on-error） |

> ⚠ **判据设计三例教训**（详见技能 `ai-art-pipeline` 第十·四节）：
> 同一型错误（**参考量与实际信号不同尺度**）本轮出现 3 次，全部靠**真实产物上的对照实验**才抓到。
> 最典型：`text-legibility` 用 5×5 邻域众数当"文字背景"，而缩略图里笔画只有 2–5px
> → 窗口比笔画还宽，众数是随机量；`bgm-spectrum` v1 用"高频占比 > 4%"判不闷，
> 而本项目 sine/triangle 高频**物理为 0** → 阈值恒真。
>
> **判据自测必须含"能量口径"验证**：`sfx-loudness` 的 C 项（峰值相同、一尖脉冲一持续音，
> 实测响度差 **44.7dB**）证明它测的是**能量**而不是**峰值**。缺这一项，
> 一个"其实在测峰值"的响度判据会**全绿通过自测**。
> **黄金做法**：判据在真实产物上跑 + 配「已知无信号区」对照 + 阴性样本必须**物理上真含信号**。

### 体检类（产出报告 + 截图）

| 脚本 | 作用 |
|---|---|
| `art-audit.mjs` | 导出游戏**实际用于绘制**的 SPRITES 联系表 + 放大预览 |
| `audio-audit.mjs` | 音频专项（音源创建计数 → 证明"真的在播"） |
| `fx-audit.mjs` | 特效专项（触发钩子 + 帧间差对照） |
| `screen-sweep.mjs` | 全界面巡检截图 |
| `screen-analyze.py` | **CI 端**屏幕分析，产出文本小报告（避免大图进 AI 上下文） |

### 构建类（会改文件，谨慎）

| 脚本 | 作用 |
|---|---|
| `build-dist.js` | 内联母版 → `dist/`（贴图 + 音频外置） |
| `build-dead-frames.py` | 死亡帧 / 受击帧：抠图 → 裁内容 → 补方图 → 缩放 → WebP → 注入 |
| `cutout-art.py` | 批量抠图去白底，写回新 HTML |
| `patch-death-wiring.mjs` | 死亡帧接线（4 处**纯增量**插入） |
| `render-missing-bgm.mjs` | 用游戏内 [11] 渲染器离线补 BGM |
| `render-missing-sfx.mjs` | 同上，补 SFX |
| `resample-audio-44100.mjs` | 采样率统一到 44100（原 8 个是 22050，偏闷） |
| `trim-bgm-seam.mjs` | 裁掉 BGM 末尾不匹配后缀，使循环点落在静音谷 |

---

## 4. 内容清单（v4 扫描实测，2026-09-21）

用 `ci/content-gap-scan.mjs` 复核。**结论：内容无缺口。**

| 维度 | 数量 | 覆盖 |
|---|---|---|
| 敌人 | 21 | 21 贴图 / 21 受击 / 21 死亡 ✅ |
| 跟宠 | 7 | 7 有 AI 图 ✅ |
| 武器 | 10 | 10 有 `wpn_` ✅ ｜ 7 有 `blt_`（另 3 个是**无弹道技能武器**） |
| 子弹 | 23 键 | 含进化武器弹体 + `blt_pethop` / `blt_petorb` |
| 装备 | 12 | 12 有 `gear_` ✅ |
| 被动 | 14 键 | — |
| 进化 | 9 键 | — |
| 符文 | 6 键 | — |
| 场物 | 3 键 | 与代码引用数一致 ✅ |
| BGM | 10 | 10 有文件 ✅ |
| SFX | 15 | 15 有文件 ✅ |
| 章节 | 6 | ch1–ch6（体内 id 另含章节奖励装备，正常） |
| 世界主题 | 4 | meadow / city / dune / frost |

**踩过的坑（别重犯）**：`DATA_ENEMY` / `DATA_WEAPON` 是**两层 map**（顶层是种族/武器分组，变体在分组内），
`DATA_BGM` 是**带 `//` 行注释的单行条目 map**。
用 `indexOf('];')` 截断或"顶层键必须是 `{`"这类写法都会数错——
本项目扫描器为此返工 4 版。**一律用括号配平 + 先剥注释**。

**三个无弹道武器**：`thunder`（落雷 `kind:"strike"`）、`laserflower`（激光 `kind:"laser"`）、
`dewpulse`（光环 `kind:"nova"`）—— `bulletSpd:0, bulletR:0`，**不存在飞行子弹实体**，
没有 `blt_` 贴图是设计如此，不是缺口。

---

## 5. 约束（不可违反）

- **数值与密度冻结**：只做表现层提升，不动数值 / 密度 / 开局节奏
- **三形态必须同步**：改母版 → 构建 dist → 复核内容一致
- **改前先量数据**：任何"这是缺陷"的判断，先用运行时真实值验证前提
- **门禁必须做阴性对照**：永远通过的守卫比没有更危险
- **重活上云**：本机只做文本编辑，不吃算力

### 体积口径

| 形态 | 体积 | 口径 |
|---|---|---|
| 内联母版 | **4.00MB**（4,191,005 B） | 微信主包 ≤4MB —— **已临界**，加贴图需先外置 |
| dist/ 全目录 | **10.21MB** | 主包 HTML 1.63MB + assets 2.17MB + audio 6.80MB |
| deploy/ | 由 dist 同步 | — |

> **贴图/音频不再内联进母版**：走 `dist → deploy` 外链路线（CDN 远程资源不计入总包）。

---

## 6. 本地手动跑（可选，仅调试用）

```bash
npm install --no-save playwright
npx playwright install chromium
node ci/verify.mjs
```

**注意**：本机跑浏览器验证会吃算力，正式验证一律走云端。
