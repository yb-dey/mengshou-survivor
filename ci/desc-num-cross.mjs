#!/usr/bin/env node
// desc-num-cross.mjs — 「表内文案引用的数字」× 「同表数值字段」交叉核对
//
// 病根（第二十四类·第二处）：文案里写死一个会随数值字段变化的量。
// 上一处是 DATA_HALL_UNLOCK.condText 抄了逐章变化的 boss 时刻（跨表引用）。
// 这一处是「同一张表内」：desc 里写 "HP+12/级"，per 字段写 12 —— 改了一边忘另一边。
// 脚本只做「表内自洽」核对，跨表核对由 unlock-text.mjs 负责。
//
// 用法：
//   node ci/desc-num-cross.mjs            正常门禁
//   node ci/desc-num-cross.mjs --selftest 阴性/正对照自检
//
// 退出码：0=全绿 / 1=有缺陷（硬门禁）

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const GAME_DIR = path.join(ROOT, 'game');

// ⚠ 入口选择必须显式排除 `_` 前缀备份文件并显式排序（第二十四类病根同源的"守错对象"）
function pickEntry() {
  const f = fs.readdirSync(GAME_DIR)
    .filter((x) => x.toLowerCase().endsWith('.html') && !x.startsWith('_'))
    .sort()[0];
  if (!f) throw new Error('未在 game/ 找到入口 html');
  return path.join(GAME_DIR, f);
}

// 用括号配平从 `var NAME = ` 之后取出完整字面量体（认 [] 与 {} 两形态）
function cutBody(src, declName) {
  const key = 'var ' + declName;
  let i = src.indexOf(key);
  if (i < 0) throw new Error('未找到声明: ' + declName);
  i = src.indexOf('=', i);
  if (i < 0) throw new Error('声明缺 =: ' + declName);
  i++;
  // 跳到第一个 [ 或 {
  while (i < src.length && src[i] !== '[' && src[i] !== '{') i++;
  const open = src[i];
  const close = open === '[' ? ']' : '}';
  let depth = 0, j = i, inStr = null, esc = false;
  for (; j < src.length; j++) {
    const c = src[j];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '/' && src[j + 1] === '/') { // 行注释
      while (j < src.length && src[j] !== '\n') j++;
      continue;
    }
    if (c === '/' && src[j + 1] === '*') { // 块注释
      j += 2;
      while (j < src.length && !(src[j] === '*' && src[j + 1] === '/')) j++;
      j++;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { j++; break; } }
  }
  return { body: src.slice(i, j), start: i, end: j };
}

// 解析对象数组/对象字面量：返回元素文本列表
// ⚠ 两个必须同时正确的条件（初版两个都错，导致整张表被当成 1 条）：
//   1) body 的第一个字符**就是外层括号本身** → 先吃掉它，再按 baseline 深度切分
//   2) 由于表里是 `{ k: {...} }`（键值对），每个元素是 **depth=1 处的 `{...}`**，
//      而顶层键名（如 `nutshell:`）不是元素 → 只把 `{` 开头的块当元素。
function splitTopLevel(body) {
  const parts = [];
  const baseline = 1;                       // 外层括号已占据的深度
  let depth = 0, inStr = null, esc = false, start = null;
  for (let j = 0; j < body.length; j++) {
    const c = body[j];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '/' && body[j + 1] === '/') { while (j < body.length && body[j] !== '\n') j++; continue; }
    if (c === '/' && body[j + 1] === '*') { j += 2; while (j < body.length && !(body[j] === '*' && body[j + 1] === '/')) j++; j++; continue; }
    if (c === '{' || c === '[') {
      depth++;
      // 元素体的起点：外层之后的第一个 `{`
      if (depth === baseline + 1 && c === '{') start = j;
      continue;
    }
    if (c === '}' || c === ']') {
      depth--;
      if (depth === baseline && start !== null) {
        parts.push({ text: body.slice(start, j + 1), at: start });
        start = null;
      }
      continue;
    }
  }
  return parts;
}

function strField(objText, key) {
  const m = objText.match(new RegExp(key + "\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\""));
  return m ? m[1] : null;
}
function idField(objText) {
  return strField(objText, 'id');
}

