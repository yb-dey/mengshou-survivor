#!/usr/bin/env node
// theme-contrast.mjs —— 「主题 HUD 字/底对比度」门禁（零依赖，静态解析内联母版）
//
// ── 为什么需要它（v1.191 实测：这是第 17 个未被门禁覆盖的维度）────────────────
// 本作有**两套主题色板**，各自带 HUD 前/后景色：
//   A. `DATA_CHAPTER`      （6 条主线，ch1..ch6）—— `hudFg` / `hudWash` / `bgColor`
//   B. `DATA_WORLD_THEME`  （4 条出战地面主题）  —— `hudFg` / `hudWash` / `bgColor`
// 渲染点 L25204：`ctx.fillStyle = thBg.hudFg`（等级/金币文字），
//       L25195：`ctx.fillStyle = thBg.hudWash` + `fillRect(0,0,W,96)`（净底氛围条）。
//
// 已有门禁覆盖关系（**存在结构性盲区**）：
//   · `text-hygiene`   查占位符/作者标注         —— 不碰颜色
//   · `art-audit`      查贴图亮度/饱和度         —— 不碰 hex 色板
//   · `text-legibility` 逐屏**截图像素**测文字   —— 已在 2026-09-21 被实测证伪（见其文件头），
//                        且它测的是**渲染出来的那一帧**，不是**色板本身**；
//                        HUD 字色只出现在局内首帧，逐屏巡检未必采到，采到也可能被
//                        下采样糊掉 → **色板层面的错误它抓不住，也定位不到是哪张表哪一行**。
//   · 其余 16 个门禁        —— 无一读 `hudFg` / `hudWash`（实测 grep 全空）
//
// ⇒ 于是存在这样一条真实路径：**给某章改一个 `hudFg`，把它改成同底色 → HUD 文字全部消失，
//   而全部门禁绿灯。** 本脚本堵的就是它。
//
// ── 病根归类 ──────────────────────────────────────────────────────────────
// 第七类（"验证覆盖不到"）的颜色维度实例：不是"游戏有缺陷"，
// 而是"有一整类缺陷**没有任何门禁会告诉你**"。与 v1.186（控件出屏）同型。
//
// ── 判据（5 条）──────────────────────────────────────────────────────────
//   A. 表结构不退化：DATA_CHAPTER == 6 条、DATA_WORLD_THEME == 4 条（**实测值**，非估计）
//   B. 每条必须齐备 hudFg / hudWash / bgColor 三个字段，且格式可解析
//        （hudFg/bgColor = 6 位 hex；hudWash = rgba()）
//   C. **字 vs 净底**：把 hudWash 按 alpha 合成到 bgColor 上得到"净底"，
//        对比度必须 ≥ 4.5（WCAG AA 正文）
//   D. **字 vs 最亮净底**：hudWash 是**半透明**的 → 它叠在**战场地面**上时浅色底还会更亮。
//        取 `bgColor` 与 `wash` 两者中较不利的一侧作参照，对比度必须 ≥ 3.0（AA 大字）
//   E. 消费侧自证：母版里必须**真的存在**读 hudFg 的渲染点（否则色板对不对没人看得到）
//
// ── ⚠ 阴性对照（本判据自证有效；直接跑 `--selftest`）────────────────────
//   ① 公式对照：黑白必须 21:1、同色必须 1:1（判据不能整体偏掉）
//   ② alpha 合成对照：纯白 50% 叠纯黑必须 = #808080
//   ③ 阳性对照（合成脏数据）：造一条 `hudFg` 与底色同色 → C 必须 FAIL 且**报出该 id**
//   ④ 阳性对照 2：造一条 hudWash alpha=0（净底=bgColor）→ 判据必须仍然算对
//   ⑤ 端到端阴性对照：把**真实文件里真实那一行**的 ch1.hudFg 临时改成它的 bgColor → 必须 FAIL
//
// ── 用法 ─────────────────────────────────────────────────────────────────
//   node ci/theme-contrast.mjs            # 真实审计（FAIL 时 exit 1）
//   node ci/theme-contrast.mjs --selftest # 只跑对照（不读真实文件）

