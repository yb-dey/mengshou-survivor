#!/usr/bin/env node
/**
 * audio-manifest.mjs —— 音频交付清单（指纹台账）+ 一致性门禁
 *
 * 为什么需要它（本轮真实踩的坑，代价 = 3 次云端 CI 假报警排查）：
 *   `game/audio/bgm_abyss.wav` 本地与仓库**不是同一份**（字节大小相同、内容不同：
 *   本地 md5 356bdbc0…，云端 ccdc40e3…）。于是：
 *     · `ci/bgm-melody.py`（读频谱/占比）**看不出**差别 → 全绿；
 *     · `ci/bgm-lane-loudness.py`（读响度）差别 4.28 dB → 报"档内跳档"。
 *   报警指向的是**下游症状**（响度不齐），而根因是**上游交付缺件**（wav 没推上去）。
 *   方向感全错，白排查三轮。
 *
 *   ⇒ 必须有一个**只做一件事**的门禁：断言"仓库里的音频 == 台账记录的音频"。
 *     这样任何"本地改了没推"都会在第一现场以**明确措辞**报出来：
 *       ✗ game/audio/bgm_abyss.wav 指纹不符（台账 … 实际 …）→ 疑似本地改动未推送
 *
 * 台账（audio-manifest.json）记录什么：
 *   · 每个 wav 的 sha256 + 字节数（内容真身）
 *   · 渲染脚本自身的 sha256（防止"脚本改了但 wav 没重烘"）
 *   · 逐曲 trim 表（CONFIG.audio.bgmTrim 的镜像，防止"配置改了但表没跟"）
 *
 * 用法：
 *   node ci/audio-manifest.mjs --write   # 写/刷新台账（本地，改完美术音频后手动跑）
 *   node ci/audio-manifest.mjs           # 校验（CI 必跑）—— 不符即 exit 1
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const AUDIO = path.join(ROOT, 'game', 'audio');
const MANIFEST = path.join(HERE, 'audio-manifest.json');

const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

/** 逐曲 trim 表 —— 与 ci/bgm-lane-loudness.py 的 TRACK_TRIM 同源（源码 CONFIG.audio.bgmTrim） */
const TRACK_TRIM = { bgm_march: 0.83, bgm_horde: 0.6597, bgm_abyss: 1.1872 };

/** 参与渲染/配平的关键脚本（改了它们就该重烘 + 刷台账） */
const TOOLING = [
  'ci/render-missing-bgm.mjs',
  'ci/render-missing-sfx.mjs',
  'ci/bgm-lane-loudness.py',
  'ci/bgm-melody.py',
];

function collect() {
  const files = fs
    .readdirSync(AUDIO)
    .filter((f) => f.endsWith('.wav'))
    .sort();
  const wav = {};
  for (const f of files) {
    const p = path.join(AUDIO, f);
    wav[f] = { sha256: sha256(p), bytes: fs.statSync(p).size };
  }
  const tooling = {};
  for (const t of TOOLING) {
    const p = path.join(ROOT, t);
    tooling[t] = fs.existsSync(p) ? sha256(p) : null;
  }
  return {
    _comment:
      '音频交付清单：--write 生成，CI 校验。任何"本地改了没推"都会在此第一现场报出，' +
      '避免下游响度/频谱门禁报出方向感错误的症状。',
    audioDir: 'game/audio',
    trackTrim: TRACK_TRIM,
    tooling,
    wav,
  };
}

const fail = [];
const note = [];
const mode = process.argv.includes('--write') ? 'write' : 'verify';
const cur = collect();

if (mode === 'write') {
  fs.writeFileSync(MANIFEST, JSON.stringify(cur, null, 2) + '\n', 'utf8');
  console.log('✅ 已写台账 ' + path.relative(ROOT, MANIFEST));
  console.log('   wav %d 个 ｜ tooling %d 个' % (Object.keys(cur.wav).length, Object.keys(cur.tooling).length));
  process.exit(0);
}

// ---------------- verify ----------------
if (!fs.existsSync(MANIFEST)) {
  console.error('✗ 台账不存在：' + path.relative(ROOT, MANIFEST));
  console.error('  → 先在本地跑 `node ci/audio-manifest.mjs --write` 生成后提交');
  process.exit(1);
}
const ref = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

// ① 逐文件指纹
const refNames = Object.keys(ref.wav || {});
const curNames = Object.keys(cur.wav);
for (const n of refNames) {
  if (!curNames.includes(n)) {
    fail.push('缺失：' + n + '（台账有、实际没有 → 被误删）');
    continue;
  }
  if (ref.wav[n].sha256 !== cur.wav[n].sha256) {
    fail.push(
      '指纹不符：' + n +
      '\n        台账 ' + ref.wav[n].sha256.slice(0, 16) + '… (' + ref.wav[n].bytes + ' B)' +
      '\n        实际 ' + cur.wav[n].sha256.slice(0, 16) + '… (' + cur.wav[n].bytes + ' B)' +
      '\n        → 疑似「本地已改、未推送到仓库」或「推送时串了版本」'
    );
  }
}
for (const n of curNames) {
  if (!refNames.includes(n)) fail.push('新增未登记：' + n + '（跑 --write 刷新台账）');
}

// ② trim 表（配置 ↔ 门禁镜像）
for (const [k, v] of Object.entries(cur.trackTrim)) {
  const rv = (ref.trackTrim || {})[k];
  if (rv !== v) fail.push('trim 表漂移：' + k + ' 台账 ' + rv + ' / 实际 ' + v);
}

// ③ 工具脚本（提示级：脚本变了通常意味着该重烘，但不强制拦截）
for (const [t, h] of Object.entries(cur.tooling)) {
  const rh = (ref.tooling || {})[t];
  if (rh !== h) note.push('工具脚本已变（可能需重烘并刷台账）：' + t);
}

console.log('# 音频交付清单一致性（audio-manifest）');
console.log('');
console.log('> 判据：仓库内 `game/audio/*.wav` 的 sha256 必须与台账逐条一致。');
console.log('> 这条门禁**只**回答一个问题：交付物有没有被完整推送/同步。');
console.log('> 它与响度门禁互补 —— 响度门禁报"声音不齐"，本门禁报"根因是缺件"。');
console.log('');
console.log('| 项 | 值 |');
console.log('|---|---|');
console.log('| 台账 wav 数 | %d |', refNames.length);
console.log('| 实际 wav 数 | %d |', curNames.length);
console.log('| 工具脚本 | %d |', Object.keys(cur.tooling).length);
console.log('');
if (fail.length) {
  console.log('## ✗ 不一致 ' + fail.length + ' 项');
  console.log('');
  for (const f of fail) console.log('- ✗ ' + f);
  console.log('');
  console.log('### 修复');
  console.log('1. 若确为本地改动未推 → 用 `_qc/gh-put-file.mjs` 推送对应 wav');
  console.log('2. 若确为仓库侧过期 → 拉回仓库版本覆盖本地后再核对');
  console.log('3. 确认一致后 → `node ci/audio-manifest.mjs --write` 刷新台账并提交');
  if (note.length) {
    console.log('');
    console.log('## ℹ 提示');
    for (const n of note) console.log('- ' + n);
  }
  process.exit(1);
}

console.log('## ✅ 全部一致');
console.log('');
console.log('- 每份 wav 与台账指纹一致（交付完整、无版本串号）');
console.log('- trim 表与门禁镜像一致');
if (note.length) {
  console.log('');
  console.log('## ℹ 提示');
  for (const n of note) console.log('- ' + n);
}
process.exit(0);