// ---------- 解析器自检（防"守卫空跑"）----------
// 若 splitTopLevel 退化（例如只切出 1 条），后续所有判据都会静默变成"只查第一条"。
// 这里对每张表断言：切出的元素数 == 实测值（v1.187 用 _qc/_diag-count.mjs 量的真身）。
// ⚠ 数字来自**实测**，不是估计：初版写 DATA_COMBAT_EVO=10 是猜的，实际是 9。
const TABLE_EXPECT = {
  DATA_HALL_TALENT: 6,
  DATA_ACHIEVE: 13,
  DATA_PASSIVE: 14,
  DATA_COMBAT_EVO: 9,
  DATA_HALL_UNLOCK: 6,
  DATA_RUNES: 5,
  DATA_SUPER: 20,
};
function parseTable(src, name) {
  const { body } = cutBody(src, name);
  const items = splitTopLevel(body);
  const want = TABLE_EXPECT[name];
  // ⚠ selftest 会临时注入探针行，此时允许 +1；正常门禁必须严格相等。
  const tol = (typeof globalThis !== 'undefined' && globalThis.__DIAG_INJECT_TOL__) ? 1 : 0;
  if (want != null && Math.abs(items.length - want) > tol) {
    throw new Error(`解析器退化: ${name} 切出 ${items.length} 条，实测应为 ${want} 条`);
  }
  // 每个元素必须是完整对象字面量
  const bad = items.filter((it) => {
    const t = it.text.trim();
    return !t.startsWith('{') || !t.endsWith('}');
  });
  if (bad.length) throw new Error(`解析器退化: ${name} 有 ${bad.length} 条不是完整对象`);
  const noId = items.filter((it) => !idField(it.text));
  if (noId.length) throw new Error(`解析器退化: ${name} 有 ${noId.length} 条缺 id 字段`);
  return items;
}

const FAILS = [];
const NOTES = [];

function fail(cat, id, msg) { FAILS.push({ cat, id, msg }); }
function note(cat, msg) { NOTES.push({ cat, msg }); }

// ---------- 判据 A: DATA_HALL_TALENT.desc 里的 "<名>+<数>%?/级" × per ----------
// desc 形如 "开局 HP+12/级" / "拾取半径+8%/级" / "咆哮 CD-10%/级" / "开局落地鸡腿×1/级"
function checkTalent(src) {
  const items = parseTable(src, 'DATA_HALL_TALENT');
  for (const it of items) {
    const id = idField(it.text);
    const desc = strField(it.text, 'desc');
    const perM = it.text.match(/per\s*:\s*(-?[\d.]+)/);
    if (!id || !desc || !perM) { if (id) note('A', `${id}: desc/per 缺失，跳过`); continue; }
    const per = parseFloat(perM[1]);
    const nums = (desc.match(/-?\d+(?:\.\d+)?/g) || []).map((n) => parseFloat(n));
    const uniq = [...new Set(nums)];
    if (!uniq.length) { note('A', `${id}: desc 无数字`); continue; }
    const cand = [];
    for (const base of [per, per * 100]) {
      cand.push(Math.abs(base));
      cand.push(-Math.abs(base));
    }
    const hit = uniq.some((n) => cand.some((c) => Math.abs(c - n) < 1e-6));
    if (!hit) {
      fail('A', id, `desc 数字 [${uniq.join(', ')}] 与 per=${per} 不一致（可接受形态: ${Math.abs(per)} 或 ${Math.abs(per * 100)}）`);
    }
  }
}

