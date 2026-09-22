// 【v1.204】第 29 维度门禁：挑战房难度跨表一致性（DATA_ROOM_TIER × DATA_FIELD × DATA_GEAR_RARITY）
//
// 病根族 = 1.5 节「跨表一致性」（与 v1.201 `gear-cross` 同族）：
//   `DATA_ROOM_TIER`（挑战房 3 档）是一张**富表**（每档 14 字段），字段之间有"难度递进"承诺，
//   并对另外两张表有引用（`field` → DATA_FIELD · `rarMin` → DATA_GEAR_RARITY）。
//   **这些承诺与引用没有任何门禁在比它们** —— 改一档数值忘了另外一档，玩家就会遇到
//   "III 禁猎比 II 猎场还容易" / "引用了一个不存在的场物" 而没有任何门禁报错。
//
// 判据：
//   A. 解析完整性：DATA_ROOM_TIER >= 3 档（防整表被当 1 条 / 解析退化）
//   B. 难度轴单调不减：`rarMin` / `eliteN` / `hpMul` / `fightSec` 随档（id 升序）不减
//      —— "越往后越难"是**玩家直觉**；回落 = 高难档反而更弱（代码不崩，玩家困惑）
//   C. `field` 引用合法：空串 或 ∈ DATA_FIELD 的 id（写错 = 场物无处生成）
//   D. `rarMin` ∈ [0, 稀有度档数-1]（越界会取到 undefined 档位）
//   E. `gems` 数组非空且全为正（奖励配置为空的静默失效）
//
// ⚠ 作用域纪律（第十七类教训）：**不纳入 `trashAdd`**。
//   它是"杂兵增量"、不是难度轴（实测 0>2>1 非单调，是设计波动）。
//   把不该比的量硬比 = 判据太宽 → 假红。
//
// ⚠ 解析纪律（第十六 / 十八类教训）：词边界锚点 + 括号配平 + 从文件读真实值再变异。
import fs from 'fs';

export function stripComments(src) {
  let out = '', i = 0, q = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (q) { out += c; if (c === '\\') { out += n || ''; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}
// ⚠ 第十六类：词边界锚点（防 `DATA_ROOM_TIER` 命中 `DATA_ROOM_TIER_XXX` 这类前缀表）
export function findVar(s, name) {
  const re = new RegExp('var[ \\t]+' + name + '[ \\t]*=');
  const m = re.exec(s);
  if (!m) throw new Error('找不到 var ' + name);
  let i = m.index + m[0].length;
  while (i < s.length && s[i] !== '{' && s[i] !== '[') i++;
  return i;
}
export function block(s, from) {
  let d = 0, st = -1;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '{' || c === '[') { if (st < 0) st = i; d++; }
    else if (c === '}' || c === ']') { d--; if (!d && st >= 0) return s.slice(st, i + 1); }
  }
  throw new Error('block 未闭合 @' + from);
}

export const MIN_TIER = 3;      // 实测 3 档；下界防腐化
export const MONO_AXES = ['rarMin', 'eliteN', 'hpMul', 'fightSec'];
export const MIN_MONO = 4;      // 单调轴条数下界（防判据被改空后恒绿）

export function parseTiers(src) {
  const b = block(src, findVar(src, 'DATA_ROOM_TIER'));
  const tiers = [];
  for (const line of b.split('\n')) {
    const m = line.match(/^\s*\{\s*id:\s*(\d+),/);
    if (!m) continue;
    const num = (k) => { const x = new RegExp(k + ':\\s*(-?[\\d.]+)').exec(line); return x ? parseFloat(x[1]) : null; };
    const str = (k) => { const x = new RegExp(k + ':\\s*"([^"]*)"').exec(line); return x ? x[1] : null; };
    const gm = /gems:\s*\[([^\]]*)\]/.exec(line);
    tiers.push({
      id: +m[1],
      rarMin: num('rarMin'),
      eliteN: num('eliteN'),
      hpMul: num('hpMul'),
      fightSec: num('fightSec'),
      trashAdd: num('trashAdd'),
      field: str('field'),
      gems: gm ? gm[1].split(',').map((x) => +x.trim()).filter((n) => !isNaN(n)) : null,
    });
  }
  return tiers;
}

