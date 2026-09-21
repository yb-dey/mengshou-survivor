// resample-audio-44100.mjs —— 把 audio/ 下所有 wav 统一到 44100Hz/16bit/mono
// 原因：既有 8 个是 22050Hz（高频只到 11kHz，偏闷），新增 17 个是 44100Hz（22kHz）
//   → 同游戏内音色不统一（BGM 切换时尤其明显）。统一到 44100 保质量。
// 手法：线性插值上采样 + 轻微一阶低通（抑制镜像），峰值护栏防削波。
// 幂等：已是 44100/16/mono 的文件直接跳过。
// 用法: node ci/resample-audio-44100.mjs [--apply]
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const TARGET_RATE = 44100;
const dir = 'game/audio';
const BACKUP = path.join('ci', 'audio-backup-22050');

function parse(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF') return null;
  let off = 12, fmt = null, dataOff = 0, dataLen = 0;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), sz = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(off + 10), rate: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
    else if (id === 'data') { dataOff = off + 8; dataLen = sz; break; }
    off += 8 + sz + (sz & 1);
  }
  if (!fmt || !dataOff) return null;
  const bytes = fmt.bits / 8, bpf = bytes * fmt.ch;
  const frames = Math.floor(dataLen / bpf);
  const d = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const p = dataOff + i * bpf;
    d[i] = fmt.bits === 16 ? b.readInt16LE(p) / 32768 : b.readFloatLE(p);
  }
  return { fmt, frames, d, buf: b };
}

function resample(src, srcRate, dstRate) {
  const n = Math.round(src.length * dstRate / srcRate);
  const out = new Float64Array(n);
  const ratio = srcRate / dstRate;
  // 一阶低通（截止 ≈ 0.45×目标 Nyquist），抑制上采样镜像
  const a = 0.5;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos), i1 = Math.min(i0 + 1, src.length - 1);
    const frac = pos - i0;
    let v = src[i0] * (1 - frac) + src[i1] * frac;
    v = prev + a * (v - prev);      // 一阶 IIR
    prev = v;
    out[i] = v;
  }
  // 峰值护栏
  let peak = 0;
  for (let i = 0; i < out.length; i++) { const x = Math.abs(out[i]); if (x > peak) peak = x; }
  if (peak > 0.95) { const k = 0.95 / peak; for (let i = 0; i < out.length; i++) out[i] *= k; }
  return out;
}

function toWav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(TARGET_RATE, 24); buf.writeUInt32LE(TARGET_RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii'); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.round(samples[i] * 32767);
    if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
    buf.writeInt16LE(v, 44 + i * 2);
  }
  return buf;
}

fs.mkdirSync(BACKUP, { recursive: true });
const files = fs.readdirSync(dir).filter((f) => /\.wav$/i.test(f)).sort();
console.log(`模式: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
console.log('| 文件 | 原采样率 | 时长 | → 44100 后 | 动作 |');
console.log('|---|---|---|---|---|');
let n = 0;
for (const f of files) {
  const p = path.join(dir, f);
  const o = parse(p);
  if (!o) continue;
  if (o.fmt.rate === TARGET_RATE && o.fmt.bits === 16 && o.fmt.ch === 1) continue;
  const dur = o.frames / o.fmt.rate;
  const rs = resample(o.d, o.fmt.rate, TARGET_RATE);
  if (APPLY) {
    const bp = path.join(BACKUP, f);
    if (!fs.existsSync(bp)) fs.writeFileSync(bp, o.buf);
    fs.writeFileSync(p, toWav(rs));
  }
  console.log(`| ${f} | ${o.fmt.rate} | ${dur.toFixed(2)}s | ${(rs.length / TARGET_RATE).toFixed(2)}s | ${APPLY ? '已转' : '待转'} |`);
  n++;
}
console.log(`\n${APPLY ? `已统一 ${n} 个` : `待统一 ${n} 个`}`);
if (APPLY && n) console.log(`原始备份: ${BACKUP}`);
