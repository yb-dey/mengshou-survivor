// render-missing-bgm.mjs —— 用游戏自己的合成规范，离线渲染缺失的 4 条 BGM 为 wav
//
// 为什么：AUDIO_ASSET 声明 10 条 BGM，但 audio/ 只有 6 条 →
//   horde（怪潮）/ abyss（深渊 BOSS）/ win / lose 四条每次都走程序化兜底。
// 做法：把游戏 [11] RENDER 里的 _tone / _renderBgmTrack 参数**逐字复刻**到 Node（无 WebAudio 依赖），
//   渲染 → 峰值归一 -3dBFS → 尾部 60ms 淡出（与已修好的 6 条同口径，防循环接缝）→ 写 16bit PCM WAV。
// 收益：内容补齐 + 与既有 6 条同源同风格 + 零 API 成本 + 可复跑。
//
// 用法: node ci/render-missing-bgm.mjs [--apply]
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const SR = 44100;
const TWO_PI = Math.PI * 2;
const PEAK_NORM = 0.708;      // CONFIG.audio.peakNorm = -3dBFS
const TAIL_FADE_MS = 60;      // 与 trim-bgm-seam 同口径（尾部落到静音再回接头部 0 电平）

// ---- 逐字复刻游戏 _tone ----
function tone(out, o) {
  const start = Math.floor(o.t0 * SR);
  const n = Math.floor(o.dur * SR);
  const a = Math.max(1, Math.floor((o.a || 0.001) * SR));
  const d = Math.max(1, Math.floor((o.d || 0.05) * SR));
  const r = Math.max(1, Math.floor((o.r || 0.05) * SR));
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

// ---- 逐字复刻游戏 DATA_BGM 中这 4 条的定义 ----
const DEFS = {
  horde: { bpm: 147, beats: 32 },
  abyss: { bpm: 84,  beats: 16 },
  win:   { jingle: true, refSmp: 94500 },
  lose:  { jingle: true, refSmp: 110250 },
};

function renderTrack(tid) {
  const def = DEFS[tid];
  const loopSec = def.jingle ? def.refSmp / 44100 : (60 / def.bpm) * def.beats;
  const len = Math.round(loopSec * SR);
  const out = new Float32Array(len);
  const beat = def.jingle ? 0 : 60 / def.bpm;
  let i, k;

  if (tid === "horde") {
    // 【v1.102/v1.159】E 小调四句 + 轻踩
    const oPad = [164.81, 196.0, 246.94, 293.66];
    for (i = 0; i < oPad.length; i++) tone(out, { wave: "triangle", f0: oPad[i], t0: 0, dur: loopSec, a: 0.03, d: 0.3, s: 0.18, r: 0.3, gain: 0.22 });
    tone(out, { wave: "sine", f0: 82.41, t0: 0, dur: loopSec, a: 0.02, d: 0.25, s: 0.85, r: 0.35, gain: 0.3 });
    tone(out, { wave: "sine", f0: 123.47, t0: 0, dur: loopSec, a: 0.04, d: 0.3, s: 0.28, r: 0.4, gain: 0.10 });
    const oHook  = [329.63, 392.0, 440.0, 392.0, 293.66, 329.63, 246.94, 293.66];
    const oHookB = [392.0, 440.0, 493.88, 440.0, 329.63, 293.66, 246.94, 329.63];
    const oHookC = [196.0, 220.0, 246.94, 293.66, 329.63, 293.66, 246.94, 220.0];
    const oHookD = [493.88, 440.0, 392.0, 329.63, 246.94, 293.66, 329.63, 392.0];
    const oPenta = [164.81, 196.0, 220.0, 246.94, 293.66, 329.63, 392.0, 440.0];
    for (k = 0; k < def.beats; k++) {
      const oPhrase = Math.floor(k / 8);
      const oNote = (oPhrase === 0 ? oHook : oPhrase === 1 ? oHookB : oPhrase === 2 ? oHookC : oHookD)[k % 8];
      tone(out, { wave: "triangle", f0: oNote, t0: k * beat, dur: beat * 0.9, a: 0.008, d: 0.16, s: 0.08, r: 0.28, gain: (oPhrase % 2) === 0 ? 0.2 : 0.26 });
      tone(out, { wave: "sine", f0: oNote * 2, t0: k * beat, dur: beat * 0.38, a: 0.006, d: 0.1, s: 0, r: 0.16, gain: (oPhrase % 2) === 0 ? 0.028 : 0.040 });
      if ((k & 1) === 0) tone(out, { wave: "sine", f0: 55, t0: k * beat, dur: beat * 0.18, a: 0.003, d: 0.07, s: 0, r: 0.07, gain: 0.2 });
      if ((oPhrase % 2) === 1 && (k & 1)) tone(out, { wave: "triangle", f0: oNote * 0.5, t0: k * beat, dur: beat * 1.2, a: 0.012, d: 0.16, s: 0.06, r: 0.3, gain: 0.08 });
    }
    for (k = 0; k < def.beats * 2; k++) {
      tone(out, { wave: "sine", f0: oPenta[(k * 3) % 8], t0: k * beat / 2, dur: beat / 2.4, a: 0.002, d: 0.05, s: 0, r: 0.05, gain: 0.030 });
    }

  } else if (tid === "abyss") {
    // 【v1.103/v1.159/v1.160】D Phrygian: saw drone + 小二度 pad + 心跳 thump
    tone(out, { wave: "saw", f0: 73.42, t0: 0, dur: loopSec, a: 0.3, d: 0.5, s: 0.85, r: 0.4, gain: 0.17 });   // D2
    tone(out, { wave: "saw", f0: 146.83, t0: 0, dur: loopSec, a: 0.35, d: 0.5, s: 0.8, r: 0.4, gain: 0.08 });  // D3
    tone(out, { wave: "triangle", f0: 146.83, t0: 0, dur: loopSec, a: 0.2, d: 0.4, s: 0.3, r: 0.5, gain: 0.10 }); // D3 pad
    tone(out, { wave: "triangle", f0: 155.56, t0: 0, dur: loopSec, a: 0.2, d: 0.4, s: 0.3, r: 0.5, gain: 0.085 }); // Eb3 小二度
    tone(out, { wave: "triangle", f0: 293.66, t0: loopSec / 2, dur: loopSec / 2, a: 1.2, d: 0.8, s: 0.22, r: 0.9, gain: 0.045 }); // D4 后半高线
    for (k = 0; k < def.beats / 2; k++) {
      const th = k * beat * 2;
      tone(out, { wave: "sine", f0: 55, t0: th, dur: 0.14, a: 0.004, d: 0.1, s: 0, r: 0.04, gain: 0.9 });
      tone(out, { wave: "sine", f0: 55, t0: th + 0.2, dur: 0.1, a: 0.004, d: 0.07, s: 0, r: 0.03, gain: 0.65 });
    }

  } else if (tid === "win") {
    // 【v1.160】C 大调上行
    // 【v1.170】补低音基础层（与游戏 _renderBgmTrack 逐字一致）：
    //   原 win 是唯一**没有任何低音层**的曲目（lose 有 A2 衬底、场景曲都有低音层）
    //   → 实测 <200Hz 能量 5.8% vs lose 31.9%（峰值/RMS/峰均比却几乎相同 = 等响但没"身体"）。
    //   补它自己的调性根音（不抄 lose 的暗色 A2），双八度 + 微失谐对，只给落地感。
    const wF = [523.25, 659.26, 783.99, 1046.5, 1318.5];
    const wT = [0, 0.26, 0.52, 0.86, 1.14];
    const wShape = [0.84, 0.92, 1.0, 0.88, 1.0];
    for (i = 0; i < wF.length; i++) tone(out, { wave: "triangle", f0: wF[i], t0: wT[i], dur: i === 4 ? 0.96 : 0.44, a: 0.012, d: 0.2, s: 0.2, r: i === 4 ? 0.32 : 0.25, gain: 0.5 * wShape[i] });
    for (i = 0; i < 4; i++) tone(out, { wave: "sine", f0: wF[i] * 2, t0: wT[i], dur: 0.24, a: 0.008, d: 0.13, s: 0, r: 0.1, gain: 0.09 });
    // 【v1.170】低音基础层(自己的调性根音, 双八度 + 微失谐)
    tone(out, { wave: "sine", f0: 65.41,  t0: 0, dur: loopSec, a: 0.14, d: 0.5,  s: 0.3,  r: 0.6, gain: 0.30 });  // C2 胸腔层
    tone(out, { wave: "sine", f0: 130.81, t0: 0, dur: loopSec, a: 0.12, d: 0.45, s: 0.24, r: 0.6, gain: 0.24 }); // C3
    tone(out, { wave: "sine", f0: 132.0,  t0: 0, dur: loopSec, a: 0.12, d: 0.45, s: 0.24, r: 0.6, gain: 0.16 }); // C3 微失谐(破相位抵消)
    // 【v1.170】中低音接续层: melody 从 C5(523) 起, 低音只到 C3(131) → 中间 C4(262) 空一节,
    //   实测 lowmid(250-500Hz) 仅 0.02% (lose 72.6% / 场景曲 11-43%) = 声音"空心"。
    //   补 C 大调的三音 G3=196Hz(和弦本身的音, 不引入新音级) + C4 根音, 把两层缝起来。
    tone(out, { wave: "triangle", f0: 196.0,  t0: 0, dur: loopSec, a: 0.1, d: 0.4, s: 0.2, r: 0.6, gain: 0.14 }); // G3 五音
    tone(out, { wave: "triangle", f0: 261.63, t0: 0, dur: loopSec, a: 0.1, d: 0.4, s: 0.2, r: 0.6, gain: 0.11 }); // C4 根音

  } else if (tid === "lose") {
    // 【v1.160】a 小调下行
    const lF = [440.0, 392.0, 329.63, 261.63, 220.0];
    const lT = [0, 0.32, 0.64, 1.08, 1.4];
    const lShape = [0.88, 0.94, 1.0, 0.86, 0.98];
    for (i = 0; i < lF.length; i++) tone(out, { wave: "triangle", f0: lF[i], t0: lT[i], dur: i === 4 ? 1.0 : 0.48, a: 0.014, d: 0.25, s: 0.18, r: 0.3, gain: 0.5 * lShape[i] });
    tone(out, { wave: "sine", f0: 110.0, t0: 0, dur: loopSec, a: 0.09, d: 0.4, s: 0.16, r: 0.6, gain: 0.18 });
  }
  return { out, loopSec, jingle: !!def.jingle };
}

// 峰值归一（游戏 _bakeBgmTrack 口径）
function normalize(out) {
  let peak = 0;
  for (let i = 0; i < out.length; i++) { const v = Math.abs(out[i]); if (v > peak) peak = v; }
  if (peak > 0.0001) { const k = PEAK_NORM / peak; for (let q = 0; q < out.length; q++) out[q] *= k; }
  return peak;
}
// 尾部余弦淡出（与已修好的 6 条同口径，防循环接缝）
function tailFade(out) {
  const L = Math.min(Math.round(SR * TAIL_FADE_MS / 1000), out.length >> 3);
  for (let i = 0; i < L; i++) out[out.length - L + i] *= (0.5 - 0.5 * Math.cos(Math.PI * (i / L)));
}

// 16bit PCM WAV（单声道，与现有 6 条一致）
function toWav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);            // PCM
  buf.writeUInt16LE(1, 22);            // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);       // byte rate
  buf.writeUInt16LE(2, 32);            // block align
  buf.writeUInt16LE(16, 34);           // bits
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.round(samples[i] * 32767);
    if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
    buf.writeInt16LE(v, 44 + i * 2);
  }
  return buf;
}

