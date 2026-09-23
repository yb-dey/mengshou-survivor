// 【v1.208】第 32 维度门禁：结算双倍领取的"每局一次"契约（防重复入账）
//
// 病根族 = **假保证**（第 39 轮查出第二例）：
//   结算页那条注释原写「…gate_d Db1.5/Dc3.3 以任意态直调为既有契约(见其 L78 "由 onTap 守卫"注)」，
//   实测**本仓库没有 gate_d 套件**（全仓库唯一 gate* 文件是 `ci/gate-audit.mjs` = 跑门禁的工具本身）
//   ⇒ 一个**保护金币不变量**的契约，其门禁是幻影。本文件把"每局只能翻一次金币"钉成静态不变量。
//
// 为什么值得单独钉：这不是"文案不一致"，而是**经济漏洞类**不变量 ——
//   `runSummary.coins`（以及 coinLoot/coinStage/coinFirst/sideGift）在结算时**乘以 2**；
//   守卫一旦被顺手删掉（"这行看着多余"），玩家连点两次按钮即可**重复翻倍**，且**没有任何门禁会报**。
//
// 判据（全部针对 `onTapDoubleBtn` 这一个函数体）：
//   A. 解析完整性：能找到 `function onTapDoubleBtn()`，且函数体含 `runSummary.coins *= 2`（防解析退化后恒绿）
//   B. **入口守卫**：函数体前部必须有 `if (runSummary.doubled) return;`（早退，挡住第二次点击）
//   C. **回调内复核**：翻倍分支的条件必须是 `ok && !runSummary.doubled`（异步回调可能晚于第二次点击）
//   D. **状态置位**：同一分支里必须 `runSummary.doubled = true`（置位缺失 = 守卫永不生效）
//   E. **置位在翻倍之后**：`doubled = true` 必须出现在 `coins *= 2` 之后（顺序反了会先锁后翻、静默失效）
//
// ⚠ 作用域纪律：只锁**结算双倍领取**这一处。`Hooks.requestCoinDouble` 的广告桩、结算面板绘制、
//   其它按钮的 state 守卫都是**另一套语义**，混进来 = 判据太宽 → 假红（本项目踩过）。
// ⚠ 解析纪律（第十六/十八类）：复用 room-tier-cross 的 stripComments（词边界 + 注释剥离）；
//   变异一律"从文件读真实值再变异"，且 `out !== base` 前置断言。
import fs from 'fs';
import { stripComments } from './room-tier-cross.mjs';

export const FN_NAME = 'onTapDoubleBtn';
export const COIN_MUL = 'runSummary.coins *= 2';
export const GUARD = 'if (runSummary.doubled) return;';
export const RECHECK = 'ok && !runSummary.doubled';
export const SET_FLAG = 'runSummary.doubled = true';

// 取 `function <name>() { ... }` 的函数体（大括号配平）
export function fnBody(s, name) {
  const m = new RegExp('function[ \\t]+' + name + '[ \\t]*\\([^)]*\\)[ \\t]*\\{').exec(s);
  if (!m) return null;
  const from = m.index + m[0].length - 1;
  let d = 0;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) return s.slice(from, i + 1); }
  }
  return null;
}

export function audit(src) {
  const errors = [];
  const s = stripComments(src);
  const body = fnBody(s, FN_NAME);
  const stats = { found: !!body, len: body ? body.length : 0, hasGuard: false, hasRecheck: false, hasFlag: false, ordered: false };

  if (!body) { errors.push('A: 找不到 function ' + FN_NAME + '()（改名或删除都会到这里）'); return { errors, stats }; }
  if (!body.includes(COIN_MUL)) errors.push('A: ' + FN_NAME + ' 里找不到 "' + COIN_MUL + '" —— 解析退化或翻倍逻辑被移走');

  stats.hasGuard = body.includes(GUARD);
  if (!stats.hasGuard) errors.push('B: 缺少入口守卫 "' + GUARD + '" —— 连点两次即可重复入账（经济漏洞）');

  stats.hasRecheck = body.includes(RECHECK);
  if (!stats.hasRecheck) errors.push('C: 翻倍分支缺少异步复核 "' + RECHECK + '" —— 回调可能晚于第二次点击');

  stats.hasFlag = body.includes(SET_FLAG);
  if (!stats.hasFlag) errors.push('D: 缺少状态置位 "' + SET_FLAG + '" —— 守卫永远不会生效');

  const iMul = body.indexOf(COIN_MUL), iFlag = body.indexOf(SET_FLAG);
  stats.ordered = iMul >= 0 && iFlag >= 0 && iFlag > iMul;
  if (iMul >= 0 && iFlag >= 0 && !stats.ordered) errors.push('E: "doubled = true" 出现在翻倍之前 —— 会先锁后翻、静默失效');

  return { errors, stats };
}

