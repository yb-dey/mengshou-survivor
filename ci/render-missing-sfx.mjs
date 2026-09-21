// render-missing-sfx.mjs —— 用游戏自己的合成规范，离线渲染缺失的 13 个 SFX 为 wav
//
// 为什么：AUDIO_ASSET.sfxFiles 声明 15 个，但 audio/ 只有 2 个（sfx_fire / sfx_levelup）
//   → 其余 13 个每次都走程序化兜底（file:// 下必然如此）。
// 做法：把游戏 [11] RENDER 的 _tone / _noise / _renderOne 参数**逐字复刻**到 Node，
//   渲染 → 峰值归一到总线增益（与运行时一致）→ 写 16bit PCM WAV。
// 收益：内容补齐（打击/受击/拾取/开箱/预警等手感核心）+ 与既有 2 个同源 + 零 API 成本。
//
// 用法: node ci/render-missing-sfx.mjs [--apply]
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const SR = 44100;
const TWO_PI = Math.PI * 2;

// 【v1.170】**已删除 GAINS 表** —— 它是一张"手抄的 CONFIG.audio.gains 副本", 实测 19 条里
//   有 12 条与真身漂移（CARD 0.62↔0.70 / HURT 0.62↔0.72 / BOSS_DIE 0.70↔0.80 / WIN 0.68↔0.80 …）。
//   危害不止"抄错"：这张表的值被**烘焙进文件的峰值**，而运行时第 12593 行**又乘一次**
//   `CONFIG.audio.gains[sid]` → **同一个 gain 被应用两次**，且两次取的是**不同版本的值**，
//   误差非线性叠加 → 19 条里 21 组"声明更响、实测更轻"的反向对（rho=0.491）。
//
//   正确做法（与游戏内合成器一致）：
//     · 游戏 `_renderAll`(12173 行) 对外采/合成 buffer **一律平峰值归一** `CONFIG.audio.peakNorm`,
//       **不按 id 缩放**；响度层级**只由运行时的 gains 决定**（单一权威）。
//     · 因此这里也**只做平峰值归一**，让"外采文件"与"程序合成"两条通路行为完全一致。
//   ⚠ 不要在主流程里重新引入任何 per-id 增益表 —— 那是下一次静默降级的温床。
const PEAK_NORM = 0.7;   // 必须与游戏 CONFIG.audio.peakNorm 一致（-3dBFS）

// ---- 逐字复刻游戏 _tone ----
function tone(out, o) {
  const start = Math.floor(o.t0 * SR);
  const n = Math.floor(o.dur * SR);
  const a = Math.max(1, Math.floor(o.a * SR));
  const d = Math.max(1, Math.floor(o.d * SR));
  const r = Math.max(1, Math.floor(o.r * SR));
  const holdEnd = Math.max(a + d, n - r);
  const s = o.s || 0;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let env;
    if (i < a) env = i / a;
    else if (i < a + d) env = s + (1 - s) * Math.exp(-6.9 * (i - a) / d);
    else if (i < holdEnd) env = s;
    else env = s * Math.exp(-6.9 * (i - holdEnd) / r);
    const f = o.f1 ? o.f0 * Math.pow(o.f1 / o.f0, t / o.dur) : o.f0;
    ph += TWO_PI * f / SR;
    const w = Math.sin(ph);
    let v;
    if (o.wave === "square") v = w >= 0 ? 1 : -1;
    else if (o.wave === "saw") v = ((ph / TWO_PI) % 1) * 2 - 1;
    else if (o.wave === "triangle") v = 1.2732395 * Math.asin(w);
    else v = w;
    const idx = start + i;
    if (idx >= 0 && idx < out.length) out[idx] += v * env * (o.gain || 1);
  }
}

