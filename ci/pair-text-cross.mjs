/**
 * pair-text-cross.mjs —— 成档（被动协同）文案一致性门禁
 *
 * 存在理由：
 *   一个成档的"效果"在项目里被写成了 5 处，互相之间没有任何门禁：
 *     ① DATA_PASSIVE[a].desc 的 "与X成档=Y"      （a 侧声明）
 *     ② DATA_PASSIVE[b].desc 的 "与X成档=Y"      （b 侧声明）
 *     ③ DATA_CODEX_PAIR[].effect                 （图鉴卡面 / 暂停构筑一览用）
 *     ④ 升级提示 "成档 X · <触发面>"             （levelHint 的 complete 分支）
 *     ⑤ 升级提示 "已成档 X · <效果面>"           （levelHint 的 active 分支）
 *   ⑤ 允许与 ①~③ 不同粒度（它只说"形成后的效果"）；
 *   但 ④ 是"什么条件触发"，语义上必须与 ③（=卡面 effect）同源；
 *   ① 与 ② 是同一成档的两个物主视角，**必须说同一件事**。
 *
 * v1.189 实测结论（本门禁的由来）：
 *   7 个成档里 6 个的 ①②③④ 自洽；只有 **聚宝成档(hoard)** 断了：
 *     磁石蘑菇.desc = "拾珠爆金环, 珠越大环越狠"        ← 触发清晰 ✅
 *     智慧果.desc   = "大珠爆大环刮伤吸珠"              ← ❌ 丢了"拾珠"触发，读作"只有大珠才爆"
 *     升级提示(complete) = "成档 聚宝 · 大珠爆大环"      ← ❌ 抄了上面那句，同样丢触发
 *     设计注释(v1.46) & tryHoardBurst(g) 调用点：真相是 **每颗珠拾取都爆环**，环按珠档放大
 *
 * 判据（全部可穷举，不依赖"转折词白名单"这类补不全的东西）：
 *   A. DATA_CODEX_PAIR 每条 a/b 都必须存在于 DATA_PASSIVE
 *   B. 同一成档 ①② 两侧必须都能解析出 "成档=<效果>"，且 **a ⊆ b**（单向！）
 *      —— 设计实测：a 侧写"基础效果"，b 侧写"基础效果 + 递进细节"
 *         （gale: 冲刺留铃浪 → 冲刺留铃浪刮伤；spice: 击杀掉尸爆 → 击杀掉尸爆, 连杀变大）
 *         只能要求 a 被 b 覆盖；要求双向相等会制造 6/7 假阳性。
 *      ⚠ v1.189 真缺陷正是在这里被抓出：hoard 的 b 侧把主语从"拾珠"换成"大珠"，
 *        丢了触发条件 → a ⊄ b。
 *   C. ③ effect 与 ①② 的关系**既非子集也非覆盖**：设计上 effect 是给 148px 窄卡定稿的
 *      **压缩改写 + 自铸短标签版**（"回血退敌"/"大珠大环"/"小刮连爆大清兔" 都是新铸标签）。
 *      → **C 只报不拦（advisory）**。硬拦会把 3/7 条合法压缩判成缺陷；
 *        而"压缩标签"与"凭空发明的机制"之别必须做语义判断，**不可穷举 → 不配当门禁**。
 *   D. ④ 升级提示 complete 分支必须存在（存在性可穷举 → 硬拦）；
 *      其效果面是否自创 → 同 C，只报不拦。
 *   E. ⑤ 升级提示 active 分支必须存在（只查存在性：它是"形成后"的另一粒度，不做串比）
 *   F. 消费侧自证：四处渲染/透传点必须真的存在，否则填了没人看
 *
 * 阴性对照（selftest）覆盖 A/B/C/D/E/F 每条判据，并**断言变异确实施加**
 *   （不复用 "|| mut===src" 这种把"没生效"当"检出"的假绿写法）。
 */
import fs from 'fs';
import path from 'path';