// 接缝指标（物理正确口径，与 audio-audit 的 ⑥ 一致）
function seamRatio(d) {
  const jump = Math.abs(d[0] - d[d.length - 1]);
  const diffs = [];
  for (let i = 1; i < d.length; i += 16) diffs.push(Math.abs(d[i] - d[i - 1]));
  diffs.sort((a, b) => a - b);
  const p95 = diffs[Math.floor(diffs.length * 0.95)] || 1e-6;
  return +(jump / p95).toFixed(2);
}

const outDir = path.join('game', 'audio');
console.log(`模式: ${APPLY ? 'APPLY' : 'DRY-RUN'}  →  ${outDir}`);
console.log('| 轨道 | 时长s | 峰值 | 接缝(xP95) | RMS | 输出 |');
console.log('|---|---|---|---|---|---|');
const results = {};
for (const tid of ['horde', 'abyss', 'win', 'lose']) {
  const { out, jingle } = renderTrack(tid);
  const rawPeak = normalize(out);
  tailFade(out);
  let rms = 0;
  for (let i = 0; i < out.length; i++) rms += out[i] * out[i];
  rms = Math.sqrt(rms / out.length);
  const ratio = seamRatio(out);
  const file = `bgm_${tid}.wav`;
  const dest = path.join(outDir, file);
  const exists = fs.existsSync(dest);
  if (APPLY) fs.writeFileSync(dest, toWav(out));
  console.log(`| ${tid} | ${(out.length / SR).toFixed(2)} | ${PEAK_NORM} | **${ratio}** | ${rms.toFixed(4)} | ${file}${exists ? '（覆盖）' : '（新建）'} |`);
  results[tid] = { dur: +(out.length / SR).toFixed(3), seam: ratio, rms: +rms.toFixed(4), rawPeak: +rawPeak.toFixed(3), file };
}
fs.writeFileSync(path.join('ci', 'out', 'render-bgm.json'), JSON.stringify(results, null, 2));
console.log(`\n${APPLY ? '已写入 4 个 wav' : '（DRY-RUN，未写文件；加 --apply 落盘）'}`);
