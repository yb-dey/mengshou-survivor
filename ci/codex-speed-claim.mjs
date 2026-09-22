#!/usr/bin/env node
// 图鉴「读招/打法」文案里的**相对速度断言** vs DATA_ENEMY 真实 spd —— 第 24 维度门禁。
//
// 病根形态（v1.199 首次发现）：**同句式的相对断言，一条真一条假**。
//   fox   hint="剪影可分, 比兔更快"  spd 158 > rabbit 120  ✅ 真
//   raven hint="剪影可分, 比鼠更快"  spd 148 < mouse  150  ❌ 假（鸦比鼠慢 2！）
//   ⇒ 两句结构完全同构（都是「剪影可分, 比X更快」），肉眼审读时会"顺着读过去"，
//     只有把断言**翻译成数据比较**才抓得住。这正是"文案是承诺、数据是事实"最阴的一类。
//
// 三种失败模式（都曾踩过，见技能 ai-art-pipeline 第十章）：
//   ① 判据太窄 → 空跑假绿：只认一种句式，别的句式静默跳过 ⇒ 本门禁用**句式族**匹配
//   ② 判据太宽 → 假红：把解释性注释当数据 ⇒ 本门禁**只解析代码区**，先剥离注释
//   ③ 解析退化 → 假绿：表结构变了仍"跑通" ⇒ 本门禁全程**下界断言**（21 条敌表 / 21 条图鉴）
//
// 判据：
//   A 解析完整性：DATA_ENEMY === 21 条且 DATA_CODEX_ENEMY === 21 条，两者 id 集合相等
//   B 相对速度断言：凡 hint/tell 出现「比X更快 / 比X慢 / X更快」且 X 能映射到真实怪
//       ⇒ 必须满足 spd 关系；无法映射到真实怪的断言**显式跳过并计数**（不静默）
//   C 覆盖度：至少解析到 1 条断言（否则说明句式族失效 ⇒ 报错，防"判据腐化成恒绿"）
//
// 用法：
//   node ci/codex-speed-claim.mjs                # 审计（GAME_HTML 可切入口）
//   node ci/codex-speed-claim.mjs --selftest     # 自检（含阴性对照）
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAME = process.env.GAME_HTML || path.join(__dirname, '..', 'game', '萌兽消消岛.html');

