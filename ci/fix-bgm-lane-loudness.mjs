#!/usr/bin/env node
// fix-bgm-lane-loudness.mjs —— 修 BGM「同档 peer 有效响度不齐」（峰值归一 ≠ 响度归一）
//
// 病根（实测，见 ci/bgm-lane-loudness.py）：
//   本作 10 首 BGM 全部按**平峰归一**(peakNorm=0.708) 烘焙 → 每首峰值都 ≈0.708，
//   但**峰值相等 ≠ 响度相等**：持续垫层型(城市/怪潮)与稀疏瞬态型(深渊心跳/霜原铃针)
//   在同一峰值下 RMS 差 **8.6 dB**。
//
// ⚠ 判决收缩（多轮实测后的重要修正，勿回退）：
//   最初想把**所有** lane 都拉平 → 实测**过度干预**：
//     ① 锚点取"该档最响者" → home 档 4 首全被顶到峰值 0.98 且残差 0.33~3.31 dB
//        （大厅整体被抬 4.4 dB，违反项目"整体响度不升"历代裁决）
//     ② 改用"中位数"锚 → 仍要把 bgm_city/harbor 压低 2.44~3.04 dB，而这两首
//        分别是大厅主力曲/首页曲 → 方向可疑
//   进一步用**感知口径交叉验证**（`_qc/_perceptual-cross.py`：100ms 短时窗）发现：
//     · 分歧在 5 种口径下都稳定在 5~6 dB → 缺陷**真实**，不是"编配风格假阳性"
//     · 但 **P95 口径**揭示了差异的**性质不同**：
//         home 档  P95 极差 4.60 dB < 均方 6.00 dB → 差异**主要来自稀疏度**
//                  （frost 的 P50 比 city 低 10 dB，P95 只低 4.6 dB）
//                  = "有声音时够响，但安静得多" → 这是**编配意图**（霜原就该疏）**不动**
//         battle 档 P95 极差 5.54 dB ≈ 均方 5.30 dB → **全时段一致地小了 5 dB**
//                  → abyss 是**真的整体轻** → 这才是缺陷
//   ⇒ 修法收缩为: **只修 battle 档内"被 1ms 瞬态独占整曲头部"的曲目**，
//      目标锚 = 同档 **P95 口径**下的较响者；home 档完全不碰。
//
// 修法（针对 abyss 这类结构病）：
//   ① **瞬态整形**：abyss 全曲 peak=0.708 只由 4 个 ~1ms 心跳瞬态决定（其余部分 peak 仅 0.594）。
//      把瞬态压到"非瞬态峰值"附近（约 -1.5 dB）→ 可用增益从 ×1.384 提到 ×1.650（+1.53 dB）。
//      代价：全曲 0.135% 样本（4 簇 ×~170 样本）；瞬态压后**仍是全曲峰值**，心跳不消失。
//   ② **P95 口径补偿增益**，再以 `PEAK_CEIL` 封顶；**不做平峰归一** —— 那正是病因。
//      ⚠ 旧版曾用"均方"口径做锚，导致残差被放大/触顶增多；P95 才是与"感知响度"最接近的口径。
//
// 幂等：`ci/audio-backup-lane/` 存首次原件；`game/audio/.lnfix.json` 记 sha1。
//   已修过的文件再跑会识别为"已修(跳过)"（`--force` 可强制重跑，仍从备份恢复后重算）。
//
// 用法: node ci/fix-bgm-lane-loudness.mjs            # DRY-RUN
//       node ci/fix-bgm-lane-loudness.mjs --apply    # 落盘
//       node ci/fix-bgm-lane-loudness.mjs --selftest # 判据阴性对照
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const SELFTEST = process.argv.includes('--selftest');
const SR_EXPECT = 44100;
const PEAK_CEIL = 0.98;            // 防削波上限（留 2% 余量）
const TRANSIENT_RATIO = 0.85;      // "超阈样本"判定：|x| > ratio × peak
const SPIKE_W = 5.0;               // 孤立瞬态判据：超阈簇宽 < 此值(ms) 且 簇数 <= SPIKE_N
const SPIKE_N = 16;                //   ——低频垫层半周期(55Hz=9ms)不可能这么窄，故窄簇必为叠加瞬态
const SPIKE_EXT = 0.50;            // 簇向两侧扩展阈值：|x| 回落到 ratio*peak 以下
const SPIKE_TGT = 0.84;            // 瞬态压到"非瞬态峰值"的 84%（约 -1.5dB，仍是全曲最响点）
// 【2026-09-22】abyss(BOSS) 专用：默认 -1.5dB 给不出足够余量（它要 +3.86dB 才够 battle 锚点），
//   需把瞬态压到≈非瞬态峰(落差比→1.02) ⇒ 压后峰值≈restPk，天花板下可施加 +4.35dB > 所需 +3.86dB。
const SPIKE_DEEP_TGT = 1.02;       // 目标"落差比"(peak/restPk)；越小压越狠。1.02=几乎压到非瞬态峰
const DEEP_SPIKE_TIDS = ["bgm_abyss"]; // ⚠ tid 带 bgm_ 前缀(与 TRACK_LANE 的 key 一致)，写成 "abyss" 不会命中
// ⚠ 原版 softKnee(KNEE=0.72) 是**空操作**：全谱峰值仅 0.70~0.72，|x|>0.72 的样本几乎为空，
//   tanh 膝点永远踩不到 → "4/4 selftest 全绿"其实绿在一个什么都没做的函数上。
//   改为「只压孤立瞬态簇」：语义明确、只动全曲 ~0.1% 样本、且保住瞬态的音乐功能。