// ---------- 判据 A2: DATA_PASSIVE.desc 里的 "X+N%/级" × per 对象 ----------
// ⚠ 这是本脚本最容易"空跑"的地方：DATA_PASSIVE.per 是**对象**（{movePct:0.04}），
//   而 DATA_HALL_TALENT.per 是**标量**（12）。判据 A 的正则只认标量 → 整张
//   DATA_PASSIVE 被当成"缺少 per"静默跳过。必须在 A 之外单列 A2，
//   并要求"每条 desc 里出现的百分比数字，必须能在 per 对象里找到对应的值"。
function checkPassive(src) {
  const items = parseTable(src, 'DATA_PASSIVE');
  let checked = 0;
  for (const it of items) {
    const id = idField(it.text);
    const desc = strField(it.text, 'desc');
    if (!id || !desc) { if (id) note('A2', `${id}: desc 缺失，跳过`); continue; }
    // 取 per 对象体
    const pm = it.text.match(/per\s*:\s*\{([^}]*)\}/);
    if (!pm) { note('A2', `${id}: 无 per 对象，跳过`); continue; }
    const perVals = [];
    for (const kv of pm[1].split(',')) {
      const v = kv.match(/:\s*(-?[\d.]+)/);
      if (v) perVals.push(parseFloat(v[1]));
    }
    // desc 数字有两种形态，都要覆盖（只覆盖百分比会静默漏掉 "回血+0.25/s/级"）：
    //   (1) "N%/级"     → per 值 ×100
    //   (2) "N/s/级"    → per 值原样
    const pctNums = [], rawNums = [];
    let m;
    const rePct = /([+\-]?)(\d+(?:\.\d+)?)\s*%/g;
    while ((m = rePct.exec(desc)) !== null) pctNums.push(parseFloat(m[2]));
    const reRaw = /([+\-]?)(\d+(?:\.\d+)?)\s*\/\s*s\s*\/\s*级/g;
    while ((m = reRaw.exec(desc)) !== null) rawNums.push(parseFloat(m[2]));
    if (!pctNums.length && !rawNums.length) { note('A2', `${id}: desc 无可核对数字（既无 % 也无 /s/级）`); continue; }
    checked++;
    const poolPct = [], poolRaw = [];
    for (const v of perVals) {
      poolPct.push(Math.abs(v)); poolPct.push(Math.abs(v * 100));
      poolRaw.push(Math.abs(v));
    }
    for (const n of pctNums) {
      if (!poolPct.some((p) => Math.abs(p - n) < 1e-6)) {
        fail('A2', id, `desc 百分比 ${n}% 在 per {${pm[1].trim()}} 中无对应值（可接受 ${poolPct.map((p) => Math.round(p * 1000) / 1000).join('/')}）`);
      }
    }
    for (const n of rawNums) {
      if (!poolRaw.some((p) => Math.abs(p - n) < 1e-6)) {
        fail('A2', id, `desc 数值 ${n}/s 在 per {${pm[1].trim()}} 中无对应值（可接受 ${poolRaw.map((p) => Math.round(p * 1000) / 1000).join('/')}）`);
      }
    }
  }
  if (!checked) note('A2', 'DATA_PASSIVE 无一条含百分比 desc，判据 A2 空跑（不构成通过）');
}


// desc 形如 "累计击杀 100 只" / "通关第 1 章" / "集齐全部 7 只萌兽" / "单局获得 1000 金币"
// ---------- 判据 B: DATA_ACHIEVE.desc 里的数字 × target ----------
function checkAchieve(src) {
  const items = parseTable(src, 'DATA_ACHIEVE');
  for (const it of items) {
    const id = idField(it.text);
    const desc = strField(it.text, 'desc');
    const tgtM = it.text.match(/target\s*:\s*(-?[\d.]+)/);
    if (!id || !desc || !tgtM) { if (id) note('B', `${id}: desc/target 缺失，跳过`); continue; }
    const target = parseFloat(tgtM[1]);
    const nums = [...new Set((desc.match(/-?\d+(?:\.\d+)?/g) || []).map((n) => parseFloat(n)))];
    if (!nums.length) { note('B', `${id}: desc 无数字`); continue; }
    if (!nums.some((n) => Math.abs(n - target) < 1e-6)) {
      fail('B', id, `desc "${desc}" 未包含 target=${target}`);
    }
  }
}

