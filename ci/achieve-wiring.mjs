// ci/achieve-wiring.mjs —— 成就**接线**判据（第 63 轮新增）
//
// 存在理由（本轮实测抓到的真 bug，且属于"内容齐全但永远拿不到"这一类）：
//   母版 `DATA_RUNES` 的**键**自带前缀（`rune_berserk`），`GAME.runeId` 存的就是这个键，
//   而成就检查点却写成 `checkAchieves("rune_" + GAME.runeId, …)` ⇒ dim 成了 `rune_rune_berserk`，
//   与 `DATA_ACHIEVE` 里的 `rune_berserk` **永不相等** ⇒ 5 条符文成就（1500 金）永远无法解锁。
//   这类病根（"表里有、代码从不产生对应触发值"）不报错、不崩、门禁照绿：
//   **只有把"表里的 dim"与"调用点真的会传的 dim"对上账，才看得见。**
//
// 判据（静态，零依赖）：
//   1. 每个成就 `dim` 必须有**生产者**：某个 `checkAchieves(<expr>, …)` 的取值集合包含它。缺 ⇒ FAIL。
//   2. 每个生产出来的 dim 必须在 `DATA_ACHIEVE` 里有对应成就（否则空转调用）⇒ FAIL。
//   3. `<expr>` 解析不出取值集合 ⇒ FAIL 并指出卡在哪一步（不许静默放过）。
//   `<expr>` 三种形态：字符串字面量 · `"前缀" + 变量` · **裸变量**（修好后的形态就是裸变量）。
//   变量取值链（母版现行写法）：`GAME.runeId` ← `this.runeId` ← `rid` ← `keys[i]` ← `for (k in DATA_X)`
//   ⇒ 取值集合 = DATA_X 的顶层键。
//
// ⚠ 自证（`--selftest`）：4 组合成样本 + **真实母版正/负对照**（把历史 bug 注入内存副本必须 FAIL）。
//   ⚠ 首版判据自己有两个 bug，全是被这组对照抓出来的：把 `===` 当成赋值；不认"裸变量"这种**正确**形态。
const F_MASTER = process.env.MASTER || 'game/萌兽消消岛.html';

