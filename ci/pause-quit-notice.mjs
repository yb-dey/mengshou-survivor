// 【v1.198】第 34 维度门禁：暂停层「回大厅」必须说清会不会结算
//
// 契约（产品规则，不是实现细节）：
//   ① 普通章：中途点「回大厅」= 本局掉落**作废**（金币唯一入账 = 结算确认）⇒ 按钮必须写明「不结算」，
//      且有钱可丢时把金额一起写出来（玩家在按下去之前就该知道代价）。
//   ② 无尽章：同一按钮走**弃局结算**（R31）⇒ 必须写「自动结算」，不能沿用「不结算」（说反了同样是骗人）。
//   ③ 结算语义本身**不改**：普通章「退出 = 作废」是有意设计（风险/收益完整性），本门禁只守"知情权"。
//   ④ 进入暂停层有三条路径（暂停按钮 / 切后台 / setState 闸门），**每条都要刷新副标** ——
//      漏一条就会出现"某条路径下按钮不说代价"的静默回退。
//
// 病根（第 43 轮查出）：母版在**复活弹窗**里把代价写得很清楚（「放弃将结算约 N 金」/「放弃无通关礼/首通金币/锻纹」），
//   而暂停层的「回大厅」原本只有三个字、周围一个字提示都没有 ⇒ 第 9 分钟点它，掉落静默全丢。
//
// 阴性对照见 selftest()：6 种"把契约改坏"的变异，每一种都必须被判 FAIL。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_GAME = join(HERE, '..', 'game', '萌兽消消岛.html');
const fileArg = () => process.argv.slice(2).find((a) => !a.startsWith('--')) || DEFAULT_GAME;

function stripLineComments(s) {
  return s.split('\n').map((l) => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l }).join('\n');
}
export function extractFn(src, name) {
  const clean = stripLineComments(src);
  const idx = clean.indexOf('function ' + name + '(');
  if (idx < 0) return null;
  const open = clean.indexOf('{', idx);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < clean.length; i++) {
    if (clean[i] === '{') depth++;
    else if (clean[i] === '}') { depth--; if (depth === 0) return clean.slice(idx, i + 1); }
  }
  return null;
}

export function runChecks(src) {
  const errors = [];
  const note = (ok, msg) => { if (!ok) errors.push(msg); return ok };
  const results = [];

  const fn = extractFn(src, 'syncPauseQuitNotice');
  if (!note(!!fn, '缺少 syncPauseQuitNotice()')) return { errors, results };

  // ── 语义：用真实实现跑四种情形 ──────────────────────────────────────────
  //   ⚠ 第一版写错在这里：`new Function(..., fn)` 只是**声明**了函数、从没调用它 ⇒ 四个用例全拿到空串。
  //     自测的"基线未变异应 0 错误"用例把它抓了出来（这正是基线用例存在的意义）。
  const make = new Function('uiBtnGoHome', 'run', 'GAME', fn + '\nreturn syncPauseQuitNotice;');
  const call = (endless, loot) => {
    const uiBtnGoHome = { sub: '' };
    const f = make(uiBtnGoHome, { coinsGained: loot }, { endlessMode: endless });
    f();
    return uiBtnGoHome.sub;
  };
  const cases = [
    { label: '无尽章 → 自动结算', got: call(true, 500), ok: (s) => s === '自动结算' },
    { label: '普通章 + 掉落 500 → 不结算且带金额', got: call(false, 500), ok: (s) => s.indexOf('不结算') === 0 && s.indexOf('500') > 0 },
    { label: '普通章 + 掉落 0 → 不结算', got: call(false, 0), ok: (s) => s.indexOf('不结算') === 0 },
    { label: '普通章 + 掉落 1（边界）', got: call(false, 1), ok: (s) => s.indexOf('1') > 0 && s.indexOf('不结算') === 0 },
  ];
  for (const c of cases) {
    const ok = c.ok(c.got);
    results.push({ label: c.label, got: c.got, ok });
    note(ok, `${c.label}：实际「${c.got}」`);
  }

  // ── 静态：结算语义与刷新路径 ────────────────────────────────────────────
  const goHome = extractFn(src, 'onTapGoHome');
  note(!!goHome, '缺少 onTapGoHome()');
  if (goHome) {
    note(/GAME\.endlessMode/.test(goHome), 'onTapGoHome 不再区分无尽模式 —— 弃局结算语义被改（本门禁只守提示，不许顺手改语义）');
    note(/enterResult\(GAME\.flow\.RESULT_LOSE\)/.test(goHome), 'onTapGoHome 的无尽分支不再走弃局结算（R31 契约被破坏）');
    note(/goHome\(\)/.test(goHome), 'onTapGoHome 的普通章分支不再回大厅');
  }
  const calls = src.split('syncPauseQuitNotice();').length - 1;
  const okCalls = calls === 3;
  results.push({ label: '暂停层三条路径都刷新副标（调用点 ' + calls + '/3）', got: String(calls), ok: okCalls });
  note(okCalls, `syncPauseQuitNotice() 调用点应为 3 处（暂停按钮 / 切后台 / setState 闸门），实际 ${calls}`);

  return { errors, results };
}

