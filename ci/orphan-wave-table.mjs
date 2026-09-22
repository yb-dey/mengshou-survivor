/* ci/orphan-wave-table.mjs —— 第 22 维度门禁：「同一份数据存在两套实现，其一手写却零读取」
 *
 * 【病根】v1.197 发现 `DATA_WAVES_8`：一份完整手写的 14 行 8 分钟波次表
 *   （逐行带调参注释【R2】A案/B案/C案），全项目**零读取**。
 *   与之并存的 `buildWavesFor()` 才是真身：以 `DATA_WAVES_15` 为唯一骨架，
 *   按 winTime 时序压缩生成。
 *
 * 【为什么既有门禁全测不到】
 *   · 表本身有值（不是空表）→ "数据侧非空"判据全绿
 *   · 表里有注释说明用途 → "文案规范"判据全绿
 *   · 不参与渲染 → 布局/对比度判据不涉及
 *   · 真正的问题是**它被一个更新的实现取代了，却没删** → 没有任何字段级判据看得见"两份真身"
 *
 * 【判据 A~D】
 *   A 孤儿检测：DATA_WAVES_* 家族每个表必须有非注释非定义的读取点
 *   B 孤儿必须显式标记：若一个表确实要留着（预留/历史），注释里必须出现
 *     「预留/搁置/未接线」等标记 —— 否则视为死代码（与 `mapSize` 的处理对齐）
 *   C 健康对照：`DATA_WAVES_15` 有读取（证明解析器能力在线，不是"全表都报孤儿"）
 *   D 双真身检测：若存在 buildWavesFor 这类生成器，则手写变体表必须要么被读、要么被标记
 *
 * 【阴性对照内建】--selftest 用合成源码正反各验一遍。
 */
import fs from 'node:fs';
import path from 'node:path';

const HTML = process.env.GAME_HTML || 'game/萌兽消消岛.html';
const MIN_ORPHAN_TABLES = 1;      // 下界断言：至少解析出 1 个 DATA_WAVES_* 表
const MARK_WORDS = ['预留', '搁置', '未接线', '暂不', '待接', '历史遗留', '已废弃', 'deprecated'];

/* ---------- 工具 ---------- */

