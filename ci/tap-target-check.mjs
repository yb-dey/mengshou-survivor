import { readFileSync } from 'node:fs';
// ci/tap-target-check.mjs —— 触控目标锁 + 台账（第 69 轮）
//   换算：逻辑 px × 0.5417 = 390pt 手机上的 CSS px（1 CSS px ≈ 0.183 mm）。
//   通行下限：iOS HIG 44×44 pt / Android 48dp ⇒ 取 44 CSS px ≈ **81 逻辑px**。
//
// 【第 69 轮的三次自我纠错，都记在这里，免得下次重犯】
//   ① 初版正则要求"两个数字紧跟 ')'" ⇒ 漏掉全部 (id,x,y,w,h,label,cb) 形态之外的调用；
//   ② 改版后又发现 `CONFIG.x` 解析的正则被 `^` 锚在行首 ⇒ 带缩进的 `roarBtnS: 96,` 一律读不到；
//   ③ 实测 `makeButton` 具名调用 **57 个**，初版只采到 27 个却照报 "PASS" ⇒ 现加"采集盲区"闸：
//      凡是解析不出来的调用都必须进 ALLOW_BLIND 台账，否则 FAIL（**宁可报盲区，不可假装看不见**）。
//
// 本判据不禁止"偏小"（存量已登记），只禁止**变小**与**新增偏小**。
const F_MASTER = process.env.MASTER || 'game/萌兽消消岛.html';
const FLOOR = 81;            // 44 CSS px
const SCALE = 390 / 720;
const BASE = [
// ── 冻结台账（v1.206 母版实测可解析的 **39** 个调用；采集器 v3，2026-09-24 冻结）──
//   达标（短边 ≥ 81 逻辑px ≈ 44 CSS px）：9 个
  { name: "pausebtn", w: 88, h: 88 },
  { name: "roarbtn", w: 96, h: 96 },
  { name: "bombbtn", w: 96, h: 96 },
  { name: "homestart", w: 492, h: 104 },
  { name: "homechapter", w: 172, h: 104 },
  { name: "homegear", w: 228, h: 148 },
  { name: "homeup", w: 152, h: 148 },
  { name: "homebeast", w: 152, h: 148 },
  { name: "homesettings", w: 140, h: 148 },
//   未达标（短边 < 81 逻辑px）—— 偏低清单与处置见 产品视角-小游戏化.md §18：30 个
  { name: "homeguide", w: 100, h: 44 },   // 短边 23.8 CSS px
  { name: "homeabout", w: 100, h: 44 },   // 短边 23.8 CSS px
  { name: "aboutlore", w: 220, h: 52 },   // 短边 28.2 CSS px
  { name: "homedaily", w: 300, h: 56 },   // 短边 30.3 CSS px
  { name: "guidereplay", w: 320, h: 56 },   // 短边 30.3 CSS px
  { name: "homevault", w: 680, h: 60 },   // 短边 32.5 CSS px
  { name: "\"uppath\"+p", w: 90, h: 60 },   // 短边 32.5 CSS px
  { name: "vaulttab0", w: 260, h: 62 },   // 短边 33.6 CSS px
  { name: "vaulttab1", w: 260, h: 62 },   // 短边 33.6 CSS px
  { name: "dailycancel", w: 240, h: 64 },   // 短边 34.7 CSS px
  { name: "upclose", w: 220, h: 64 },   // 短边 34.7 CSS px
  { name: "vaultclose", w: 220, h: 64 },   // 短边 34.7 CSS px
  { name: "beastclose", w: 220, h: 64 },   // 短边 34.7 CSS px
  { name: "settheme", w: 320, h: 64 },   // 短边 34.7 CSS px
  { name: "setbgm", w: 320, h: 64 },   // 短边 34.7 CSS px
  { name: "setexport", w: 320, h: 64 },   // 短边 34.7 CSS px
  { name: "setimport", w: 320, h: 64 },   // 短边 34.7 CSS px
  { name: "setclose", w: 220, h: 64 },   // 短边 34.7 CSS px
  { name: "gearmerge", w: 188, h: 64 },   // 短边 34.7 CSS px
  { name: "gearforge", w: 196, h: 64 },   // 短边 34.7 CSS px
  { name: "gearclose", w: 188, h: 64 },   // 短边 34.7 CSS px
  { name: "guideok", w: 220, h: 64 },   // 短边 34.7 CSS px
  { name: "aboutclose", w: 220, h: 64 },   // 短边 34.7 CSS px
  { name: "btnreroll", w: 300, h: 68 },   // 短边 36.8 CSS px
  { name: "btnrevive", w: 320, h: 70 },   // 短边 37.9 CSS px
  { name: "btngiveup", w: 320, h: 70 },   // 短边 37.9 CSS px
  { name: "\"upbuy\"+u", w: 130, h: 70 },   // 短边 37.9 CSS px
  { name: "guideskiphall", w: 220, h: 72 },   // 短边 39.0 CSS px
  { name: "chapterconfirm", w: 220, h: 76 },   // 短边 41.2 CSS px
  { name: "chaptercancel", w: 220, h: 76 },   // 短边 41.2 CSS px
];
// 允许新增的偏小控件（**当前为空**：新加按钮请先补尺寸；确有理由则在此登记并写原因）
const ALLOW_NEW = [];
// 解析盲区台账：key = 调用点 id 原文，值 = 为什么静态解析不了。**空数组 ⇒ 有盲区即 FAIL**
const ALLOW_BLIND = [
  // ── 解析盲区台账（18 条）：静态读不到尺寸的形态，逐条登记并写明原因 ──
  //   为什么不"继续补解析"：这些尺寸由布局函数里的局部变量算出（var bw = CONFIG.pauseBtnW || 300; …），
  //   要静态解就得写一个 JS 解释器；正确做法是**运行时枚举**（见 PM §18.6 的下一步），不是把解析器堆成玩具解释器。
  //   ⇒ 有新增盲区、或这里出现已经不盲的旧条目，本判据都会 FAIL。
  { key: "btncontinue", why: "暂停面板动作钮 · 尺寸由 pauseActionLayout() 局部变量算出" },
  { key: "btnbgm", why: "暂停面板动作钮 · 尺寸由 pauseActionLayout() 局部变量算出" },
  { key: "btnnodesfx", why: "暂停面板动作钮 · 尺寸由 pauseActionLayout() 局部变量算出" },
  { key: "btnmute", why: "暂停面板动作钮 · 尺寸由 pauseActionLayout() 局部变量算出" },
  { key: "btngohome", why: "暂停面板动作钮 · 尺寸由 pauseActionLayout() 局部变量算出" },
  { key: "btndouble", why: "结算面板动作钮 · 尺寸由 resultActionLayout() 局部变量算出" },
  { key: "resulthome", why: "结算面板动作钮 · 尺寸由 resultActionLayout() 局部变量算出" },
  { key: "\"vaultcraft\"+vci", why: "仓库面板钮 · vLay.btnW/btnH 由 vaultPanelMetrics() 算出" },
  { key: "\"vaulttalent\"+vti", why: "仓库面板钮 · vLay.btnW/btnH 由 vaultPanelMetrics() 算出" },
  { key: "setbgmon", why: "设置页音频钮 · 尺寸由 settingsAudioLayout() 局部变量算出" },
  { key: "setnodesfx", why: "设置页音频钮 · 尺寸由 settingsAudioLayout() 局部变量算出" },
  { key: "setmute", why: "设置页音频钮 · 尺寸由 settingsAudioLayout() 局部变量算出" },
  { key: "debugevent", why: "调试面板（不进玩家路径）· CONFIG.debug.panelW 属嵌套表，解析器未支持" },
  { key: "debugfork", why: "调试面板（不进玩家路径）· CONFIG.debug.panelW 属嵌套表，解析器未支持" },
  { key: "debugbehave", why: "调试面板（不进玩家路径）· CONFIG.debug.panelW 属嵌套表，解析器未支持" },
  { key: "debugspawn", why: "调试面板（不进玩家路径）· CONFIG.debug.panelW 属嵌套表，解析器未支持" },
  { key: "debugskip", why: "调试面板（不进玩家路径）· CONFIG.debug.panelW 属嵌套表，解析器未支持" },
  { key: "debugpressure", why: "调试面板（不进玩家路径）· CONFIG.debug.panelW 属嵌套表，解析器未支持" },
];