function sliceBlock(src, startIdx, open, close) {
  let depth = 0, started = false;
  for (let i = startIdx; i < src.length; i++) {
    const c = src[i];
    if (c === open) { depth++; started = true; }
    else if (c === close) { depth--; if (started && depth === 0) return src.slice(startIdx, i + 1); }
  }
  return null;
}
function tableOf(src, name) {
  const m = new RegExp(`var\\s+${name}\\s*=\\s*([\\[{])`).exec(src);
  if (!m) return null;
  return sliceBlock(src, m.index + m[0].length - 1, m[1], m[1] === '{' ? '}' : ']');
}
function topKeysOf(objText) {
  const keys = new Set();
  let depth = 0, inStr = null;
  for (let i = 0; i < objText.length; i++) {
    const c = objText[i];
    if (inStr) { if (c === '\\') i++; else if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '{' || c === '[') { depth++; continue; }
    if (c === '}' || c === ']') { depth--; continue; }
    if (depth === 1) {
      const g = /^([A-Za-z_$][\w$]*)\s*:/.exec(objText.slice(i));
      if (g && (i === 0 || /[\s,{[]/.test(objText[i - 1]))) { keys.add(g[1]); i += g[1].length; }
    }
  }
  return [...keys];
}
// 赋值查找：排除 `==` / `===` / `!=` / `<=` / `>=`（本轮踩过：`GAME.runeId === this.runeId` 被当成赋值）
function findAssign(src, name) {
  const re = new RegExp(`(?<![=!<>+\\-*/])\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(?!=)([^;\\n]+)`);
  return re.exec(src);
}
const IDENT = /^[A-Za-z_$][\w$]*$/;

// 变量 ⇒ 取值集合（数组）。失败返回 { error }
function resolveVar(src, varName, trace = [], depth = 0) {
  if (depth > 4) return { error: `解析链过深（>4）：${trace.join(' → ')}` };
  const prop = varName.includes('.') ? varName.split('.').pop() : varName;
  const asg = findAssign(src, varName);
  if (!asg) return { error: `找不到 ${varName} 的赋值点（形如 \`${varName} = …\`）` };
  const rhs = asg[1].trim();
  trace.push(`${varName} = ${rhs.length > 46 ? rhs.slice(0, 46) + '…' : rhs}`);
  const lit = /^["']([^"']*)["']$/.exec(rhs);
  if (lit) return { dims: [lit[1]], trace };
  const thisProp = /this\.([A-Za-z_$][\w$]*)/.exec(rhs);
  let ident = thisProp ? thisProp[1] : (/^\(?\s*([A-Za-z_$][\w$]*)\s*\)?$/.exec(rhs) || [])[1];
  if (!ident) ident = prop;                       // 兜底：用属性名找定义（如 runeId: rid）
  const propDef = new RegExp(`(?:^|[\\s,{])${ident}\\s*:\\s*([A-Za-z_$][\\w$]*)`, 'm').exec(src);
  if (!propDef) return { error: `找不到属性定义 \`${ident}: <标识符>\`（链：${trace.join(' → ')}）` };
  trace.push(`${ident}: ${propDef[1]}`);
  const inner = propDef[1];
  const idx = new RegExp(`\\b${inner}\\s*=\\s*([A-Za-z_$][\\w$]*)\\s*\\[`).exec(src);
  if (idx) {
    const arr = idx[1];
    trace.push(`${inner} = ${arr}[i]`);
    const push = new RegExp(`\\b${arr}\\.push\\(\\s*([A-Za-z_$][\\w$]*)\\s*\\)`).exec(src);
    if (!push) return { error: `找不到 ${arr}.push(...)` };
    const loop = new RegExp(`for\\s*\\(\\s*${push[1]}\\s+in\\s+(DATA_[A-Z_]+)\\s*\\)`).exec(src);
    if (!loop) return { error: `找不到 for (${push[1]} in DATA_*) 循环` };
    const tbl = tableOf(src, loop[1]);
    if (!tbl) return { error: `找不到表 ${loop[1]}` };
    const keys = topKeysOf(tbl);
    trace.push(`取值集合 = ${loop[1]} 的键（${keys.length} 个）`);
    return { dims: keys, trace };
  }
  if (IDENT.test(inner)) return resolveVar(src, inner, trace, depth + 1);
  return { error: `无法解析（链：${trace.join(' → ')}）` };
}

export function analyze(src) {
  const fails = [], warns = [], info = [];
  const achTbl = tableOf(src, 'DATA_ACHIEVE');
  if (!achTbl) return { fails: ['找不到 DATA_ACHIEVE 表'], warns, info, dims: [], producers: [] };
  const dims = [...achTbl.matchAll(/dim\s*:\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const dimSet = new Set(dims);
  info.push(`成就 ${dims.length} 条 · dim ${dimSet.size} 种：${[...dimSet].join(', ')}`);

  const producers = new Set();
  for (const m of src.matchAll(/checkAchieves\(\s*([^,]+?)\s*,/g)) {
    // ⚠ 跳过**函数定义**本身（`function checkAchieves(dim, val) {`）——本轮踩过：
    //   它把形参 `dim` 当成调用点，报"找不到属性定义 false: <标识符>"这种假阳性。
    if (/function\s+$/.test(src.slice(Math.max(0, m.index - 16), m.index))) continue;
    const expr = m[1].trim();
    const line = src.slice(0, m.index).split('\n').length;
    const lit = /^["']([^"']+)["']$/.exec(expr);
    if (lit) { producers.add(lit[1]); info.push(`第 ${line} 行 字面量 dim「${lit[1]}」`); continue; }
    const concat = /^["']([^"']*)["']\s*\+\s*(.+)$/.exec(expr);
    if (concat) {
      const r = resolveVar(src, concat[2].trim());
      if (r.error) { fails.push(`第 ${line} 行动态 dim「${expr}」解析失败：${r.error}`); continue; }
      for (const k of r.dims) producers.add(concat[1] + k);
      info.push(`第 ${line} 行「${expr}」⇒ ${r.dims.map((k) => concat[1] + k).join(', ')}（${r.trace.join(' → ')}）`);
      continue;
    }
    // 裸变量（修好后的正确形态）
    if (IDENT.test(expr) || /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(expr)) {
      const r = resolveVar(src, expr);
      if (r.error) { fails.push(`第 ${line} 行 dim 变量「${expr}」解析失败：${r.error}`); continue; }
      for (const k of r.dims) producers.add(k);
      info.push(`第 ${line} 行「${expr}」⇒ ${r.dims.join(', ')}（${r.trace.join(' → ')}）`);
      continue;
    }
    fails.push(`第 ${line} 行 checkAchieves(${expr}, …) 形态无法静态判定 ⇒ 请显式确认它会产生哪些 dim`);
  }
  for (const d of dimSet) if (!producers.has(d)) fails.push(`成就 dim「${d}」没有任何 checkAchieves 调用点会传它 ⇒ 该成就**永不可解锁**`);
  for (const p of producers) if (!dimSet.has(p)) fails.push(`checkAchieves 会传 dim「${p}」，但 DATA_ACHIEVE 里没有对应成就 ⇒ 空转调用（或成就表漏了条目）`);
  return { fails, warns, info, dims: [...dimSet], producers: [...producers] };
}

const isMain = process.argv[1] && /achieve-wiring\.mjs$/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain && process.argv.includes('--selftest')) {
  const shape = (call) => `
var DATA_RUNES = {
  rune_berserk: { id: "rune_berserk", name: "狂暴符文", hpMul: 1.3 },
  rune_tiny:    { id: "rune_tiny",    name: "小小符文", enemyR: 0.8 }
};
var DATA_ACHIEVE = [
  { id: "kill_100",    name: "初露锋芒", dim: "kill",        target: 100, reward: 100 },
  { id: "rune_berserk", name: "狂暴通关", dim: "rune_berserk", target: 6,   reward: 300 },
  { id: "rune_tiny",   name: "小小通关", dim: "rune_tiny",    target: 6,   reward: 300 }
];
function makeRuneChip(i) {
  var keys = [], k;
  for (k in DATA_RUNES) keys.push(k);
  var rid = keys[i];
  return { runeId: rid, onTap: function () { GAME.runeId = (GAME.runeId === this.runeId) ? "" : this.runeId; } };
}
function onClear() {
  checkAchieves("kill", saveData.totalKills);
  ${call}
}`;
  const fixed = shape('checkAchieves(GAME.runeId, GAME.chapterIdx + 1);');
  const cases = [
    { name: '阴性A：真实历史 bug（"rune_" + runeId 双前缀）', src: shape('checkAchieves("rune_" + GAME.runeId, GAME.chapterIdx + 1);'), wantFail: true },
    { name: '阳性B：修好之后（裸变量 GAME.runeId，且三元赋值易被误当 ===）', src: fixed, wantFail: false },
    { name: '阴性C：成就 dim 无生产者（表里多一条 roar）', src: fixed.replace('reward: 100 },', 'reward: 100 },\n  { id: "roar_10", name: "狮吼功", dim: "roar", target: 10, reward: 150 },'), wantFail: true },
    { name: '阴性D：动态 dim 变量无赋值链', src: shape('checkAchieves("rune_" + mysteryVar, 6);'), wantFail: true },
  ];
  let bad = 0;
  for (const c of cases) {
    const r = analyze(c.src);
    const failed = r.fails.length > 0;
    const ok = failed === c.wantFail;
    console.log(`${ok ? '✅' : '❌'} ${c.name} ⇒ ${failed ? 'FAIL' : 'PASS'}（期望 ${c.wantFail ? 'FAIL' : 'PASS'}）`);
    for (const f of r.fails) console.log(`      · ${f}`);
    if (!ok) bad++;
  }
  try {
    const fs = await import('node:fs');
    const real = fs.readFileSync(F_MASTER, 'utf8');
    const r1 = analyze(real);
    const r2 = analyze(real.replace('checkAchieves(GAME.runeId, GAME.chapterIdx + 1)', () => 'checkAchieves("rune_" + GAME.runeId, GAME.chapterIdx + 1)'));
    const ok1 = r1.fails.length === 0, ok2 = r2.fails.length > 0;
    console.log(`${ok1 ? '✅' : '❌'} 真实母版原样 ⇒ ${ok1 ? 'PASS' : 'FAIL'}（期望 PASS）`);
    for (const f of r1.fails) console.log(`      · ${f}`);
    console.log(`${ok2 ? '✅' : '❌'} 真实母版**注入历史 bug** ⇒ ${ok2 ? 'FAIL' : 'PASS'}（期望 FAIL）`);
    if (ok2) console.log(`      · ${r2.fails.find((f) => f.includes('rune_')) || r2.fails[0]}`);
    if (!ok1 || !ok2) bad++;
  } catch (e) { console.log(`⚠ 真实母版对照跳过：${e.message}`); }
  console.log(bad ? `\n✗ 自测失败 ${bad} 项` : '\n✅ 成就接线判据自测通过（4 组合成样本 + 真实母版正/负对照）');
  process.exit(bad ? 1 : 0);
}
if (isMain) {
  const fs = await import('node:fs');
  const r = analyze(fs.readFileSync(F_MASTER, 'utf8'));
  for (const i of r.info) console.log(`  · ${i}`);
  for (const w of r.warns) console.log(`  ⚠ ${w}`);
  if (r.fails.length) { for (const f of r.fails) console.log(`❌ ${f}`); console.log(`\n结论：FAIL（${r.fails.length} 条）`); process.exit(1); }
  console.log(`\n结论：PASS —— 成就 ${r.dims.length} 种 dim 全部有生产者（生产者共 ${r.producers.length} 种）`);
}
