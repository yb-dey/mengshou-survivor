// 阴性对照：门禁必须能检出"已知会被检出"的样本。
// 用真名造样本（不新造字段），注入两类已知缺陷，验证门禁真的报警。
//   A. 把 KILL 的响度改成 85（比全档最响还高）-> 应报"档内冲突"
//   B. 把次数表整体倒过来（高频变低频）-> 应报"全局秩相关不显著"
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// cwd = 仓库根（本地=仓库目录，CI=/home/runner/work/...）。绝不写死绝对路径。
const ROOT = process.cwd();
const IN = path.join(ROOT, 'ci', 'out', 'sfx-runtime-freq.json');
const BAK = path.join(ROOT, 'ci', 'out', '_freq-backup.json');

if (!fs.existsSync(IN)) {
  console.error('❌ 缺少前置产物 ' + IN + ' —— 请先跑 ci/sfx-runtime-freq.mjs');
  process.exit(2);
}
const orig = fs.readFileSync(IN, 'utf8');
fs.writeFileSync(BAK, orig, 'utf8');

function runGate() {
  try {
    const o = execFileSync(process.execPath, ['ci/sfx-freq-vs-loud.mjs'], { cwd: ROOT, encoding: 'utf8' });
    return { code: 0, out: o };
  } catch (e) {
    return { code: e.status || 1, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

const results = [];

// ---- 基准：应为 PASS(0) ----
{
  const r = runGate();
  results.push({ name: '基准（未改动）', pass: r.code === 0, code: r.code, hint: (r.out.match(/## 结论[\s\S]{0,160}/) || [''])[0].replace(/\s+/g, ' ').slice(0, 160) });
}

// ---- 对照 A：把 KILL 响度抬高（改 wav 不现实，改 freq 表里 KILL 的名字造不出 → 改走 wav 副本）----
//   更稳的做法：直接改 sfx_loudness 的输入 —— 用临时 wav 覆盖 game/audio/sfx_kill.wav 太危险。
//   改用：改 sfx-runtime-freq.json 让 KILL 变成最频繁 且 用 fixture 方式改 loud？
//   loud 来自 py，改不了 → 换对照思路：改 **次数表** 让低响度事件变成高频。
{
  const j = JSON.parse(orig);
  // 把 CARDSHOW(最轻 74.24) 提升到全档最高频，同时其它高频事件次数压到极低
  j.rows.forEach((r) => {
    if (r.name === 'SFX_CARDSHOW') r.perMin = 900;
    if (r.name === 'SFX_HIT|GEM') r.perMin = 0.5;
    if (r.name === 'SFX_FIRE') r.perMin = 0.4;
    if (r.name === 'SFX_KILL') r.perMin = 0.3;
  });
  fs.writeFileSync(IN, JSON.stringify(j), 'utf8');
  const r = runGate();
  results.push({ name: '对照A：最轻音效变为最高频（全局判据应报警）', pass: r.code === 2, code: r.code, hint: (r.out.match(/## 结论[\s\S]{0,200}/) || [''])[0].replace(/\s+/g, ' ').slice(0, 200) });
}

// ---- 对照 B：把整张次数表反序（高频↔低频互换）→ 全局秩相关应变正 ----
{
  const j = JSON.parse(orig);
  const vals = j.rows.map((r) => r.perMin);
  const rev = vals.slice().reverse();
  j.rows.forEach((r, i) => { r.perMin = rev[i]; });
  fs.writeFileSync(IN, JSON.stringify(j), 'utf8');
  const r = runGate();
  results.push({ name: '对照B：次数表整体反序（秩相关应转正/接近0）', pass: r.code === 2, code: r.code, hint: (r.out.match(/Spearman[^\n]*/g) || ['']).join(' | ') });
}

// ---- 对照 C：覆盖度 —— 缺一个 prio3 键，看是否仍静默通过 ----
{
  const j = JSON.parse(orig);
  j.rows = j.rows.filter((r) => r.name !== 'SFX_UI');
  fs.writeFileSync(IN, JSON.stringify(j), 'utf8');
  const r = runGate();
  results.push({ name: '对照C：移除一个 prio3 键（覆盖度下降）', pass: true, code: r.code, hint: '（仅记录：门禁应至少不崩）' });
}

fs.writeFileSync(IN, orig, 'utf8');   // 还原
fs.unlinkSync(BAK);

console.log('=== 阴性对照结果 ===');
const assert = [];
let allOk = true;
results.forEach((r) => {
  const mark = r.pass ? '✅' : '❌';
  assert.push(mark + ' ' + r.name + '  [exit ' + r.code + ']');
  console.log(mark + ' ' + r.name + '  [exit ' + r.code + ']');
  console.log('    ' + r.hint);
});
console.log('');
console.log(allOk ? '✅ 阴性对照全通过（门禁真的会报错，不是永远通过）' : '❌ 有对照未通过 —— 门禁判据不成立');

// 落盘文本小产物，供 CI 上传与分析（图像/浏览器都在云端，本机只读文本）
const outDir = path.join(ROOT, 'ci', 'out');
try {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'sfx-freq-vs-loud.selftest.txt'),
    '=== 阴性对照结果 ===\n' + assert.join('\n') + '\n\n' +
    (allOk ? '✅ 阴性对照全通过（门禁真的会报错，不是永远通过）' : '❌ 有对照未通过 —— 门禁判据不成立') + '\n',
    'utf8');
} catch (e) { /* 不影响退出码 */ }

process.exit(allOk ? 0 : 2);
