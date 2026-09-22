#!/usr/bin/env node
/* daily-knife.mjs -- 「加菜局过场淡刀子」闭环门禁（第 21 维度）
 *
 * 病根（结构型）：**同一渲染位在两条分支上，一条填文案一条留空** ——
 *   普通章进局过场 cine.knife = chapterKnifeLine(ch)（有那句"淡刀子"）
 *   加菜局进局过场 cine.knife = ""               （空 → 渲染块整段不执行）
 *   ⇒ 玩家看得见的差异：打普通章有一句余味，打加菜局只有干巴巴的规则名。
 *   ⚠ 这类缺陷**任何既有门禁都测不到**：字段都有值、渲染点都正常、
 *     布局也不越界 —— 缺的是"某一条分支上没人写这句文案"。
 *
 * 判据（A~D，硬门禁）：
 *   A 数据侧：DATA_DAILY 每条规则都有非空 knife，且长度与全项目 knife 同量级
 *     （下界防占位符，上界防溢出：渲染用 hudFitText，但过长会压掉后半句）
 *   B 接线侧：章节过场取值处**读的是 rule.knife**（而非旧版恒 "")
 *   C 渲染侧：cine.knife 存在条件渲染块 + 参与面板高度 + 平移后续元素 + 有防溢出
 *   D 阴性对照：把接线改回旧版 / 删掉一条 knife → 必须被抓到
 *
 * 口径说明：**不读渲染截图**，纯静态结构断言（结构上不可能漂移）。
 *
 * 用法：
 *   node ci/daily-knife.mjs [html]       # 默认 game/萌兽消消岛.html
 *   node ci/daily-knife.mjs --selftest
 *   GAME_HTML=dist/萌兽消消岛.html node ci/daily-knife.mjs
 */
import fs from 'node:fs';

const HTML = process.env.GAME_HTML
  || process.argv.slice(2).find(a => !a.startsWith('--'))
  || 'game/萌兽消消岛.html';

// ---- 判据常量（钉死；不随产物变化）----
const KNIFE_MIN = 12;      // 与全项目 knife 同量级下界（最短的 "奶一口，是怕你冷得先走。" = 13）
const KNIFE_MAX = 24;      // 上界（最长章 knife "星星巅把最后一颗星砸下来，只为让巢火再亮一寸。" = 24）
const MIN_RULES = 3;       // DATA_DAILY 规则条数下界（防解析退化把整表当 0 条）

function stripComments(s) {
  const out = s.split(''); let i = 0, n = s.length;
  while (i < n) {
    if (s[i] === '/' && s[i + 1] === '/') { let j = i; while (j < n && s[j] !== '\n') { out[j] = ' '; j++; } i = j; }
    else if (s[i] === '/' && s[i + 1] === '*') { let j = i + 2; while (j < n && !(s[j] === '*' && s[j + 1] === '/')) { out[j] = ' '; j++; } if (j < n) { out[j] = ' '; out[j + 1] = ' '; } i = j + 2; }
    else if (s[i] === '"' || s[i] === "'" || s[i] === '`') { const q = s[i]; let j = i + 1; while (j < n) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === q) break; j++; } i = j + 1; }
    else i++;
  }
  return out.join('');
}

// 【作用域限定】只解析 DATA_DAILY 块内部 —— 否则会匹配到全项目其它
// `{ id: "...", ... }` 表（DATA_HERO / DATA_CODEX_ENEMY …），
// 实测曾解出 **37 条**（真实只有 3 条）→ 基准 1 条假报警 + 阴性对照打偏。
export function dailyBlock(src) {
  const stripped = stripComments(src);
  const m = /\bDATA_DAILY\s*=\s*\{/.exec(stripped);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let d = 0;
  for (let i = start; i < stripped.length; i++) {
    const c = stripped[i];
    if (c === '"' || c === "'" || c === '`') { const q = c; i++; while (i < stripped.length) { if (stripped[i] === '\\') { i += 2; continue; } if (stripped[i] === q) break; i++; } continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return stripped.slice(start, i + 1); }
  }
  return null;
}

export function parseRules(src) {
  const block = dailyBlock(src);
  if (!block) return [];
  // 块内逐条规则：顶层键名 id: "d_xxx"
  const re = /\{\s*\n?\s*id:\s*"([A-Za-z_][\w]*)",([\s\S]*?)\n  \}/g;
  const out = []; let m;
  while ((m = re.exec(block))) {
    const km = /knife:\s*"([^"]*)"/.exec(m[2]);
    out.push({ id: m[1], knife: km ? km[1] : null });
  }
  return out;
}