// ══ 解析层 ═══════════════════════════════════════════════════════════════
const strip = (s) => s.trim();
// 从 open（'{'/'[' 的下标）起按括号配平切出**顶层**条目，返回 [{text, start}]（跳过字符串与注释）
export function splitTop(src, open) {
  const closeCh = src[open] === '{' ? '}' : ']';
  const out = [];
  let depth = 0, cur = '', start = open + 1, q = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '\\') { cur += ch + src[++i]; continue; } if (ch === q) q = 0; cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '{' || ch === '[' || ch === '(') { depth++; if (depth === 1) { cur = ''; start = i + 1; continue; } }
    if (ch === '}' || ch === ']' || ch === ')') {
      depth--;
      if (depth === 0) { if (closeCh === ch && i > open + 1) out.push({ text: cur, start }); return out; }
    }
    if (ch === ',' && depth === 1) { out.push({ text: cur, start }); cur = ''; start = i + 1; continue; }
    if (depth >= 1) cur += ch;
  }
  return out;
}
// 对象字面量 → 数值路径表（递归；`a: 12` ⇒ path.a = 12 / `a: { b: 12 }` ⇒ path.a.b = 12）
export function numberPaths(src, open, prefix, out) {
  for (const e of splitTop(src, open)) {
    const m = /^\s*(?:([A-Za-z_$][\w$]*)|"([^"]+)"|'([^']+)')\s*:\s*([\s\S]+)$/.exec(e.text);
    if (!m) continue;
    const key = m[1] || m[2] || m[3];
    const val = strip(m[4]);
    if (/^-?\d+(?:\.\d+)?$/.test(val)) { out.set(prefix + key, Number(val)); continue; }
    if (val[0] === '{') {
      const rel = e.text.indexOf('{', e.text.indexOf(':'));
      numberPaths(src, e.start + rel, prefix + key + '.', out);
    }
  }
  return out;
}
// 找 `function NAME(` 后**第一个 return 的对象字面量**，按 prefix 收数值
export function functionTable(src, name, out) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) return out;
  const body = src.indexOf('{', at);
  const ret = src.indexOf('return', body);
  if (ret < 0) return out;
  const open = src.indexOf('{', ret);
  if (open < 0 || open - ret > 40) return out;
  return numberPaths(src, open, name + '.', out);
}
export function buildTables(src) {
  const t = new Map();
  const cfgVar = /var\s+CONFIG\s*=\s*\{/.exec(src);
  if (cfgVar) numberPaths(src, src.indexOf('{', cfgVar.index), 'CONFIG.', t);
  // 布局函数：`var X = fn()` 与 `function fn()` 的返回字面量都收，并做别名
  for (const m of src.matchAll(/var\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\(\s*\)/g)) {
    const [, alias, fn] = m;
    functionTable(src, fn, t);
    for (const [k, v] of [...t]) if (k.startsWith(fn + '.')) t.set(alias + k.slice(fn.length), v);
  }
  return t;
}
// 受限算术求值：数字 / 点分标识符 / + - * / / 括号（解析不出返回 NaN —— **不猜**）
export function evalExpr(expr, t) {
  const toks = String(expr).match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|\d+(?:\.\d+)?|\|\||[-+*/()]/g);
  if (!toks) return NaN;
  let i = 0;
  const peek = () => toks[i];
  const expr1 = () => {
    let v = term();
    while (peek() === '+' || peek() === '-' || peek() === '||') {
      const op = toks[i++];
      if (op === '||') { const r = term(); v = isFinite(v) ? v : r; continue; }
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const term = () => { let v = factor(); while (peek() === '*' || peek() === '/') { const op = toks[i++]; const r = factor(); v = op === '*' ? v * r : v / r; } return v; };
  const factor = () => {
    const tk = toks[i];
    if (tk === '(') { i++; const v = expr1(); if (toks[i] === ')') i++; return v; }
    if (tk === '-') { i++; return -factor(); }
    i++;
    if (/^\d/.test(tk)) return Number(tk);
    return t.has(tk) ? t.get(tk) : NaN;
  };
  const v = expr1();
  return i === toks.length ? v : NaN;   // 有剩余 token（如函数调用）⇒ 视为解析不出
}
export function collect(src) {
  const t = buildTables(src);
  const list = [], blind = [];
  for (const m of src.matchAll(/makeButton\(/g)) {
    if (/function\s+$/.test(src.slice(Math.max(0, m.index - 12), m.index))) continue;   // 跳过函数定义本身
    const args = splitTop(src, src.indexOf('(', m.index));
    if (!args || args.length < 5) { blind.push({ key: '参数不完整 @' + line(src, m.index), why: '参数少于 5 个' }); continue; }
    const rawId = strip(args[0].text);
    const idm = /^"([^"]+)"$/.exec(rawId);
    const key = idm ? idm[1] : rawId.replace(/\s+/g, '');
    const w = evalExpr(args[3].text, t), h = evalExpr(args[4].text, t);
    if (!isFinite(w) || !isFinite(h)) { blind.push({ key, why: `w/h 解析不出：${strip(args[3].text)} / ${strip(args[4].text)}` }); continue; }
    list.push({ name: key, x: evalExpr(args[1].text, t), y: evalExpr(args[2].text, t), w, h, ln: line(src, m.index) });
  }
  return { list, blind };
}
function line(src, idx) { return src.slice(0, idx).split('\n').length; }
// ── 邻居间距：只查"同一带"（另一轴投影相交）的控件，取最近的正间距 ──
export function gaps(c, all) {
  let vg = Infinity, hg = Infinity;
  for (const o of all) {
    if (o === c || !isFinite(o.x) || !isFinite(o.y)) continue;
    const xOver = Math.min(c.x + c.w, o.x + o.w) - Math.max(c.x, o.x);
    const yOver = Math.min(c.y + c.h, o.y + o.h) - Math.max(c.y, o.y);
    if (xOver > 0) { const g = Math.max(o.y - (c.y + c.h), c.y - (o.y + o.h)); if (g >= 0) vg = Math.min(vg, g); }
    if (yOver > 0) { const g = Math.max(o.x - (c.x + c.w), c.x - (o.x + o.w)); if (g >= 0) hg = Math.min(hg, g); }
  }
  return { vg, hg };
}
export function analyze(src) {
  const { list, blind } = collect(src);
  const fails = [];
  const base = new Map(BASE.map((x) => [x.name, Math.min(x.w, x.h)]));
  const small = [];
  for (const c of list) {
    const short = Math.min(c.w, c.h);
    const axis = c.h <= c.w ? 'h' : 'w';
    const b = base.get(c.name);
    if (b !== undefined && short < b) fails.push(`控件「${c.name}」短边从 ${b} 缩到 ${short} 逻辑px（${(short * SCALE).toFixed(1)} CSS px）`);
    if (b === undefined && short < FLOOR && !ALLOW_NEW.some((a) => a.name === c.name)) {
      fails.push(`新控件「${c.name}」短边只有 ${short} 逻辑px（${(short * SCALE).toFixed(1)} CSS px < 44）⇒ 请补尺寸或登记到 ALLOW_NEW`);
    }
    if (short < FLOOR) {
      const g = gaps(c, list);
      // ⚠ 第 70 轮纠错：hitPad 是**四面对称**扩张的 ⇒ 并排邻居（水平间距小）同样约束 pad。
      //   只按"短边所在轴"取间距，会把 homeguide 这类并排钮算成很安全（实测它右侧 8px 就是 homeabout）。
      const near = Math.min(g.vg, g.hg);
      const need = Math.ceil((FLOOR - short) / 2);
      const safe = isFinite(near) ? Math.floor(near / 2) : Infinity;
      small.push({ name: c.name, w: c.w, h: c.h, css: +(short * SCALE).toFixed(1), near, need, safe,
        verdict: need <= safe ? `可补 pad ${need}` : '需改视觉' });
    }
  }
  for (const b of blind) if (!ALLOW_BLIND.some((a) => a.key === b.key)) fails.push(`采集盲区「${b.key}」：${b.why} ⇒ 该按钮完全没被本判据看着（补解析或登记 ALLOW_BLIND）`);
  for (const a of ALLOW_BLIND) if (!blind.some((b) => b.key === a.key)) fails.push(`盲区台账失效：「${a.key}」现在已能解析 ⇒ 请从 ALLOW_BLIND 删除（台账必须与实测一一对应）`);
  return { fails, now: list, blind, small, base };
}
// ══ 入口 ═════════════════════════════════════════════════════════════════
const isMain = process.argv[1] && /tap-target-check\.mjs$/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain && process.argv.includes('--selftest')) {
  const real = readFileSync(F_MASTER, 'utf8');
  const a = analyze(real);
  const b = analyze(real + '\nvar _x = makeButton("_newtiny", 10, 10, 60, 40, "x", function () {});\n');
  const c = analyze(real.replace('makeButton("homeguide", 496, 6, 100, 44', 'makeButton("homeguide", 496, 6, 100, 40'));
  const d = analyze(real + '\nvar _y = makeButton("_blindty", 10, 10, someLay.w, someLay.h, "x", function () {});\n');
  const cases = [
    ['阳性A：真实母版原样（不应有 FAIL）', a.fails.length === 0],
    ['阴性B：新增一个 60×40 的小按钮（必须 FAIL）', b.fails.length > 0],
    ['阴性C：把某个控件改矮（必须 FAIL）', c.fails.length > 0],
    ['阴性D：新增一个尺寸读不出的调用（采集盲区，必须 FAIL）', d.fails.length > 0 && d.fails.some((f) => f.includes('采集盲区'))],
  ];
  let bad = 0;
  for (const [n, ok] of cases) { console.log((ok ? '✅' : '❌') + ' ' + n + ' ⇒ ' + ok); if (!ok) bad++; }
  for (const [i, r] of [b, c, d].entries()) if (r.fails.length) console.log('      · ' + (i === 2 ? (r.fails.find((f) => f.includes('采集盲区')) || r.fails[0]) : r.fails[0]));
  console.log(bad ? '\n✗ 自测失败' : `\n✅ 触控目标锁自测通过（4 组样本）· 采集 ${a.now.length} 个 · 盲区 ${a.blind.length} 个`);
  if (a.blind.length && !bad) { console.log('  盲区明细：'); for (const x of a.blind) console.log(`    ${x.key} — ${x.why}`); }
  process.exit(bad ? 1 : 0);
}
if (isMain) {
  const r = analyze(readFileSync(F_MASTER, 'utf8'));
  const padable = r.small.filter((s) => s.verdict.startsWith('可补 pad'));
  const visual = r.small.filter((s) => s.verdict === '需改视觉');
  console.log(`  具名控件 ${r.now.length} 个（解析盲区 ${r.blind.length}）· 短边 <44 CSS px（${FLOOR} 逻辑px）的 ${r.small.length} 个`);
  console.log(`  · 可**零像素改动**补命中区（对称 pad 不压邻居）的 ${padable.length} 个：`);
  for (const s of padable.sort((a, b) => a.css - b.css)) {
    console.log(`    ${s.name.padEnd(16)} ${String(s.w).padStart(4)}×${String(s.h).padEnd(4)} 短边 ${String(s.css).padStart(4)} CSS px（${(s.css * 0.183).toFixed(1)} mm）· 两轴最近间距 ${s.near} · pad ${s.need} ≤ 上限 ${s.safe}`);
  }
  console.log(`  · 需改视觉（补 pad 会压到邻居）的 ${visual.length} 个：`);
  for (const s of visual.sort((a, b) => a.css - b.css)) {
    console.log(`    ${s.name.padEnd(16)} ${String(s.w).padStart(4)}×${String(s.h).padEnd(4)} 短边 ${String(s.css).padStart(4)} CSS px · 两轴最近同类间距 ${s.near}（安全 pad 上限 ${s.safe}）`);
  }
  if (r.fails.length) { for (const f of r.fails) console.log('❌ ' + f); console.log('\n结论：FAIL'); process.exit(1); }
  console.log('\n结论：PASS —— 触控目标没有变小，也没有新增偏小控件，且无未登记盲区');
}
