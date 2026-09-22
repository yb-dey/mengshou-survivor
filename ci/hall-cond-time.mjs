// 【v1.202】第 27 维度门禁：大厅解锁条件文案的**硬编码时刻**审计
//
// 病根（v1.187 首次发现、v1.202 发现漏网一条）：
//   `boss1/boss2/boss3` 的出场时刻写在 `DATA_CHAPTER[].bossTimes`，**逐章不同**：
//     boss1  180 / 150 / 180 / 160 / 180 / 180
//     boss2        300 / 360 / 320 / 360 / 360
//     boss3                    480 / 600 / 600
//   而 `DATA_HALL_UNLOCK` 的 `cond` 是 `{type:"anchor", boss:"boss1"}`，
//   判定为 `saveData.hallAnchor["boss1"]` —— **任意章击破过即解锁，与章节无关**。
//   ⇒ **任何单一时刻都无法对所有可达章节为真**（"跨表抄了一份逐章变化的量"）。
//
// 铁证：v1.187 已修过 `startmag`/`mapledart`（改成章节无关表述），
//       但 `startbomb` 的 "击破 3:00 锚点首领" **漏网至今**（v1.202 修复）。
//
// 判据：
//   A 解析完整性 —— DATA_HALL_UNLOCK === 6 条 · DATA_ACHIEVE === 13 条 · DATA_HALL_TALENT === 6 条
//   B **condText 里不得出现硬编码 mm:ss 时刻**（先剥注释，防把解释性注释当数据 —— 第十三类的反面）
//   C 若出现 `（名字）` 形式的专名，必须与 cond 指向的真实 boss/章节名一致
//   D 覆盖度下界 —— 至少检出 N 条"专名断言"，防判据腐化
//
// ⚠ 判据 B 是"**纯否定式**"判据，必须配 D 下界，否则"表被删空"也会通过。
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
function findArr(s, name) {
  const re = new RegExp('var[ \\t]+' + name + '[ \\t]*=');   // ⚠ 词边界（第十六类）
  const m = re.exec(s);
  if (!m) throw new Error('找不到 var ' + name);
  let i = m.index + m[0].length;
  while (i < s.length && s[i] !== '[') i++;
  const st = i;
  let d = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '[' || c === '{') d++;
    else if (c === ']' || c === '}') { d--; if (!d) return s.slice(st, i + 1); }
  }
  throw new Error('未闭合 ' + name);
}

export const MIN_UNLOCK = 6, MIN_ACHIEVE = 13, MIN_TALENT = 6;
export const MIN_NAME_ASSERT = 3;   // 实测 4 条专名断言（巨盾龟/熔岩狮/深渊鲸王/星星巅）

