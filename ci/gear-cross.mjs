// 【v1.201】第 26 维度门禁：装备跨表一致性（DATA_GEAR × DATA_GEAR_SLOT × DATA_GEAR_RARITY）
//
// 病根：三张表各写一份事实，无一处比它们。
//   A. DATA_GEAR.per 数组长度必须 === DATA_GEAR_RARITY.length（每档一值；短了会 undefined）
//   B. DATA_GEAR.slot 必须存在于 DATA_GEAR_SLOT（写错槽位 = 装备无处可穿）
//   C. per 必须**单调递增**（"史诗 > 普通"是玩家直觉；回落 = 高稀有度反而更差）
//   D. 同一「slot + stat」（**真正的替代关系**）内，chMin 大的应更强
//   E. 同 slot+stat 不应有完全相同的 per（同质重复）
//
// ⚠ 本轮踩了两个新坑（已固化进技能）：
//   第十六类 **前缀命名冲突 → indexOf 命中错表**：`indexOf('var DATA_GEAR')` 命中 `var DATA_GEAR_SLOT`
//     ⇒ 解析出 0 条却全绿。修法：`findVar` 用**词边界** `var[ \t]+NAME[ \t]*=` + 下界断言。
//   第十七类 **判据作用域失控 → 假红**：D 判据首版按 `stat` 单键分组，把**跨 slot 可同时装备**的
//     `dewdrop(@necklace)` 与 `seedbelt(@belt)` 当替代品 ⇒ 假红 1 条。
//     修法：分组键 = `slot + '|' + stat`，并加"组数 ≥ 1"下界防分组键失效。
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
// ⚠ 第十六类：必须用词边界锚点，否则 `DATA_GEAR` 会命中 `DATA_GEAR_SLOT`
function findVar(s, name) {
  const re = new RegExp('var[ \\t]+' + name + '[ \\t]*=');
  const m = re.exec(s);
  if (!m) throw new Error('找不到 var ' + name);
  let i = m.index + m[0].length;
  while (i < s.length && s[i] !== '{' && s[i] !== '[') i++;
  return i;
}
function block(s, from) {
  let d = 0, st = -1;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '{' || c === '[') { if (st < 0) st = i; d++; }
    else if (c === '}' || c === ']') { d--; if (!d && st >= 0) return s.slice(st, i + 1); }
  }
  throw new Error('block 未闭合 @' + from);
}

export const MIN_GEAR = 10;   // 实测 12 条；下界防腐化