const AUDIO = path.join('game', 'audio');
const BAK = path.join('ci', 'audio-backup-lane');
const MARK = path.join(AUDIO, '.lnfix.json');

const TRACK_LANE = {
  bgm_city: 'home', bgm_dune: 'home', bgm_frost: 'home',
  bgm_harbor: 'home', bgm_meadow: 'home',
  bgm_march: 'battle', bgm_horde: 'battle', bgm_abyss: 'battle',
  bgm_win: 'result', bgm_lose: 'result',
};
const LANE_GAIN = { home: 0.115, battle: 0.16, daily: 0.17, result: 0.12 };
// 【2026-09-22】⚠ 与门禁 `ci/bgm-lane-loudness.py: TRACK_TRIM` **必须保持一致**（同源码 CONFIG.audio.bgmTrim）。
//   修复器此前**完全不知道逐曲 trim**（有效响度 = 内容 + 20log10(laneGain) + 20log10(trim)），
//   导致它按"裸 P95"判缺斤两 → 对已被 trim 配平的曲目**误报"待修·触顶"**（abyss 就是假警报）。
//   照这个假警报去改音频，反而会把本来平衡的搞坏（实测 abyss 从 ±0.04dB 被改成 +3.87dB）。
//   ⇒ 两侧口径不一致的守卫比没有更危险：它不只是"没拦住"，它会**主动把好的改坏**。
const TRACK_TRIM = {
  bgm_march: 0.8300, bgm_horde: 0.6597, bgm_abyss: 1.1872,
  bgm_meadow: 1.3703, bgm_frost: 1.3706, bgm_dune: 1.2368,
  bgm_harbor: 1.1080, bgm_city: 1.0000
};

// ── WAV I/O（16bit PCM mono，与项目同规格）────────────────────
function readWav(p) {
  const b = fs.readFileSync(p);
  if (b.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not RIFF: ' + p);
  let pos = 12, fmt = null, dataOff = -1, dataLen = 0;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4);
    const sz = b.readUInt32LE(pos + 4);
    if (id === 'fmt ') fmt = { sr: b.readUInt32LE(pos + 12), ch: b.readUInt16LE(pos + 10), bits: b.readUInt16LE(pos + 22) };
    else if (id === 'data') { dataOff = pos + 8; dataLen = sz; break; }
    pos += 8 + sz + (sz & 1);
  }
  if (!fmt || dataOff < 0) throw new Error('bad wav: ' + p);
  const n = dataLen / 2;
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) s[i] = b.readInt16LE(dataOff + i * 2) / 32768;
  return { fmt, samples: s };
}

function writeWav(p, fmt, samples) {
  const n = samples.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(fmt.sr, 24);
  b.writeUInt32LE(fmt.sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.round(samples[i] * 32767);
    if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
    b.writeInt16LE(v, 44 + i * 2);
  }
  fs.writeFileSync(p, b);
}

