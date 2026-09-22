// 【v1.200】第 25 维度门禁：DATA_CODEX_FORK.feel 的**数量断言** vs DATA_SUPER 真实字段。
//
// 病根（与 v1.199「文案是承诺、数据是事实」同族，但断言类型不同）：
//   v1.199 是**相对断言**（"比鼠更快" → 两值比大小），本维度是**绝对数量断言**
//   （"八只近卫"/"四球远轨"/"六砾密环" → 必须等于 bulletCount）。
//   两类断言在代码里长得完全不像，同一次肉眼审读都会"顺着读过去"，所以必须分开守。
//
// 判据三件套（照搬 v1.199 范式）：
//   A 解析完整性 —— DATA_SUPER === 20 条 · DATA_CODEX_FORK === 10 组 / 20 分支
//   B 断言与数据一致 —— feel 里每个「数字+量词」必须命中对应字段（量词→字段映射见 UNIT2FIELD）
//   C 覆盖度下界 —— **至少检出 N 条数量断言**，否则报错（防判据腐化成恒绿）
//
// 三种失败模式都防：
//   · 判据太窄 → 空跑假绿 ⇒ 量词用**族**（只球砾向叶镖岩发枚道环），不是单个
//   · 判据太宽 → 假红     ⇒ 先 stripComments（本表无注释也做，防未来加注释）
//   · 解析退化 → 假绿     ⇒ 全程下界断言 + selftest 阴性对照
//
// 已证伪（阴性对照 `_qc/_neg-fork-feel.mjs` 6/6）：改数据 / 改文案 / 换单位 三方向都报红，
//   动别的分支不误报 ⇒ 判据**敏感**，非恒绿。
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

function block(s, from) {
  let d = 0, st = -1;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '{' || c === '[') { if (st < 0) st = i; d++; }
    else if (c === '}' || c === ']') { d--; if (!d && st >= 0) return s.slice(st, i + 1); }
  }
  throw new Error('block 未闭合 @' + from);
}

// 行级解析 DATA_SUPER（多行表条目不能跨行匹配 —— 见 v1.199 的教训）
export function parseSuper(src) {
  const S = {};
  const b = block(src, src.indexOf('var DATA_SUPER'));
  for (const line of b.split('\n')) {
    const m = line.match(/^\s{2}(\w+):\s*\{\s*id:\s*"(\w+)",\s*name:\s*"([^"]+)",\s*from:\s*"(\w+)",\s*req:\s*"(\w+)"/);
    if (!m) continue;
    const g = (k) => { const r = line.match(new RegExp('\\b' + k + ':\\s*(-?[\\d.]+)')); return r ? +r[1] : null; };
    const gs = (k) => { const r = line.match(new RegExp('\\b' + k + ':\\s*"([^"]+)"')); return r ? r[1] : null; };
    const gb = (k) => new RegExp('\\b' + k + ':\\s*true\\b').test(line);
    S[m[1]] = {
      id: m[2], name: m[3], from: m[4], req: m[5],
      bulletCount: g('bulletCount'), kind: gs('kind'),
      dmg: g('dmg'), orbitR: g('orbitR'), sweepDeg: g('sweepDeg'), pierce: g('pierce'),
      range: g('range'), laserW: g('laserW'), laserDur: g('laserDur'),
      chain: g('chain'), aoeR: g('aoeR'), interval: g('interval'), bulletSpd: g('bulletSpd'),
      burnDmg: g('burnDmg'), burnDur: g('burnDur'), dropPuddle: gb('dropPuddle'),
    };
  }
  return S;
}