// ---------- 工具 ----------
// 剥离注释（保守：不碰字符串内的 // ）
export function stripComments(src) {
  let out = '', i = 0, n = src.length;
  let inS = null, inL = false, inB = false;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (inL) { if (c === '\n') { inL = false; out += c; } else out += ' '; i++; continue; }
    if (inB) { if (c === '*' && c2 === '/') { inB = false; out += '  '; i += 2; continue; } out += (c === '\n' ? '\n' : ' '); i++; continue; }
    if (inS) {
      out += c;
      if (c === '\\') { out += src[i + 1] || ''; i += 2; continue; }
      if (c === inS) inS = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { inS = c; out += c; i++; continue; }
    if (c === '/' && c2 === '/') { inL = true; out += '  '; i += 2; continue; }
    if (c === '/' && c2 === '*') { inB = true; out += '  '; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

function bracketBlock(s, from) {
  let d = 0, st = -1;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '{' || c === '[') { if (st < 0) st = i; d++; }
    else if (c === '}' || c === ']') { d--; if (!d && st >= 0) return s.slice(st, i + 1); }
  }
  throw new Error('括号配平失败');
}

// DATA_ENEMY：行级（表内每行一条，缩进 2 空格）
export function parseEnemy(src) {
  const code = stripComments(src);
  const i = code.indexOf('var DATA_ENEMY');
  if (i < 0) throw new Error('DATA_ENEMY 未找到');
  const b = bracketBlock(code, i);
  const out = {};
  for (const line of b.split('\n')) {
    const m = line.match(/^\s{2}(\w+):\s*\{\s*id:\s*"(\w+)",\s*name:\s*"([^"]+)",[^}]*?spd:\s*(\d+),/);
    if (!m) continue;
    out[m[1]] = { name: m[3], spd: +m[4] };
  }
  return out;
}

// DATA_CODEX_ENEMY：行级，取 id/tell/where/hint
export function parseCodex(src) {
  const code = stripComments(src);
  const i = code.indexOf('var DATA_CODEX_ENEMY');
  if (i < 0) throw new Error('DATA_CODEX_ENEMY 未找到');
  const b = bracketBlock(code, i);
  const out = [];
  for (const line of b.split('\n')) {
    const m = line.match(/\{\s*id:\s*"(\w+)",\s*group:\s*"(\w+)",\s*tell:\s*"([^"]+)",\s*where:\s*"([^"]+)",\s*hint:\s*"([^"]+)"/);
    if (!m) continue;
    out.push({ id: m[1], group: m[2], tell: m[3], where: m[4], hint: m[5] });
  }
  return out;
}

// 速度断言句式族（宁可多认，不可漏认）
//   中文里"X更快"的比较对象在**前一个名词**，这里显式列出已知怪的中文名 + 常见简称
const NAME2ID = {
  '兔': 'rabbit', '呆呆兔': 'rabbit', '熊': 'bear', '壮壮熊': 'bear',
  '鼠': 'mouse', '闪电鼠': 'mouse', '猬': 'hedgehog', '喷嚏猬': 'hedgehog',
  '狐': 'fox', '疾风狐': 'fox', '鸦': 'raven', '夜啼鸦': 'raven',
  '蟹': 'orbitcrab', '环甲蟹': 'orbitcrab', '果': 'boomfruit', '爆果果': 'boomfruit',
  '菇': 'sporecap', '孢孢菇': 'sporecap', '蟾': 'leaptoad', '跳跳蟾': 'leaptoad',
  '鼹': 'burrowmole', '钻钻鼹': 'burrowmole', '獾': 'badger', '钢盔獾': 'badger',
  '猪': 'boar', '暴走野猪': 'boar', '猴': 'monkey', '弹弓猴': 'monkey',
  '犀': 'chargerhino', '冲锋犀': 'chargerhino', '虫': 'shieldbug', '盾甲虫': 'shieldbug',
  '罐猬': 'honeypot', '蜜罐猬': 'honeypot', '石甲': 'rollshell', '滚滚石甲': 'rollshell',
  '龟': 'boss1', '巨盾龟': 'boss1', '狮': 'boss2', '熔岩狮': 'boss2', '鲸': 'boss3', '深渊鲸王': 'boss3'
};

// 抓「比<X>更快 / 比<X>慢 / 比<X>快 / 比<X>肉 / 比<X>脆 / 比<X>薄」
export function extractSpeedClaims(text) {
  const out = [];
  const re = /比([\u4e00-\u9fa5]{1,4}?)(更快|更慢|快|慢|更肉|脆|薄|厚)/g;
  let m;
  while ((m = re.exec(text))) out.push({ raw: m[0], ref: m[1], rel: m[2] });
  return out;
}

// ---------- 审计 ----------
export function audit(src) {
  const enemy = parseEnemy(src);
  const codex = parseCodex(src);
  const issues = [];
  const skipped = [];

  // 判据 A
  const eIds = Object.keys(enemy).sort();
  const cIds = codex.map(c => c.id).sort();
  if (eIds.length !== 21) issues.push({ rule: 'A', msg: `DATA_ENEMY 应为 21 条, 实得 ${eIds.length}` });
  if (cIds.length !== 21) issues.push({ rule: 'A', msg: `DATA_CODEX_ENEMY 应为 21 条, 实得 ${cIds.length}` });
  const missInCodex = eIds.filter(x => !cIds.includes(x));
  const missInEnemy = cIds.filter(x => !eIds.includes(x));
  if (missInCodex.length) issues.push({ rule: 'A', msg: `DATA_ENEMY 有而图鉴无: ${missInCodex.join(' ')}` });
  if (missInEnemy.length) issues.push({ rule: 'A', msg: `图鉴有而 DATA_ENEMY 无: ${missInEnemy.join(' ')}` });

  // 判据 B
  const checked = [];
  for (const c of codex) {
    const me = enemy[c.id];
    if (!me) continue;
    for (const field of ['tell', 'hint', 'where']) {
      for (const cl of extractSpeedClaims(c[field] || '')) {
        const refId = NAME2ID[cl.ref];
        if (!refId || !enemy[refId]) { skipped.push({ id: c.id, field, ...cl }); continue; }
        const faster = me.spd > enemy[refId].spd;
        const slower = me.spd < enemy[refId].spd;
        let ok = true, dir = '';
        if (/快/.test(cl.rel)) { ok = faster; dir = '更快'; }
        else if (/慢/.test(cl.rel)) { ok = slower; dir = '更慢'; }
        else if (/肉|厚/.test(cl.rel)) { ok = me.spd > enemy[refId].spd; dir = '更肉'; } // "更肉"指速度更快(贴脸)
        else if (/脆|薄/.test(cl.rel)) { ok = true; dir = '脆薄(非速度)'; }
        checked.push({ id: c.id, field, raw: cl.raw, refId, my: me.spd, ref: enemy[refId].spd, ok, dir });
        if (!ok) {
          issues.push({
            rule: 'B',
            msg: `${c.id}(${me.name}) ${field} 断言"${cl.raw}": spd ${me.spd} vs ${refId}(${enemy[refId].name}) ${enemy[refId].spd} ⇒ 不成立`
          });
        }
      }
    }
  }

  // 判据 C
  if (checked.length === 0) issues.push({ rule: 'C', msg: '零断言被检出 —— 句式族可能已失效(防"判据腐化成恒绿")' });

  return { issues, checked, skipped, enemy, codex };
}

// ---------- selftest ----------
function selftest() {
  const src = fs.readFileSync(GAME, 'utf8');
  let pass = 0, fail = 0;
  const t = (name, cond, extra) => { cond ? pass++ : fail++; console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`); };

  console.log(`=== selftest (${path.basename(GAME)}) ===`);

  // 1. 真实文件零违规
  const a = audit(src);
  t('1  真实文件零违规', a.issues.length === 0, a.issues.map(i => i.msg).join(' | '));
  t('2  检出断言数 >= 3', a.checked.length >= 3, `实得 ${a.checked.length}`);
  t('3  敌表 21 条', Object.keys(a.enemy).length === 21, `实得 ${Object.keys(a.enemy).length}`);

  // 4. 断言明细（含 raven 修正后的状态）
  for (const c of a.checked) console.log(`     · ${c.id.padEnd(12)} ${c.raw.padEnd(12)} ${c.my} vs ${c.refId}(${c.ref})  ${c.ok ? '✅' : '❌'}`);

  // 5. 阴性对照 5a：把 raven 改回 148→150 关系破坏（即把 raven.spd 降到 100）
  const neg5a = src.replace(/(\braven:\s*\{[^}]*?spd:\s*)148/, '$1100');
  const a5a = audit(neg5a);
  t('5a 阴性: raven.spd→100 必须报 B', a5a.issues.some(i => i.rule === 'B' && /raven/.test(i.msg)), a5a.issues.map(i => i.msg).join(' | '));

  // 5b. 阴性对照：把 fox.spd 降到 100（"比兔更快"破坏，兔 120）
  const neg5b = src.replace(/(\bfox:\s*\{[^}]*?spd:\s*)158/, '$1100');
  const a5b = audit(neg5b);
  t('5b 阴性: fox.spd→100 必须报 B', a5b.issues.some(i => i.rule === 'B' && /fox/.test(i.msg)), a5b.issues.map(i => i.msg).join(' | '));

  // 5c. 阴性对照：把 mouse.spd 提到 200（raven "比兔更快"不受影响，但 rabbit 类断言若存在会触发）
  const neg5c = src.replace(/(\bmouse:\s*\{[^}]*?spd:\s*)150/, '$1200');
  const a5c = audit(neg5c);
  t('5c 阴性: mouse.spd→200 不应破坏 raven→rabbit 断言', !a5c.issues.some(i => /raven/.test(i.msg)), a5c.issues.map(i => i.msg).join(' | '));

  // 6. 判据 C 阴性：把句式族人为破坏（把所有"比X…"比较句改掉）应报 C
  const neg6 = src.replace(/比兔更快/g, '比兔相当').replace(/比鼠更快/g, '比鼠相当')
    .replace(/比兔脆/g, '与兔相当').replace(/比獾更快更肉/g, '与獾相当');
  const a6 = audit(neg6);
  t('6  阴性: 句式全改后应报 C(判据腐化告警)', a6.issues.some(i => i.rule === 'C'), a6.issues.map(i => i.msg).join(' | '));

  // 7. 解析退化防线：表结构破坏应报 A
  const neg7 = src.replace('var DATA_ENEMY = {', 'var DATA_ENEMY = { __x: { id: "x", name: "x", spd: 1 },').replace(/(\brabbit:\s*\{[^}]*)\}/, '');
  let a7ok = false, a7msg = '';
  try { const a7 = audit(neg7); a7ok = a7.issues.some(i => i.rule === 'A'); a7msg = a7.issues.map(i => i.msg).join(' | '); }
  catch (e) { a7ok = true; a7msg = '抛错(可接受): ' + e.message; }
  t('7  阴性: 表结构破坏应报 A 或抛错', a7ok, a7msg);

  console.log(`\n结果 ${pass}/${pass + fail}  ${fail === 0 ? 'PASS' : 'FAIL'}`);
  return fail === 0;
}

// ---------- main ----------
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const isSelf = process.argv.includes('--selftest');
  const src = fs.readFileSync(GAME, 'utf8');
  if (isSelf) process.exit(selftest() ? 0 : 1);
  const r = audit(src);
  console.log(`入口: ${GAME}`);
  console.log(`断言检出 ${r.checked.length} 条 / 无法映射而跳过 ${r.skipped.length} 条`);
  for (const c of r.checked) console.log(`  ${c.ok ? '✅' : '❌'} ${c.id.padEnd(12)} ${c.raw.padEnd(12)} spd ${c.my} vs ${c.refId}(${c.ref})`);
  for (const s of r.skipped) console.log(`  ⏭ ${s.id}(${s.field}) "${s.raw}" 引用"${s.ref}"不在敌表 ⇒ 跳过`);
  if (r.issues.length) {
    console.log('\n=== 违规 ===');
    for (const i of r.issues) console.log(`  [${i.rule}] ${i.msg}`);
    process.exit(1);
  }
  console.log('\n✅ 图鉴相对速度断言与 DATA_ENEMY 一致');
}
