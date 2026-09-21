// ci/sfx-freq-vs-loud.mjs —— 「频率 × 响度」交叉判定（第十四类病根的门禁）
//
// 设计立场（游戏自己写的，两处）：
//   ① CONFIG.audio.prios 注释：
//      "抢占优先级(数字越大越不该被抢; 规格二节纵向层级: 受击/复活>BOSS>升级/选卡/结算>击杀/宝石>开火/命中)"
//   ② ci/sfx-loudness.py 头注：
//      "高频事件（每秒数次）必须显著低于低频事件（每局几次），否则长局被磨耳朵"
//
// 已有门禁只看 ①（sfx-intent-vs-real 看档间单调）；本脚本看 ②：
//   **档位内**若存在「次数高得多、响度却更高」的组合 → 意图自相矛盾，判缺陷。
//
// 输入：ci/out/sfx-runtime-freq.json（次数）+ game/audio/*.wav（响度）
// 输出：ci/out/sfx-freq-vs-loud.json + .md
// 退出码：0 通过；2 有硬缺陷；3 输入缺失（不可静默通过）

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'ci', 'out');
const IN = path.join(OUT_DIR, 'sfx-runtime-freq.json');
if (!fs.existsSync(IN)) { console.error('❌ 缺少 ' + IN + '（先跑 ci/sfx-runtime-freq.mjs）'); process.exit(3); }
const freq = JSON.parse(fs.readFileSync(IN, 'utf8'));

// ---- prios 真身（与 game 内 CONFIG.audio.prios 一一对应，抄录 + 自检）----
const PRIO = {
  SFX_FIRE: 1, SFX_HIT: 1, SFX_GEM: 2,
  SFX_LEVELUP: 3, SFX_CARD: 3, SFX_CARDSHOW: 3, SFX_CHEST: 3, SFX_EVENT: 3,
  SFX_WIN: 3, SFX_LOSE: 3, SFX_KILL: 3, SFX_UI: 3,
  SFX_BOSS_WARN: 4, SFX_BOSS_DIE: 4, SFX_EVO: 4, SFX_BOMB: 4, SFX_START: 4,
  SFX_HURT: 5, SFX_REVIVE: 5
};
const LEVEL_NAME = { 5: '受击/复活', 4: 'BOSS/开局/进化', 3: '升级/选卡/结算/击杀', 2: '宝石', 1: '开火/命中' };

// 判"冲突"所需的**实质响度差**（dB）：低于此值视为测量噪声，不判缺陷。
//   依据：本项目 `sfx-loudness.py` 的组内离群阈值是 3×1.4826×MAD（对 prio3 实测 ≈9.5dB），
//   单点差异小于 1dB 已远低于"能听出层级差"的量级（人耳对响度差的 JND 约 1dB @1kHz）。
//   取 1.0 dB 作为"实质"下限：既拦住 0.05dB 的噪声假阳性，又不放过真差异。
const MIN_GAP = 1.0;

// ---- 读响度：复用 sfx-loudness.py 的 analyze（同尺度，不重复实现）----
const PY = process.env.PY || 'python3';
let loud = {};
try {
  const raw = execFileSync(PY, ['-c', `
import importlib.util, glob, os, json
spec = importlib.util.spec_from_file_location('sl','ci/sfx-loudness.py')
m = importlib.util.module_from_spec(spec)
try: spec.loader.exec_module(m)
except SystemExit: pass
out={}
for f in sorted(glob.glob('game/audio/sfx_*.wav')):
    r=m.analyze(f)
    out[os.path.basename(f).replace('sfx_','').replace('.wav','')]=r['loudW']
print(json.dumps(out))
`], { cwd: ROOT, encoding: 'utf8' });
  loud = JSON.parse(raw);
} catch (e) {
  console.error('❌ 读取响度失败（需 python3 + ci/sfx-loudness.py）: ' + String(e.message).slice(0, 200));
  process.exit(3);
}

// ---- 次数表：把运行时指纹行映射到 prios 的 key ----
//   ⚠ 合并行（SFX_HIT/GEM、SFX_LEVELUP/BOMB）按**较大次数**保守取值 ——
//   不能拆就取上界，宁可把缺陷抓出来，不要因合表放过。
const rows = freq.rows || [];
const perMin = {};        // key -> 次/分钟
const merged = [];
rows.forEach((r) => {
  const nm = r.name;
  if (!nm || nm.indexOf('SFX_') !== 0) return;
  if (nm.indexOf('/') >= 0) {
    const ks = nm.split('/');
    merged.push({ keys: ks, perMin: r.perMin, len: r.len });
    ks.forEach((k) => { perMin[k] = Math.max(perMin[k] || 0, r.perMin); });
  } else {
    perMin[nm] = Math.max(perMin[nm] || 0, r.perMin);
  }
});

