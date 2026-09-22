// ci/bgm-spec-coherence.mjs —— 第 23 维度门禁：BGM 规格自洽审计
//
// 【病根形态（v1.198 新识别）】
//   `DATA_BGM` 表头顶注释明写了一套"参考采样数"规格：
//     「loop 曲长度 = beats*60/bpm 秒(44100Hz 参考采样数与 spec 给定值逐一吻合:
//        港湾 235200 / 启程 168000 / 怪潮 144000 / 深渊 252000); jingle 长度 = refSmp/44100 秒」
//   而 `refSmp` 字段的真实消费点**只有 jingle 分支一处**（`_renderBgmTrack` L12158），
//   loop 曲的 `refSmp` **全项目零读取** ⇒ 它写错了**永远不会被发现**。
//
//   实测三处已漂移：
//     · horde  refSmp=288000，算术(147bpm×32拍×44100/60)=576000 → **恰好减半**
//     · abyss  refSmp=252000，算术(84bpm×16拍×44100/60)=504000  → **恰好减半**
//     · march  refSmp=717560（算术一致 ✅），但**表头注释仍写 168000**（v1.94 把 8 拍扩到 32 拍时没改注释）
//   这不是"某个值写错了"，而是**"声明与实现各写一份、且没有一处比它们"**——
//   与已建的门禁族同源（存在≠被消费 / 镜像表 / 孤儿表），但形态是**规格声明漂移**。
//
// 【门禁判据】
//   A. 算术闭合：每条 loop 曲  refSmp == round(beats*60/bpm*44100)（容差 ±1 采样，容四舍五入）
//   B. 表头注释 vs 表内值：注释里列出的「曲名 采样数」逐条必须与同曲 refSmp **完全相等**
//   C. 覆盖闭合：DATA_BGM 每个 id 都必须被 BGM_TRACK_ORDER 收录（渲染队列不得漏曲）
//   D. 解析退化防线：解出的曲数 < 下界 ⇒ 报「解析退化」而非静默通过
//   E. 健康对照：至少一条曲的 A/B 两项都真通过（防"全体豁免"式假绿）
//
// 【为什么 jingle 豁免 A】
//   win/lose 无 bpm/beats（jingle 长度 ≡ refSmp/44100，refSmp 就是权威值，无算术可闭合）。
//   但 B 仍适用（注释 94500 / 110250 必须与表内值相等）。

import fs from 'fs';
import path from 'path';

const ROOT = process.env.MENGSHOU_ROOT || 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou';
const GAME_HTML = process.env.GAME_HTML || path.join(ROOT, 'game/萌兽消消岛.html');
const SR = 44100;
const TOL = 1;                 // 采样容差（四舍五入）
const MIN_TRACKS = 8;          // 条数下界（当前 10；留余量给未来增曲）

