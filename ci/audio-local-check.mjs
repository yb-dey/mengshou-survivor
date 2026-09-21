// 本地全量音频体检（不依赖浏览器）：格式合规 + 削波 + 接缝
// 覆盖 audio/ 全部 wav，输出表格。这是云端 audio-audit 的"离线前置闸门"。
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || 'game/audio';

function parse(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') return null;
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
    d[i] = fmt.bits === 16 ? b.readInt16LE(p) / 32768 : fmt.bits === 32 ? b.readFloatLE(p) : (b.readUInt8(p) - 128) / 128;
  }
  return { fmt, frames, d, declaredBytes: dataLen, expectBytes: frames * bpf };
}

function metrics(o) {
  const { d, frames, fmt } = o;
  let peak = 0, sum = 0, clips = 0, hi = 0;
  for (let i = 0; i < frames; i++) {
    const v = d[i], a = Math.abs(v);
    if (a > peak) peak = a;
    if (a >= 0.999) clips++;
    if (a > 0.90) hi++;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / Math.max(1, frames));
  // 接缝（长缓冲才判）
  let seam = null;
  if (fmt.rate * 3 < frames) {
    const jump = Math.abs(d[0] - d[frames - 1]);
    const diffs = [];
    for (let i = 1; i < frames; i += 16) diffs.push(Math.abs(d[i] - d[i - 1]));
    diffs.sort((a, b) => a - b);
    seam = +(jump / (diffs[Math.floor(diffs.length * 0.95)] || 1e-6)).toFixed(2);
  }
  return { dur: frames / fmt.rate, peak, rms, clips, seam, hi, hiFrac: hi / Math.max(1, frames),
           rate: fmt.rate, bits: fmt.bits, ch: fmt.ch };
}

const files = fs.readdirSync(dir).filter((f) => /\.wav$/i.test(f)).sort();
console.log('| 文件 | 时长s | 采样率 | 位深 | 声道 | 峰值 | RMS | 削波 | 接缝 | 判定 |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
let fail = 0;
for (const f of files) {
  const o = parse(path.join(dir, f));
  if (!o) { console.log(`| ${f} | - | - | - | - | - | - | - | - | ❌ 解析失败 |`); fail++; continue; }
  const m = metrics(o);
  const issues = [];
  if (m.rate !== 44100) issues.push('采样率≠44100');
  if (m.bits !== 16) issues.push('位深≠16');
  if (m.ch !== 1) issues.push('非单声道');
  if (o.declaredBytes !== o.expectBytes) issues.push('data块长度不符');
  if (m.clips > 0) issues.push(`削波${m.clips}`);
  // 峰值判据（v1.179 修订）：
  //   ⚠ 旧版是裸阈值 `peak > 0.75` —— 那是"平峰归一(peakNorm=0.708)时代"的**等值检查**，
  //     隐含要求"所有音频必须贴 0.708"。而平峰归一正是 BGM 响度不齐的病根（见
  //     ci/bgm-lane-loudness.py），修复后有曲目**有意**使用更高峰值（bgm_abyss 靠瞬态
  //     换整曲响度）。裸阈值会把"有意设计"误判为缺陷。
  //   改为按"头部占用是否为单点瞬态"区分：
  //     · peak ≤ 0.95            → 正常
  //     · peak > 0.95 且 >0.90 样本占比 < 0.1% → 单点瞬态顶点，合法（距满刻度仍有余量）
  //     · peak > 0.99 或 高位样本成片 → 过烫/逼近削波，报错
  if (m.peak > 0.99) issues.push('峰值逼近满刻度');
  else if (m.peak > 0.95 && m.hiFrac >= 0.001) issues.push(`峰值过高且成片（>0.90 占 ${(100 * m.hiFrac).toFixed(2)}%）`);
  if (m.rms < 0.01) issues.push('过轻');
  if (m.seam !== null && m.seam >= 4) issues.push(`接缝${m.seam}`);
  if (issues.length) fail++;
  console.log(`| ${f} | ${m.dur.toFixed(2)} | ${m.rate} | ${m.bits} | ${m.ch} | ${m.peak.toFixed(3)} | ${m.rms.toFixed(4)} | ${m.clips} | ${m.seam === null ? '—' : m.seam} | ${issues.length ? '❌ ' + issues.join('/') : '✅'} |`);
}
console.log(`\n共 ${files.length} 个，不合格 ${fail} 个`);
if (fail) process.exit(1);
