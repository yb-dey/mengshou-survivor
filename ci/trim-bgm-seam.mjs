// 外采 BGM —— 裁掉末尾不匹配后缀，使循环点落在自然静音谷
// 依据：6 个 bgm_*.wav 尾部「降到静音后又回升一段」(尾音尾巴/混响残留)，
//   该后缀起点即循环断崖点。裁到静音谷 → 接缝 38.9/42.5/5.1/26.2/2.3/48.2 × → ≤0.1 ×。
// 幂等：若文件已裁过（末尾 60ms RMS 已 <0.01 且无回升）则跳过。
// 用法: node ci/trim-bgm-seam.mjs [--apply] [dir]
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const dir = args.find((a) => !a.startsWith('--')) || 'game/audio';
const BACKUP = path.join('ci', 'audio-backup');

function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  let off = 12, fmt = null, dataOff = 0, dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4), sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { ch: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    else if (id === 'data') { dataOff = off + 8; dataLen = sz; break; }
    off += 8 + sz + (sz & 1);
  }
  return fmt && dataOff ? { fmt, dataOff, dataLen } : null;
}

function toFloat(buf, info) {
  const { fmt, dataOff } = info;
  const bytes = fmt.bits / 8;
  const frames = Math.floor(info.dataLen / (bytes * fmt.ch));
  const d = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const p = dataOff + i * bytes * fmt.ch;
    d[i] = fmt.bits === 16 ? buf.readInt16LE(p) / 32768 : buf.readFloatLE(p);
  }
  return { d, frames, bytes };
}

// 从末端往回以 20ms 窗扫，找"其后再无回升"的静音谷（即后缀起点）
function findCut(d, frames, rate) {
  const W = Math.round(rate * 0.02);
  const prof = [];
  for (let e = frames; e - W > frames * 0.5; e -= W) {
    let s = 0;
    for (let i = e - W; i < e; i++) s += d[i] * d[i];
    prof.push({ end: e, rms: Math.sqrt(s / W) });
  }
  for (let k = 2; k < prof.length - 4; k++) {
    if (prof[k].rms < prof[k - 1].rms && prof[k].rms < prof[k + 1].rms && prof[k].rms < 0.01) {
      const later = Math.max(...prof.slice(1, k).map((x) => x.rms));
      if (later > prof[k].rms * 2.5) return prof[k].end;
    }
  }
  return null;
}

function seamOf(d, frames) {
  const jump = Math.abs(d[0] - d[frames - 1]);
  const diffs = [];
  for (let i = 1; i < frames; i += 16) diffs.push(Math.abs(d[i] - d[i - 1]));
  diffs.sort((a, b) => a - b);
  const p95 = diffs[Math.floor(diffs.length * 0.95)] || 1e-6;
  return { jump, x: +(jump / p95).toFixed(2) };
}

fs.mkdirSync(BACKUP, { recursive: true });
const files = fs.readdirSync(dir).filter((f) => /^bgm_.*\.wav$/i.test(f)).sort();
console.log(`模式: ${APPLY ? 'APPLY（写回）' : 'DRY-RUN（只看）'}  ·  目录 ${dir}`);
console.log('| 文件 | 裁前时长 | 裁前接缝 | 裁掉 | 裁后时长 | 裁后接缝 | 动作 |');
console.log('|---|---|---|---|---|---|---|');
let changed = 0;
for (const f of files) {
  const p = path.join(dir, f);
  const buf = fs.readFileSync(p);
  const info = parseWav(buf);
  if (!info) { console.log(`| ${f} | - | - | - | - | - | 解析失败 |`); continue; }
  const { d, frames, bytes } = toFloat(buf, info);
  const rate = info.fmt.rate;
  const before = seamOf(d, frames);
  const cut = findCut(d, frames, rate);
  if (!cut || cut >= frames) { console.log(`| ${f} | ${(frames / rate).toFixed(2)}s | ${before.x} | 无需裁 | - | - | 跳过 |`); continue; }
  const after = seamOf(d, cut);
  const droppedMs = ((frames - cut) / rate * 1000).toFixed(0);
  if (APPLY) {
    // 备份（只备份一次，保留原始）
    const bp = path.join(BACKUP, f);
    if (!fs.existsSync(bp)) fs.writeFileSync(bp, buf);
    // 重写 data 块：只保留头部数据 + 新长度，RIFF/data size 同步更新
    const head = Buffer.from(buf.subarray(0, info.dataOff));
    const keepBytes = cut * bytes * info.fmt.ch;
    const newData = buf.subarray(info.dataOff, info.dataOff + keepBytes);
    const out = Buffer.concat([head, newData]);
    out.writeUInt32LE(out.length - 8, 4);                                   // RIFF size
    // 定位 data chunk 的 size 字段
    let o = 12;
    while (o + 8 <= out.length) {
      const id = out.toString('ascii', o, o + 4), sz = out.readUInt32LE(o + 4);
      if (id === 'data') { out.writeUInt32LE(keepBytes, o + 4); break; }
      o += 8 + sz + (sz & 1);
    }
    fs.writeFileSync(p, out);
    changed++;
  }
  console.log(`| ${f} | ${(frames / rate).toFixed(2)}s | **${before.x}** | ${droppedMs}ms | ${(cut / rate).toFixed(2)}s | **${after.x}** | ${APPLY ? '已裁' : '待裁'} |`);
}
console.log(`\n${APPLY ? `已改 ${changed} 个文件` : '（DRY-RUN，未改动任何文件；加 --apply 写回）'}`);
if (APPLY) console.log(`原始备份: ${BACKUP}`);