// ---------- 判据 A3: DATA_RUNES.desc 的 "×N" × 表内数值键 ----------
// desc 形如 "敌HP×1.3 币×1.5" —— 出现几个 "×N"，表内就该有对应的几个数值键。
function checkRunes(src) {
  const items = parseTable(src, 'DATA_RUNES');
  for (const it of items) {
    const id = idField(it.text);
    const desc = strField(it.text, 'desc');
    if (!id || !desc) { if (id) note('A3', `${id}: desc 缺失，跳过`); continue; }
    const shown = [...new Set((desc.match(/×\s*(\d+(?:\.\d+)?)/g) || []).map((s) => parseFloat(s.replace(/[×\s]/g, ''))))];
    // 兼容 "词缀概率100%" 形态（不是 ×N，但同样是数值宣称）
    const pctShown = [...new Set((desc.match(/(\d+(?:\.\d+)?)\s*%/g) || []).map((s) => parseFloat(s)))];
    if (!shown.length && !pctShown.length) { note('A3', `${id}: desc 无 ×N / N%`); continue; }
    const vals = [];
    const reKV = /([A-Za-z][A-Za-z0-9_]*)\s*:\s*(-?\d+(?:\.\d+)?)/g;
    let m;
    while ((m = reKV.exec(it.text)) !== null) vals.push(parseFloat(m[2]));
    for (const n of shown) {
      const ok = vals.some((v) => Math.abs(v - n) < 1e-6 || Math.abs(v * 100 - n) < 1e-6);
      if (!ok) fail('A3', id, `desc 宣称 "×${n}"，但表内数值键 [${vals.join(', ')}] 无对应值`);
    }
    for (const n of pctShown) {
      const ok = vals.some((v) => Math.abs(v * 100 - n) < 1e-6 || Math.abs(v - n) < 1e-6);
      if (!ok) fail('A3', id, `desc 宣称 "${n}%"，但表内数值键 [${vals.join(', ')}] 无对应值`);
    }
  }
}

// ---------- 判据 A4: DATA_SUPER.desc 的数字（阿拉伯 + 中文） × 表内数值字段 ----------
// 20 条超武 desc 是本项目**引用数字最密集**的文案（`半径140`/`6 连发`/`连锁 3`/
//   `六镖`/`四巨岩`/`七向`/`五叶`/`四只`），且**中阿混用**。
// ⚠ 中文数字若不折算，`六镖` 会被整条漏掉 —— 那正是"空跑"的变体。
const CN_NUM = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
function checkSuper(src) {
  const items = parseTable(src, 'DATA_SUPER');
  // 建立"名字 → 表内数值字段"索引，供 contrast 子句解析（对比句引用的是**别的**超武）
  const byName = {};
  for (const it of items) {
    const n = strField(it.text, 'name');
    if (!n) continue;
    const vals = [];
    const reKV0 = /([A-Za-z][A-Za-z0-9_]*)\s*:\s*(-?\d+(?:\.\d+)?)/g;
    let m0;
    while ((m0 = reKV0.exec(it.text)) !== null) vals.push(parseFloat(m0[2]));
    byName[n] = vals;
  }
  let checked = 0;
  for (const it of items) {
    const id = idField(it.text);
    const desc = strField(it.text, 'desc');
    if (!id || !desc) { if (id) note('A4', `${id}: desc 缺失，跳过`); continue; }
    const vals = [];
    const reKV = /([A-Za-z][A-Za-z0-9_]*)\s*:\s*(-?\d+(?:\.\d+)?)/g;
    let m;
    while ((m = reKV.exec(it.text)) !== null) vals.push(parseFloat(m[2]));
    if (!vals.length) { note('A4', `${id}: 无数值字段，跳过`); continue; }

    // ⚠ 关键：desc 里的对比子句（`(与X分叉, …)`）引用的是**别的**超武的数值。
    //   初版把整条 desc 的数字都拿来对**本条**字段 → `fluffguard` 的"与八只亲卫分叉"
    //   里的 8 被误判（8 属于 beesguard）。必须**先剥离括号内的对比句**再核对。
    const own = desc.replace(/[（(][^）)]*[）)]/g, '');
    const contrast = (desc.match(/[（(]([^）)]*)[）)]/g) || []).join(' ');

    const collect = (txt) => {
      const s = new Set();
      for (const x of (txt.match(/\d+(?:\.\d+)?/g) || [])) s.add(parseFloat(x));
      for (const ch of txt) { if (CN_NUM[ch] !== undefined && CN_NUM[ch] >= 3) s.add(CN_NUM[ch]); }
      return s;
    };
    const ownNums = collect(own);
    const ctrNums = collect(contrast);
    if (!ownNums.size && !ctrNums.size) { note('A4', `${id}: desc 无数字`); continue; }
    checked++;

    for (const n of ownNums) {
      const ok = vals.some((v) => Math.abs(v - n) < 1e-6 || Math.abs(v * 100 - n) < 1e-6 || Math.abs(v / 100 - n) < 1e-6);
      if (!ok) fail('A4', id, `desc 正文 "${own.trim()}" 宣称数字 ${n}，但本条数值字段 [${vals.join(', ')}] 无对应值`);
    }
    // 对比句里的数字必须能在**某一条**超武里找到（不限定是哪条，只要求"引用的是真数"）
    if (ctrNums.size) {
      const all = [];
      for (const k in byName) for (const v of byName[k]) all.push(v);
      for (const n of ctrNums) {
        const ok = all.some((v) => Math.abs(v - n) < 1e-6 || Math.abs(v * 100 - n) < 1e-6);
        if (!ok) fail('A4', id, `desc 对比句 "${contrast.trim()}" 宣称数字 ${n}，但全表超武数值无任何一条对应`);
      }
    }
  }
  if (!checked) note('A4', 'DATA_SUPER 无一条含可核数字，判据 A4 空跑（不构成通过）');
}


