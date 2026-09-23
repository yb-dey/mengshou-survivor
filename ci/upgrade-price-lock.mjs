// 【v1.207】第 31 维度门禁：局外强化价格锁（UPGRADE_DEFS × CONFIG.upPriceExp / upMaxLv）
//
// 病根族 = **假保证**（第 36 轮查出）：
//   母版 L10557 注释声称「冻结断言 gate_d_upgrade Da1/Da5 按"该表 5 线×10 级"闭合(价格合计 29939 口径)」，
//   实测 **全仓库没有 gate_d_upgrade**（grep 只命中那条注释本身，ci/ 下只有 room-tier-cross 碰这些表）
//   ⇒ 这张价格表**没有任何门禁在守**；且注释里的 29939 与代码自身公式实算的 **29,980** 也不符（差 41）。
//   **"注释声称有门禁" ≠ "门禁存在"** —— 本文件把那个声称变成现实。
//
// 判据（全部锚在**代码自身的公式**上，不锚注释）：
//   A. 解析完整性：UPGRADE_DEFS 恰好 5 线、每线 base > 0（防整表被改空/解析退化后恒绿）
//   B. 曲线参数锚定：CONFIG.upPriceExp === 1.6 且 upMaxLv === 10（被改 = 全场价格漂移）
//   C. **逐线满级合计锁定**：atk/hp 5451 · aspd/move 7267 · pickup 4544（改 base 或 exp 都会在这里报）
//   D. 五线合计锁定：**29,980**（注释里的 29939 是**陈旧值**，不是基准）
//   E. 首级价锁定：第一个永久强化 = **30 金**（首局门槛属产品口径，见 `产品视角-小游戏化.md` 第九节）
//
// ⚠ 作用域纪律：只锁**局外强化五线**。`PATH_NODE_DEFS`（天赋路径 base 60）与 `DATA_BEAST`（跟宠固定价）
//   是**另一套价格语义**，混进同一把锁 = 判据太宽 → 改 A 报 B（假红）。自测里用两条阴性样本钉死这一点。
// ⚠ 解析纪律（第十六/十八类）：复用 room-tier-cross 的 stripComments/findVar/block（词边界 + 括号配平）；
//   变异一律"从文件读真实值再变异"（手抄常量永远可疑）。
import fs from 'fs';
import { stripComments, findVar, block } from './room-tier-cross.mjs';

export const LOCK_LINES = 5;
export const LOCK_EXP = 1.6;
export const LOCK_MAX_LV = 10;
export const LOCK_TOTAL = 29980;
export const LOCK_FIRST = 30;
export const LOCK_PER_LINE = { atk: 5451, hp: 5451, aspd: 7267, move: 7267, pickup: 4544 };

export function parseUpgradeDefs(s) {
  const b = block(s, findVar(s, 'UPGRADE_DEFS'));
  const out = [];
  const re = /\{\s*id:\s*"([a-z_]+)",\s*name:\s*"([^"]+)",\s*base:\s*(\d+)/g;
  let m;
  while ((m = re.exec(b)) !== null) out.push({ id: m[1], name: m[2], base: +m[3] });
  return out;
}
// ⚠ 只认 `名字:` 形式（CONFIG 里的声明）；`CONFIG.upPriceExp || 1.6` 这类引用没有冒号，不会误命中
export function parseConfNum(s, name) {
  const m = new RegExp(name + ':\\s*([\\d.]+)').exec(s);
  return m ? parseFloat(m[1]) : null;
}
export const priceAt = (base, lv, exp) => Math.ceil(base * Math.pow(exp, lv));
export function lineTotal(base, maxLv, exp) {
  let sum = 0;
  for (let lv = 0; lv < maxLv; lv++) sum += priceAt(base, lv, exp);
  return sum;
}

export function audit(src) {
  const errors = [];
  const s = stripComments(src);
  const defs = parseUpgradeDefs(s);
  const exp = parseConfNum(s, 'upPriceExp');
  const maxLv = parseConfNum(s, 'upMaxLv');
  const stats = { nLines: defs.length, exp, maxLv, total: 0, first: 0, perLine: [] };

  if (defs.length !== LOCK_LINES) errors.push(`A: UPGRADE_DEFS 应为 ${LOCK_LINES} 线，实得 ${defs.length}`);
  for (const d of defs) if (!(d.base > 0)) errors.push(`A: ${d.id} 的 base 非正（${d.base}）`);
  if (exp !== LOCK_EXP) errors.push(`B: CONFIG.upPriceExp 应为 ${LOCK_EXP}，实得 ${exp}`);
  if (maxLv !== LOCK_MAX_LV) errors.push(`B: CONFIG.upMaxLv 应为 ${LOCK_MAX_LV}，实得 ${maxLv}`);

  const useExp = exp > 0 ? exp : LOCK_EXP;
  const useLv = maxLv > 0 ? maxLv : LOCK_MAX_LV;
  let total = 0;
  for (const d of defs) {
    const t = lineTotal(d.base, useLv, useExp);
    total += t;
    stats.perLine.push(`${d.id} ${d.base}→${t}`);
    const want = LOCK_PER_LINE[d.id];
    if (want === undefined) errors.push(`C: 出现未登记的新线 ${d.id}（新增线是有意为之的话，请同步更新锁表）`);
    else if (t !== want) errors.push(`C: ${d.id} 满级合计应为 ${want}，实得 ${t}（base=${d.base}）`);
  }
  stats.total = total;
  stats.first = defs.length ? priceAt(defs[0].base, 0, useExp) : 0;
  if (total !== LOCK_TOTAL) errors.push(`D: 五线满级合计应为 ${LOCK_TOTAL}，实得 ${total}`);
  if (stats.first !== LOCK_FIRST) errors.push(`E: 第一个永久强化 1 级价应为 ${LOCK_FIRST}，实得 ${stats.first}`);
  return { errors, stats };
}