export function audit(src) {
  const alarms = [], notes = [];
  const rules = parseRules(src);

  // A 数据侧
  if (rules.length < MIN_RULES) {
    alarms.push(`A 解析退化：DATA_DAILY 只解出 ${rules.length} 条（下界 ${MIN_RULES}）→ 解析器或表结构已变`);
  } else {
    const missing = rules.filter(r => !r.knife || !r.knife.trim()).map(r => r.id);
    if (missing.length) {
      alarms.push(`A 缺 knife：${missing.join(', ')}（加菜局过场会少一句"淡刀子"，而普通章有）`);
    }
    const short = rules.filter(r => r.knife && r.knife.length < KNIFE_MIN).map(r => `${r.id}(${r.knife.length}字)`);
    const long = rules.filter(r => r.knife && r.knife.length > KNIFE_MAX).map(r => `${r.id}(${r.knife.length}字)`);
    if (short.length) alarms.push(`A 过短（< ${KNIFE_MIN}）：${short.join(', ')} → 疑似占位符`);
    if (long.length) alarms.push(`A 过长（> ${KNIFE_MAX}）：${long.join(', ')} → 渲染会压掉后半句`);
    const plain = rules.filter(r => r.knife && /^(加菜|规则|本局|注意)/.test(r.knife)).map(r => r.id);
    if (plain.length) alarms.push(`A 像规则说明不像"刀子"：${plain.join(', ')}`);
  }

  // B 接线侧
  const bOk = /knife:\s*rule\s*\?\s*\(rule\.knife\s*\|\|\s*""\)\s*:\s*chapterKnifeLine\(ch\)/.test(src);
  if (!bOk) {
    alarms.push('B 过场取值未读 rule.knife → 加菜局 knife 永远是空串（渲染块整段不执行）');
  }

  // C 渲染侧
  const cChecks = [
    [/if\s*\(cine\.knife\)\s*\{/, 'C1 knife 条件渲染块缺失'],
    [/knifeH\s*=\s*cine\.knife\s*\?\s*[\d.]+\s*:\s*0/, 'C2 knife 未参与面板高度（会出现底部挂一条或压住）'],
    [/knifeShift\s*=\s*[\d.]+/, 'C3 knife 未平移后续元素（会与 goal 行重叠）'],
    [/hudFitText\(ctx,\s*cine\.knife,/, 'C4 knife 未做防溢出'],
  ];
  for (const [re, msg] of cChecks) if (!re.test(src)) alarms.push(msg);

  if (!alarms.length) notes.push('加菜局过场"淡刀子"闭环完好（数据/接线/渲染 三段齐）');
  return { alarms, notes, rules };
}

export function selftest() {
  let ok = 0, tot = 0;
  const say = (c, msg) => { tot++; if (c) ok++; console.log(`  ${c ? 'PASS' : 'FAIL'} ${msg}`); };

  const live = fs.readFileSync(HTML, 'utf8');
  console.log(`=== daily-knife selftest（入口 ${HTML}）===`);

  // 1) 良性基准
  const a0 = audit(live);
  say(a0.alarms.length === 0, `1) 活文件基准 → 0 报警（实测 ${a0.alarms.length}）`);

  // 2) 解析器真解出规则（防"整表当 0 条"空跑）
  const rules = parseRules(live);
  say(rules.length >= MIN_RULES, `2) 解析器解出 ${rules.length} 条规则（下界 ${MIN_RULES}）`);

  // 3) 删掉一条 knife → A 必须报
  const idFirst = rules[0] && rules[0].id;
  if (!idFirst) { say(false, '3) 取不到首条规则 id → 无法做阴性对照'); }
  else {
    const neg = live.replace(new RegExp(`(id:\\s*"${idFirst}",[\\s\\S]*?)\\n\\s*knife:\\s*"[^"]*",`), '$1');
    const a1 = audit(neg);
    say(a1.alarms.some(x => x.startsWith('A 缺 knife')), `3) 删掉 ${idFirst} 的 knife → A 报「缺 knife」`);
  }

  // 4) 接线改回旧版 → B 必须报
  const negB = live.replace(
    /knife:\s*rule\s*\?\s*\(rule\.knife\s*\|\|\s*""\)\s*:\s*chapterKnifeLine\(ch\)/,
    'knife: rule ? "" : chapterKnifeLine(ch)');
  const a2 = audit(negB);
  say(aEB(a2), '4) 接线改回旧版 → B 报「未读 rule.knife」');

  // 5) 去掉高度参与 → C2 必须报
  const negC = live.replace(/knifeH\s*=\s*cine\.knife\s*\?\s*[\d.]+\s*:\s*0/, 'knifeH = 0');
  const a3 = audit(negC);
  say(a3.alarms.some(x => x.startsWith('C2')), '5) 去掉 knife 高度参与 → C2 报');

  // 6) 插入占位符 knife → A 必须报「过短」
  const idSecond = rules[1] && rules[1].id;
  if (idSecond) {
    const negD = live.replace(new RegExp(`(id:\\s*"${idSecond}",[\\s\\S]*?\\n\\s*knife:\\s*)"[^"]*"`), '$1"待写"');
    const a4 = audit(negD);
    say(a4.alarms.some(x => x.includes('过短')), `6) 把 ${idSecond} 的 knife 改成占位符 → A 报「过短」`);
  } else say(false, '6) 取不到第二条规则 id');

  // 7) 越界长度 → A 必须报「过长」
  if (idFirst) {
    const longStr = '这不是一句刀子'.repeat(4);
    const negE = live.replace(new RegExp(`(id:\\s*"${idFirst}",[\\s\\S]*?\\n\\s*knife:\\s*)"[^"]*"`), `$1"${longStr}"`);
    const a5 = audit(negE);
    say(a5.alarms.some(x => x.includes('过长')), `7) 把 ${idFirst} 的 knife 拉长到 ${longStr.length} 字 → A 报「过长」`);
  }
  // 8) 全删 knife 字段 → A 报缺
  const negF = live.replace(/\n\s*knife:\s*"[^"]*",(?=\n\s*chapterIdx)/g, '');
  const a6 = audit(negF);
  say(a6.alarms.some(x => x.startsWith('A 缺 knife')), '8) 全删 knife 字段 → A 报「缺 knife」');

  // 9) 【作用域失控防护】把 DATA_DAILY 整块删掉 → 解析必须报「退化」而不是静默 0 条
  const negG = live.replace(/\bDATA_DAILY\s*=\s*\{[\s\S]*?\n\};/, 'DATA_DAILY = {};');
  const a7 = audit(negG);
  say(a7.alarms.some(x => x.includes('解析退化')), '9) 清空 DATA_DAILY → A 报「解析退化」（不静默通过）');

  // 10) 【作用域失控防护】解析器只认 DATA_DAILY，不得蹭到别表的 id
  say(rules.length === 3, `10) 作用域限定：只解出 ${rules.length} 条（应 3，曾误解 37 条）`);

  console.log(`  --- ${ok}/${tot} 通过`);
  return ok === tot;

  function aEB(a) { return a.alarms.some(x => x.startsWith('B ')); }
}

function fmt(res, entry) {
  const L = ['# 加菜局过场「淡刀子」闭环门禁（第 21 维度）', '',
    `- 入口: \`${entry}\``,
    `- 规则数: **${res.rules.length}** · knife 长度域: ${KNIFE_MIN}–${KNIFE_MAX} 字`, '',
    '## 病根', '',
    '同一渲染位在两条分支上，**一条填文案一条留空**：',
    '普通章进局过场用 `chapterKnifeLine(ch)`，加菜局恒 `""` → 渲染块整段不执行。',
    '玩家看得见：打普通章有句余味，打加菜局只剩干巴巴的规则名。', '',
    '> ⚠ 既有门禁全部测不到：字段都有值、渲染点正常、布局不越界 ——',
    '> 缺的是「某条分支上没人写这句文案」。', '',
    '## 逐条规则', '',
    '| id | knife | 字数 |', '|---|---|---|',
  ];
  for (const r of res.rules) L.push(`| ${r.id} | ${r.knife || '❌ 无'} | ${r.knife ? r.knife.length : 0} |`);
  L.push('', '## 结论', '');
  if (res.alarms.length) {
    L.push(`- ❌ **${res.alarms.length} 条未通过**`);
    for (const a of res.alarms) L.push('  - ' + a);
  } else {
    L.push('- ✅ **A/B/C 全部通过**（数据/接线/渲染 三段齐）');
  }
  L.push('');
  return L.join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('daily-knife.mjs')) {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) {
    process.exit(selftest() ? 0 : 1);
  }
  const src = fs.readFileSync(HTML, 'utf8');
  const res = audit(src);
  const txt = fmt(res, HTML);
  console.log(txt);
  if (args[1]) { fs.mkdirSync('ci/out', { recursive: true }); fs.writeFileSync(args[1], txt, 'utf8'); }
  process.exit(res.alarms.length ? 1 : 0);
}