export function audit(srcRaw) {
  const errors = [];
  const src = stripComments(srcRaw);

  const UNLOCK = [], ACHIEVE = [], TALENT = [];
  {
    const b = findArr(src, 'DATA_HALL_UNLOCK');
    for (const line of b.split('\n')) {
      const m = line.match(/condText:\s*"([^"]+)"/);
      if (m) UNLOCK.push({ condText: m[1], line: line.trim() });
    }
  }
  {
    const b = findArr(src, 'DATA_ACHIEVE');
    for (const line of b.split('\n')) {
      const m = line.match(/^\s{2}\{\s*id:\s*"(\w+)",\s*name:\s*"([^"]+)",\s*desc:\s*"([^"]+)",\s*dim:\s*"(\w+)",\s*target:\s*(\d+)/);
      if (m) ACHIEVE.push({ id: m[1], name: m[2], desc: m[3], dim: m[4], target: +m[5] });
    }
  }
  {
    const b = findArr(src, 'DATA_HALL_TALENT');
    for (const line of b.split('\n')) {
      const m = line.match(/^\s{2}\{\s*id:\s*"(\w+)",\s*name:\s*"([^"]+)",\s*stat:\s*"(\w+)",\s*per:\s*(-?[\d.]+),\s*maxLv:\s*(\d+)/);
      if (m) TALENT.push({ id: m[1], name: m[2], stat: m[3], per: +m[4], maxLv: +m[5] });
    }
  }

  // 判据 A0：解析完整性（第十六类防线）
  if (UNLOCK.length !== MIN_UNLOCK) errors.push(`A0: DATA_HALL_UNLOCK condText 应 ${MIN_UNLOCK} 条, 实得 ${UNLOCK.length}`);
  if (ACHIEVE.length !== MIN_ACHIEVE) errors.push(`A0: DATA_ACHIEVE 应 ${MIN_ACHIEVE} 条, 实得 ${ACHIEVE.length}`);
  if (TALENT.length !== MIN_TALENT) errors.push(`A0: DATA_HALL_TALENT 应 ${MIN_TALENT} 条, 实得 ${TALENT.length}`);
  if (errors.length) return { errors, stats: { nUnlock: UNLOCK.length, nAchieve: ACHIEVE.length, nTalent: TALENT.length, nameAssert: 0 } };

  // 判据 B：condText / desc 不得含硬编码 mm:ss
  const TIME_RE = /\b(\d{1,2}):(\d{2})\b/;
  for (const u of UNLOCK) {
    if (TIME_RE.test(u.condText))
      errors.push(`B: 解锁条件文案含硬编码时刻 —— "${u.condText}"（boss 时刻逐章不同，单一时刻无法逐章为真）`);
  }
  for (const a of ACHIEVE) {
    if (TIME_RE.test(a.desc))
      errors.push(`B: 成就 desc 含硬编码时刻 —— ${a.id} "${a.desc}"`);
  }

  // 判据 C：`（专名）` 必须与 cond 指向一致
  let nameAssert = 0;
  const BOSS_NAMES = new Set(['巨盾龟', '熔岩狮', '深渊鲸王']);   // 来自 DATA_ENEMY（下方可扩展）
  const CHAPTER_NAMES = new Set(['芽芽原', '花花谷', '果果林', '岩岩坡', '雾雾泽', '星星巅']);
  for (const u of UNLOCK) {
    const m = u.condText.match(/（([^）]+)）/);
    if (!m) continue;
    const inside = m[1];
    // 专名断言：括号内若是 boss 名或章节名，必须能被真实表认识
    if (BOSS_NAMES.has(inside) || CHAPTER_NAMES.has(inside)) { nameAssert++; }
    else if (/^[\u4e00-\u9fa5]{2,6}$/.test(inside) && !/分钟|正片|锚点|首领/.test(inside)) {
      // 长得像专名但不在已知表内 —— 提示（不硬失败，防误伤）
      errors.push(`C: 解锁条件文案 "${u.condText}" 的括号内容「${inside}」不在已知 boss/章节名表内`);
    }
  }
  // 章节名断言：condText 里出现章节名时计数（供下界）
  for (const u of UNLOCK) { for (const cn of CHAPTER_NAMES) if (u.condText.includes(cn)) { nameAssert++; break; } }

  // 判据 D：覆盖度下界（纯否定式判据必须配下界，否则删空也会通过）
  if (nameAssert < MIN_NAME_ASSERT)
    errors.push(`D: 仅检出 ${nameAssert} 条专名断言, 低于下界 ${MIN_NAME_ASSERT} ⇒ 判据可能已腐化`);

  return { errors, stats: { nUnlock: UNLOCK.length, nAchieve: ACHIEVE.length, nTalent: TALENT.length, nameAssert } };
}