export function audit(srcRaw) {
  const errors = [];
  const src = stripComments(srcRaw);

  const SLOTS = [];
  {
    const b = block(src, findVar(src, 'DATA_GEAR_SLOT'));
    for (const m of b.matchAll(/\{\s*id:\s*"(\w+)",\s*name:\s*"([^"]+)"\s*\}/g)) SLOTS.push({ id: m[1], name: m[2] });
  }
  const RARITY = [];
  {
    const b = block(src, findVar(src, 'DATA_GEAR_RARITY'));
    for (const line of b.split('\n')) {
      const m = line.match(/^\s{2}\{\s*name:\s*"([^"]+)"/);
      if (m) RARITY.push({ name: m[1] });
    }
  }
  const GEAR = [];
  {
    const b = block(src, findVar(src, 'DATA_GEAR'));
    for (const line of b.split('\n')) {
      const m = line.match(/^\s{2}\{\s*id:\s*"(\w+)",\s*slot:\s*"(\w+)",\s*name:\s*"([^"]+)",\s*stat:\s*"(\w+)",\s*per:\s*\[([^\]]+)\],\s*chMin:\s*(\d+)/);
      if (!m) continue;
      GEAR.push({ id: m[1], slot: m[2], name: m[3], stat: m[4], per: m[5].split(',').map((x) => +x.trim()), chMin: +m[6] });
    }
  }

  // 判据 A0：解析完整性（第十六类防线 —— 解析出 0 条不能是 PASS）
  if (SLOTS.length !== 6) errors.push(`A0: DATA_GEAR_SLOT 应 6 条, 实得 ${SLOTS.length}`);
  if (RARITY.length !== 5) errors.push(`A0: DATA_GEAR_RARITY 应 5 条, 实得 ${RARITY.length}`);
  if (GEAR.length < MIN_GEAR) errors.push(`A0: DATA_GEAR 应 >= ${MIN_GEAR} 条, 实得 ${GEAR.length} ⇒ 前缀冲突/解析退化?`);
  if (errors.length) return { errors, stats: { nSlot: SLOTS.length, nRarity: RARITY.length, nGear: GEAR.length, checked: 0, groups: 0 } };

  const slotSet = new Set(SLOTS.map((s) => s.id));
  let checked = 0;

  // 判据 A：per 长度 === 稀有度档数
  for (const g of GEAR) {
    checked++;
    if (g.per.length !== RARITY.length)
      errors.push(`A: ${g.id}.per 长度 ${g.per.length} ≠ 稀有度档数 ${RARITY.length}`);
  }
  // 判据 B：slot 合法
  for (const g of GEAR) {
    if (!slotSet.has(g.slot)) errors.push(`B: ${g.id}.slot="${g.slot}" 不在 DATA_GEAR_SLOT（${[...slotSet].join('/')}）`);
  }
  // 判据 C：per 单调递增
  for (const g of GEAR) {
    for (let i = 1; i < g.per.length; i++) {
      if (g.per[i] < g.per[i - 1])
        errors.push(`C: ${g.id}.per 在档 ${i} 回落（${g.per[i - 1]} → ${g.per[i]}）⇒ 高稀有度反而更差`);
    }
  }
  // 判据 D：同 slot+stat（真正替代关系）内 chMin 大的应更强
  const byKey = {};
  for (const g of GEAR) (byKey[g.slot + '|' + g.stat] = byKey[g.slot + '|' + g.stat] || []).push(g);
  let dChecked = 0;
  for (const [k, list] of Object.entries(byKey)) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.chMin - b.chMin);
    for (let i = 1; i < sorted.length; i++) {
      const lo = sorted[i - 1], hi = sorted[i];
      if (hi.chMin === lo.chMin) continue;
      const loMax = lo.per[lo.per.length - 1], hiMax = hi.per[hi.per.length - 1];
      dChecked++;
      if (hiMax < loMax)
        errors.push(`D: [${k}] ${hi.id}(chMin${hi.chMin}) 最高档 ${hiMax} < ${lo.id}(chMin${lo.chMin}) 最高档 ${loMax}`);
    }
  }
  const groups = Object.values(byKey).filter((l) => l.length >= 2).length;
  // 判据 E：同 slot+stat 不应 per 完全相同（同质重复）
  for (const [k, list] of Object.entries(byKey)) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if (JSON.stringify(list[i].per) === JSON.stringify(list[j].per))
        errors.push(`E: [${k}] ${list[i].id} 与 ${list[j].id} per 完全相同 ${JSON.stringify(list[i].per)} ⇒ 同质重复`);
    }
  }
  // 判据 C 下界：分组键失效防线
  if (groups < 1) errors.push(`C: 同 slot+stat 组数 0 ⇒ 分组键可能失效（判据腐化）`);

  return { errors, stats: { nSlot: SLOTS.length, nRarity: RARITY.length, nGear: GEAR.length, checked, dChecked, groups } };
}