// ---- 逐字复刻游戏 _noise（确定性 LCG，禁 Math.random）----
function noise(out, o) {
  const start = Math.floor(o.t0 * SR);
  const n = Math.floor(o.dur * SR);
  const a = Math.max(1, Math.floor((o.a || 0.002) * SR));
  const r = Math.max(1, Math.floor((o.r || 0.04) * SR));
  let seed = o.seed || 1;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1664525 + 1013904223) | 0;
    const nv = ((seed >>> 8) / 16777216) * 2 - 1;
    const env = i < a ? i / a : (i > n - r ? (n - i) / r : 1);
    const idx = start + i;
    if (idx >= 0 && idx < out.length) out[idx] += nv * env * (o.gain || 1);
  }
}

const alloc = (sec) => new Float32Array(Math.max(1, Math.floor(sec * SR)));

// ---- 逐字复刻游戏 _renderOne（15 个基础音色）----
function renderOne(id) {
  let out;
  if (id === "SFX_FIRE") { out = alloc(0.07);
    tone(out, { wave: "triangle", f0: 920, f1: 620, t0: 0, dur: 0.065, a: 0.003, d: 0.04, s: 0, r: 0.015, gain: 1 });
    noise(out, { t0: 0, dur: 0.024, a: 0.001, r: 0.018, gain: 0.15, seed: 11 });
  } else if (id === "SFX_HIT") { out = alloc(0.1);
    tone(out, { wave: "sine", f0: 1180, f1: 392, t0: 0, dur: 0.07, a: 0.001, d: 0.045, s: 0, r: 0.018, gain: 1 });
    tone(out, { wave: "triangle", f0: 784, t0: 0, dur: 0.03, a: 0.001, d: 0.02, s: 0, r: 0.01, gain: 0.12 });
    noise(out, { t0: 0, dur: 0.032, a: 0.001, r: 0.02, gain: 0.10, seed: 22 });
  } else if (id === "SFX_GEM") { out = alloc(0.1);
    tone(out, { wave: "sine", f0: 1568, t0: 0, dur: 0.08, a: 0.004, d: 0.05, s: 0, r: 0.024, gain: 0.9 });
    tone(out, { wave: "sine", f0: 2093, t0: 0.02, dur: 0.07, a: 0.004, d: 0.04, s: 0, r: 0.02, gain: 0.24 });
  } else if (id === "SFX_LEVELUP") { out = alloc(0.42);
    tone(out, { wave: "sine", f0: 659, t0: 0, dur: 0.26, a: 0.02, d: 0.1, s: 0.18, r: 0.1, gain: 0.9 });
    tone(out, { wave: "sine", f0: 784, t0: 0.1, dur: 0.26, a: 0.02, d: 0.1, s: 0.16, r: 0.1, gain: 0.8 });
    tone(out, { wave: "sine", f0: 988, t0: 0.2, dur: 0.22, a: 0.02, d: 0.1, s: 0.12, r: 0.1, gain: 0.68 });
  } else if (id === "SFX_CARD") { out = alloc(0.18);
    tone(out, { wave: "triangle", f0: 523, t0: 0, dur: 0.18, a: 0.002, d: 0.12, s: 0, r: 0.06, gain: 1 });
    tone(out, { wave: "triangle", f0: 784, t0: 0, dur: 0.14, a: 0.002, d: 0.1, s: 0, r: 0.06, gain: 0.22 });
  } else if (id === "SFX_HURT") { out = alloc(0.20);
    tone(out, { wave: "sine", f0: 148, f1: 82, t0: 0, dur: 0.16, a: 0.010, d: 0.11, s: 0, r: 0.08, gain: 0.70 });
    tone(out, { wave: "triangle", f0: 196, f1: 98, t0: 0, dur: 0.12, a: 0.008, d: 0.08, s: 0, r: 0.06, gain: 0.26 });
    noise(out, { t0: 0, dur: 0.05, a: 0.004, r: 0.04, gain: 0.06, seed: 33 });
  } else if (id === "SFX_CARDSHOW") { out = alloc(0.30);
    // 【v1.176】与 SFX_START 结构去同构（详见母版同名分支的注释）：
    //   旧 = 4 音级进上行琶音 523·659·784·1046（0.36s，重心 638Hz，与 start 仅差 5.9 半音，
    //        且两者在 beginRun 里**同一 tick 相继播放** → 叠在一起听是"同一段音换调"）
    //   新 = 2 音大跳 784·1046（G5→C6）+ 1568Hz 亮钉 = "叮-咚"两下、利落落定
    //        → 重心 ≈1180Hz（与 start 差 ~16.5 半音，跨八度）；时长 0.36→0.30s（差 21%）
    //   ⚠ 只做平峰值归一（下方 normalize），响度档位仍只由运行时 gains(0.56) 决定。
    const cf = [784.0, 1046.5];
    for (let ci = 0; ci < 2; ci++) {
      tone(out, { wave: "triangle", f0: cf[ci], f1: cf[ci] * 1.012, t0: ci * 0.10, dur: 0.10, a: 0.004, d: 0.05, s: 0, r: 0.045, gain: 0.9 });
    }
    tone(out, { wave: "sine", f0: 1568.0, t0: 0.10, dur: 0.09, a: 0.002, d: 0.03, s: 0, r: 0.05, gain: 0.30 });
  } else if (id === "SFX_CHEST") { out = alloc(0.36);
    noise(out, { t0: 0, dur: 0.08, a: 0.004, r: 0.05, gain: 0.42, seed: 77 });
    tone(out, { wave: "sine", f0: 140, f1: 88, t0: 0, dur: 0.16, a: 0.006, d: 0.1, s: 0, r: 0.06, gain: 0.88 });
    tone(out, { wave: "triangle", f0: 392, t0: 0.04, dur: 0.12, a: 0.004, d: 0.08, s: 0, r: 0.04, gain: 0.34 });
    tone(out, { wave: "sine", f0: 1568, t0: 0.12, dur: 0.18, a: 0.005, d: 0.08, s: 0, r: 0.08, gain: 0.36 });
    tone(out, { wave: "sine", f0: 2093, t0: 0.18, dur: 0.16, a: 0.005, d: 0.08, s: 0, r: 0.08, gain: 0.24 });
  } else if (id === "SFX_EVENT") { out = alloc(0.5);
    tone(out, { wave: "triangle", f0: 349.23, t0: 0, dur: 0.22, a: 0.016, d: 0.12, s: 0.15, r: 0.1, gain: 0.8 });
    tone(out, { wave: "sine", f0: 523.25, t0: 0.08, dur: 0.28, a: 0.016, d: 0.14, s: 0.12, r: 0.14, gain: 0.62 });
    tone(out, { wave: "sine", f0: 659.26, t0: 0.2, dur: 0.28, a: 0.016, d: 0.12, s: 0, r: 0.14, gain: 0.38 });
  } else if (id === "SFX_REVIVE") { out = alloc(0.58);
    tone(out, { wave: "sine", f0: 329.63, t0: 0, dur: 0.28, a: 0.022, d: 0.12, s: 0.25, r: 0.12, gain: 1 });
    tone(out, { wave: "sine", f0: 392.0, t0: 0.12, dur: 0.3, a: 0.022, d: 0.12, s: 0.22, r: 0.12, gain: 0.9 });
    tone(out, { wave: "sine", f0: 523.25, t0: 0.24, dur: 0.32, a: 0.022, d: 0.12, s: 0.18, r: 0.16, gain: 0.8 });
    tone(out, { wave: "triangle", f0: 659.26, t0: 0.32, dur: 0.26, a: 0.018, d: 0.1, s: 0.1, r: 0.14, gain: 0.5 });
  } else if (id === "SFX_EVO") { out = alloc(0.46);
    // 【v1.169】原先 4 层**依次错开**(t0: 0 / 0.08 / 0.18 / 0.26) → 各层几乎不重叠,
    //   能量被摊薄 → 实测相对响度 -21.0dB, 比**同长度**的 SFX_LEVELUP(-15.8) **低 5.2dB**,
    //   在 INFREQ 档内是离群偏轻 -3.8dB。但 evo 的声明 gain 是 0.78(全表最高档之一)、
    //   埋点注释写明"进化专属, 不复用升级音" → 它是**里程碑高光**, 不该比日常升级还轻。
    //   → 改为**同头重叠**(t0: 0 / 0.04 / 0.09 / 0.16), 让 4 层在 0.1~0.2s 处叠加,
    //     与 LEVELUP 的"三音齐鸣"同型, 但音更高(523→1047 上行)、层更多 → 既亮又厚。
    tone(out, { wave: "triangle", f0: 523.25, t0: 0, dur: 0.20, a: 0.004, d: 0.08, s: 0.12, r: 0.08, gain: 0.85 });
    tone(out, { wave: "sine", f0: 659.26, t0: 0.04, dur: 0.24, a: 0.004, d: 0.1, s: 0.18, r: 0.1, gain: 1 });
    tone(out, { wave: "sine", f0: 783.99, t0: 0.09, dur: 0.26, a: 0.005, d: 0.1, s: 0.16, r: 0.12, gain: 0.78 });
    tone(out, { wave: "triangle", f0: 1046.5, t0: 0.16, dur: 0.22, a: 0.004, d: 0.08, s: 0.08, r: 0.12, gain: 0.46 });
  } else if (id === "SFX_BOMB") { out = alloc(0.42);
    noise(out, { t0: 0, dur: 0.12, a: 0.005, r: 0.08, gain: 0.55, seed: 44 });
    tone(out, { wave: "sine", f0: 110, f1: 48, t0: 0, dur: 0.28, a: 0.007, d: 0.12, s: 0, r: 0.12, gain: 0.9 });
    tone(out, { wave: "triangle", f0: 220, f1: 90, t0: 0.02, dur: 0.18, a: 0.005, d: 0.1, s: 0, r: 0.08, gain: 0.44 });
    tone(out, { wave: "sine", f0: 392, t0: 0.08, dur: 0.16, a: 0.005, d: 0.08, s: 0, r: 0.08, gain: 0.22 });
  } else if (id === "SFX_KILL") { out = alloc(0.14);
    tone(out, { wave: "sine", f0: 196, f1: 82, t0: 0, dur: 0.10, a: 0.002, d: 0.05, s: 0, r: 0.032, gain: 0.92 });
    tone(out, { wave: "sine", f0: 784, f1: 523, t0: 0, dur: 0.036, a: 0.002, d: 0.02, s: 0, r: 0.016, gain: 0.20 });
    noise(out, { t0: 0, dur: 0.028, a: 0.002, r: 0.016, gain: 0.10, seed: 55 });
  } else if (id === "SFX_UI") { out = alloc(0.12);
    tone(out, { wave: "triangle", f0: 784, t0: 0, dur: 0.08, a: 0.001, d: 0.05, s: 0, r: 0.04, gain: 1 });
    tone(out, { wave: "sine", f0: 1175, t0: 0.02, dur: 0.07, a: 0.001, d: 0.04, s: 0, r: 0.03, gain: 0.32 });
  } else if (id === "SFX_START") { out = alloc(0.38);
    tone(out, { wave: "triangle", f0: 392.0, t0: 0, dur: 0.18, a: 0.004, d: 0.08, s: 0.15, r: 0.08, gain: 0.9 });
    tone(out, { wave: "sine", f0: 523.25, t0: 0.08, dur: 0.22, a: 0.004, d: 0.1, s: 0.18, r: 0.1, gain: 1 });
    tone(out, { wave: "triangle", f0: 659.26, t0: 0.16, dur: 0.22, a: 0.004, d: 0.08, s: 0.12, r: 0.12, gain: 0.7 });
  } else if (id === "SFX_BOSS_WARN") { out = alloc(0.8);
    tone(out, { wave: "triangle", f0: 392, t0: 0,    dur: 0.10, a: 0.013, d: 0.08, s: 0, r: 0.03, gain: 0.88 });
    tone(out, { wave: "triangle", f0: 392, t0: 0.15, dur: 0.10, a: 0.013, d: 0.08, s: 0, r: 0.03, gain: 0.88 });
    tone(out, { wave: "triangle", f0: 523, t0: 0.30, dur: 0.10, a: 0.013, d: 0.08, s: 0, r: 0.03, gain: 0.8 });
    tone(out, { wave: "triangle", f0: 330, t0: 0.45, dur: 0.32, a: 0.013, d: 0.12, s: 0, r: 0.08, gain: 0.9 });
  } else if (id === "SFX_BOSS_DIE") { out = alloc(0.7);
    // 【v1.169】原 2 层都是 s:0(无延音) + 长衰减 → 0.7s 窗口里后段近乎静音,
    //   能量被稀释 → 实测 -20.6dB, 在 INFREQ 档内离群偏轻 -3.5dB。
    // 【v1.170 续修】上一版补的低音延音床仍不够：实测**有效时长只有 0.186s / 总 0.7s**
    //   （包络 10% 阈值内），峰均比 16.4dB → 落在**打击类**形状家族，而不是"重大事件"家族。
    //   声明 gain 0.80 是**并列最高**、设计层级把 BOSS 放在顶端 → 它该是"一个时刻"而非"一记闷响"。
    //   修法：① 主层 s 0.06→0.16、r 0.2→0.3（承住后段）② 低音床 s 0.12→0.20、dur 0.55→0.62
    //        ③ 高频层下降沿放慢（d 0.35→0.45、r 0.15→0.22），让"坠落下扫"听得出过程。
    tone(out, { wave: "triangle", f0: 880, f1: 220, t0: 0, dur: 0.7, a: 0.002, d: 0.42, s: 0.16, r: 0.3, gain: 1 });
    tone(out, { wave: "sine", f0: 2200, f1: 440, t0: 0.1, dur: 0.55, a: 0.002, d: 0.45, s: 0.05, r: 0.22, gain: 0.4 });
    tone(out, { wave: "sine", f0: 130, f1: 62, t0: 0.12, dur: 0.62, a: 0.01, d: 0.22, s: 0.2, r: 0.24, gain: 0.5 });
  } else if (id === "SFX_WIN") { out = alloc(1.02);
    // 【v1.175】与母版逐字一致 —— 补"绽开"修辞(亮尾 C7 琶音 + 微失谐 shimmer + 五度高亮层 + 每音 +2% 上扬)。
    //   ⚠ 本文件是"外采 wav"渲染器, 与母版 `_renderOne` **必须逐字同源**, 否则两条通路分叉
    //     (外采文件一到位, 程序合成版就被换掉 → 修复静默失效)。
    const wf = [523, 659, 784, 1046];
    for (let i = 0; i < 4; i++) tone(out, { wave: "triangle", f0: wf[i], f1: wf[i] * 1.02, t0: i * 0.15, dur: 0.45, a: 0.024, d: 0.28, s: 0.16, r: 0.2, gain: 0.95 });
    const wtail = [1046.5, 1318.5, 1568.0, 2093.0];
    for (let i = 0; i < 4; i++) tone(out, { wave: "sine", f0: wtail[i], t0: 0.58 + i * 0.055, dur: 0.26, a: 0.004, d: 0.09, s: 0.02, r: 0.14, gain: 0.34 });
    tone(out, { wave: "sine", f0: 1568.0, t0: 0.56, dur: 0.42, a: 0.016, d: 0.18, s: 0.10, r: 0.2, gain: 0.16 });
    tone(out, { wave: "sine", f0: 1571.6, t0: 0.56, dur: 0.42, a: 0.016, d: 0.18, s: 0.10, r: 0.2, gain: 0.13 });
    tone(out, { wave: "triangle", f0: 1568.0, t0: 0.42, dur: 0.34, a: 0.02, d: 0.12, s: 0.08, r: 0.16, gain: 0.14 });
    // 【v1.170】补低音基础层（与游戏 _renderAll 逐字一致）: 原 win/lose 都是纯四音 triangle、
    //   完全没有低音层 → 实测 sfx_win 的 low 与 lowmid **双双 0.0%**, 是 6 个 INFREQ 里唯一低频全空的。
    //   ⚠ 增益是**扫出来的**(用 sfx-loudness.py 的 analyze 评候选):
    //     首版 0.78/0.62 把 low 抬到 15.2%, 但低音层抢了峰值 → 归一后整体变轻 1.2dB,
    //     把 INFREQ 档中位从 -16.8 拉到 -18.2 → 与 FREQ 的档位差距 3.9dB 缩到 2.5dB(设计意图被削弱)。
    //     最终取 0.30/0.20 + 旋律 0.84→0.95: **low 仍有 ~7%, 而响度回到 -17.69**(目标 -17.1)。
    tone(out, { wave: "sine", f0: 65.41,  t0: 0, dur: 1.02, a: 0.03,  d: 0.3,  s: 0.62, r: 0.34, gain: 0.30 });
    tone(out, { wave: "sine", f0: 130.81, t0: 0, dur: 0.98, a: 0.025, d: 0.28, s: 0.55, r: 0.3,  gain: 0.20 });
  } else if (id === "SFX_LOSE") { out = alloc(1.35);
    // 【v1.175】与母版逐字一致 —— 补"沉降"修辞(8 个短音 + 每音 −1.5% 下坠 + 长下滑 sub + 暗色 saw pad + 散场气声)。
    const lf = [523, 523, 440, 440, 349, 349, 262, 220];
    for (let j = 0; j < 8; j++) tone(out, { wave: "triangle", f0: lf[j], f1: lf[j] * 0.985, t0: j * 0.095, dur: 0.14, a: 0.026, d: 0.22, s: 0.42, r: 0.22, gain: 1.8 });
    tone(out, { wave: "sine", f0: 200, f1: 38, t0: 0.55, dur: 0.8, a: 0.02, d: 0.22, s: 0.5, r: 0.4, gain: 0.42 });
    tone(out, { wave: "saw", f0: 87.3, t0: 0.24, dur: 0.92, a: 0.12, d: 0.34, s: 0.4, r: 0.36, gain: 0.16 });
    noise(out, { t0: 0.62, dur: 0.68, a: 0.22, r: 0.4, gain: 0.06, seed: 91 });
    // 【v1.170】同档补齐低音层(与 win 对称; 下行曲用更低更暗的 A2 承托"落句", 增益略低维持档位关系)
    //   【v1.175】低音床 gain 0.28/0.18→0.42/0.30、s 0.58/0.52→0.80/0.72:
    //     新结构里 sub/saw/气声都是**宽包络层**, 会把峰值抬高 → 归一后稀释 RMS。
    //     逐层量过后用低音床补回(它持音长、能量密度高), 使 RMS 0.1591→0.1587、ΔLUFS 基本不变。
    tone(out, { wave: "sine", f0: 55.0,  t0: 0, dur: 1.34, a: 0.035, d: 0.32, s: 0.80, r: 0.5,  gain: 0.42 });
    tone(out, { wave: "sine", f0: 110.0, t0: 0, dur: 1.20, a: 0.03,  d: 0.3,  s: 0.72, r: 0.35, gain: 0.30 });
  } else {
    out = alloc(0.01);
  }
  return out;
}