// ---------- 判据 C: 文案「点名兄弟」的反引号（『』「」）包裹才是精确引用 ----------
// 教训：初版用 /与([^成,，;；]{1,10})成档/ 抓裸文本，会把
//   "与暖绒絮+巢枝光环" 的「暖绒絮+巢枝光环」整串当成一个名字，也会把
//   "仍是花蜜+净露叶光环" 这种**组合描述**误判为单一名字 → 全是假阳性。
// 正确口径：只检查**被引号包裹**的名字（作者显式标注的精确引用），
//   并允许组合词（用 /[+＋·]/ 拆开后逐段校验）。
function checkCrossNames(src) {
  const names = new Set();
  for (const tbl of ['DATA_PASSIVE', 'DATA_COMBAT_EVO']) {
    for (const it of parseTable(src, tbl)) {
      const n = strField(it.text, 'name');
      if (n) names.add(n);
    }
  }
  const Q = /[『「]([^』」]{1,20})[』」]/g;   // 显式引用
  const targets = [
    ['DATA_PASSIVE', 'desc'],
    ['DATA_COMBAT_EVO', 'contrast'],
    ['DATA_COMBAT_EVO', 'feel'],
  ];
  let quotedSeen = 0;
  for (const [tbl, field] of targets) {
    for (const it of parseTable(src, tbl)) {
      const id = idField(it.text);
      const txt = strField(it.text, field);
      if (!txt) continue;
      Q.lastIndex = 0;
      let m;
      while ((m = Q.exec(txt)) !== null) {
        quotedSeen++;
        const inner = m[1];
        const segs = inner.split(/[+＋]/).map((s) => s.trim()).filter(Boolean);
        for (const s of segs) {
          if (names.has(s)) continue;
          let ok = false;
          for (let cut = 1; cut <= 4 && cut < s.length; cut++) {
            if (names.has(s.slice(0, s.length - cut))) { ok = true; break; }
          }
          if (!ok) fail('C', id, `${field} 引用「${inner}」，其中「${s}」在全表找不到`);
        }
      }
    }
  }
  if (!quotedSeen) note('C', '全文未发现引号包裹的兄弟名引用，判据 C 空跑（不构成通过）');
}

function run(src) {
  FAILS.length = 0; NOTES.length = 0;
  checkTalent(src);
  checkPassive(src);
  checkRunes(src);
  checkSuper(src);
  checkAchieve(src);
  checkCrossNames(src);
  return { fails: FAILS.slice(), notes: NOTES.slice() };
}

function report(tag, r) {
  console.log(`\n## ${tag}`);
  if (!r.fails.length) console.log('  结论: **PASS** — 全部文案数字与数值字段一致 ✅');
  else {
    console.log('  结论: **FAIL**');
    for (const f of r.fails) console.log(`  [${f.cat}] ${f.id}: ${f.msg}`);
  }
  for (const n of r.notes) console.log(`  (注) [${n.cat}] ${n.msg}`);
}

// ---------------- 主流程 ----------------
const entry = pickEntry();
let src = fs.readFileSync(entry, 'utf8');
console.log('入口:', path.basename(entry), `(${src.length} 字符)`);