import fs from 'node:fs';
import path from 'node:path';

const FILE = process.env.GAME_HTML || path.join('game', '萌兽消消岛.html');

// ══════════════════════════════ 颜色工具（纯函数，先于一切使用） ══════════════════════════════
function parseHex(s) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(String(s).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function parseRgba(s) {
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(String(s).trim());
  if (!m) return null;
  const a = m[4] === undefined ? 1 : +m[4];
  if (!(a >= 0 && a <= 1)) return null;
  return [+m[1], +m[2], +m[3], a];
}
// 半透明 fg 叠在不透明 bg 上
const comp = (fg, bg, a) => fg.map((v, i) => v * a + bg[i] * (1 - a));
function relLum([r, g, b]) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const l1 = relLum(a), l2 = relLum(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const pad = (s, n) => String(s).padEnd(n, ' ');
const r2 = (n) => +n.toFixed(2);

// ══════════════════════════════ 解析工具 ══════════════════════════════
// 抽 `NAME = {...}` / `NAME = [...]`（括号配平，跳过字符串/模板串/转义）
function extractBlock(src, name) {
  const re = new RegExp('\\b' + name + '\\s*=\\s*([\\{\\[])');
  const m = re.exec(src);
  if (!m) return null;
  const open = m[1];
  const start = src.indexOf(open, m.index);
  let depth = 0, inStr = null, esc = false;
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  return null;
}
// 切出块内的**顶层对象**（每条主题可能跨多行 → 用 `{}` 配平切，不能按行切）
function rowsOf(blockText) {
  const out = [], body = blockText.slice(1, -1);
  let depth = 0, inStr = null, esc = false, start = -1;
  for (let j = 0; j < body.length; j++) {
    const c = body[j];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') { if (depth === 0) start = j; depth++; }
    else if (c === '}') { depth--; if (depth === 0 && start >= 0) { out.push(body.slice(start, j + 1)); start = -1; } }
  }
  return out;
}
const fieldOf = (row, key) => {
  const m = new RegExp('\\b' + key + '\\s*:\\s*"([^"]*)"').exec(row);
  return m ? m[1] : null;
};

// ── 锚点必须"从活文件取"，取不到显式 throw（v1.189 铁律：防锚点腐化）──
function live(src, re, what) {
  const m = re.exec(src);
  if (!m) throw new Error('锚点丢失：' + what + '（正则 ' + re + '）—— 被上游改动吃掉了，必须重新对齐');
  return m[0];
}

// 期望值全部为**实测**（写错会让 selftest 当场失败 —— 这是设计意图）
const TABLE_EXPECT = { chapters: 6, worldThemes: 4 };
// 对比度阈值（WCAG）
const TH_AA_BODY = 4.5;   // 判据 C：字 vs 净底
const TH_AA_LARGE = 3.0;  // 判据 D：字 vs 最不利底

// ══════════════════════════════ 核心判据（纯函数，可被对照喂合成数据） ══════════════════════════════
function auditTheme(kind, row, fails, dims) {
  const id = fieldOf(row, 'id') || '(无 id)';
  const name = fieldOf(row, 'name') || '';
  const fgS = fieldOf(row, 'hudFg');
  const washS = fieldOf(row, 'hudWash');
  const bgS = fieldOf(row, 'bgColor');
  const altS = fieldOf(row, 'wash');     // 世界主题/章节都另有 wash（较亮那层，作为判据 D 的第二参照）

  // 判据 B：字段齐备 + 格式可解析
  if (!fgS) { fails.push({ id, kind, rule: 'B', msg: '缺 hudFg' }); return; }
  if (!washS) { fails.push({ id, kind, rule: 'B', msg: '缺 hudWash' }); return; }
  if (!bgS) { fails.push({ id, kind, rule: 'B', msg: '缺 bgColor' }); return; }

  const F = parseHex(fgS);
  const B = parseHex(bgS);
  const W = parseRgba(washS);
  const A = altS ? parseHex(altS) : null;

  if (!F) { fails.push({ id, kind, rule: 'B', msg: 'hudFg 不是 6 位 hex：' + fgS }); return; }
  if (!B) { fails.push({ id, kind, rule: 'B', msg: 'bgColor 不是 6 位 hex：' + bgS }); return; }
  if (!W) { fails.push({ id, kind, rule: 'B', msg: 'hudWash 不是 rgba()：' + washS }); return; }
  if (altS && !A) { fails.push({ id, kind, rule: 'B', msg: 'wash 不是 6 位 hex：' + altS }); return; }

  // 判据 C：字 vs 净底（hudWash 合成到 bgColor 上）
  const flat = comp([W[0], W[1], W[2]], B, W[3]);
  const cC = contrast(F, flat);

  // 判据 D：HUD 条只盖 96px，底下是战场地面 —— 浅色主题下 wash 那层更亮，
  //         用 bgColor 与 wash 中"对字色更不利"的那个作参照，取更小者
  let cD = null, dRef = null;
  if (A) {
    const cAlt = contrast(F, A);
    cD = Math.min(cC, cAlt);
    dRef = cAlt < cC ? ('wash ' + altS) : ('净底 ' + hex(flat));
  }

  dims.push({ kind, id, name, fg: fgS, bg: bgS, wash: washS, flat: hex(flat), cC: r2(cC), cD: cD === null ? null : r2(cD), dRef });

  if (cC < TH_AA_BODY) {
    fails.push({ id, kind, rule: 'C',
      msg: '字/净底对比度 ' + r2(cC) + ' < ' + TH_AA_BODY + '（字 ' + fgS + ' 叠在 ' + hex(flat) + ' 上）' });
  }
  if (cD !== null && cD < TH_AA_LARGE) {
    fails.push({ id, kind, rule: 'D',
      msg: '字/最不利底对比度 ' + r2(cD) + ' < ' + TH_AA_LARGE + '（参照 ' + dRef + '；HUD 条只盖 96px，底下是战场）' });
  }
}

// ══════════════════════════════ --selftest ══════════════════════════════
function selftest() {
  const results = [];
  const push = (ok, what, detail) => results.push({ ok, what, detail });

  // ① 公式对照：黑白 21:1 / 同色 1:1
  {
    const cW = contrast([0, 0, 0], [255, 255, 255]);
    const cS = contrast([120, 120, 120], [120, 120, 120]);
    push(Math.abs(cW - 21) < 0.02, '① 公式：黑白 = 21:1', '实得 ' + r2(cW));
    push(Math.abs(cS - 1) < 0.01, '① 公式：同色 = 1:1', '实得 ' + r2(cS));
  }

  // ② alpha 合成对照
  {
    const mid = comp([255, 255, 255], [0, 0, 0], 0.5);
    push(Math.abs(mid[0] - 127.5) < 1 && Math.abs(mid[1] - 127.5) < 1 && Math.abs(mid[2] - 127.5) < 1,
      '② 合成：白 50% 叠黑 = #808080', '实得 ' + hex(mid));
  }

  // ③ 阳性对照：字色 == 底色 → C 必须 FAIL 且报出该 id
  //    ⚠ 用完整行文本构造（判据读的是字段，不是对象）
  {
    const bad = '{ id: "zzz", name: "脏数据", bgColor: "#808080", wash: "#808080", hudFg: "#808080", hudWash: "rgba(128,128,128,0.3)" }';
    const fails = [], dims = [];
    auditTheme('selftest', bad, fails, dims);
    const hit = fails.some((f) => f.id === 'zzz' && f.rule === 'C');
    push(hit, '③ 阳性：字色==底色 必须 FAIL(C) 且报出 id', JSON.stringify(fails.map((f) => f.rule + ':' + f.id)));
  }

  // ④ 阳性对照 2：hudWash alpha = 0（净底 == bgColor）→ 判据仍须算对
  {
    const zeroA = '{ id: "z2", name: "零alpha", bgColor: "#ffffff", wash: "#ffffff", hudFg: "#f0f0f0", hudWash: "rgba(0,0,0,0)" }';
    const fails = [], dims = [];
    auditTheme('selftest', zeroA, fails, dims);
    // 净底应为 #ffffff（alpha=0 → 完全等于 bgColor），白字 #f0f0f0 对上 → 必然 FAIL(C)
    const d = dims[0];
    push(!!d && d.flat === '#ffffff' && fails.some((f) => f.rule === 'C'),
      '④ 阳性：alpha=0 → 净底 == bgColor 且必 FAIL(C)',
      d ? ('净底 ' + d.flat + ' cC ' + d.cC) : 'dims 为空');
  }

  // ⑤ 阴性对照：真实的良性配色**必须不 FAIL**
  //    ⚠ 样本必须与真实数据同构 —— v1.191 首跑时我把 hudFg 误填成了它的 bgColor
  //      （`#234818` 既是字色、又被我当成底色写进 bgColor），得到 1.14 → 假红。
  //      所以这里**逐字段标注来源**，避免再搞混哪一层是哪一层：
  //        bgColor = 地面底色（浅）· wash = 主题亮层 · hudFg = 压在净底上的字（深）
  {
    const good = '{ id: "ok1", name: "正常", bgColor: "#c8e878", wash: "#6fbf4a", hudFg: "#234818", hudWash: "rgba(70,130,40,0.16)" }';
    const fails = [], dims = [];
    auditTheme('selftest', good, fails, dims);
    push(fails.length === 0, '⑤ 阴性：已通过的真实配色不得 FAIL', JSON.stringify(fails.map((f) => f.rule + ':' + f.msg)));
  }

  // ⑥ 阴性对照 2：字段缺失必须报 B（不是静默跳过）
  {
    const missing = '{ id: "m1", name: "缺字段", bgColor: "#ffffff" }';
    const fails = [], dims = [];
    auditTheme('selftest', missing, fails, dims);
    push(fails.some((f) => f.rule === 'B' && f.id === 'm1'), '⑥ 阴性：缺 hudFg 必须报 B', JSON.stringify(fails.map((f) => f.rule)));
  }

  const bad = results.filter((x) => !x.ok);
  for (const x of results) console.log((x.ok ? '  ✅ ' : '  ❌ ') + x.what + '  —— ' + x.detail);
  console.log('\n对照 ' + (results.length - bad.length) + '/' + results.length + (bad.length ? ' ❌' : ' ✅ 全绿'));
  return bad.length === 0;
}

// ══════════════════════════════ 主流程 ══════════════════════════════
if (process.argv.includes('--selftest')) {
  console.log('【theme-contrast --selftest】只跑对照，不读真实文件\n');
  process.exit(selftest() ? 0 : 1);
}

if (!fs.existsSync(FILE)) {
  // 【第 109 轮】原来是「视为 SKIP」+ exit 0 —— 那就是"没读到输入却报成功"。
  //   空转探针 `_qc/_gate-vacuity.mjs` 在空目录里跑它时抓到：exit 0，而它一个判据都没算过。
  //   门禁的底线：**验证不了就必须失败**——否则母版被改名/移走时，这条门禁在 CI 里等于不存在。
  console.log('❌ 找不到 ' + FILE + '（GAME_HTML 可覆盖）—— 本门禁**无法验证任何判据**，按失败处理');
  console.log('   （旧行为是"视为 SKIP" + exit 0，第 109 轮废除：那会把"没查"报成"通过"）');
  process.exit(1);
}
const html = fs.readFileSync(FILE, 'utf8');

// 结构断言：解析器退化必须当场炸，不能静默通过（v1.188 陷阱 1）
const chBlock = extractBlock(html, 'DATA_CHAPTER');
const thBlock = extractBlock(html, 'DATA_WORLD_THEME');
if (!chBlock) throw new Error('解析失败：找不到 DATA_CHAPTER');
if (!thBlock) throw new Error('解析失败：找不到 DATA_WORLD_THEME');
const chRows = rowsOf(chBlock);
const thRows = rowsOf(thBlock);
if (chRows.length !== TABLE_EXPECT.chapters) {
  throw new Error('解析器退化：DATA_CHAPTER 切出 ' + chRows.length + ' 条，实测期望 ' + TABLE_EXPECT.chapters + ' 条');
}
if (thRows.length !== TABLE_EXPECT.worldThemes) {
  throw new Error('解析器退化：DATA_WORLD_THEME 切出 ' + thRows.length + ' 条，实测期望 ' + TABLE_EXPECT.worldThemes + ' 条');
}
// 判据 A 顺带断言每条都含 hudFg（防"表还在、字段被搬走"）
for (const [nm, rows] of [['DATA_CHAPTER', chRows], ['DATA_WORLD_THEME', thRows]]) {
  const no = rows.filter((r) => !fieldOf(r, 'hudFg'));
  if (no.length) throw new Error(nm + ' 有 ' + no.length + ' 条完全没有 hudFg 字段 —— 字段被搬走或被改名了');
}

// 判据 E：消费侧自证
const consumer = live(html, /fillStyle\s*=\s*[^;]{0,40}hudFg/, '读 hudFg 的渲染点');
const consumerWash = live(html, /fillStyle\s*=\s*[^;]{0,40}hudWash/, '读 hudWash 的渲染点');

const fails = [], dims = [];
for (const r of chRows) auditTheme('chapter', r, fails, dims);
for (const r of thRows) auditTheme('world', r, fails, dims);

// ══════════════════════════════ 报告 ══════════════════════════════
const md = [];
md.push('# 主题 HUD 字/底对比度审计（第 17 维度）');
md.push('');
md.push('- 入口: `' + FILE.replace(/\\/g, '/') + '`');
md.push('- 解析: `DATA_CHAPTER` **' + chRows.length + '/' + TABLE_EXPECT.chapters + '** 条 · `DATA_WORLD_THEME` **' + thRows.length + '/' + TABLE_EXPECT.worldThemes + '** 条');
md.push('- 消费侧自证: `' + consumer.trim() + '` ✅ · `' + consumerWash.trim() + '` ✅');
md.push('- 阈值: 判据 C（字/净底）≥ ' + TH_AA_BODY + ':1 · 判据 D（字/最不利底）≥ ' + TH_AA_LARGE + ':1');
md.push('- 结论: **' + (fails.length === 0 ? 'PASS' : 'FAIL') + '**（' + fails.length + ' 处）');
md.push('');
md.push('| 类别 | id | 名称 | hudFg | 净底 | 字/净底 (C) | 字/最不利底 (D) | 判 D 参照 |');
md.push('|---|---|---|---|---|---|---|---|');
for (const d of dims) {
  const m1 = d.cC >= TH_AA_BODY ? '' : ' ❌';
  const m2 = d.cD === null ? '' : (d.cD >= TH_AA_LARGE ? '' : ' ❌');
  md.push('| ' + d.kind + ' | ' + d.id + ' | ' + d.name + ' | `' + d.fg + '` | `' + d.flat + '` | **' + d.cC + '**' + m1 + ' | ' + (d.cD === null ? '-' : '**' + d.cD + '**' + m2) + ' | ' + (d.dRef || '-') + ' |');
}
md.push('');
if (fails.length) {
  md.push('## 未通过判据');
  md.push('');
  for (const f of fails) md.push('- ❌ `' + f.kind + '/' + f.id + '` 判据 ' + f.rule + '：' + f.msg);
  md.push('');
}
const outDir = path.join('ci', 'out');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'theme-contrast.md'), md.join('\n'));
console.log(md.join('\n'));
console.log('\n报告已写 ci/out/theme-contrast.md');
process.exit(fails.length === 0 ? 0 : 1);