// ── P95 口径短时响度（100ms 窗 / 25ms 跳；最接近"感知响度"的可比量）────
function p95Db(sig, sr) {
  const f = kWeight(sig, sr);
  const win = Math.max(1, Math.floor(sr * 0.100));
  const hop = Math.max(1, Math.floor(sr * 0.025));
  const vals = [];
  for (let s0 = 0; s0 < Math.max(1, f.length - win); s0 += hop) {
    let ms = 0;
    for (let i = s0; i < s0 + win && i < f.length; i++) ms += f[i] * f[i];
    vals.push(ms / Math.min(win, f.length - s0));
  }
  vals.sort((a, b) => a - b);
  return 10 * Math.log10(vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.95))] + 1e-30);
}

function kWeight(sig, sr) {
  const dt = 1 / sr;
  const rc = 1 / (2 * Math.PI * 100);
  const a = rc / (rc + dt);
  let yp = 0, xp = 0;
  const hp = new Float64Array(sig.length);
  for (let i = 0; i < sig.length; i++) {
    const x = sig[i];
    const y = a * (yp + x - xp);
    hp[i] = y; xp = x; yp = y;
  }
  const rc2 = 1 / (2 * Math.PI * 8000);
  const a2 = dt / (rc2 + dt);
  const out = new Float64Array(hp.length);
  let y = 0;
  for (let i = 0; i < hp.length; i++) { y = y + a2 * (hp[i] - y); out[i] = y; }
  return out;
}

// 只对这些 lane 做补偿（home 档经感知口径验证为"编配意图差异"，不动）
const FIX_LANES = new Set(['battle', 'result']);
// 只对"存在孤立瞬态"的曲目做补偿（= 真·头部被瞬态独占）；其余即使档内不齐也不动
const NEED_LANES = new Set(['battle']);

// ── 目标锚（**钉死的常量**，绝不从"当前文件"现算）────────────────
// ⚠ 这里踩过一个隐蔽的坑，必须写下来：
//   最初 target[lane] = max(当前各曲 rawP95)。在**已修好**的仓库上重跑时，abyss 的 P95
//   已被抬高 → 锚跟着水涨船高 → 又得出"还需 +1.69 dB"，永远收敛不了。
//   CI 上尤其致命：`.lnfix.json` 不在版本控制里（点开头的本地标记），CI 把它当"原文件"，
//   于是 **dry-run 报"待修"** —— 幂等机制在换机器/CI 上整体失效。
//   ⇒ 锚必须是**常量**（"希望 battle 档达到的 P95"），且幂等改为"**当前值是否已达锚**"判定，
//     完全不依赖任何标记文件。
//   取值依据（**只抬不压**——锚是"下限"不是"等值目标"）：
//     修复前 battle 档 P95：march −17.37 / horde −19.05 / abyss −22.91（未加 lane 增益）
//     · horde 是最轻的"正常峰"曲（无瞬态独占）→ 它就是该档的合理下限
//     · 目标 = 让 abyss 追到 **horde 略下**（−19.05），即把 5.3dB 断崖压到 ~1dB
//     · 比锚响的曲目（march）**绝不压低**（need > 0 才算）
//   ⚠ abyss 的"已修值"（−18.70，比 horde 还高）是**一次过头**的结果：压瞬态后可用增益 1.65×
//     被用满（封顶 0.98），把整曲抬过了头。新锚 −19.05 会把它正确回落到"恰好齐平 horde"。
const ANCHOR_P95 = { battle: -19.05, result: null, home: null };
// 【2026-09-22】锚点取自哪一曲：目标必须**连同该曲的 trim** 一起算，否则目标比真实有效电平高
//   出一个 trim 的量（battle 锚点是 horde，trim=0.6597 → -3.61dB）。改前目标 -34.97，
//   而 horde 实际有效 -36.68 ⇒ 三首都"低于锚"，修复器就误报"都要抬"（含已配平的 abyss）。
const ANCHOR_TID = { battle: "bgm_horde", result: null, home: null };
// 只抬不压：need = 锚 − 当前值，且 need > 0 才动手
const ONLY_RAISE = true;

function peakOf(sig) { let p = 0; for (let i = 0; i < sig.length; i++) { const v = Math.abs(sig[i]); if (v > p) p = v; } return p; }
function sha1(p) { return crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 16); }