export function stripComments(src) {
  let out = '', i = 0, inS = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (inS) {
      out += c;
      if (c === '\\') { out += src[i + 1] || ''; i += 2; continue; }
      if (c === inS) inS = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { inS = c; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

// 【表形态先行】DATA_BGM 是**对象表**（键值对，非数组表）→ 用括号配平定位整块后按行提取顶层键。
//   ⚠ 不能用 `/{[^}]*id:"…"/g` 扫全文（会抓到字段名，v1.197 踩过）。
export function parseBgmTable(src) {
  const key = 'var DATA_BGM = {';
  const start = src.indexOf(key);
  if (start < 0) return null;
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  const block = src.slice(start, end + 1);
  const tracks = [];
  for (const line of block.split('\n')) {
    const cut = line.indexOf('//');
    const code = cut >= 0 ? line.slice(0, cut) : line;
    const m = code.match(/^\s{2}(\w+)\s*:\s*\{([^}]*)\}/);
    if (!m) continue;
    const body = m[2];
    const num = (k) => { const r = body.match(new RegExp('\\b' + k + '\\s*:\\s*(\\d+)')); return r ? Number(r[1]) : null; };
    const str = (k) => { const r = body.match(new RegExp('\\b' + k + '\\s*:\\s*"([^"]*)"')); return r ? r[1] : null; };
    tracks.push({
      id: m[1],
      name: str('name'),
      bpm: num('bpm'),
      beats: num('beats'),
      refSmp: num('refSmp'),
      jingle: /\bjingle\s*:\s*true/.test(body),
    });
  }
  return tracks;
}

// 表头注释（DATA_BGM 上方连续的 // 注释块）—— ⚠ 窗口不设固定字符数，向上收集连续注释行
export function tableHeaderComment(src) {
  const idx = src.indexOf('var DATA_BGM = {');
  if (idx < 0) return '';
  const before = src.slice(0, idx);
  const lines = before.split('\n');
  const buf = []; let blankRun = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const L = lines[i];
    if (/^\s*\/\//.test(L)) { buf.unshift(L); blankRun = 0; continue; }
    if (/^\s*$/.test(L)) { blankRun++; if (blankRun > 2) break; buf.unshift(L); continue; }
    break;
  }
  return buf.join('\n');
}

// 从注释里抽「曲名 数字」对（如 "港湾 235200"）
//
// ⚠ 抽取必须**限定在"声明段"内**，否则会抓注释里任何说明性文字（v1.198 亲踩：
//   解释性注释里写「应为 576000」「注释写 168000」→ 被当成"曲名 数值"声明，产生 6 处假红）。
//   锁定方式：只取含「参考采样数」那一行 + 紧随其后的 1~2 行（声明就在那儿）。
//   双防线：① 段内提取 ② 曲名必须命中表内真实 name（否则丢弃，不报"无同名曲目"）。
export function declaredSamplesFromComment(comment, tracks) {
  const nameToId = {};
  for (const t of tracks) if (t.name) nameToId[t.name] = t.id;

  const lines = comment.split('\n');
  const segLines = [];
  const anchor = lines.findIndex(l => /参考采样数/.test(l));
  if (anchor >= 0) segLines.push(lines[anchor]);
  // 声明段的续行：紧跟在后的注释行，**遇到说明性/新增注释块即停**（v1.198 教训：不能宽到抓解释文字）
  for (let k = anchor + 1; k < lines.length; k++) {
    const L = lines[k];
    if (!/^\s*\/\//.test(L)) break;
    if (/【|应为|注释写|表内值|旧值|见下|注意|⚠|⇒|门禁|语义|恒等于/.test(L)) break;
    segLines.push(L);
    // 段末标志：jingle 声明行（含"失败 110250"）之后不再吃
    if (/110250/.test(L)) break;
  }

  const out = [];
  const re = /([\u4e00-\u9fa5]{2,4})\s+(\d{4,9})/g;
  for (const L of segLines) {
    let m;
    while ((m = re.exec(L))) {
      const name = m[1], val = Number(m[2]);
      if (!nameToId[name]) continue;                 // 防线②：非表内曲名 → 丢弃（不当声明）
      out.push({ name, val, id: nameToId[name] });
    }
  }
  return out;
}

export function parseOrder(src) {
  const m = src.match(/var BGM_TRACK_ORDER\s*=\s*\[([^\]]*)\]/);
  if (!m) return null;
  return m[1].split(',').map(s => s.trim().replace(/["']/g, '')).filter(Boolean);
}

// ---- 审计主逻辑（返回问题列表；供 selftest 复用）----
export function audit(src) {
  const problems = [];
  const tracks = parseBgmTable(src);
  if (!tracks) { problems.push({ rule: 'D', id: '-', msg: '解析退化：未找到或无法配平 DATA_BGM 表' }); return { problems, tracks: [], healthy: 0 }; }
  if (tracks.length < MIN_TRACKS) problems.push({ rule: 'D', id: '-', msg: `解析退化：解出 ${tracks.length} 条 < 下界 ${MIN_TRACKS}` });

  // A. 算术闭合
  for (const t of tracks) {
    if (t.jingle) continue;
    if (t.bpm == null || t.beats == null || t.refSmp == null) {
      problems.push({ rule: 'A', id: t.id, msg: `字段缺失（bpm=${t.bpm} beats=${t.beats} refSmp=${t.refSmp}）` });
      continue;
    }
    const expect = Math.round(t.beats * 60 / t.bpm * SR);
    if (Math.abs(t.refSmp - expect) > TOL) {
      const ratio = expect > 0 ? (t.refSmp / expect) : NaN;
      const hint = Math.abs(ratio - 0.5) < 1e-6 ? ' 【恰好减半 → 疑似漏乘 beats 或误按半段】'
                 : Math.abs(ratio - 2) < 1e-6 ? ' 【恰好翻倍】' : '';
      problems.push({ rule: 'A', id: t.id, msg: `算术不闭合：refSmp=${t.refSmp}，beats*60/bpm*44100=${expect}，Δ=${t.refSmp - expect}${hint}` });
    }
  }

  // B. 表头注释 vs 表内值
  const comment = tableHeaderComment(src);
  const declared = declaredSamplesFromComment(comment, tracks);
  for (const d of declared) {
    if (!d.id) { problems.push({ rule: 'B', id: d.name, msg: `注释声明「${d.name} ${d.val}」但表内无同名曲目` }); continue; }
    const t = tracks.find(x => x.id === d.id);
    if (t.refSmp !== d.val) {
      problems.push({ rule: 'B', id: d.id, msg: `注释声明 ${d.val} ≠ 表内 refSmp ${t.refSmp}（Δ=${t.refSmp - d.val}）` });
    }
  }

  // C. 覆盖闭合
  const order = parseOrder(src);
  if (!order) problems.push({ rule: 'C', id: '-', msg: '未找到 BGM_TRACK_ORDER' });
  else for (const t of tracks) if (!order.includes(t.id)) problems.push({ rule: 'C', id: t.id, msg: 'DATA_BGM 有该曲但 BGM_TRACK_ORDER 未收录（渲染队列漏曲 ⇒ 该曲永不烘焙）' });

  // E. 健康对照：至少一条曲 A+B 都通过
  let healthy = 0;
  for (const t of tracks) {
    const aOk = t.jingle ? true : (t.bpm != null && t.beats != null && t.refSmp != null && Math.abs(t.refSmp - Math.round(t.beats * 60 / t.bpm * SR)) <= TOL);
    const dB = declared.find(d => d.id === t.id);
    const bOk = !dB || dB.val === t.refSmp;
    if (aOk && bOk) healthy++;
  }
  return { problems, tracks, declared, healthy, order };
}

// ---------------- selftest ----------------
function selftest() {
  const src = fs.readFileSync(GAME_HTML, 'utf8');
  const orig = (s) => s;                       // 便于阅读
  const cases = [];
  const check = (n, cond, note) => cases.push({ n, cond: !!cond, note });

  const tracks = parseBgmTable(src);
  const comment = tableHeaderComment(src);
  const order = parseOrder(src);

  // 0 基座：真实文件能解析出合理条数
  check('0 真实文件解析出 ≥', tracks && tracks.length >= MIN_TRACKS, `tracks=${tracks ? tracks.length : 0}`);

  // 1 解析器把 refSmp 抓对了（harbor=235200）
  const hb = tracks && tracks.find(t => t.id === 'harbor');
  check('1 harbor.refSmp=235200', hb && hb.refSmp === 235200, JSON.stringify(hb));

  // 2 注释窗口够宽（能读到大表头，含"参考采样数"）
  check('2 注释含"参考采样数"', /参考采样数/.test(comment), (comment.split('\n').find(l => l.trim()) || '(空)').trim().slice(0, 60));

  // 3 注释抽「曲名 数字」至少 4 对
  const dec = declaredSamplesFromComment(comment, tracks);
  check('3 注释抽出 ≥4 对', dec.length >= 4, JSON.stringify(dec));

  // 4 【阴性对照 A】把 harbor 的 refSmp 改成半值 → 必须报 A 违规
  {
    const mut = src.replace(/(harbor:\s*\{[^}]*refSmp:\s*)235200/, '$1' + 117600);
    check('4 阴性A 改动必被检出', mut !== src, 'mutated');
    const r = audit(mut);
    check('4b 阴性A 报 A 违规(harbor)', r.problems.some(p => p.rule === 'A' && p.id === 'harbor'), JSON.stringify(r.problems.filter(p => p.id === 'harbor')));
  }

  // 5 【阴性对照 B】把表头注释里的"港湾 235200"改成"港湾 111111" → 必须报 B 违规
  {
    const mut = src.replace(/(港湾\s+)235200/, '$1' + 111111);
    check('5 阴性B 改动必被检出', mut !== src, 'mutated');
    const r = audit(mut);
    check('5b 阴性B 报 B 违规(harbor)', r.problems.some(p => p.rule === 'B' && p.id === 'harbor'), JSON.stringify(r.problems.filter(p => p.id === 'harbor')));
  }

  // 6 【阴性对照 C】从 BGM_TRACK_ORDER 摘掉一条 → 必须报 C 违规（覆盖"渲染队列漏曲"）
  //   ⚠ 断言必须与"实际被摘掉的那条"一致（本用例摘 march；曾误写成 horde → 假红）
  {
    const mut = src.replace('var BGM_TRACK_ORDER = ["city", "march", ', 'var BGM_TRACK_ORDER = ["city", ');
    check('6 阴性C 改动必被检出', mut !== src, 'mutated');
    const r = audit(mut);
    check('6b 阴性C 报 C 违规(march)', r.problems.some(p => p.rule === 'C' && p.id === 'march'), JSON.stringify(r.problems.filter(p => p.rule === 'C')));
  }
  // 6c 【阴性对照 C2】摘掉 horde 再验一次（换曲，防"只对某一条敏感"）
  {
    const mut = src.replace('"march", "meadow", "harbor", "dune", "frost", "horde", ', '"march", "meadow", "harbor", "dune", "frost", ');
    check('6c 阴性C2 改动必被检出', mut !== src, 'mutated');
    const r = audit(mut);
    check('6d 阴性C2 报 C 违规(horde)', r.problems.some(p => p.rule === 'C' && p.id === 'horde'), JSON.stringify(r.problems.filter(p => p.rule === 'C')));
  }

  // 7 【当前状态断言 —— 基准前移后的新形态】
  //   ⚠ 这三条原来断言的是"真实文件里存在漂移"（修复前状态）；v1.198 修复后必然翻红。
  //   范式：**改写为新状态断言 + 另立阴性对照夺回判别力**（绝不删除）。
  //   ① 新状态：真实文件必须**零违规**（修复成果的守卫）
  //   ② 阴性对照：把修好的 horde 值再改回减半 → 必须重新报警（判别力未失）
  {
    const r = audit(src);
    check('7 真实文件零违规（修复成果守卫）', r.problems.length === 0, JSON.stringify(r.problems));
    check('7a 健康曲 = 全曲数（无豁免假绿）', r.healthy === r.tracks.length, `healthy=${r.healthy} tracks=${r.tracks.length}`);

    const mut = src.replace(/(horde:\s*\{[^}]*refSmp:\s*)576000/, '$1' + 288000);
    check('7b 阴性 改回减半 → 立刻报 A(horde)', mut !== src && audit(mut).problems.some(p => p.rule === 'A' && p.id === 'horde'), 'mutated');
    const mut2 = src.replace(/(注释声明|怪潮\s+)576000/, '怪潮 ' + 111111);
    check('7c 阴性 手改注释 → 立刻报 B(horde)', mut2 !== src && audit(mut2).problems.some(p => p.rule === 'B' && p.id === 'horde'), 'mutated');
  }

  // 8 【解析退化防线】把表头删掉 → 报解析退化或 B 全失（不静默通过）
  {
    const mut = src.replace('var DATA_BGM = {', 'var DATA_BGM_MOVED = {');
    const r = audit(mut);
    check('8 表被移走 → 报解析退化', r.problems.some(p => p.rule === 'D'), JSON.stringify(r.problems.filter(p => p.rule === 'D')));
  }

  // 9 【健康对照】真实文件至少 4 条曲 A+B 双通过（证明不是"全体豁免"）
  {
    const r = audit(src);
    check('9 健康曲 ≥4', r.healthy >= 4, 'healthy=' + r.healthy);
  }

  // 10 【负向：改了注释声明但值一致 → 不该假报】
  {
    const mut = src.replace(/(港湾\s+)235200/, '$1' + '235200');   // 同值替换：应无变化
    const r0 = audit(src), r1 = audit(mut);
    check('10 同值替换不产生新违规', r1.problems.length === r0.problems.length, `${r0.problems.length} → ${r1.problems.length}`);
  }

  // 11 【jingle 豁免 A】：把 win 的 refSmp 改成任意值 → A 不报（但 B 会报，因注释 94500 不符）
  {
    const mut = src.replace(/(win:\s*\{[^}]*refSmp:\s*)94500/, '$1' + 96400);
    const r = audit(mut);
    check('11 jingle 不触发 A 违规', !r.problems.some(p => p.rule === 'A' && p.id === 'win'), JSON.stringify(r.problems.filter(p => p.id === 'win')));
    check('11b jingle 改动触发 B 违规', r.problems.some(p => p.rule === 'B' && p.id === 'win'), JSON.stringify(r.problems.filter(p => p.id === 'win')));
  }

  // 12 覆盖完整性：order 长度 ≥ tracks 长度
  check('12 order 覆盖 tracks', order && order.length >= tracks.length, `order=${order ? order.length : 0} tracks=${tracks.length}`);

  let pass = 0;
  console.log('=== bgm-spec-coherence selftest ===');
  for (const c of cases) {
    console.log(`  ${c.cond ? '✅' : '❌'} ${c.n}${c.note ? '  [' + c.note + ']' : ''}`);
    if (c.cond) pass++;
  }
  console.log(`\nselftest: ${pass}/${cases.length}`);
  return pass === cases.length;
}

// ---------------- main ----------------
const isMain = process.argv[1] && /bgm-spec-coherence\.mjs$/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  if (process.argv.includes('--selftest')) {
    process.exit(selftest() ? 0 : 1);
  }
  const src = fs.readFileSync(GAME_HTML, 'utf8');
  console.log('入口:', GAME_HTML);
  const r = audit(src);
  console.log(`\n解析: ${r.tracks.length} 条曲目（下界 ${MIN_TRACKS}）`);
  console.log(`健康曲: ${r.healthy} 条（A+B 双通过）`);
  console.log(`注释声明: ${r.declared.length} 对`);
  console.log(`\n=== 审计结果 ===`);
  if (r.problems.length === 0) {
    console.log('✅ 通过：BGM 规格自洽（算术闭合 / 注释一致 / 覆盖闭合）');
  } else {
    for (const p of r.problems) console.log(`  [规则${p.rule}] ${p.id}: ${p.msg}`);
    console.log(`\n❌ 发现 ${r.problems.length} 处规格不自洽`);
  }
  process.exit(r.problems.length === 0 ? 0 : 1);
}
