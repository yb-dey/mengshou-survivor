#!/usr/bin/env node
/**
 * audio-config-consistency.mjs —— 音频配置「多表一致性」门禁
 *
 * 为什么需要它（2026-09-22 一夜踩两次，代价很大）：
 *   同一份"逐曲配平增益"被抄在 **4 处**，同一份"曲目清单"又抄在别处：
 *     ① HTML  CONFIG.audio.bgmTrim      （真身，播放时施加）
 *     ② ci/bgm-lane-loudness.py  TRACK_TRIM   （门禁响度口径）
 *     ③ ci/fix-bgm-lane-loudness.mjs TRACK_TRIM（修复器口径）
 *     ④ ci/bgm-melody.py  TRACKS        （旋律门禁的曲目清单）
 *   不同步的后果，两个方向都致命：
 *     · ②③ 不一致 ⇒ 修复器按错尺子判缺斤两 ⇒ **假报警**（照它改会把已配平的音频改坏）
 *     · ④  漏登记 ⇒ 该曲**根本不参评**，门禁照样显示"全部通过" ⇒ **假绿**
 *
 *   本门禁只做一件事：断言这四处 + 交付目录里的 wav **彼此一致**。
 *   任何一处漏改，都在第一现场以明确措辞报出来，而不是留到下游变成"响度跳档"
 *   或"静默跳过"这类方向感全错的症状。
 *
 * 用法：
 *   node ci/audio-config-consistency.mjs            # 校验（CI 必跑），不符 exit 1
 *   node ci/audio-config-consistency.mjs --selftest # 判据阴性对照（必须能检出注入的缺陷）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const HTML = path.join(ROOT, 'game', '萌兽消消岛.html');
const AUDIO = path.join(ROOT, 'game', 'audio');
const PY_LANE = path.join(HERE, 'bgm-lane-loudness.py');
const MJS_FIX = path.join(HERE, 'fix-bgm-lane-loudness.mjs');
const PY_MELODY = path.join(HERE, 'bgm-melody.py');

/** 取 `key` 之后第一处 { } 的配平内容 */
function objectBody(src, key) {
  const i = src.indexOf(key);
  if (i < 0) return null;
  let s = src.indexOf('{', i);
  if (s < 0) return null;
  let d = 0, e = -1;
  for (let j = s; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) { e = j; break; } }
  }
  if (e < 0) return null;
  return src.slice(s + 1, e);
}