// ---- 判定 ----
//   ⚠ 键形状差异：`loud` 来自 sfx-loudness.py，键是**裸名**（levelup）；
//     PRIO 用的是**常量名**（SFX_LEVELUP）。必须显式换算，否则整表读成 0（踩过）。
const k6 = (k) => String(k).replace(/^SFX_/, '').toLowerCase();

const out = [];
out.push('# SFX「频率 × 响度」交叉判定');
out.push('');
out.push('> 判据来源：游戏自己的两条设计立场 ——');
out.push('> ① `CONFIG.audio.prios` 5 级纵向层级；② `sfx-loudness.py` 头注「高频必须显著低于低频」。');
out.push('> 已有门禁只看 ① 的档**间**单调；本门禁查 **档内**是否存在"次数高得多、却更响"。');
out.push('');
out.push('| 档 | 事件 | 次/分钟 | loudW dB | 档内次数排名 | 档内响度排名 | 判定 |');
out.push('|---|---|---|---|---|---|---|');

const issues = [];
const levelStats = {};
[5, 4, 3, 2, 1].forEach((p) => {
  const keys = Object.keys(PRIO).filter((k) => PRIO[k] === p && perMin[k] !== undefined);
  if (!keys.length) return;
  const byN = keys.slice().sort((a, b) => perMin[b] - perMin[a]);
  const byL = keys.slice().sort((a, b) => (loud[k6(a)] || 0) - (loud[k6(b)] || 0));
  levelStats[p] = { n: keys.length, maxPerMin: perMin[byN[0]], minPerMin: perMin[byN[byN.length - 1]],
                    maxLoud: loud[k6(byL[0])], minLoud: loud[k6(byL[byL.length - 1])] };
  keys.forEach((k) => {
    const rn = byN.indexOf(k) + 1, rl = byL.indexOf(k) + 1;
    const lv = loud[k6(k)];
    if (lv === undefined) { out.push('| ' + p + ' | ' + k + ' | ' + perMin[k].toFixed(2) + ' | — | ' + rn + '/' + keys.length + ' | — | ⚠ 缺响度 |'); return; }
    // 冲突判定（三层，必须**同时**成立才算）：
    //   ① 次数排名在前 1/3  ② 响度排名在前 1/3
    //   ③ **实质差距**：它比"档内次数最高者"的响度高 ≥ MIN_GAP dB。
    //   ⚠ ③ 是必须的 —— 只看排名会造**假阳性**：本项目实测 `SFX_UI`(74.29) 与
    //     `SFX_CARDSHOW`(74.24) 差 0.05dB，纯测量噪声，却被排名判成"第 2 响"。
    //     排名是无量纲的，只要样本够多，0.05dB 也能排到前面 → 必须加绝对门限。
    const topN = Math.max(1, Math.ceil(keys.length / 3));
    const busiest = k6(byN[0]);
    const gap = lv - (loud[busiest] || lv);
    let verdict = '';
    if (rn <= topN && rl <= topN && keys.length >= 4 && gap >= MIN_GAP) {
      verdict = '⚠ **冲突** (+' + gap.toFixed(2) + 'dB vs 最频)';
      issues.push({ prio: p, key: k, rn, rl, perMin: perMin[k], loud: lv, gap: +gap.toFixed(2), busiest: byN[0] });
    }
    out.push('| ' + p + ' | ' + k + ' | ' + perMin[k].toFixed(2) + ' | ' + lv.toFixed(2) +
             ' | ' + rn + '/' + keys.length + ' | ' + rl + '/' + keys.length + ' | ' + verdict + ' |');
  });
});

// ---- 全局判据（比"档内前 1/3"稳，且不依赖人为分档）----
//   设计立场是**跨档互斥**的：每秒数次的必须比每局几次的轻。
//   最稳的量法：取"高频组（>100 次/min）的最响"vs"低频组（<1 次/min）的最轻"，
//   高频组最大值必须 **小于** 低频组最小值 —— 否则两组区间重叠 = 立场被违反。
const HIGH_HZ = 100, LOW_HZ = 1;
const hi = Object.keys(perMin).filter((k) => perMin[k] > HIGH_HZ);
const lo = Object.keys(perMin).filter((k) => perMin[k] < LOW_HZ);
const hiMax = Math.max.apply(null, hi.map((k) => loud[k6(k)] || -Infinity));
const loMin = Math.min.apply(null, lo.map((k) => loud[k6(k)] || Infinity));
const sep = (hi.length && lo.length) ? +(loMin - hiMax).toFixed(2) : null;

