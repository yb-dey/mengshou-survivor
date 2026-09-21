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
  } else if (id === "SFX_CARDSHOW") { out = alloc(0.36);
    tone(out, { wave: "triangle", f0: 523.25, t0: 0, dur: 0.14, a: 0.009, d: 0.08, s: 0, r: 0.05, gain: 0.78 });
    tone(out, { wave: "triangle", f0: 659.26, t0: 0.07, dur: 0.14, a: 0.009, d: 0.08, s: 0, r: 0.05, gain: 0.82 });
    tone(out, { wave: "triangle", f0: 783.99, t0: 0.14, dur: 0.18, a: 0.009, d: 0.08, s: 0.12, r: 0.08, gain: 0.9 });
    tone(out, { wave: "sine", f0: 1046.5, t0: 0.2, dur: 0.16, a: 0.009, d: 0.08, s: 0, r: 0.1, gain: 0.36 });
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
    //   保留"高→低坠落下扫"的设计(那是毙命感), 但补一层**低音延音床**承住后段能量,
    //   让它在 0.7s 里持续有声, 而不是"响一下就空"。
    tone(out, { wave: "triangle", f0: 880, f1: 220, t0: 0, dur: 0.7, a: 0.002, d: 0.5, s: 0.06, r: 0.2, gain: 1 });
    tone(out, { wave: "sine", f0: 2200, f1: 440, t0: 0.1, dur: 0.5, a: 0.002, d: 0.35, s: 0, r: 0.15, gain: 0.4 });
    tone(out, { wave: "sine", f0: 130, f1: 62, t0: 0.12, dur: 0.55, a: 0.01, d: 0.2, s: 0.12, r: 0.2, gain: 0.5 });
  } else if (id === "SFX_WIN") { out = alloc(0.9);
    const wf = [523, 659, 784, 1046];
    for (let i = 0; i < 4; i++) tone(out, { wave: "triangle", f0: wf[i], t0: i * 0.15, dur: 0.45, a: 0.024, d: 0.28, s: 0.16, r: 0.2, gain: 0.84 });
  } else if (id === "SFX_LOSE") { out = alloc(0.9);
    const lf = [523, 440, 349, 262];
    for (let j = 0; j < 4; j++) tone(out, { wave: "triangle", f0: lf[j], t0: j * 0.15, dur: 0.45, a: 0.026, d: 0.3, s: 0.15, r: 0.22, gain: 0.82 });
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