function selftest() {
  const HTML = process.env.GAME_HTML || process.argv.filter((a) => !a.startsWith('--'))[2] || 'game/萌兽消消岛.html';
  const base = fs.readFileSync(HTML, 'utf8');
  const cases = [];
  cases.push(['真实文件零违规', base, 0]);
  {
    const r = audit(base);
    cases.push([`DATA_GEAR >= ${MIN_GEAR} 条（实得 ${r.stats.nGear}）`, null, r.stats.nGear >= MIN_GEAR ? 0 : 1, r]);
  }
  cases.push(['稀有度 5 档', null, (() => { return audit(base).stats.nRarity === 5 ? 0 : 1; })()]);
  cases.push(['slot 6 槽', null, (() => { return audit(base).stats.nSlot === 6 ? 0 : 1; })()]);

  // ⚠⚠ 第十三类的变体：**变异没施加 ⇒ 假绿**。本轮连踩三层：
  //   ① `DATA_GEAR` 是**数组**（元素 `{ id: "xxx"`），不是对象表（`xxx: {`）⇒ 锚点写错，永不命中；
  //   ② `from` 按正则解释（`[` `]` `.` 是元字符）⇒ 需 `esc()` 字面量转义；
  //   ③ **手抄常量对不上**：源码写 `0.10`，我抄成 `0.1` ⇒ 锚点永不命中（第九类"数字要么实测要么不写"）。
  //   ⇒ 最终修法：**从文件里读出真实值再变异**（`readPer`），彻底消除手抄。
  //   ⇒ 并且**每例加"变异确实施加"前置断言**（`out !== base`），否则变异没施加会伪装成"判据不报错"。
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const readPer = (id) => {
    const m = new RegExp('\\{\\s*id:\\s*"' + id + '"[^}]*?per:\\s*\\[([^\\]]+)\\]').exec(base);
    if (!m) throw new Error('读不到 per: ' + id);
    return m[1];   // 原样字符串（含真实空格/尾零）
  };
  const mutPer = (id, transform) => {
    const cur = readPer(id);
    const next = transform(cur);
    if (next === cur) throw new Error(`变异未生效(内容相同): ${id}`);
    const re = new RegExp('(\\{\\s*id:\\s*"' + id + '"[^}]*?per:\\s*\\[)' + esc(cur) + '(\\])');
    if (!re.test(base)) throw new Error(`变异锚点未命中: ${id} / [${cur}]`);
    const out = base.replace(re, '$1' + next + '$2');
    if (out === base) throw new Error(`变异未生效: ${id}`);
    return out;
  };
  const dropLast = (s) => s.replace(/,\s*[^,]+$/, '');            // 删末档
  const weakenLast = (s) => s.replace(/(,\s*)([^,]+)$/, (m, a, v) => a + (parseFloat(v) / 3).toFixed(2)); // 末档降到 1/3

  cases.push(['1 截短 windstep.per（删末档）应报 A', mutPer('windstep', dropLast), 1]);
  cases.push(['2 paws.slot 改 "ring" 应报 B', base.replace('{ id: "paws", slot: "gloves"', '{ id: "paws", slot: "ring"'), 1]);
  cases.push(['3 leafmail.per 末档降到 1/3 应报 C', mutPer('leafmail', weakenLast), 1]);
  cases.push(['4 windstep.per 末档 0.14→0.04（< softstep 0.10）应报 D', mutPer('windstep', (s) => s.replace(/(,\s*)[^,]+$/, (m, a) => a + '0.04')), 1]);
  cases.push(['5 windstep.per 抄 softstep（同质重复）应报 E', mutPer('windstep', () => readPer('softstep')), 1]);
  cases.push(['6 DATA_GEAR 全表删空 应报 A0', base.replace(/(var[ \t]+DATA_GEAR[ \t]*=\s*\[)[\s\S]*?(\n\];)/, '$1$2'), 1]);
  // 阴性对照 7：动 DATA_GEAR_RARITY 的色值应仍通过（不误报 —— 前缀冲突方向）
  cases.push(['7 动 DATA_GEAR_RARITY 的 color 应仍通过（不误报）', base.replace(/(DATA_GEAR_RARITY[\s\S]*?)\{ name: "普通", color: "#8a8a8a"/, '$1{ name: "普通", color: "#8b8b8b"'), 0]);

  let pass = 0, fail = 0;
  console.log('=== selftest: ci/gear-cross.mjs (v1.201 第 26 维度) ===');
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

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('gear-cross.mjs');
if (isMain) {
  if (process.argv.includes('--selftest')) {
    process.exit(selftest() ? 0 : 1);
  } else {
    const HTML = process.env.GAME_HTML || process.argv.filter((a) => !a.startsWith('--'))[2] || 'game/萌兽消消岛.html';
    const r = audit(fs.readFileSync(HTML, 'utf8'));
    console.log(`ci/gear-cross.mjs — GATE — ${HTML}`);
    console.log(`DATA_GEAR_SLOT ${r.stats.nSlot} · RARITY ${r.stats.nRarity} · DATA_GEAR ${r.stats.nGear} 条 · per 长度/单调检查 ${r.stats.checked} 条 · 同 slot+stat 对照对 ${r.stats.dChecked || 0} · 组数 ${r.stats.groups || 0}`);
    if (r.errors.length) { console.log('\n❌ 违规:'); for (const e of r.errors) console.log('  ' + e); process.exit(1); }
    console.log('\n✅ PASS —— 装备三表一致（per 长度/单调 · slot 合法 · 替代关系强度 · 无同质重复）');
  }
}