// Spearman 秩相关（次数 vs 响度）：期望显著负
const all = Object.keys(perMin).filter((k) => loud[k6(k)] !== undefined);
const byF = all.slice().sort((a, b) => perMin[b] - perMin[a]);
const byLd = all.slice().sort((a, b) => loud[k6(b)] - loud[k6(a)]);
const rankF = {}, rankL = {};
byF.forEach((k, i) => { rankF[k] = i; });
byLd.forEach((k, i) => { rankL[k] = i; });
let d2 = 0; all.forEach((k) => { d2 += (rankF[k] - rankL[k]) ** 2; });
const rho = all.length > 2 ? +(1 - 6 * d2 / (all.length * (all.length * all.length - 1))).toFixed(3) : null;

out.push('');
out.push('## 全局判据（不依赖人为分档）');
out.push('');
out.push('- 高频组（>' + HIGH_HZ + ' 次/min，' + hi.length + ' 个）：最响 **' + (hi.length ? hiMax.toFixed(2) : '—') + ' dB**');
out.push('- 低频组（<' + LOW_HZ + ' 次/min，' + lo.length + ' 个）：最轻 **' + (lo.length ? loMin.toFixed(2) : '—') + ' dB**');
out.push('- 两组间隔 = **' + (sep === null ? '—' : sep + ' dB') + '**（要求 > 0，即高频组整体轻于低频组）');
out.push('- Spearman 秩相关（次数 vs 响度）= **' + (rho === null ? '—' : rho) + '**（要求显著为负）');
out.push('');
out.push('> 这两个判据不依赖 `prios` 分档，直接量"游戏自己写的立场"是否成立 ——');
out.push('> 分档表本身是人写的、可能滞后（v1.169 就漏过 4 个键），所以需要一个不依赖它的兜底判据。');

const globalIssues = [];
if (sep !== null && sep <= 0) globalIssues.push('高频组最响(' + hiMax.toFixed(2) + ') ≥ 低频组最轻(' + loMin.toFixed(2) + ') → 两组区间重叠');
if (rho !== null && rho > -0.3) globalIssues.push('Spearman ρ = ' + rho + '（>-0.3）→ 次数与响度几乎不相关');
globalIssues.forEach((g) => issues.push({ global: true, detail: g }));
out.push('');
if (merged.length) {
  out.push('## 合并计数的行（长度指纹无法区分，已按上界取值）');
  out.push('');
  merged.forEach((m) => out.push('- `' + m.keys.join(' / ') + '`：' + m.perMin.toFixed(2) + ' 次/分钟（buffer ' + m.len + '）'));
  out.push('');
}
out.push('## 档内跨度');
out.push('');
out.push('| 档 | 语义 | 条数 | 次数跨度(次/min) | 响度跨度(dB) |');
out.push('|---|---|---|---|---|');
[5, 4, 3, 2, 1].forEach((p) => {
  const s = levelStats[p]; if (!s) return;
  out.push('| ' + p + ' | ' + LEVEL_NAME[p] + ' | ' + s.n + ' | ' + s.minPerMin.toFixed(2) + ' → ' + s.maxPerMin.toFixed(2) +
           ' | ' + (s.minLoud || 0).toFixed(2) + ' → ' + (s.maxLoud || 0).toFixed(2) + ' |');
});
out.push('');
out.push('## 结论');
out.push('');
if (issues.length) {
  out.push('❌ **发现 ' + issues.length + ' 处问题**：');
  issues.forEach((i) => {
    if (i.global) out.push('- **全局**：' + i.detail);
    else out.push('- prio ' + i.prio + ' `' + i.key + '`：' + i.perMin.toFixed(2) + ' 次/min（档内第 ' + i.rn + ' 多），' +
      'loudW ' + i.loud.toFixed(2) + '（档内第 ' + i.rl + ' 响）');
  });
} else {
  out.push('✅ 无档内"高频却更响"冲突，且全局两组区间不重叠、秩相关显著为负');
}

fs.writeFileSync(path.join(OUT_DIR, 'sfx-freq-vs-loud.json'), JSON.stringify({ PRIO, perMin, loud, issues, levelStats, merged, global: { hi, lo, hiMax, loMin, sep, rho } }, null, 2), 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'sfx-freq-vs-loud.md'), out.join('\n'), 'utf8');
console.log(out.join('\n'));

if (issues.length) process.exit(2);