const GAME_DIR = process.env.GAME_DIR || 'game';
const pickEntry = (dir) => fs.readdirSync(dir)
  .filter((f) => f.toLowerCase().endsWith('.html') && !f.startsWith('_'))
  .sort()[0];

let SRC = '';
let ENTRY = '';

// ---------- 解析工具（与 ci/desc-num-cross.mjs 同源，保证行为一致） ----------
function cutBody(text, name) {
  const re = new RegExp('(?:const|var|let)\\s+' + name + '\\s*=\\s*');
  const m = re.exec(text);
  if (!m) return null;
  let p = m.index + m[0].length;
  while (/\s/.test(text[p])) p++;
  const open = text[p];
  if (open !== '{' && open !== '[') return null;
  const close = open === '{' ? '}' : ']';
  let depth = 0, q = null, esc = false;
  for (let k = p; k < text.length; k++) {
    const c = text[k];
    if (esc) { esc = false; continue; }
    if (q) { if (c === '\\') { esc = true; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return { body: text.slice(p, k + 1), open }; }
  }
  return null;
}
// ⚠ cutBody 返回的 body 首字符就是外层括号 → baseline = 1
function splitTopLevel(body) {
  const baseline = 1;
  let depth = 0, q = null, esc = false; const parts = []; let start = null;
  for (let j = 0; j < body.length; j++) {
    const c = body[j];
    if (esc) { esc = false; continue; }
    if (q) { if (c === '\\') { esc = true; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{' || c === '[') { depth++; if (depth === baseline + 1 && c === '{') start = j; continue; }
    if (c === '}' || c === ']') { depth--; if (depth === baseline && start !== null) { parts.push(body.slice(start, j + 1)); start = null; } continue; }
  }
  return parts;
}
function gs(item, key) {
  const m = item.match(new RegExp('\\b' + key + '\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"'));
  return m ? m[1] : null;
}

// ---------- 表期望条目数（防"空跑"：解析器退化成 1 条时必须报错，而不是静默通过） ----------
const TABLE_EXPECT = {
  DATA_PASSIVE: 14,
  DATA_CODEX_PAIR: 7,
};
const TOL = Number(globalThis.__DIAG_INJECT_TOL__ || 0);

function parsePassive() {
  const r = cutBody(SRC, 'DATA_PASSIVE');
  if (!r) throw new Error('DATA_PASSIVE 未找到');
  const items = splitTopLevel(r.body);
  if (!items.length || Math.abs(items.length - TABLE_EXPECT.DATA_PASSIVE) > TOL) {
    throw new Error(`DATA_PASSIVE 解析到 ${items.length} 条，期望 ${TABLE_EXPECT.DATA_PASSIVE}（解析器退化？）`);
  }
  const out = {};
  for (const it of items) {
    const id = gs(it, 'id');
    if (!id) throw new Error('DATA_PASSIVE 有条目缺 id: ' + it.slice(0, 120));
    out[id] = { id, name: gs(it, 'name'), desc: gs(it, 'desc') };
  }
  return out;
}
function parsePairs() {
  const r = cutBody(SRC, 'DATA_CODEX_PAIR');
  if (!r) throw new Error('DATA_CODEX_PAIR 未找到');
  const items = splitTopLevel(r.body);
  if (!items.length || Math.abs(items.length - TABLE_EXPECT.DATA_CODEX_PAIR) > TOL) {
    throw new Error(`DATA_CODEX_PAIR 解析到 ${items.length} 条，期望 ${TABLE_EXPECT.DATA_CODEX_PAIR}（解析器退化？）`);
  }
  return items.map((it) => {
    const id = gs(it, 'id');
    if (!id) throw new Error('DATA_CODEX_PAIR 有条目缺 id');
    return { id, name: gs(it, 'name'), a: gs(it, 'a'), b: gs(it, 'b'), effect: gs(it, 'effect') };
  });
}

// ---------- 效果串 → 语义片段 ----------
// 去掉括号补充（"(走动拔根散)" 这类副注不算独立信息点），再按分隔符切
function frags(s) {
  if (!s) return [];
  const t = s.replace(/[（(][^）)]*[）)]/g, '');
  return t.split(/[·,，;；、\s]+/).map((x) => x.trim()).filter((x) => x.length >= 2);
}
// 片段级双向覆盖：a 的每个片段都能在 b 里找到包含关系（用于判 ①② 同粒度声明）
function covered(x, y) { return x.every((p) => y.some((q) => q.includes(p) || p.includes(q))); }

/**
 * 【矛盾】判定 —— 专用于"压缩改写版"（PAIR.effect / 升级提示）对"完整版"（PASSIVE.desc）。
 * 压缩允许"短化 + 改名"（"冲刺留铃浪"→"冲刺留铃"），所以不能查覆盖。
 * 只查：① 出现一个 ≥4 字的片段  ② 该片段不是完整版任何片段的子串
 *   → 同时满足才算"自创了新信息点"。
 * 为什么要 ≥4：2 字的差异（"近刮"）在压缩改写里太常见，会制造假阳性。
 * 为什么要求"非子串"："满田刮"不是"站住生绒田刮伤减速"的子串 → 真新词；
 *   "铃浪刮伤"是 desc 里"冲刺留铃浪"+"刮伤"的组合，但它是"冲刺留铃浪刮伤"的子串 → 放过。
 */
function novelFrags(short, full) {
  return frags(short).filter((p) => p.length >= 4 && !full.some((q) => q.includes(p) || p.includes(q)));
}

// ---------- 升级提示串（从源码里抽 complete/active 两支） ----------
function parseLevelHints() {
  const out = {};
  const re = /pair: "([a-z]+)"\s*\};?\s*\}\s*if \(([a-zA-Z]+)PairOn\(\)\)/g;
  // 直接按 tone:"complete"/tone:"active" + pair:"id" 抓更稳
  const re2 = /tone:\s*"(complete|active)",\s*text:\s*"([^"]*)"[^}]*?pair:\s*"([a-z]+)"/g;
  let m;
  while ((m = re2.exec(SRC))) {
    const tone = m[1], text = m[2], pair = m[3];
    if (!out[pair]) out[pair] = {};
    out[pair][tone] = text;
  }
  return out;
}

// ---------- 判据 ----------
function run() {
  const fails = [];
  const advisories = [];
  const P = parsePassive();
  const PAIRS = parsePairs();
  const HINTS = parseLevelHints();

  const declOf = (d) => { if (!d) return null; const m = d.match(/成档\s*=\s*(.+)$/); return m ? m[1].trim() : null; };

  for (const p of PAIRS) {
    // A. a/b 必须在 PASSIVE 里，且不能是同一件
    if (!P[p.a]) fails.push(`[A] ${p.id}: a="${p.a}" 不在 DATA_PASSIVE`);
    if (!P[p.b]) fails.push(`[A] ${p.id}: b="${p.b}" 不在 DATA_PASSIVE`);
    if (p.a && p.a === p.b) fails.push(`[A] ${p.id}: a 与 b 是同一件（"${p.a}"），成档需两件不同被动`);
    if (!P[p.a] || !P[p.b]) continue;

    const da = declOf(P[p.a].desc), db = declOf(P[p.b].desc);
    // B. 两侧都能解析出 =效果，且互相覆盖
    if (!da) fails.push(`[B] ${p.id}: ${p.a}.desc 无 "成档=效果" 声明`);
    if (!db) { fails.push(`[B] ${p.id}: ${p.b}.desc 无 "成档=效果" 声明`); }
    if (da && db && p.a !== p.b) {
      const fa = frags(da), fb = frags(db);
      // 【单向】a ⊆ b：a 的每个片段都要能被 b 的某个片段包含
      const missing = fa.filter((x) => !covered([x], fb));
      if (missing.length) {
        fails.push(`[B] ${p.id}(${p.name}): b 侧没有覆盖 a 侧的效果 —— a(${P[p.a].name}) 说了 ${JSON.stringify(missing)}，b(${P[p.b].name}) 里找不到`);
      }
    }
    // C（只报不拦）：effect 是否出现 desc 里没有的新铸标签
    if (p.effect && (da || db)) {
      const full = frags([da, db].filter(Boolean).join(' · '));
      const extra = novelFrags(p.effect, full);
      if (extra.length) advisories.push(`[C] ${p.id}(${p.name}): effect 的新铸标签 ${JSON.stringify(extra)}（压缩改写许可，人工确认非新机制即可）`);
    }
    // D/E. 升级提示两支必须存在
    const h = HINTS[p.id] || {};
    if (!h.complete) { fails.push(`[D] ${p.id}(${p.name}): 缺升级提示 complete 分支`); }
    if (!h.active) advisories.push(`[E] ${p.id}(${p.name}): 升级提示无 active 分支`);
    // D'（只报不拦）：complete 分支的效果面是否自创
    if (h.complete) {
      const body = h.complete.replace(/^成档\s*\S+\s*·\s*/, '');
      const full = frags([da, db, p.effect].filter(Boolean).join(' · '));
      const extra = novelFrags(body, full);
      if (extra.length) advisories.push(`[D] ${p.id}(${p.name}): 升级提示"${h.complete}"里的 ${JSON.stringify(extra)} 在 desc/effect 里找不到出处`);
    }
  }

  // F. 消费侧自证
  const consumers = [
    { name: '图鉴成档卡 draw 读 view.effect', re: /fillText\(hudFitText\(ctx,\s*view\.effect/ },
    { name: '暂停构筑一览读 p.effect', re: /view\.aName\s*\+\s*"\+"\s*\+\s*view\.bName\s*\+\s*"="\s*\+\s*view\.effect/ },
    { name: 'pairCodexOf 透传 effect', re: /function pairCodexOf\(id\)[\s\S]{0,900}?effect:\s*p\.effect/ },
    { name: 'passiveEvoHint 读 p.effect', re: /成档="\s*\+\s*\(p\.effect/ },
  ];
  for (const c of consumers) {
    if (!c.re.test(SRC)) fails.push(`[F] 消费侧缺失：${c.name}`);
  }

  return { fails, advisories, stat: { passives: Object.keys(P).length, pairs: PAIRS.length, hints: Object.keys(HINTS).length } };
}

// ---------- selftest：9 项阴性 + 4 项阳性 ----------
function selftest() {
  const clean = SRC;
  const cases = [];
  const set = (s) => { SRC = s; };
  const reset = () => { SRC = clean; };

  // ⚠⚠ 教训（v1.189 第一次云端跑就栽在这）：
  //   阴性对照用**硬编码字符串**当锚点 → 一旦该字符串被修掉（本补丁正是修它），
  //   锚点失配 → "变异未施加" → selftest 挂。这不是门禁坏了，是**对照样本腐化了**。
  //   对策：锚点一律**从活文件里正则取**，取不到就显式抛错（而不是静默算过）。
  const live = (re, what) => {
    const m = re.exec(clean);
    if (!m) throw new Error(`selftest 锚点取不到（${what}）—— 对照样本已腐化，请更新正则`);
    return m[0];
  };

  // 负 A：把 hoard.a 改成不存在的 id
  {
    reset();
    const anchor = live(/a: "magnet", b: "wisdom"/, '不硬用 hoard a/b');
    const mut = clean.replace(anchor, 'a: "magnetZZ", b: "wisdom"');
    cases.push({ name: '负A: 成档 a 指向不存在的被动', mut, expect: '[A] hoard' });
  }

  // 负 B：让 **a 侧** 声明一个 b 侧没有的效果（a ⊄ b → 硬拦）
  //   ⚠ 不能靠"给 b 追加字符"来制造缺陷 —— a ⊆ b 是单向判据，b 变长永远不会破坏它。
  //     第一次写错就是这里：变异 += "ZZZZ" 后 a 仍 ⊆ b，判据正确地没有报错。
  {
    reset();
    const anchor = live(/desc: "拾取半径\+10%\/级[^"]*与智慧果成档=[^"]*"/, '不硬用 magnet.desc');
    const mut = clean.replace(anchor, anchor.replace(/"$/, '、额外爆金币雨"'));
    cases.push({ name: '负B: a 侧多出一个 b 没有的效果', mut, expect: '[B] hoard' });
  }
  // 负 B2：b 侧完全没有"成档="声明
  {
    reset();
    const anchor = live(/desc: "拾取半径\+6%\/级[^"]*与花蜜成档=[^"]*"/, '不硬用 mistleaf.desc');
    const mut = clean.replace(anchor, 'desc: "拾取半径+6%/级; 与花蜜互相加成"');
    cases.push({ name: '负B2: b 侧 desc 缺 "成档=效果"', mut, expect: '[B] mist' });
  }
  // 负 C（只报不拦）：effect 自铸新标签 → 必须出现在 advisories
  {
    reset();
    const anchor = live(/effect: "站住生绒田·满田刮"/, '不硬用 root.effect');
    const mut = clean.replace(anchor, 'effect: "站住生绒田·满田刮·附赠闪电链"');
    cases.push({ name: '负C(advisory): effect 自铸新标签', mut, expect: '[C] root', where: 'advisories' });
  }
  // 负 C2（硬拦）：b 侧把 a 的基础效果丢掉（真缺陷形态）→ [B]
  {
    reset();
    const anchor = live(/与坚果壳成档=[^"]*"/, '不硬用 peppercorn.desc');
    const mut = clean.replace(anchor, '与坚果壳成档=连杀变大"');
    cases.push({ name: '负C2(硬拦): b 侧丢掉 a 的基础效果', mut, expect: '[B] spice' });
  }
  // 负 D（只报不拦）：complete 提示自铸新标签
  //   ⚠ 变异要用**分隔符**接出新片段（"拾珠爆金环·附赠陨石"）。
  //     直接粘成 "拾珠爆金环附赠陨石" 会变成一个**包含**原片段的整段 → 判据正确地放行。
  {
    reset();
    const anchor = live(/text: "成档 聚宝 · [^"]*"/, '不硬用 hoard complete 提示');
    const mut = clean.replace(anchor, anchor.replace(/"$/, '· 附赠陨石"'));
    cases.push({ name: '负D(advisory): complete 提示自铸新标签', mut, expect: '[D] hoard', where: 'advisories' });
  }
  // 负 D2（硬拦）：删掉 complete 分支
  {
    reset();
    const anchor = live(/tone: "complete", text: "成档 疾风 · [^"]*"/, '不硬用 gale complete 提示');
    const mut = clean.replace(anchor, anchor.replace('tone: "complete"', 'tone: "completeXYZ"'));
    cases.push({ name: '负D2(硬拦): 缺 complete 分支', mut, expect: '[D] gale' });
  }
  // 负 F（硬拦）：破坏消费侧（图鉴卡不再读 view.effect）
  {
    reset();
    const anchor = live(/fillText\(hudFitText\(ctx,\s*view\.effect,\s*r\.w - 20\),\s*r\.x \+ 10,\s*r\.y \+ 68\)/, '不硬用图鉴卡 draw 行');
    const mut = clean.replace(anchor, anchor.replace('view.effect', '"x"'));
    cases.push({ name: '负F(硬拦): 图鉴卡不再读 view.effect', mut, expect: '[F]' });
  }
  // 负 G（解析器退化）：把 DATA_CODEX_PAIR 改成只 1 条
  {
    reset();
    globalThis.__DIAG_INJECT_TOL__ = 0;
    const i = clean.indexOf('var DATA_CODEX_PAIR = [');
    const j = clean.indexOf('\n];', i);
    const mut = clean.slice(0, i) + 'var DATA_CODEX_PAIR = [\n  { id: "gale", name: "疾风成档", a: "windbell", b: "spinachseed", tag: "机动", effect: "x", contrast: "y" }\n' + clean.slice(j);
    cases.push({ name: '负G: DATA_CODEX_PAIR 退化成 1 条', mut, expect: '期望 7' });
  }
  // 负H：把 gale 的 b 从"风车草籽"改成"晨露菇"（存在，但 desc 声明是"与风之铃成档"→ 与 a 侧不同事）
  {
    reset();
    const anchor = live(/\{ id: "gale", name: "疾风成档", a: "windbell", b: "[a-z]+"/, '不硬用 gale a/b');
    const mut = clean.replace(anchor, anchor.replace(/b: "[a-z]+"$/, 'b: "dewcap"'));
    cases.push({ name: '负H: 成档 b 被换成另一件（跨接线）', mut, expect: '[B] gale' });
  }
  // 负 I：a 侧 desc 缺 "成档=效果"
  {
    reset();
    const anchor = live(/desc: "受击减伤 4%\/级[^"]*与晨露菇成档=[^"]*"/, '不硬用 moss.desc');
    const mut = clean.replace(anchor, 'desc: "受击减伤 4%/级, 回血+0.1/s/级; 与晨露菇相互加成"');
    cases.push({ name: '负I: a 侧 desc 缺 "成档=效果"', mut, expect: '[B] dew' });
  }

  console.log('=========== selftest（阴性对照必须全部检出）===========');
  let ok = 0, total = 0;
  for (const c of cases) {
    total++;
    // 【关键】先断言变异确实施加了
    const injected = c.mut !== clean;
    if (!injected) {
      console.log(`  ${c.name}: ⚠ 变异未施加（锚点未命中）→ 不得计为通过 ❌`);
      continue;
    }
    SRC = c.mut;
    let res, threw = null;
    try { res = run(); } catch (e) { threw = e.message; }
    const pool = res ? (c.where === 'advisories' ? res.advisories : res.fails) : [];
    const hits = pool.filter((f) => f.includes(c.expect));
    const okCase = threw ? threw.includes(c.expect) : hits.length > 0;
    if (okCase) { ok++; console.log(`  ${c.name}: 检出 ✅  → ${threw ? 'throw: ' + threw : hits[0]}`); }
    else {
      console.log(`  ${c.name}: ❌ 未检出（期望命中 ${c.expect} @${c.where || 'fails'}）`);
      if (res) console.log('      实际 fails: ' + JSON.stringify(res.fails.slice(0, 6)) + '\n      实际 advisories: ' + JSON.stringify(res.advisories.slice(0, 6)));
    }
  }
  SRC = clean;
  console.log(`\nselftest ${ok}/${total} ${ok === total ? '✅' : '❌'}`);
  return ok === total;
}

// ---------- main ----------
const SELFTEST = process.argv.includes('--selftest');
const gd = path.resolve(GAME_DIR);
ENTRY = path.join(gd, pickEntry(gd));
SRC = fs.readFileSync(ENTRY, 'utf8');

if (SELFTEST) {
  const ok = selftest();
  process.exit(ok ? 0 : 1);
}

console.log('# 成档（被动协同）文案一致性门禁');
console.log(`入口: ${path.basename(ENTRY)} (${SRC.length} 字符)`);
console.log('');

let r;
try { r = run(); } catch (e) {
  console.log('❌ 解析/自检失败: ' + e.message);
  process.exit(1);
}

console.log(`解析: DATA_PASSIVE=${r.stat.passives} 条 · DATA_CODEX_PAIR=${r.stat.pairs} 条 · 升级提示=${r.stat.hints} 组`);
console.log('');
if (r.advisories.length) { console.log('提示（只报不拦，压缩改写许可）:'); r.advisories.forEach((n) => console.log('  · ' + n)); console.log(''); }

if (r.fails.length) {
  console.log(`结论: **FAIL** — ${r.fails.length} 处成档文案互相矛盾 ❌`);
  console.log('');
  r.fails.forEach((f) => console.log('  ' + f));
  process.exit(1);
} else {
  console.log('结论: **PASS** — 全部成档在 desc/effect/升级提示 三侧说法一致 ✅');
  process.exit(0);
}