export function audit(srcRaw) {
  const errors = [];
  const src = stripComments(srcRaw);

  const TIERS = parseTiers(src);

  // 判据 A0：解析完整性
  if (TIERS.length < MIN_TIER) {
    errors.push(`A0: DATA_ROOM_TIER 应 >= ${MIN_TIER} 档, 实得 ${TIERS.length} ⇒ 解析退化?`);
    return { errors, stats: { nTier: TIERS.length, monoChecked: 0, fieldChecked: 0, checked: 0 } };
  }

  // 另两张表（引用目标）
  const FIELD_IDS = [];
  {
    const b = block(src, findVar(src, 'DATA_FIELD'));
    for (const m of b.matchAll(/^\s*(\w+):\s*\{/gm)) FIELD_IDS.push(m[1]);
  }
  let RARITY_LEN = 0;
  {
    const b = block(src, findVar(src, 'DATA_GEAR_RARITY'));
    for (const line of b.split('\n')) if (/^\s{2}\{\s*name:\s*"/.test(line)) RARITY_LEN++;
  }
  if (FIELD_IDS.length < 1) errors.push('A0: DATA_FIELD 解析 0 条 ⇒ 无法校验 field 引用');
  if (RARITY_LEN < 1) errors.push('A0: DATA_GEAR_RARITY 解析 0 条 ⇒ 无法校验 rarMin 上界');
  if (errors.length) return { errors, stats: { nTier: TIERS.length, monoChecked: 0, fieldChecked: 0, checked: 0 } };

  const sorted = [...TIERS].sort((a, b) => a.id - b.id);

  // 判据 B：难度轴单调不减
  let monoChecked = 0;
  for (const k of MONO_AXES) {
    let axisOk = true;
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1][k], cur = sorted[i][k];
      if (prev == null || cur == null) { axisOk = false; errors.push(`B: ${k} 在档 ${sorted[i].id} 解析为 null`); continue; }
      if (cur < prev) errors.push(`B: ${k} 在档 ${sorted[i].id} 回落（${prev} → ${cur}）⇒ 高难档反而更弱`);
    }
    if (axisOk) monoChecked++;
  }
  if (monoChecked < MIN_MONO) errors.push(`B: 单调轴仅 ${monoChecked} 条 < 下界 ${MIN_MONO} ⇒ 判据可能腐化`);

  // 判据 C：field 引用合法
  let fieldChecked = 0;
  const fieldSet = new Set(FIELD_IDS);
  for (const t of sorted) {
    fieldChecked++;
    if (t.field && !fieldSet.has(t.field))
      errors.push(`C: 档 ${t.id}.field="${t.field}" 不在 DATA_FIELD（${[...fieldSet].join('/')} 或空串）`);
  }

  // 判据 D：rarMin 在档内
  for (const t of sorted) {
    if (!(t.rarMin >= 0 && t.rarMin <= RARITY_LEN - 1))
      errors.push(`D: 档 ${t.id}.rarMin=${t.rarMin} 越界（应 0..${RARITY_LEN - 1}）`);
  }

  // 判据 E：gems 非空且全正
  let gemsChecked = 0;
  for (const t of sorted) {
    gemsChecked++;
    if (!t.gems || t.gems.length === 0) errors.push(`E: 档 ${t.id}.gems 为空 ⇒ 奖励配置静默失效`);
    else if (t.gems.some((g) => !(g > 0))) errors.push(`E: 档 ${t.id}.gems 含非正值 [${t.gems.join(',')}]`);
  }

  return {
    errors,
    stats: { nTier: TIERS.length, rarityLen: RARITY_LEN, nField: FIELD_IDS.length, monoChecked, fieldChecked, gemsChecked, checked: fieldChecked },
  };
}

function selftest() {
  const HTML = process.env.GAME_HTML || process.argv.filter((a) => !a.startsWith('--'))[2] || 'game/萌兽消消岛.html';
  const base = fs.readFileSync(HTML, 'utf8');
  const cases = [];

  const r0 = audit(base);
  cases.push(['真实文件零违规', null, 0, r0]);
  cases.push([`DATA_ROOM_TIER >= ${MIN_TIER} 档（实得 ${r0.stats.nTier}）`, null, r0.stats.nTier >= MIN_TIER ? 0 : 1, r0]);
  cases.push([`单调轴 >= ${MIN_MONO} 条（实得 ${r0.stats.monoChecked}）`, null, r0.stats.monoChecked >= MIN_MONO ? 0 : 1, r0]);

  // ⚠ 第十八类：变异必须"从文件读真实值再变异" + `out !== base` 前置断言（手抄常量永远可疑）
  const tierLine = (id) => {
    const re = new RegExp('\\{\\s*id:\\s*' + id + ',[^\\n]*\\}');
    const m = re.exec(base);
    if (!m) throw new Error('读不到 tier ' + id);
    return m[0];
  };
  const mutTier = (id, transform) => {
    const cur = tierLine(id);
    const next = transform(cur);
    if (next === cur) throw new Error('变异未生效(内容相同): tier ' + id);
    const out = base.replace(cur, next);
    if (out === base) throw new Error('变异未生效: tier ' + id);
    return out;
  };

  // 4 阳性：末档 hpMul 降到 0.50（< 上一档 1.18）→ 判据 B 必报
  cases.push(['4 末档 hpMul 降到 0.50 应报 B', mutTier(2, (s) => s.replace(/hpMul:\s*[\d.]+/, 'hpMul: 0.50')), 1]);
  // 5 阳性：field 改成不存在的 "noexist" → 判据 C 必报
  cases.push(['5 field 改成 "noexist" 应报 C', mutTier(1, (s) => s.replace(/field:\s*"[^"]*"/, 'field: "noexist"')), 1]);
  // 6 阳性：rarMin 改成 -1（仍单调递增，但越界）→ **只**触发判据 D（隔离样本，防 B 顺手一起报）
  cases.push(['6 rarMin 改成 -1（单调但越界）应报 D', mutTier(0, (s) => s.replace(/rarMin:\s*\d+/, 'rarMin: -1')), 1]);
  // 7 阳性：gems 清空 → 判据 E 必报
  cases.push(['7 gems 清空应报 E', mutTier(0, (s) => s.replace(/gems:\s*\[[^\]]*\]/, 'gems: []')), 1]);
  // 8 阳性：整表删空 → 判据 A0 必报
  cases.push(['8 DATA_ROOM_TIER 整表删空应报 A0', base.replace(/(var[ \t]+DATA_ROOM_TIER[ \t]*=\s*\[)[\s\S]*?(\n\];)/, '$1$2'), 1]);
  // 9 阴性：动 trashAdd（非难度轴）应仍通过（证明判据 B 作用域正确，不误报）
  cases.push(['9 动 trashAdd（非难度轴）应仍通过（不误报）', mutTier(1, (s) => s.replace(/trashAdd:\s*\d+/, 'trashAdd: 9')), 0]);

  let pass = 0, fail = 0;
  console.log('=== selftest: ci/room-tier-cross.mjs (v1.204 第 29 维度) ===');
  for (const [name, mutated, expectErr, pre] of cases) {
    let r;
    try { r = pre || audit(mutated == null ? base : mutated); }
    catch (e) { r = { errors: ['THROW: ' + e.message] }; }
    const nErr = r.errors.length;
    const ok = expectErr === 0 ? nErr === 0 : nErr > 0;
    ok ? pass++ : fail++;
    console.log(`  ${ok ? '✅' : '❌'} ${name}  (errors=${nErr})`);
    if (!ok && nErr) for (const e of r.errors.slice(0, 3)) console.log(`        ${e}`);
  }
  console.log(`\nselftest ${pass}/${cases.length} ${fail === 0 ? 'PASS' : 'FAIL'}`);
  return fail === 0;
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('room-tier-cross.mjs');
if (isMain) {
  if (process.argv.includes('--selftest')) {
    process.exit(selftest() ? 0 : 1);
  } else {
    const HTML = process.env.GAME_HTML || process.argv.filter((a) => !a.startsWith('--'))[2] || 'game/萌兽消消岛.html';
    const r = audit(fs.readFileSync(HTML, 'utf8'));
    console.log(`ci/room-tier-cross.mjs — GATE — ${HTML}`);
    console.log(`DATA_ROOM_TIER ${r.stats.nTier} 档 · 稀有度 ${r.stats.rarityLen} 档 · DATA_FIELD ${r.stats.nField} · 单调轴 ${r.stats.monoChecked} 条 · field 检查 ${r.stats.fieldChecked} · gems 检查 ${r.stats.gemsChecked || 0}`);
    if (r.errors.length) { console.log('\n❌ 违规:'); for (const e of r.errors) console.log('  ' + e); process.exit(1); }
    console.log('\n✅ PASS —— 挑战房三档难度递进一致（难度轴单调 · field 引用合法 · rarMin 在档内 · gems 非空）');
  }
}