export function selftest() {
  const HTML = 'game/萌兽消消岛.html';
  const base = fs.readFileSync(HTML, 'utf8');
  const cases = [];
  const mut = (transform) => {
    const out = transform(base);
    if (out === base) throw new Error('变异未生效（内容相同）');
    return out;
  };
  cases.push(['1 原样（基线）应通过', null, 0]);
  cases.push(['2 删掉入口守卫 应报 B', mut((x) => x.replace(GUARD, '/* 守卫被删 */')), 1]);
  cases.push(['3 回调复核改成只看 ok 应报 C', mut((x) => x.replace(RECHECK, 'ok')), 1]);
  cases.push(['4 删掉状态置位 应报 D', mut((x) => x.replace(SET_FLAG, '/* 置位被删 */')), 1]);
  // 5 阳性：在函数开头插入一次"提早置位" ⇒ **只**触发 E（隔离样本，防 B/C/D 顺手一起报）
  //   ⚠ 第一版写成"先替换再换回"，两次替换互相抵消 = 空操作，被 `out !== base` 断言当场拦下（纪律生效）。
  cases.push(['5 函数开头插入提早置位 应报 E', mut((x) => x.replace('function onTapDoubleBtn() {',
    'function onTapDoubleBtn() {\n  runSummary.doubled = true;   // [变异] 提早置位')), 1]);
  cases.push(['6 把函数改名 应报 A', mut((x) => x.replace('function onTapDoubleBtn', 'function onTapDoubleBtnX')), 1]);
  // 阴性①：动结算面板绘制（另一套语义）应仍通过
  cases.push(['7 阴性: 动 drawResultPanel 应仍通过', mut((x) => x.replace('function drawResultPanel', 'function drawResultPanel /* touched */')), 0]);
  // 阴性②：动广告桩（另一套语义）应仍通过
  cases.push(['8 阴性: 动 AdService 桩 应仍通过', mut((x) => x.replace('showRewarded: function (onReward, onFail) {', 'showRewarded: function (onReward, onFail) { /* touched */')), 0]);

  let pass = 0, fail = 0;
  console.log('=== selftest: ci/result-double-guard.mjs (v1.208 第 32 维度) ===');
  for (const [name, mutated, expectErr] of cases) {
    let r;
    try { r = audit(mutated == null ? base : mutated); }
    catch (e) { r = { errors: ['THROW: ' + e.message], stats: {} }; }
    const nErr = r.errors.length;
    const ok = expectErr === 0 ? nErr === 0 : nErr > 0;
    ok ? pass++ : fail++;
    console.log('  ' + (ok ? '✅' : '❌') + ' ' + name + '  (errors=' + nErr + ')');
    if (!ok && nErr) for (const e of r.errors.slice(0, 3)) console.log('        ' + e);
  }
  console.log('\nselftest ' + pass + '/' + cases.length + ' ' + (fail === 0 ? 'PASS' : 'FAIL'));
  return fail === 0;
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('result-double-guard.mjs');
if (isMain) {
  if (process.argv.includes('--selftest')) {
    process.exit(selftest() ? 0 : 1);
  } else {
    const HTML = process.env.GAME_HTML || process.argv.filter((a) => !a.startsWith('--'))[2] || 'game/萌兽消消岛.html';
    const r = audit(fs.readFileSync(HTML, 'utf8'));
    console.log('ci/result-double-guard.mjs — GATE — ' + HTML);
    console.log(FN_NAME + ' 函数体 ' + r.stats.len + ' 字符 · 入口守卫 ' + r.stats.hasGuard + ' · 异步复核 ' + r.stats.hasRecheck + ' · 状态置位 ' + r.stats.hasFlag + ' · 顺序正确 ' + r.stats.ordered);
    if (r.errors.length) { console.log('\n❌ 违规:'); for (const e of r.errors) console.log('  ' + e); process.exit(1); }
    console.log('\n✅ PASS —— 结算双倍领取"每局一次"契约完整（入口守卫 · 异步复核 · 置位 · 顺序）');
  }
}