/** 从对象体里收 `键: 数值`（先剥注释，避免把注释里的数字当配置） */
function numMap(body) {
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const out = {};
  for (const m of clean.matchAll(/["']?([A-Za-z_][\w.]*)["']?\s*:\s*([0-9]*\.?[0-9]+)/g)) {
    out[m[1]] = parseFloat(m[2]);
  }
  return out;
}

/** 旋律门禁的曲目清单是 `TRACKS = { 'bgm_x.wav': dict(...) }`，键带 .wav */
function melodyKeys(src) {
  const body = objectBody(src, 'TRACKS =');
  if (!body) return {};
  const out = {};
  for (const m of body.replace(/\/\/[^\n]*/g, '').matchAll(/['"](bgm_[\w]+)\.wav['"]\s*:/g)) out[m[1]] = 1;
  return out;
}

function collect() {
  const html = fs.readFileSync(HTML, 'utf8');
  const htmlBody = objectBody(html, 'bgmTrim:');
  const rawHtml = htmlBody ? numMap(htmlBody) : {};
  // HTML 里用短名(march)，门禁/修复器用 bgm_march ⇒ 归一到带前缀
  const htmlTrim = {};
  for (const k in rawHtml) htmlTrim[k.startsWith('bgm_') ? k : 'bgm_' + k] = rawHtml[k];

  const pyLane = numMap(objectBody(fs.readFileSync(PY_LANE, 'utf8'), 'TRACK_TRIM =') || '');
  const mjsFix = numMap(objectBody(fs.readFileSync(MJS_FIX, 'utf8'), 'const TRACK_TRIM =') || '');
  const melody = melodyKeys(fs.readFileSync(PY_MELODY, 'utf8'));
  const wavs = fs.readdirSync(AUDIO).filter((f) => /^bgm_.*\.wav$/.test(f)).map((f) => f.replace(/\.wav$/, ''));
  return { htmlTrim, pyLane, mjsFix, melody, wavs };
}

function check(c) {
  const errs = [];
  const all = [...new Set([...Object.keys(c.htmlTrim), ...Object.keys(c.pyLane), ...Object.keys(c.mjsFix)])].sort();
  const EPS = 1e-4;
  for (const k of all) {
    const a = c.htmlTrim[k], b = c.pyLane[k], d = c.mjsFix[k];
    // ⚠ 特例：HTML 缺省 trim=1（`|| 1`）⇒ "HTML 里没写、但门禁值是 1" 语义等价，**不算不一致**；
    //   只有"门禁值 ≠1 却没写进 HTML"才是真漂移（改天有人把 1 改成 0.8 就会立刻被抓）。
    const missingInHtmlOk = (a === undefined && b === 1);
    if (a === undefined && !missingInHtmlOk) errs.push(`✗ ${k}: HTML CONFIG.audio.bgmTrim 缺（门禁里有 ${b}）——播放增益没配`);
    if (b === undefined) errs.push(`✗ ${k}: 门禁 bgm-lane-loudness.py 的 TRACK_TRIM 缺（HTML 里有 ${a}）`);
    if (d === undefined) errs.push(`✗ ${k}: 修复器 fix-bgm-lane-loudness.mjs 的 TRACK_TRIM 缺（HTML 里有 ${a}）——会导致假报警`);
    if (a !== undefined && b !== undefined && Math.abs(a - b) > EPS) errs.push(`✗ ${k}: HTML(${a}) ≠ 门禁(${b})`);
    if (a !== undefined && d !== undefined && Math.abs(a - d) > EPS) errs.push(`✗ ${k}: HTML(${a}) ≠ 修复器(${d})`);
    // 修复器与门禁之间也必须一致（即便 HTML 缺省）
    if (a === undefined && b !== undefined && d !== undefined && Math.abs(b - d) > EPS) errs.push(`✗ ${k}: 门禁(${b}) ≠ 修复器(${d})`);
    // 旋律门禁漏登记 ⇒ 该曲被静默跳过（假绿）
    if (c.wavs.indexOf(k) >= 0 && !c.melody[k]) errs.push(`✗ ${k}: 有 wav 但 bgm-melody.py 的 TRACKS 没登记 ⇒ 旋律门禁会**静默跳过**它（假绿）`);
  }
  return errs;
}

if (process.argv.includes('--selftest')) {
  // 阴性对照：注入 3 类已知缺陷，门禁必须全部检出，否则判据是坏的
  let ok = 0, tot = 0;
  const base = collect();
  const mk = (mut) => { const c = JSON.parse(JSON.stringify(base)); mut(c); return check(c); };
  const cases = [
    ['A. HTML 漏一条 trim', (c) => { delete c.htmlTrim.bgm_abyss; }],
    ['B. 修复器与 HTML 不一致', (c) => { c.mjsFix.bgm_abyss = 0.9999; }],
    ['C. 旋律门禁漏登记（有 wav 无声明）', (c) => { delete c.melody.bgm_abyss; }],
  ];
  console.log('## 阴性对照（注入已知缺陷，门禁必须检出）\n');
  for (const [name, mut] of cases) {
    tot++;
    const e = mk(mut);
    const pass = e.length > 0;
    if (pass) ok++;
    console.log(`| ${name} | ${pass ? '检出 ✅' : '没检出 ❌'} | ${e.length} 条 |`);
    if (e.length) console.log('    ' + e[0].replace(/✗/, '→'));
  }
  tot++;
  const clean = check(base);
  if (clean.length === 0) ok++;
  console.log(`\n| D. 当前真实配置不得误报 | ${clean.length === 0 ? '无告警 ✅' : '误报 ❌'} | ${clean.length} 条 |`);
  console.log(`\n--- ${ok}/${tot} 通过`);
  process.exit(ok === tot ? 0 : 1);
}

const c = collect();
const errs = check(c);
console.log('# 音频配置多表一致性\n');
console.log(`- HTML bgmTrim: ${Object.keys(c.htmlTrim).length} 条 | 门禁: ${Object.keys(c.pyLane).length} | 修复器: ${Object.keys(c.mjsFix).length} | 旋律清单: ${Object.keys(c.melody).length} | wav: ${c.wavs.length}`);
console.log('');
if (errs.length) {
  console.log('## ❌ 不一致\n');
  for (const e of errs) console.log('- ' + e);
  console.log('\n⇒ 修复：四处（HTML CONFIG / 门禁 py / 修复器 mjs / 旋律 py）+ 台账 一并改齐');
  process.exit(1);
}
console.log('## ✅ 全部一致\n');
console.log('- 四处 trim 表数值相同');
console.log('- 每首 wav 都在旋律门禁登记（不存在"有曲不评"的假绿）');