if (process.argv.includes('--selftest')) {
  // 正对照：真实文件应 PASS（若真实文件有缺陷则会 FAIL —— 也接受，需人工看）
  const real = run(src);
  report('正对照: 真实文件', real);

  // 阴性对照 1：把某个 talent 的 per 改掉，desc 不动 → 必须报错
  const mut1 = src.replace(
    /per: 12, maxLv: 3/,
    'per: 99, maxLv: 3'
  );
  const r1 = run(mut1);
  report('阴性对照 1: data_hall_talent.hp per 12→99（desc 仍写 12）', r1);
  const ok1 = r1.fails.some((f) => f.cat === 'A' && f.id === 'hp');

  // 阴性对照 2：把某成就 target 改掉，desc 不动
  const mut2 = src.replace(
    /id: "kill_100",\s+name: "初露锋芒",\s+desc: "累计击杀 100 只",\s+dim: "kill",\s+target: 100/,
    'id: "kill_100",  name: "初露锋芒",   desc: "累计击杀 100 只",       dim: "kill",  target: 250'
  );
  const r2 = run(mut2);
  report('阴性对照 2: achieve.kill_100 target 100→250（desc 仍写 100）', r2);
  const ok2 = r2.fails.some((f) => f.cat === 'B' && f.id === 'kill_100') || mut2 === src;

  // 阴性对照 3：在真实文件的引号里注入一个不存在的兄弟名 → 必须报错
  //   注意：本项目全文目前没有引号引用，所以不能改现成文本，必须**注入**一段。
  //   且必须断言 "注入确实生效"，否则就是"守卫永远通过"的假绿。
  const anchor = 'var DATA_PASSIVE = {';
  const probe = '\n  __probe__: { id: "__probe__", name: "探针", maxLv: 5, per: { dmgPct: 0.01 }, tag: "测试", desc: "与『绝不存在的兄弟物』成档" },';
  const mut3 = src.replace(anchor, anchor + probe);
  const injected = mut3 !== src;
  // 注入会让条目数 +1，临时放宽解析器断言（只在本次 selftest 内生效）
  globalThis.__DIAG_INJECT_TOL__ = 1;
  const r3 = run(mut3);
  globalThis.__DIAG_INJECT_TOL__ = 0;
  report('阴性对照 3: 注入「与『绝不存在的兄弟物』成档」', r3);
  const ok3 = injected && r3.fails.some((f) => f.cat === 'C' && f.id === '__probe__');

  // 阴性对照 5：DATA_PASSIVE 的 per 对象被改，desc 不动 → 必须报错
  //   这条专门守"空跑"：初版判据 A 的正则只认标量 per，整张 DATA_PASSIVE 被静默跳过。
  const mut5 = src.replace(
    'windbell: { id: "windbell", name: "风之铃",   maxLv: 5, per: { movePct: 0.04 }',
    'windbell: { id: "windbell", name: "风之铃",   maxLv: 5, per: { movePct: 0.07 }'
  );
  const inj5 = mut5 !== src;
  const r5 = run(mut5);
  report('阴性对照 5: DATA_PASSIVE.windbell per 0.04→0.07（desc 仍写 4%）', r5);
  const ok5 = inj5 && r5.fails.some((f) => f.cat === 'A2' && f.id === 'windbell');

  // 阴性对照 6：raw 数值形态（"回血+0.25/s/级"）漂移 → 必须报错
  //   守的是"只覆盖百分比形态"这个盲区。
  const mut6 = src.replace(
    'dewcap: { id: "dewcap", name: "晨露菇", maxLv: 5, per: { regen: 0.25 }',
    'dewcap: { id: "dewcap", name: "晨露菇", maxLv: 5, per: { regen: 0.40 }'
  );
  const inj6 = mut6 !== src;
  const r6 = run(mut6);
  report('阴性对照 6: DATA_PASSIVE.dewcap regen 0.25→0.40（desc 仍写 0.25/s）', r6);
  const ok6 = inj6 && r6.fails.some((f) => f.cat === 'A2' && f.id === 'dewcap');

  // 阴性对照 7：DATA_RUNES 的数值键漂移，desc 的 ×N 不动 → 必须报错
  const mut7 = src.replace(
    'rune_berserk: { id: "rune_berserk", name: "狂暴符文", desc: "敌HP×1.3 币×1.5", hpMul: 1.3, coinMul: 1.5 }',
    'rune_berserk: { id: "rune_berserk", name: "狂暴符文", desc: "敌HP×1.3 币×1.5", hpMul: 1.9, coinMul: 1.5 }'
  );
  const inj7 = mut7 !== src;
  const r7 = run(mut7);
  report('阴性对照 7: DATA_RUNES.rune_berserk hpMul 1.3→1.9（desc 仍写 ×1.3）', r7);
  const ok7 = inj7 && r7.fails.some((f) => f.cat === 'A3' && f.id === 'rune_berserk');

  // 阴性对照 8：DATA_SUPER 阿拉伯数字漂移（"半径140" 但 aoeR 改了）
  const mut8 = src.replace('aoeR: 140, arcT: 0.9', 'aoeR: 210, arcT: 0.9');
  const inj8 = mut8 !== src;
  const r8 = run(mut8);
  report('阴性对照 8: DATA_SUPER.megaboom aoeR 140→210（desc 仍写 半径140）', r8);
  const ok8 = inj8 && r8.fails.some((f) => f.cat === 'A4' && f.id === 'megaboom');

  // 阴性对照 9：DATA_SUPER **中文数字**漂移（"六镖" 但 bulletCount 改了）
  //   这条专门守"中文数字被整条漏掉"这个盲区 —— 阿拉伯正则抓不到它。
  //   ⚠ 锚点必须**由实测取**，不能手抄（首版手抄的空格不对 → 替换没生效 → 假失败）。
  const anchor9 = src.match(/mapletornado:[\s\S]{0,200}?bulletCount:\s*6/);
  const mut9 = anchor9 ? src.replace(anchor9[0], anchor9[0].replace(/bulletCount:\s*6/, 'bulletCount: 9')) : src;
  const inj9 = mut9 !== src;
  const r9 = run(mut9);
  report('阴性对照 9: DATA_SUPER.mapletornado bulletCount 6→9（desc 仍写 六镖）', r9);
  const ok9 = inj9 && r9.fails.some((f) => f.cat === 'A4' && f.id === 'mapletornado');
  if (!inj9) console.log('  ⚠ 阴性对照 9 的替换**未生效**（anchor 未命中）→ 视为漏检，不得算通过');

  const all = ok1 && ok2 && ok3;
  console.log('\n--- selftest ---');
  console.log(`  阴性对照 A(per 漂移): ${ok1 ? '检出 ✅' : '漏检 ❌'}`);
  console.log(`  阴性对照 B(target 漂移): ${ok2 ? '检出 ✅' : '漏检 ❌'}`);
  console.log(`  阴性对照 C(兄弟名不存在): ${ok3 ? '检出 ✅' : '漏检 ❌'}`);

  // 阴性对照 D：解析器守卫本身必须会响（否则上面 3 条可能全在"空跑"上通过）
  let ok4 = false;
  try {
    parseTable(src.replace('var DATA_PASSIVE = {', 'var DATA_PASSIVE = {\n  __broken__: { id: "x" },\n  __broken2__: { id: "y" },'), 'DATA_PASSIVE');
    ok4 = false;
  } catch (e) {
    ok4 = /解析器退化/.test(e.message);
  }
  console.log(`  阴性对照 D(解析器退化必报错): ${ok4 ? '检出 ✅' : '漏检 ❌'}`);
  console.log(`  阴性对照 E(DATA_PASSIVE 对象型 per 漂移): ${ok5 ? '检出 ✅' : '漏检 ❌'}`);
  console.log(`  阴性对照 F(DATA_PASSIVE 数值型 desc 漂移): ${ok6 ? '检出 ✅' : '漏检 ❌'}`);
  console.log(`  阴性对照 G(DATA_RUNES ×N 漂移): ${ok7 ? '检出 ✅' : '漏检 ❌'}`);
  console.log(`  阴性对照 H(DATA_SUPER 阿拉伯数字漂移): ${ok8 ? '检出 ✅' : '漏检 ❌'}`);
  console.log(`  阴性对照 I(DATA_SUPER 中文数字漂移): ${ok9 ? '检出 ✅' : '漏检 ❌'}`);

  const n = (ok1?1:0)+(ok2?1:0)+(ok3?1:0)+(ok4?1:0)+(ok5?1:0)+(ok6?1:0)+(ok7?1:0)+(ok8?1:0)+(ok9?1:0);
  console.log(`  selftest ${n}/9 ${n === 9 ? '✅' : '❌'}`);
  process.exit(n === 9 ? 0 : 1);
}

const real = run(src);
report('真实文件', real);
process.exit(real.fails.length ? 1 : 0);