// ── 孤立瞬态检测 + 局部压制 ───────────────────────────────
// 真信号不是"超阈样本占比"（那是**所有**曲目的普遍属性：垫层本身就不高，
// 峰值天然高于主体，占比全都 < 0.1%），而是"**超阈样本聚成的时间簇有多窄**"：
//   整段波形顶过阈 → 簇宽 = 一个波形半周期（22~41ms）  → 常规峰，别动
//   叠加打击瞬态   → 簇宽 0.3~1.2ms（远窄于任何音频半周期）→ 真正的头部独占者
function findSpikes(sig) {
  const pk = peakOf(sig);
  const out = { pk, n: 0, frac: 0, offs: [], spans: [], maxW: 0, spikes: false, th: 0 };
  if (pk <= 0) return out;
  const th = TRANSIENT_RATIO * pk;
  out.th = th;
  const gap = Math.max(1, Math.floor(SR_EXPECT * 0.020));
  const idx = [];
  for (let i = 0; i < sig.length; i++) if (Math.abs(sig[i]) > th) idx.push(i);
  out.n = idx.length;
  out.frac = idx.length / sig.length;
  if (!idx.length) return out;
  // 聚簇（间隔 > 20ms 断开）
  const spans = [];
  let start = idx[0], prev = idx[0];
  for (let j = 1; j < idx.length; j++) {
    if (idx[j] - prev > gap) { spans.push([start, prev]); start = idx[j]; }
    prev = idx[j];
  }
  spans.push([start, prev]);
  const widths = spans.map(([a, b]) => (b - a + 1) / SR_EXPECT * 1000);
  out.spans = spans;
  out.maxW = Math.max(...widths);
  out.spikes = spans.length <= SPIKE_N && out.maxW < SPIKE_W;
  if (!out.spikes) return out;
  // 定位：每簇向两侧扩到 |x| 回落到 TRANSIENT_RATIO*peak 以下（用 SPIKE_EXT 定格）
  const ext = SPIKE_EXT * pk;
  for (let j = 0; j < spans.length; j++) {
    let lo = spans[j][0], hi = spans[j][1];
    while (lo > 0 && Math.abs(sig[lo]) > ext) lo--;
    while (hi < sig.length - 1 && Math.abs(sig[hi]) > ext) hi++;
    out.offs.push([lo, hi]);
  }
  return out;
}

// 把每个瞬态簇按 scale 缩放（簇内样本才动；组内用平滑窗避免接缝咔哒）
function scaleSpans(sig, offs, scale) {
  const out = Float64Array.from(sig);
  const ramp = Math.max(2, Math.floor(SR_EXPECT * 0.0015));  // 1.5ms 交叉渐变
  for (const [lo, hi] of offs) {
    for (let i = lo; i <= hi; i++) {
      let w = 1 - scale;
      if (i - lo < ramp) w = (1 - scale) * (i - lo) / ramp;
      else if (hi - i < ramp) w = (1 - scale) * (hi - i) / ramp;
      out[i] = sig[i] * (1 - w);
    }
  }
  return out;
}

// 把信号整体缩放到目标峰值（不做平峰归一 —— 那正是病因）
function scaleTo(sig, target) {
  const pk = peakOf(sig);
  if (pk <= 0) return { out: Float64Array.from(sig), k: 1 };
  const k = target / pk;
  const out = new Float64Array(sig.length);
  for (let i = 0; i < sig.length; i++) {
    let v = sig[i] * k;
    if (v > 1) v = 1; else if (v < -1) v = -1;
    out[i] = v;
  }
  return { out, k };
}