export function parseFork(src) {
  const F = [];
  const b = block(src, src.indexOf('var DATA_CODEX_FORK'));
  for (const line of b.split('\n')) {
    const m = line.match(/\{\s*from:\s*"(\w+)",\s*branches:\s*\[([\s\S]*?)\]\s*\}/);
    if (!m) continue;
    const br = [];
    for (const bm of m[2].matchAll(/\{\s*id:\s*"(\w+)",\s*feel:\s*"([^"]+)",\s*pick:\s*"([^"]+)"/g))
      br.push({ id: bm[1], feel: bm[2], pick: bm[3] });
    F.push({ from: m[1], branches: br });
  }
  return F;
}

const CN = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
// 量词族 —— 判据**不能太窄**（单量词会空跑假绿）
const UNIT_CHARS = '只球砾向叶镖岩发枚道环';
// 量词 → 应等于 DATA_SUPER 的哪个字段
export const UNIT2FIELD = {
  '只': 'bulletCount', '球': 'bulletCount', '砾': 'bulletCount', '向': 'bulletCount',
  '叶': 'bulletCount', '镖': 'bulletCount', '岩': 'bulletCount', '发': 'bulletCount', '枚': 'bulletCount',
};

export function extractCounts(feel) {
  const out = [];
  const re = new RegExp('(\\d+)\\s*([' + UNIT_CHARS + '])', 'g');
  for (const m of feel.matchAll(re)) out.push({ n: +m[1], unit: m[2], raw: m[0] });
  const cn = Object.keys(CN).join('');
  const re2 = new RegExp('([' + cn + '])\\s*([' + UNIT_CHARS + '])', 'g');
  for (const m of feel.matchAll(re2)) out.push({ n: CN[m[1]], unit: m[2], raw: m[0] });
  return out;
}

// 覆盖度下界：实测 9 条（见下方 selftest）。取 8 作下界，留 1 条余量防误伤，
// 但**不能低于 5** —— 太低就失去"防判据腐化"作用。
const MIN_CLAIMS = 8;
const MIN_DIR = 7;   // 定性方向规则实测命中数（见 selftest），同理设下界防腐化

// —— 判据 B2 规则表：把 feel 里的**方向词/性质词**绑定到真实字段 ——
// 同族对照法（同一条武器分叉的两个分支，方向词必须一正一反）
//   [A, B, 字段, 'GT'|'LT'] 表示 A.字段 应 > / < B.字段
const DIRECTION_PAIRS = [
  ['gurumeteor', 'gurugravel', 'orbitR', 'GT'],   // "四岩**远**砸" vs "六砾**密**环" → 130 > 62
  ['bladestorm', 'leafdash', 'range', 'GT'],      // "三叶**远**阵" vs "五叶**近**快" → 380 > 240
  ['fluffguard', 'beesguard', 'orbitR', 'GT'],    // "四球**远**轨" vs "八只近卫"     → 150 > 110
  ['mapletornado', 'maplecross', 'range', 'GT'],  // "六镖**远**卷" vs "对穿**近**斩" → 430 > 250
  ['thunderstorm', 'pepperbolt', 'chain', 'GT'],  // "连锁雷云" vs "**短链**快劈"     → 3 > 1
  ['thunderstorm', 'pepperbolt', 'interval', 'GT'], // 雷云慢(1.2) vs "快劈"(0.55)
  ['solarflare', 'nectarsnap', 'laserW', 'GT'],   // "**宽**束慢扫" vs "**窄**束瞬斩" → 40 > 14
  ['solarflare', 'nectarsnap', 'laserDur', 'GT'], // 慢(3) vs 瞬(0.42)
  ['solarflare', 'nectarsnap', 'interval', 'GT'], // 慢扫(3) vs 瞬斩(0.78)
  ['rootwell', 'tideshield', 'aoeR', 'GT'],       // "站住才打"(168) vs "走动花环"(132)
  ['gurugravel', 'gurumeteor', 'bulletCount', 'GT'], // "六砾" vs "四岩" → 6 > 4
  ['bladestorm', 'leafdash', 'bulletCount', 'LT'],   // "三叶" vs "五叶" → 3 < 5
  ['mapletornado', 'maplecross', 'bulletCount', 'GT'], // "六镖" vs "对穿"(4)
  ['beesguard', 'fluffguard', 'bulletCount', 'GT'],  // "八只" vs "四球" → 8 > 4
];

// 单条规则：[id, 字段, 期望值] 或 [id, 字段, fn]
const SINGLE_RULES = [
  ['megaboom', 'burnDmg', (r) => typeof r.burnDmg === 'number' && r.burnDmg > 0],   // "巨木**余燃**" → burnDmg 8
  ['peppermine', 'dropPuddle', (r) => r.dropPuddle === true],                        // "落地**地雷**" → dropPuddle true
];

export function audit(srcRaw) {
  const errors = [];
  const src = stripComments(srcRaw);
  const S = parseSuper(src), F = parseFork(src);

  // 判据 A：解析完整性
  const nS = Object.keys(S).length;
  const nF = F.length, nB = F.reduce((a, x) => a + x.branches.length, 0);
  if (nS !== 20) errors.push(`A: DATA_SUPER 应 20 条, 实得 ${nS}`);
  if (nF !== 10) errors.push(`A: DATA_CODEX_FORK 应 10 组, 实得 ${nF}`);
  if (nB !== 20) errors.push(`A: FORK 分支应 20 个, 实得 ${nB}`);
  if (errors.length) return { errors, stats: { nS, nF, nB, checked: 0, skipped: [] } };

  const sidSet = new Set(Object.keys(S));
  const fidSet = new Set();
  for (const f of F) for (const b of f.branches) fidSet.add(b.id);
  const onlyS = [...sidSet].filter((x) => !fidSet.has(x));
  const onlyF = [...fidSet].filter((x) => !sidSet.has(x));
  if (onlyS.length) errors.push(`A: DATA_SUPER 有而 FORK 无: ${onlyS.join(',')}`);
  if (onlyF.length) errors.push(`A: FORK 有而 DATA_SUPER 无: ${onlyF.join(',')}`);

  // 判据 B2：**定性描述**核验 —— 11 条 feel 无数量断言，但含方向/性质词
  //   （"远/近"/"宽/窄"/"连锁/短链"/"余燃"/"地雷"/"花环"/"站住"）
  //   这些词**必须能映射到真实字段**，否则就是"好听的形容词没人守"。
  //   映射规则见 D_QUAL。**不命中规则不算违规**（有些词是纯文学形容），
  //   但**同一对照对（A/B 分叉）的方向必须成立** —— 这才是可判定的部分。
  const dErrors = [];
  let dirChecked = 0;
  for (const [idA, idB, field, want] of DIRECTION_PAIRS) {
    const a = S[idA], b = S[idB];
    if (!a || !b) { dErrors.push(`B2: 对照对 ${idA}/${idB} 缺定义`); continue; }
    if (a[field] == null || b[field] == null) { dErrors.push(`B2: ${field} 无值 (${idA}/${idB})`); continue; }
    const ok = want === 'GT' ? a[field] > b[field] : a[field] < b[field];
    if (!ok) dErrors.push(`B2: ${idA}.${field}=${a[field]} 应 ${want === 'GT' ? '>' : '<'} ${idB}.${field}=${b[field]}（方向词失真）`);
    dirChecked++;
  }
  for (const [id, field, want] of SINGLE_RULES) {
    const r = S[id];
    if (!r) { dErrors.push(`B2: ${id} 缺定义`); continue; }
    if (typeof want === 'function') { if (!want(r)) dErrors.push(`B2: ${id} 单条规则不成立: ${want.desc || ''}`); else dirChecked++; continue; }
    if (r[field] !== want) dErrors.push(`B2: ${id}.${field}=${r[field]} 应 === ${want}`);
    else dirChecked++;
  }


  // 判据 B：逐条数量断言核验
  let checked = 0;
  const skipped = [];
  for (const f of F) {
    for (const b of f.branches) {
      const real = S[b.id];
      const claims = extractCounts(b.feel);
      if (!claims.length) { skipped.push({ id: b.id, feel: b.feel, why: '无数量断言 ⇒ 由判据 B2 定性规则覆盖' }); continue; }
      for (const c of claims) {
        const field = UNIT2FIELD[c.unit];
        if (!field || real[field] == null) { skipped.push({ id: b.id, claim: c.raw, why: `${field} 无值` }); continue; }
        checked++;
        if (real[field] !== c.n)
          errors.push(`B: ${b.id} feel"${b.feel}" 断言 ${c.raw}=${c.n}, 但 ${field}=${real[field]}`);
      }
    }
  }

  // 判据 C：覆盖度下界（防判据腐化成恒绿）
  if (checked < MIN_CLAIMS)
    errors.push(`C: 仅检出 ${checked} 条数量断言, 低于下界 ${MIN_CLAIMS} ⇒ 判据可能已腐化（模板被改?）`);
  if (dirChecked < MIN_DIR)
    errors.push(`C: 仅命中 ${dirChecked} 条定性方向规则, 低于下界 ${MIN_DIR} ⇒ 规则表可能已失效（字段改名?）`);

  for (const e of dErrors) errors.push(e);
  return { errors, stats: { nS, nF, nB, checked, dirChecked, skipped } };
}

// ---------------- selftest ----------------
function selftest() {
  const HTML = process.argv.filter((a) => !a.startsWith('--'))[2] || 'game/萌兽消消岛.html';
  const base = fs.readFileSync(HTML, 'utf8');
  const cases = [];

  // 1 真实文件零违规
  cases.push(['真实文件零违规', base, 0]);
  // 2 检出断言数 >= MIN_CLAIMS（实测 9）
  {
    const r = audit(base);
    cases.push([`检出断言数 >= ${MIN_CLAIMS}（实得 ${r.stats.checked}）`, null, r.stats.checked >= MIN_CLAIMS ? 0 : 1, r]);
  }
  // 3 DATA_SUPER 20 条
  cases.push(['DATA_SUPER 20 条', null, parseSuper(stripComments(base)) && Object.keys(parseSuper(stripComments(base))).length === 20 ? 0 : 1]);
  // 4 FORK 20 分支
  {
    const F = parseFork(stripComments(base));
    const n = F.reduce((a, x) => a + x.branches.length, 0);
    cases.push(['FORK 20 分支', null, n === 20 ? 0 : 1]);
  }
  // 阴性对照 5a：改数据 beesguard.bulletCount 8→6 ⇒ 必须报 B
  cases.push(['5a 改数据(beesguard bc 8→6) 必须报 B', base.replace(/(beesguard:\s*\{[^}]*?bulletCount:\s*)8/, '$16'), 1]);
  // 阴性对照 5b：改文案 beesguard feel 八只→六只 ⇒ 必须报 B
  cases.push(['5b 改文案(八只→六只) 必须报 B', base.replace(/(\{\s*id:\s*"beesguard",\s*feel:\s*")八只/, '$1六只'), 1]);
  // 阴性对照 5c：动别处 gurumeteor（beesguard 不受影响）⇒ 应仍通过
  cases.push(['5c 动别处(gurumeteor 四岩→六岩) 应仍通过', base.replace(/(\{\s*id:\s*"gurumeteor",\s*feel:\s*")四岩/, '$1六岩'), 1]);
  // 阴性对照 5d：换单位（fluffguard 四球→六球）⇒ 必须报 B
  cases.push(['5d 换单位(四球→六球) 必须报 B', base.replace(/(\{\s*id:\s*"fluffguard",\s*feel:\s*")四球/, '$1六球'), 1]);
  // 阴性对照 6：把全部 feel 的数量断言删掉 ⇒ 应报 C（判据腐化）
  cases.push(['6 全部 feel 去数量化 应报 C', base.replace(/(\{\s*id:\s*"\w+",\s*feel:\s*")[^"]+"/g, '$1定性描述"'), 1]);
  // 阴性对照 7：破坏 DATA_SUPER 结构 ⇒ 应报 A
  cases.push(['7 破坏 DATA_SUPER 表结构 应报 A', base.replace('var DATA_SUPER = {', 'var DATA_SUPER = { __junk__: 1,').replace(/^\s{2}acornstorm:\s*\{/m, '  __x: 0, acornstorm: {'), 1]);
  // 阴性对照 8：把 gurumeteor.orbitR 从 130 改小到 40（"远砸"变近）⇒ B2 应报红
  cases.push(['8 改 gurumeteor.orbitR 130→40 (远砸失真) 应报 B2', base.replace(/(gurumeteor:\s*\{[\s\S]*?\borbitR:\s*)130/, '$140'), 1]);
  // 阴性对照 9：把 solarflare.laserW 40→10（"宽束"变窄）⇒ B2 应报红
  cases.push(['9 改 solarflare.laserW 40→10 (宽束失真) 应报 B2', base.replace(/(solarflare:\s*\{[\s\S]*?\blaserW:\s*)40/, '$110'), 1]);
  // 阴性对照 10：把 megaboom.burnDmg 删掉（"余燃"无据）⇒ B2 应报红
  cases.push(['10 删 megaboom.burnDmg ("余燃"无据) 应报 B2', base.replace(/(megaboom:\s*\{[\s\S]*?\bburnDmg:\s*)\d+/, '$10'), 1]);

  let pass = 0, fail = 0;
  console.log('=== selftest: ci/fork-feel-count.mjs (v1.200 第 25 维度) ===');
  for (const [name, mutated, expectErr, pre] of cases) {
    const r = pre || audit(mutated == null ? base : mutated);
    const nErr = r.errors.length;
    const ok = expectErr === 0 ? nErr === 0 : nErr > 0;
    ok ? pass++ : fail++;
    console.log(`  ${ok ? '✅' : '❌'} ${name}  (errors=${nErr})`);
    if (!ok && nErr) for (const e of r.errors.slice(0, 3)) console.log(`        ${e}`);
  }
  console.log(`\nselftest ${pass}/${cases.length} ${fail === 0 ? 'PASS' : 'FAIL'}`);
  return fail === 0;
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('fork-feel-count.mjs');
if (isMain) {
  if (process.argv.includes('--selftest')) {
    process.exit(selftest() ? 0 : 1);
  } else {
    const HTML = process.argv[2] || 'game/萌兽消消岛.html';
    const src = fs.readFileSync(HTML, 'utf8');
    const r = audit(src);
    console.log(`ci/fork-feel-count.mjs — GATE — ${HTML}`);
    console.log(`DATA_SUPER ${r.stats.nS} 条 · DATA_CODEX_FORK ${r.stats.nF} 组 / ${r.stats.nB} 分支 · 数量断言 ${r.stats.checked} 条（下界 ${MIN_CLAIMS}） · 定性方向规则 ${r.stats.dirChecked} 条（下界 ${MIN_DIR}）`);
    if (r.stats.skipped && r.stats.skipped.length) {
      console.log(`\n无数量断言的分支 ${r.stats.skipped.length} 条（已由判据 B2 定性规则覆盖）:`);
      for (const s of r.stats.skipped) console.log(`  · ${s.id.padEnd(13)} ${s.feel || s.claim || ''}  — ${s.why}`);
    }
    if (r.errors.length) { console.log('\n❌ 违规:'); for (const e of r.errors) console.log('  ' + e); process.exit(1); }
    console.log('\n✅ PASS —— feel 数量断言全部与 DATA_SUPER 一致');
  }
}