/** 去注释（保守：只去 // 行注释与 /* *\/ 块注释，保留字符串内的 // ） */
export function stripComments(src) {
  let out = '', i = 0, n = src.length;
  let inS = null;                       // 当前字符串引号
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (inS) {
      out += c;
      if (c === '\\') { out += (d || ''); i += 2; continue; }
      if (c === inS) inS = null;
      i++; continue;
    }
    if (c === '"' || c === "'") { inS = c; out += c; i++; continue; }
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

/** 取一个表的块（从 `var NAME = [` 后括号配平到对应 `]`）。返回 {body, start, end} 或 null */
export function tableBlock(stripped, name) {
  const re = new RegExp('\\bvar\\s+' + name + '\\s*=\\s*\\[');
  const m = re.exec(stripped);
  if (!m) return null;
  const start = m.index + m[0].length - 1;   // 指向 '['
  let d = 0, inS = null;
  for (let i = start; i < stripped.length; i++) {
    const c = stripped[i];
    if (inS) { if (c === '\\') { i++; continue; } if (c === inS) inS = null; continue; }
    if (c === '"' || c === "'") { inS = c; continue; }
    if (c === '[') d++;
    else if (c === ']') { d--; if (d === 0) return { body: stripped.slice(start, i + 1), start, end: i + 1 }; }
  }
  return null;
}

/** 统计一个名字在源码里的"非注释非定义"引用 */
export function countRealRefs(stripped, name) {
  const re = new RegExp('\\b' + name + '\\b', 'g');
  let c = 0, m;
  const defRe = new RegExp('\\bvar\\s+' + name + '\\s*=');
  while ((m = re.exec(stripped))) {
    // 检查这个位置是否是定义处
    const back = stripped.slice(Math.max(0, m.index - 20), m.index + name.length + 3);
    if (defRe.test(back)) continue;
    c++;
  }
  return c;
}

/** 从原始源码（含注释）里取某个表定义前的注释上下文。
 *  ⚠ 窗口必须够宽：标记注释可能隔了多行说明才到 `var NAME =`（v1.197 踩过：
 *  400 字符窗口读不到上方 800 字符处的标记 → 明明标了仍报死代码）。
 *  这里按 **"往上找连续的注释行块"** 取，不设固定字符数。
 */
function commentContext(rawSrc, name) {
  const idx = rawSrc.indexOf('var ' + name + ' =');
  if (idx < 0) return '';
  // 从定义行起向上收集：连续的以 // 开头的行（允许中间夹空行，最多跨 3 个空行）
  const before = rawSrc.slice(0, idx);
  const lines = before.split('\n');
  const buf = [];
  let blankRun = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const L = lines[i];
    if (/^\s*\/\//.test(L)) { buf.unshift(L); blankRun = 0; continue; }
    if (/^\s*$/.test(L)) { blankRun++; if (blankRun > 3) break; buf.unshift(L); continue; }
    break;                                  // 撞到代码行 → 停
  }
  return buf.join('\n');
}

/* ---------- 主判据 ---------- */

export function audit(src) {
  const raw = src;
  const st = stripComments(src);
  const names = [...st.matchAll(/\bvar\s+(DATA_WAVES_[A-Z_0-9]+)\s*=/g)].map(m => m[1]);
  const uniq = [...new Set(names)];
  const issues = [], info = [];

  if (uniq.length < MIN_ORPHAN_TABLES) {
    issues.push({ kind: 'PARSE_DEGRADED', msg: '解析退化为 ' + uniq.length + ' 个 DATA_WAVES_* 表（下界 ' + MIN_ORPHAN_TABLES + '）—— 不静默通过' });
    return { tables: [], issues, info, degraded: true };
  }

  const tables = [];
  for (const n of uniq) {
    const refs = countRealRefs(st, n);
    const blk = tableBlock(st, n);
    const rowCount = blk ? (blk.body.match(/\{\s*t:\s*\d+/g) || []).length : -1;
    const ctx = commentContext(raw, n);
    const marked = MARK_WORDS.find(w => ctx.includes(w)) || null;
    tables.push({ name: n, refs, rows: rowCount, marked });

    if (refs === 0) {
      if (marked) {
        info.push({ kind: 'ORPHAN_MARKED', name: n, msg: '零读取，但有显式标记「' + marked + '」→ 视为可接受（与 mapSize 处理一致）' });
      } else {
        issues.push({ kind: 'ORPHAN_UNMARKED', name: n, msg: '零读取且无「预留/搁置」标记 → 死代码（' + rowCount + ' 行数据无人消费）' });
      }
    }
  }

  // C 健康对照：至少一个表有真实读取
  const alive = tables.filter(t => t.refs > 0);
  if (alive.length === 0) {
    issues.push({ kind: 'ALL_ORPHAN', msg: '所有 DATA_WAVES_* 表都零读取 —— 解析器能力可疑（健康对照失败）' });
  }

  return { tables, issues, info, degraded: false };
}

/* ---------- CLI ---------- */

function load() {
  return fs.readFileSync(HTML, 'utf8');
}

function report(src) {
  const r = audit(src);
  console.log('=== DATA_WAVES_* 孤儿表审计（入口 ' + HTML + '）===');
  for (const t of r.tables) {
    console.log('  ' + (t.refs > 0 ? '读取' : '孤儿') + '  ' + t.name.padEnd(16) + ' refs=' + String(t.refs).padStart(3) +
      ' rows=' + String(t.rows).padStart(3) + (t.marked ? '  [标记:' + t.marked + ']' : ''));
  }
  for (const i of r.info) console.log('  ℹ ' + i.name + ': ' + i.msg);
  if (r.issues.length === 0) {
    console.log('\n✅ 通过：无未标记的孤儿波次表');
    return 0;
  }
  console.log('\n❌ 发现 ' + r.issues.length + ' 个问题：');
  for (const i of r.issues) console.log('  · [' + i.kind + '] ' + (i.name ? i.name + ' — ' : '') + i.msg);
  return 1;
}

/* ---------- selftest ---------- */

function selftest() {
  let ok = 0, tot = 0;
  const say = (c, m) => { tot++; if (c) ok++; console.log('  ' + (c ? 'PASS' : 'FAIL') + ' ' + m); };
  const live = load();

  console.log('=== orphan-wave-table selftest ===');

  // 1) 活文件：DATA_WAVES_8 已被显式标记 → 应进入 info 而非 issue
  const r1 = audit(live);
  say(!r1.issues.some(i => i.name === 'DATA_WAVES_8'), '1) 活文件：DATA_WAVES_8 已被标记 → 不再报死代码（实测 ' + (r1.issues.some(i => i.name === 'DATA_WAVES_8') ? '仍报警' : '已放行') + '）');
  say(r1.info.some(i => i.name === 'DATA_WAVES_8'), '1b) 该表进入 info（标记被识别，非静默跳过）');
  say(r1.tables.some(t => t.name === 'DATA_WAVES_15' && t.refs > 0), '2) 健康对照：DATA_WAVES_15 有读取（解析器能力在线）');
  say(r1.tables.some(t => t.name === 'DATA_WAVES_8' && t.rows === 14), '3) 解析出 DATA_WAVES_8 的 14 行');
  say(r1.tables.some(t => t.name === 'DATA_WAVES_15' && t.rows === 25), '4) 解析出 DATA_WAVES_15 的 25 行');

  // 5) 阴性对照：给 DATA_WAVES_8 加读取点 → 仍不报（refs>0 优先级高于标记）
  const fixed = live.replace(/function buildWavesFor\(/, 'function _useW8(){ return DATA_WAVES_8.length; }\nfunction buildWavesFor(');
  const r5 = audit(fixed);
  say(!r5.issues.some(i => i.name === 'DATA_WAVES_8'), '5) 接了读取点后 → 不报 DATA_WAVES_8 孤儿（判据会动）');
  say(r5.tables.find(t => t.name === 'DATA_WAVES_8').refs > 0, '5b) refs 实测 > 0');

  // 5c) 阴性对照：删掉标记注释 → 立刻回到「未标记孤儿」
  const unmk = live.replace(/【v1\.197】⚠ 历史遗留 \/ 已废弃（预留，暂未接线）/, '（M 案调参记录）');
  const r5c = audit(unmk);
  say(r5c.issues.some(i => i.name === 'DATA_WAVES_8' && i.kind === 'ORPHAN_UNMARKED'),
    '5c) 删掉「预留」标记后 → 立刻报未标记孤儿（防线真的会开）');

  // 6) 阴性对照：另造一份带「暂未接线」标记的 → 同样降级为 info
  const markedSrc = live.replace(/(\/\/ 8 分钟变体波次)/, '$1（暂未接线）');
  const r6 = audit(markedSrc);
  say(!r6.issues.some(i => i.name === 'DATA_WAVES_8'), '6) 加「暂未接线」标记后 → 不算死代码（词表生效）');
  say(r6.info.some(i => i.name === 'DATA_WAVES_8'), '7) 该表进入 info 列表（标记被正确识别）');

  // 7b) 窗口宽度防线：把标记挪到离定义更远处（隔 6 行注释）→ 仍应读到
  const farMark = live.replace(/var DATA_WAVES_8 = \[/, '// （搁置）说明: 本表不接线, 仅存档。\n// 行2\n// 行3\n// 行4\n// 行5\n// 行6\nvar DATA_WAVES_8 = [');
  const r7b = audit(farMark);
  say(!r7b.issues.some(i => i.name === 'DATA_WAVES_8'), '7b) 标记隔 6 行注释仍能读到（窗口足够宽，v1.197 踩过 400 字符窗口的坑）');

  // 8) 解析退化防线：清空所有 DATA_WAVES_* 定义 → 报 PARSE_DEGRADED 而非静默通过
  const cleared = stripComments(live).replace(/var\s+DATA_WAVES_[A-Z_0-9]+\s*=\s*\[/g, 'var _X_ = [');
  const r8 = audit(cleared);
  say(r8.degraded === true, '8) 清空全部 DATA_WAVES_* → 报「解析退化」（不静默通过）');

  // 9) 作用域防线：确认解析出的表名只有 DATA_WAVES_ 前缀（没蹭到别的表）
  say(r1.tables.every(t => /^DATA_WAVES_/.test(t.name)), '9) 作用域限定：解析出的全是 DATA_WAVES_* 前缀');
  say(r1.tables.length === 2, '12) 精确解出 2 个表（DATA_WAVES_15 / DATA_WAVES_8），实测 ' + r1.tables.length);

  console.log('  --- ' + ok + '/' + tot + ' 通过');
  return ok === tot ? 0 : 1;
}

/* ---------- 入口 ---------- */

const args = process.argv.slice(2);
if (args.includes('--selftest')) {
  const rc = selftest();
  // 再跑一次活文件主判据
  console.log('');
  const rc2 = report(load());
  process.exit(rc === 0 ? rc2 : 1);
}
process.exit(report(load()));