export function selftest() {
  const HTML = 'game/萌兽消消岛.html';
  const base = fs.readFileSync(HTML, 'utf8');
  const cases = [];
  cases.push(['1 原样（基线）应通过', null, 0]);
  // 阳性：把**第一条**线的 base 30→31（第一条 = 攻击强化；第二条 hp 的 base 同样是 30，故意只动第一条）
  cases.push(['2 atk base 30→31 应报 C/D', base.replace('base: 30', 'base: 31'), 1]);
  // 阳性：价格曲线底数 1.6→1.7
  cases.push(['3 upPriceExp 1.6→1.7 应报 B/C/D', base.replace('upPriceExp: 1.6', 'upPriceExp: 1.7'), 1]);
  // 阳性：级数上限 10→11
  cases.push(['4 upMaxLv 10→11 应报 B/C/D', base.replace('upMaxLv: 10', 'upMaxLv: 11'), 1]);
  // 阳性：删掉第一条线（整表退化）
  {
    const line = /\n\s*\{\s*id:\s*"atk",[^\n]*\n/.exec(base);
    const mut = line ? base.replace(line[0], '\n') : base;
    cases.push(['5 删掉 atk 一条线 应报 A/C/D', mut, 1]);
  }
  // 阳性：插入一条未登记的新线
  {
    const anchor = 'var UPGRADE_DEFS = [';
    const i = base.indexOf(anchor);
    const mut = i < 0 ? base : base.slice(0, i + anchor.length) +
      '\n  { id: "brandnew", name: "新线", base: 50, desc: "x", stat: "dmgPct", per: 0.01 },' + base.slice(i + anchor.length);
    if (mut === base) throw new Error('变异未生效: 插入新线');
    cases.push(['6 插入未登记新线 应报 A/C', mut, 1]);
  }
  // 阴性①：动天赋路径（另一套语义）应仍通过 —— 证明作用域正确
  cases.push(['7 阴性: 动 PATH_NODE_DEFS base 应仍通过', base.replace('base: 60', 'base: 61'), 0]);
  // 阴性②：动跟宠里程价（固定价语义）应仍通过
  cases.push(['8 阴性: 动 DATA_BEAST price 应仍通过', base.replace('price: 1500', 'price: 1600'), 0]);

  let pass = 0, fail = 0;
  console.log('=== selftest: ci/upgrade-price-lock.mjs (v1.207 第 31 维度) ===');
  for (const [name, mutated, expectErr] of cases) {
    let r;
    try { r = audit(mutated == null ? base : mutated); }
    catch (e) { r = { errors: ['THROW: ' + e.message], stats: {} }; }
    const nErr = r.errors.length;
    const ok = expectErr === 0 ? nErr === 0 : nErr > 0;
    ok ? pass++ : fail++;
    console.log(`  ${ok ? '✅' : '❌'} ${name}  (errors=${nErr})`);
    if (!ok && nErr) for (const e of r.errors.slice(0, 3)) console.log(`        ${e}`);
  }
  console.log(`\nselftest ${pass}/${cases.length} ${fail === 0 ? 'PASS' : 'FAIL'}`);
  return fail === 0;
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('upgrade-price-lock.mjs');
if (isMain) {
  if (process.argv.includes('--selftest')) {
    process.exit(selftest() ? 0 : 1);
  } else {
    const HTML = process.env.GAME_HTML || process.argv.filter((a) => !a.startsWith('--'))[2] || 'game/萌兽消消岛.html';
    const r = audit(fs.readFileSync(HTML, 'utf8'));
    console.log(`ci/upgrade-price-lock.mjs — GATE — ${HTML}`);
    console.log(`五线 ${r.stats.nLines} 条 · upPriceExp ${r.stats.exp} · upMaxLv ${r.stats.maxLv} · 逐线 ${r.stats.perLine.join(' / ')} · 合计 ${r.stats.total} · 首级 ${r.stats.first}`);
    if (r.errors.length) { console.log('\n❌ 违规:'); for (const e of r.errors) console.log('  ' + e); process.exit(1); }
    console.log('\n✅ PASS —— 局外强化价格与锁表一致（5 线 · exp 1.6 · 10 级 · 合计 29,980 · 首级 30）');
  }
}