// 归一：游戏 _renderAll 中 SFX 也走同一个 -3dBFS 峰值归一通路
function normalize(out, target) {
  let peak = 0;
  for (let i = 0; i < out.length; i++) { const v = Math.abs(out[i]); if (v > peak) peak = v; }
  if (peak > 0.0001) { const k = target / peak; for (let q = 0; q < out.length; q++) out[q] *= k; }
  return peak;
}

function toWav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii'); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.round(samples[i] * 32767);
    if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
    buf.writeInt16LE(v, 44 + i * 2);
  }
  return buf;
}

// 【2026-09-21 补】原先只列 AUDIO_ASSET.sfxFiles 声明的 15 个 —— 但 CONFIG.audio.gains
//   里有 **19** 个键，`_renderAll()` 会渲这 19 个，而 `tryLoadLocalFiles()` 只按
//   `sfxFiles` 表 fetch → 多出的 4 个（CARDSHOW/CHEST/EVENT/REVIVE）**永远拿不到外采文件**，
//   静默走程序化兜底。这 4 个覆盖 **10 个埋点**（全部 5 个章事件提示 + 复活 + 开箱 + 亮卡），
//   是玩家最常听到的"节点音"。
//   → 本清单必须 = `CONFIG.audio.gains` 的键集（**判据**：渲染清单要跟"会被渲染的集合"对齐，
//     不是跟"已声明的映射表"对齐；后者缺键时不会报错，只会静默降级。）
//   ⚠ 同时必须同步补进游戏 `AUDIO_ASSET.sfxFiles` 表，否则文件渲染了也 fetch 不到（见 patch 脚本）。
const ALL = ['SFX_FIRE', 'SFX_HIT', 'SFX_GEM', 'SFX_LEVELUP', 'SFX_CARD', 'SFX_HURT', 'SFX_BOSS_WARN',
             'SFX_BOSS_DIE', 'SFX_WIN', 'SFX_LOSE', 'SFX_EVO', 'SFX_BOMB', 'SFX_KILL', 'SFX_UI', 'SFX_START',
             // 【2026-09-21】补齐 4 个"有合成器、无映射"的节点音
             'SFX_CARDSHOW', 'SFX_CHEST', 'SFX_EVENT', 'SFX_REVIVE'];