// ── selftest（判据阴性对照）──────────────────────────────
if (SELFTEST) {
  let ok = 0, tot = 0;
  const sr = SR_EXPECT;
  console.log('=== 孤立瞬态判据自测 ===');

  // A. 平稳正弦（簇宽 = 半周期 ≈2.3ms@220Hz... 用 60Hz 更接近垫层）→ 必须**不**判 spiky
  {
    const n = sr;
    const s = new Float64Array(n);
    for (let i = 0; i < n; i++) s[i] = 0.7 * Math.sin(2 * Math.PI * 60 * i / sr);
    const r = findSpikes(s);
    tot++;
    if (!r.spikes) { ok++; console.log(`  [A] 平稳 60Hz 正弦（簇宽 ${r.maxW.toFixed(1)}ms）→ spiky=${r.spikes}（应 false）✅`); }
    else console.log(`  [A] 平稳正弦 → spiky=${r.spikes}（应 false）❌ 簇宽 ${r.maxW.toFixed(1)}ms`);
  }
  // A2. 平稳 220Hz 正弦（簇宽更窄，2.3ms）→ 仍不得判 spiky（证明"宽窄"本身不是唯一条件）
  {
    const n = sr;
    const s = new Float64Array(n);
    for (let i = 0; i < n; i++) s[i] = 0.7 * Math.sin(2 * Math.PI * 220 * i / sr);
    const r = findSpikes(s);
    tot++;
    if (!r.spikes) { ok++; console.log(`  [A2] 平稳 220Hz 正弦（簇宽 ${r.maxW.toFixed(1)}ms）→ spiky=${r.spikes}（应 false）✅`); }
    else console.log(`  [A2] 平稳 220Hz 正弦 → spiky=${r.spikes}（应 false）❌（簇数 ${r.spans.length} 宽 ${r.maxW.toFixed(1)}ms）`);
  }
  // B. 垫层 + 4 个 1ms 瞬态（精仿 abyss 心跳：间隔 1.43s）→ 必须判 spiky
  const mkAbyss = () => {
    const n = sr * 3;
    const s = new Float64Array(n);
    for (let i = 0; i < n; i++) s[i] = 0.30 * Math.sin(2 * Math.PI * 55 * i / sr);
    for (let j = 0; j < 4; j++) {
      const o = Math.floor(sr * (0.5 + j * 0.7));
      for (let k = 0; k < 44; k++) s[o + k] = 0.95 * Math.sin(Math.PI * k / 44);  // 44 样本 ≈1ms
    }
    return s;
  };
  {
    const s = mkAbyss();
    const r = findSpikes(s);
    tot++;
    if (r.spikes) { ok++; console.log(`  [B] 垫层+4×1ms 心跳瞬态 → spiky=${r.spikes}（应 true）✅ 簇数 ${r.spans.length} 最大簇宽 ${r.maxW.toFixed(1)}ms`); }
    else console.log(`  [B] 垫层+4×1ms 瞬态 → spiky=${r.spikes}（应 true）❌ 簇数 ${r.spans.length} 最大簇宽 ${r.maxW.toFixed(1)}ms`);
  }
  // C. 压制瞬态 → 同封顶下可施加的增益必须变大（"腾出头部预算"）
  {
    const s = mkAbyss();
    const r = findSpikes(s);
    const restPk = (() => {  // 非瞬态峰值
      const m = new Uint8Array(s.length);
      for (const [lo, hi] of r.offs) for (let i = lo; i <= hi; i++) m[i] = 1;
      let p = 0;
      for (let i = 0; i < s.length; i++) if (!m[i]) p = Math.max(p, Math.abs(s[i]));
      return p;
    })();
    const sc = SPIKE_TGT * restPk / r.pk;
    const shaped = scaleSpans(s, r.offs, sc);
    const gRaw = PEAK_CEIL / peakOf(s), gSft = PEAK_CEIL / peakOf(shaped);
    tot++;
    if (peakOf(shaped) < peakOf(s) && gSft > gRaw) {
      ok++;
      console.log(`  [C] 压瞬态 ×${sc.toFixed(3)} → 峰值 ${peakOf(s).toFixed(3)}→${peakOf(shaped).toFixed(3)}；`
        + `同封顶(${PEAK_CEIL})可施加增益 ×${gRaw.toFixed(3)}→×${gSft.toFixed(3)}`
        + `（+${(20 * Math.log10(gSft / gRaw)).toFixed(2)}dB 预算）✅`);
    } else console.log(`  [C] 未腾出预算（×${gRaw.toFixed(3)}→×${gSft.toFixed(3)}）❌`);
  }
  // C2. 压制后的瞬态**必须仍是全曲峰值**（心跳不许被抹掉）
  {
    const s = mkAbyss();
    const r = findSpikes(s);
    const restPk = (() => {
      const m = new Uint8Array(s.length);
      for (const [lo, hi] of r.offs) for (let i = lo; i <= hi; i++) m[i] = 1;
      let p = 0;
      for (let i = 0; i < s.length; i++) if (!m[i]) p = Math.max(p, Math.abs(s[i]));
      return p;
    })();
    const shaped = scaleSpans(s, r.offs, SPIKE_TGT * restPk / r.pk);
    let spk = 0;
    for (const [lo, hi] of r.offs) for (let i = lo; i <= hi; i++) spk = Math.max(spk, Math.abs(shaped[i]));
    tot++;
    if (spk > peakOf(shaped) * 0.98) { ok++; console.log(`  [C2] 压制后瞬态峰值 ${spk.toFixed(4)} ≥ 全曲峰值×0.98（${(peakOf(shaped) * 0.98).toFixed(4)}）→ 仍是顶点 ✅`); }
    else console.log(`  [C2] 瞬态被压过了头：${spk.toFixed(4)} < ${(peakOf(shaped) * 0.98).toFixed(4)} ❌`);
  }
  // D. 对已合规信号（峰 0.7 平稳低频）→ 必须完全不动（不存在瞬态 → scaleSpans 不触发）
  {
    const n = 4096;
    const s = new Float64Array(n);
    for (let i = 0; i < n; i++) s[i] = 0.7 * Math.sin(2 * Math.PI * 60 * i / sr);
    const r = findSpikes(s);
    const shaped = r.spikes ? scaleSpans(s, r.offs, SPIKE_TGT) : s;
    let maxd = 0;
    for (let i = 0; i < n; i++) maxd = Math.max(maxd, Math.abs(shaped[i] - s[i]));
    tot++;
    if (maxd === 0) { ok++; console.log(`  [D] 无瞬态的平稳信号 → 恒等（最大差 ${maxd}）✅`); }
    else console.log(`  [D] 不应改动却有差 ${maxd.toExponential(1)} ❌`);
  }
  // E. 交叉渐变必须连续（不得产生接缝咔哒）：压制后相邻样本最大跳变不得超过原信号
  {
    const s = mkAbyss();
    const r = findSpikes(s);
    const shaped = scaleSpans(s, r.offs, SPIKE_TGT * 0.84);
    const jmp = (x) => { let m = 0; for (let i = 1; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m; };
    tot++;
    if (jmp(shaped) <= jmp(s) * 1.001) { ok++; console.log(`  [E] 压制后最大相邻跳变 ${jmp(shaped).toFixed(5)} ≤ 原 ${jmp(s).toFixed(5)} → 无新接缝 ✅`); }
    else console.log(`  [E] 压制引入跳变尖峰：${jmp(shaped).toFixed(5)} > ${jmp(s).toFixed(5)} ❌`);
  }
  // F. P95 口径必须对"整体变响"敏感、对"仅稀疏度变化"相对钝
  {
    const mk = (amp, duty) => {
      const n = sr * 2;
      const s = new Float64Array(n);
      const period = Math.floor(sr * 0.4);
      const on = Math.floor(period * duty);
      for (let i = 0; i < n; i++) {
        if (i % period < on) s[i] = amp * Math.sin(2 * Math.PI * 440 * i / sr);
      }
      return s;
    };
    const a = p95Db(mk(0.7, 0.9), sr);         // 密集
    const b = p95Db(mk(0.7, 0.3), sr);         // 稀疏（同幅度）
    const c = p95Db(mk(0.35, 0.9), sr);        // 密集但幅度一半
    tot++;
    if (a - c > 5.0 && Math.abs(a - b) < 3.0) {
      ok++;
      console.log(`  [F] P95 对整体变响敏感（密集 → 半幅 ${(a - c).toFixed(2)} dB），`
        + `对仅稀疏度变化钝（密集 vs 稀疏 ${Math.abs(a - b).toFixed(2)} dB < 3）✅`);
    } else console.log(`  [F] P95 口径不理想：密集-半幅 ${(a - c).toFixed(2)} dB，密集vs稀疏 ${Math.abs(a - b).toFixed(2)} dB ❌`);
  }
  console.log(`  --- ${ok}/${tot} 通过`);
  process.exit(ok === tot ? 0 : 1);
}

// ── 主流程 ─────────────────────────────────────────────
const files = fs.readdirSync(AUDIO).filter((f) => f.startsWith('bgm_') && f.endsWith('.wav')).sort();
let marks = {};
if (fs.existsSync(MARK)) { try { marks = JSON.parse(fs.readFileSync(MARK, 'utf8')); } catch (e) { marks = {}; } }

const rows = [];
for (const f of files) {
  const tid = f.slice(0, -4);
  const lane = TRACK_LANE[tid];
  if (!lane) continue;
  const p = path.join(AUDIO, f);
  // ⚠ 不再依赖 `.lnfix.json` 判"是否修过"（该文件不在版本控制 → CI/换机即失效）。
  //   幂等改为**纯函数语义**：输入当前文件 → 输出目标状态；已达标则 k=1、无需写盘。
  //   备份仍保留（首次写入前存原件），但它只用于 `--force` 重算，不参与幂等判定。
  const { fmt, samples } = readWav(p);
  if (fmt.sr !== SR_EXPECT) { console.log(`⚠ ${f} 采样率 ${fmt.sr} ≠ ${SR_EXPECT}，跳过`); continue; }
  const sp = findSpikes(samples);
  let shaped = samples, deSpike = 1;
  if (sp.spikes) {
    // 非瞬态峰值 → 瞬态压到它的 SPIKE_TGT 倍
    const m = new Uint8Array(samples.length);
    for (const [lo, hi] of sp.offs) for (let i = lo; i <= hi; i++) m[i] = 1;
    let restPk = 0;
    for (let i = 0; i < samples.length; i++) if (!m[i]) restPk = Math.max(restPk, Math.abs(samples[i]));
    // ⚠ 幂等的关键：用**落差比**（peak / restPk）判"是否已压到位"，而不是"检测到 spiky 就压"。
    //   为什么比值可以、绝对目标不行：`SPIKE_TGT × restPk` 会**随整曲增益漂移**
    //   （整曲被放大 1.65× 后 restPk 也从 0.594 涨到 0.823，目标永远追不上 → 每跑一次再压一次）。
    //   而 **peak/restPk 在等比例缩放下是不变量**：原件 0.708/0.5939 = 1.192，
    //   已修文件 0.980/0.8228 = 1.191 —— 落差已恒定，说明"压到位"了，不该再动。
    //   ⇒ 判据 = 当前落差比 > 目标落差比（1/SPIKE_TGT）才压；deSpike 用比值直接算，天然幂等。
    const curRatio = restPk > 0 ? sp.pk / restPk : 1;
    const wantRatio = DEEP_SPIKE_TIDS.indexOf(tid) >= 0 ? SPIKE_DEEP_TGT : (1 / SPIKE_TGT);
    if (curRatio > wantRatio * 1.001) {
      deSpike = wantRatio / curRatio;
      shaped = scaleSpans(samples, sp.offs, deSpike);
    }
  }
  rows.push({ f, tid, lane, p, fmt, samples: shaped, raw: samples, sp, deSpike,
              p95: p95Db(shaped, fmt.sr), peak: peakOf(shaped),
              rawPeak: sp.pk, rawP95: p95Db(samples, fmt.sr) });
}
// ⚠ 必须与门禁同口径：有效响度 = P95 + 20log10(laneGain) + 20log10(逐曲trim)
for (const r of rows) {
  r.trim = TRACK_TRIM[r.tid] === undefined ? 1 : TRACK_TRIM[r.tid];
  r.eff = r.p95 + 20 * Math.log10(LANE_GAIN[r.lane]) + 20 * Math.log10(r.trim);
}

const byLane = {};
for (const r of rows) (byLane[r.lane] = byLane[r.lane] || []).push(r);
// 目标锚 = 常量（见 ANCHOR_P95）；未设锚的 lane → 目标 = 自身（不动）
const target = {};
for (const lane in byLane) {
  const a = ANCHOR_P95[lane];
  const atId = ANCHOR_TID[lane];
  const atTrim = atId ? (TRACK_TRIM[atId] === undefined ? 1 : TRACK_TRIM[atId]) : 1;
  target[lane] = (a === null || a === undefined)
    ? Math.max(...byLane[lane].map((r) => r.eff))
    : a + 20 * Math.log10(LANE_GAIN[lane]) + 20 * Math.log10(atTrim);
}

console.log(`模式: ${APPLY ? 'APPLY' : 'DRY-RUN'} ｜ 文件 ${rows.length} ｜ 峰值封顶 ${PEAK_CEIL} ｜ 瞬态判据 簇宽<${SPIKE_W}ms且簇数<=${SPIKE_N}`);
console.log(`口径: **P95**(100ms 窗) ｜ 补偿范围: lane ∈ {${[...FIX_LANES].join(',')}} 且存在孤立瞬态 ｜ home 档经感知验证为编配意图差异，不动`);

console.log('\n### ① 孤立瞬态检测（结构性病因：极少数 1ms 瞬态独占全曲头部）\n');
console.log('| 曲目 | 原峰值 | 超阈样本 | 簇数 | 最大簇宽 | 判定 | 瞬态压到 |');
console.log('|---|---|---|---|---|---|---|');
for (const r of rows) {
  const v = r.sp.spikes ? `**孤立瞬态 → 压 ×${r.deSpike.toFixed(3)}**` : '常规峰（不动）';
  console.log(`| ${r.tid} | ${r.rawPeak.toFixed(3)} | ${r.sp.n} | ${r.sp.spans.length} | ${r.sp.maxW.toFixed(1)}ms | ${v} | ${r.sp.spikes ? r.sp.offs.length + ' 簇' : '—'} |`);
}

console.log('\n### ② 补偿增益（目标锚 = 常量 ANCHOR_P95，不从文件现算；仅 battle 档 + 有瞬态者）\n');
console.log('| 曲目 | lane | 原P95dB | 整形后P95 | 目标dB | 需 +dB | 倍率 | 新峰值 | 残差 | 状态 |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
const plan = [];
for (const lane in byLane) {
  for (const r of byLane[lane].sort((a, b) => a.eff - b.eff)) {
    const inScope = FIX_LANES.has(lane) && NEED_LANES.has(lane) && r.sp.spikes;
    // 只抬不压：need = 锚 − 当前值，但只在为正时生效（比锚响的曲目绝不压低）
    let need = inScope ? target[lane] - r.eff : 0;
    if (ONLY_RAISE && need < 0) need = 0;
    let k = Math.pow(10, need / 20);
    let newPeak = r.peak * k, cap = false;
    if (newPeak > PEAK_CEIL) { k = PEAK_CEIL / r.peak; newPeak = PEAK_CEIL; cap = true; }
    const residual = need - 20 * Math.log10(k);
    // ⚠ 判"待修"的充分条件 = **有实际增益**（|k-1| 有意义）。仅有瞬态但目标不差 → 不必重写文件：
    //   压瞬态只为"腾头部预算"，若本来不需要提响度，压它等于凭空改动（march 就属于这种）。
    const needFix = inScope && Math.abs(k - 1) > 1e-4;
    const st = (!inScope ? (lane === 'home' ? '不动(home编配差异)' : '不动(无瞬态)')
      : (needFix ? '待修' : '✅已达标'));
    plan.push({ ...r, k, newPeak, cap, residual, st, inScope, needFix });
    console.log(`| ${r.tid} | ${r.lane} | ${r.rawP95.toFixed(2)} | ${r.p95.toFixed(2)} | ${target[lane].toFixed(2)} | ${inScope ? (need >= 0 ? '+' : '') + need.toFixed(2) : '—'} | ×${k.toFixed(4)} | ${newPeak.toFixed(3)} | ${Math.abs(residual) < 0.05 ? '—' : residual.toFixed(2)} | ${st}${cap ? ' ⚠触顶' : ''} |`);
  }
}

if (!APPLY) { console.log('\n(dry-run，未落盘。加 --apply 执行)'); process.exit(0); }

fs.mkdirSync(BAK, { recursive: true });
let done = 0;
for (const it of plan) {
  if (!it.needFix) continue;                       // home / 无瞬态 / 已达标 → 完全不碰
  const bak = path.join(BAK, it.f);
  if (!fs.existsSync(bak)) fs.copyFileSync(it.p, bak);   // 首次原件只备份一次
  const { out } = scaleTo(it.samples, it.newPeak);
  writeWav(it.p, it.fmt, out);
  marks[it.tid] = { sha: sha1(it.p), k: +it.k.toFixed(6), deSpike: +it.deSpike.toFixed(6),
                    shaped: it.sp.spikes, at: new Date().toISOString().slice(0, 19) };
  done++;
}
fs.writeFileSync(MARK, JSON.stringify(marks, null, 2));
console.log(`\n✅ 落盘 ${done} 个文件 · 原件备份 ${BAK} · 标记 ${MARK}`);