export function selftest() {
  const cases = [];
  const base = readFileSync(fileArg(), 'utf8');
  const t = (name, mutate) => {
    const m = mutate(base);
    let bad = 0, why = '变异未生效(字符串没匹配上)';
    if (m !== base) { const r = runChecks(m); bad = r.errors.length; why = r.errors[0] || '未被判 FAIL' }
    cases.push({ name, pass: bad > 0, why });
  };
  cases.push({ name: '基线未变异应 0 错误', pass: runChecks(base).errors.length === 0, why: (runChecks(base).errors[0] || '') });

  t('M1 无尽分支不再写副标', (s) => s.replace('    uiBtnGoHome.sub = "自动结算";', ''));
  t('M2 金额丢了', (s) => s.replace('("不结算 · 丢弃 " + loot + " 金")', '"不结算"'));
  t('M3 漏掉一条刷新路径', (s) => s.replace('  syncPauseQuitNotice();\n  bindPauseBuildChips();', '  bindPauseBuildChips();'));
  t('M4 副标清空', (s) => s.replace('loot > 0 ? ("不结算 · 丢弃 " + loot + " 金") : "不结算"', '""'));
  t('M5 顺手改了结算语义', (s) => s.replace('if (GAME.state === GAME.flow.PAUSED_MENU && GAME.endlessMode) {', 'if (false) {'));
  t('M6 普通章说成自动结算', (s) => s.replace('loot > 0 ? ("不结算 · 丢弃 " + loot + " 金") : "不结算"', '"自动结算"'));

  let pass = 0;
  console.log('=== selftest: ci/pause-quit-notice.mjs (v1.198 第 34 维度) ===');
  for (const c of cases) {
    if (c.pass) pass++;
    console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}${c.pass ? '' : '  ← ' + c.why}`);
  }
  console.log('\nselftest ' + pass + '/' + cases.length + ' ' + (pass === cases.length ? 'PASS' : 'FAIL'));
  return pass === cases.length;
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('pause-quit-notice.mjs');
if (isMain) {
  if (process.argv.includes('--selftest')) process.exit(selftest() ? 0 : 1);
  const file = fileArg();
  const src = readFileSync(file, 'utf8');
  console.log('=== ci/pause-quit-notice.mjs (v1.198 第 34 维度：退出提示) ===');
  console.log('  源 ' + resolve(file).replace(/\\/g, '/').split('/').slice(-2).join('/') + ' (' + src.length.toLocaleString('en-US') + ' 字符)');
  const r = runChecks(src);
  for (const c of r.results) console.log('  ' + (c.ok ? '✅' : '❌') + ' ' + c.label + (c.ok ? '' : `（实际「${c.got}」）`));
  if (r.errors.length) { console.log('\n❌ 违规:'); for (const e of r.errors) console.log('  ' + e); process.exit(1) }
  console.log('\n✅ PASS —— 普通章退出写明「不结算(+金额)」· 无尽章写明「自动结算」· 三条路径都刷新');
}