const outDir = path.join('game', 'audio');
// 【v1.170】`--force` 重渲全部；默认仍跳过已存在文件（保护手工资产）。
//   ⚠ 但"跳过"**必须打印出来**：旧版静默 skip 让 sfx_fire.wav 在 gains 从 0.50 改到 0.32 后
//     一直是旧标度（实测峰值/gain = 2.168，全场唯一离群），且**零提示**。
const FORCE = process.argv.includes('--force');
console.log(`模式: ${APPLY ? 'APPLY' : 'DRY-RUN'}${FORCE ? ' [FORCE 重渲全部]' : ''}  →  ${outDir}`);
console.log('| id | 时长ms | 峰值 | RMS | 文件 |');
console.log('|---|---|---|---|---|');
let made = 0, skipped = 0;
const skippedFiles = [];
for (const id of ALL) {
  const file = 'sfx_' + id.replace(/^SFX_/, '').toLowerCase() + '.wav';
  const dest = path.join(outDir, file);
  if (!FORCE && fs.existsSync(dest)) { skipped++; skippedFiles.push(file); continue; }
  const raw = renderOne(id);
  normalize(raw, PEAK_NORM);   // 【v1.170】平峰值归一，与游戏 _renderAll 同口径；
                               //   **不再**乘 per-id gain（否则运行时再乘一次 = 双重缩放）
  let rms = 0; for (let i = 0; i < raw.length; i++) rms += raw[i] * raw[i];
  rms = Math.sqrt(rms / raw.length);
  if (APPLY) fs.writeFileSync(dest, toWav(raw));
  console.log(`| ${id} | ${(raw.length / SR * 1000).toFixed(0)} | ${PEAK_NORM.toFixed(2)} | ${rms.toFixed(4)} | ${file}${APPLY ? '' : '（待写）'} |`);
  made++;
}
console.log(`\n${APPLY ? `已写 ${made} 个` : `待写 ${made} 个`}（跳过已存在 ${skipped} 个）`);
if (skippedFiles.length) {
  console.log(`\n⚠ 跳过（沿用磁盘现有文件，**未重渲**）：\n  ${skippedFiles.join('\n  ')}`);
  console.log(`  这些文件的标度可能与当前 gains 口径不符 → 需要校准请加 --force 重渲。`);
}