function selftest() {
  const HTML = process.argv.filter((a) => !a.startsWith('--'))[2] || 'game/萌兽消消岛.html';
  const base = fs.readFileSync(HTML, 'utf8');
  const cases = [
    ['真实文件零违规', base, 0],
    ['解析完整性（6/13/6）', null, 0, audit(base)],
  ];
  {
    const r = audit(base);
    cases.push([`专名断言 >= ${MIN_NAME_ASSERT}（实得 ${r.stats.nameAssert}）`, null, r.stats.nameAssert >= MIN_NAME_ASSERT ? 0 : 1, r]);
  }
  // 1 把硬编码时刻加回去 ⇒ 必须报 B
  cases.push(['1 恢复 "击破 3:00 锚点首领（巨盾龟）" 应报 B',
    base.replace('condText: "击破锚点首领（巨盾龟）"', 'condText: "击破 3:00 锚点首领（巨盾龟）"'), 1]);
  // 2 造一个 2:30 的硬编码 ⇒ 必须报 B
  cases.push(['2 condText 加 "2:30" 应报 B',
    base.replace('condText: "击破锚点首领（熔岩狮）"', 'condText: "击破 2:30 锚点首领（熔岩狮）"'), 1]);
  // 3 成就 desc 加时刻 ⇒ 必须报 B
  cases.push(['3 成就 desc 加 "5:00" 应报 B',
    base.replace('desc: "通关第 1 章"', 'desc: "通关第 1 章（5:00）"'), 1]);
  // 4 括号里塞一个不存在的 boss 名 ⇒ 应报 C
  cases.push(['4 括号改「钢铁巨龙」应报 C',
    base.replace('condText: "击破锚点首领（熔岩狮）"', 'condText: "击破锚点首领（钢铁巨龙）"'), 1]);
  // 5 删空解锁表 ⇒ 应报 A0
  cases.push(['5 DATA_HALL_UNLOCK 删空 应报 A0',
    base.replace(/(var[ \t]+DATA_HALL_UNLOCK[ \t]*=\s*\[)[\s\S]*?(\n\];)/, '$1$2'), 1]);
  // 6 注释里有时刻**不应**报（剥注释生效）—— 用当前真实文件验证（注释里有 3:00/2:30/2:40）
  cases.push(['6 注释含时刻不应误报（剥注释生效）', base, 0]);
  // 7 动 DATA_HALL_TALENT 的 per 应仍通过（不误报）
  cases.push(['7 动天赋 per 应仍通过（不误报）', base.replace('per: 12, maxLv: 3', 'per: 15, maxLv: 3'), 0]);
  // 8 把专名断言全删（去掉所有括号专名与章节名）⇒ 应报 D
  cases.push(['8 去掉专名断言 应报 D',
    base.replace(/condText: "([^"]+)"/g, (m, t) => 'condText: "' + t.replace(/（[^）]*）/g, '').replace(/芽芽原|星星巅|花花谷|果果林|岩岩坡|雾雾泽/g, '某章') + '"'), 1]);

  let pass = 0, fail = 0;
  console.log('=== selftest: ci/hall-cond-time.mjs (v1.202 第 27 维度) ===');
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

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('hall-cond-time.mjs');
if (isMain) {
  if (process.argv.includes('--selftest')) process.exit(selftest() ? 0 : 1);
  const HTML = process.argv.filter((a) => !a.startsWith('--'))[2] || 'game/萌兽消消岛.html';
  const r = audit(fs.readFileSync(HTML, 'utf8'));
  console.log(`ci/hall-cond-time.mjs — GATE — ${HTML}`);
  console.log(`DATA_HALL_UNLOCK ${r.stats.nUnlock} · DATA_ACHIEVE ${r.stats.nAchieve} · DATA_HALL_TALENT ${r.stats.nTalent} · 专名断言 ${r.stats.nameAssert}（下界 ${MIN_NAME_ASSERT}）`);
  if (r.errors.length) { console.log('\n❌ 违规:'); for (const e of r.errors) console.log('  ' + e); process.exit(1); }
  console.log('\n✅ PASS —— 解锁/成就文案无硬编码逐章变化量（先剥注释）');
}
