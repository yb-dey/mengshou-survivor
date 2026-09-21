#!/usr/bin/env node
// branch-pick.mjs —— 「选它当口」文案覆盖率门禁（零依赖，静态解析内联母版）
//
// 存在理由（v1.174 实测）：
//   配方图鉴（fork tab）里，每条进化分支此前只有 `feel`（3–4 字，如「叠弹暴雨」）——
//   玩家**没有任何依据**判断"这条分支什么时候该选"。20 条分支 = 20 个决策点全无提示。
//   这与 v1.173 的「淡刀子」缺口**同型**：都是"结构里有位置、但内容没填"，
//   且**不报错、不崩溃**（卡片照常画出来，只是画不出那一行）。
//
// 判据（4 条）：
//   A. DATA_CODEX_FORK 的每条 branch 必须有非空 `pick`（缺一即 FAIL，列出 from/branch id）
//   B. pick 文案质量：中文 7–24 字 · 不以标点结尾 · 不含禁用词
//      （下界 7 = 本轮实测最短 8 字留 1 字容差；上界 24 = 为将来更长的分支留空）
//      注意：**8 字的实测最短值是 mapletornado「要卷着走一路选它」/maplecross「近身对穿两次选它」
//      /thunderstorm「怪挤成一堆时选它」/solarflare「慢慢扫、扫得宽选它」**——
//      句首「要…」「近…」「怪…」「慢…」都是**局面状态**，不是动作名，这是本批文案的统一句式。
//   C. 消费侧自证：forkCodexOf 必须**透传** pick（声明了但没透传 = 填了没人看）
//   D. 渲染侧自证：fork 卡 draw 必须真的读 `b0.pick`
//   E. 几何自证：pick 行的 y 必须在卡高内（防"填了但画到卡外"）
//
// ⚠ 阴性对照 3 组（必须检出）+ 正对照 2 组（不得误报），与 v1.173 同一纪律。
// ⚠ 判据只留**可穷举**的两条（长度包络 + 结尾形态）—— 不枚举"应该含什么词"，
//   那是白名单方向，永远补不全（v1.173 的教训）。

import fs from 'node:fs';
import path from 'node:path';

const FILE = process.env.GAME_HTML || path.join('game', '萌兽消消岛.html');
const html = fs.readFileSync(FILE, 'utf8');

// ---------- 解析工具 ----------
function extractBlock(src, name) {
  const re = new RegExp('\\b' + name + '\\s*=\\s*([\\{\\[])');
  const m = re.exec(src);
  if (!m) return null;
  const start = src.indexOf(m[1], m.index);
  let depth = 0, inStr = null, esc = false;
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (inStr) { if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  return null;
}

// 长度包络从**本轮实测**的 20 条取值定：实际分布 8–12（min=mapletornado/maplecross
// /thunderstorm/solarflare 8 字，max=fluffguard 12 字）。留 1 字下容差 → 7 是硬下界。
// ⚠ 上界给 24 是为"未来补更长的分支"留空间，不是"现在允许写到 24"（现状最长 12）。
const LEN_MIN = 7, LEN_MAX = 24;
const BAN = /征服|称霸|统治|秒杀|无敌|最强|必须|绝对/;   // 语气禁用词（本作定调回避胜负/绝对化）

// 从一个 fork 条目里抽出所有 branch 对象
function branchesOf(forkRow) {
  const out = [];
  const re = /\{ id: "([a-z0-9_]+)", feel: "([^"]*)"(?:, pick: "([^"]*)")? \}/g;
  let m;
  while ((m = re.exec(forkRow))) out.push({ id: m[1], feel: m[2], pick: m[3] });
  return out;
}

function audit(forkBlock, issues) {
  // DATA_CODEX_FORK 每行一条 `{ from: "...", branches: [ {...}, {...} ] },`
  const rows = forkBlock.split(/\r?\n/).filter((l) => /^\s*\{\s*from\s*:/.test(l));
  const stat = { forks: rows.length, branches: 0, withPick: 0, missing: [], badText: [] };
  for (const row of rows) {
    const from = (row.match(/from\s*:\s*"([^"]+)"/) || [])[1] || '(?)';
    for (const b of branchesOf(row)) {
      stat.branches++;
      if (!b.pick || !b.pick.trim()) { stat.missing.push(from + '/' + b.id); continue; }
      stat.withPick++;
      const n = (b.pick.match(/[\u4e00-\u9fff]/g) || []).length;
      const probs = [];
      if (n < LEN_MIN || n > LEN_MAX) probs.push('字数' + n + '不在 ' + LEN_MIN + '–' + LEN_MAX);
      if (/[。，、；：！]$/.test(b.pick)) probs.push('以标点结尾(卡面断句由布局负责)');
      if (BAN.test(b.pick)) probs.push('含禁用词');
      if (probs.length) stat.badText.push(from + '/' + b.id + ': ' + probs.join('/') + ' → ' + b.pick);
    }
  }
  if (stat.missing.length) issues.push({ kind: '文案缺口', table: 'DATA_CODEX_FORK', detail: '缺 pick: ' + stat.missing.join(', ') });
  for (const b of stat.badText) issues.push({ kind: '文案质量', table: 'DATA_CODEX_FORK', detail: b });
  return stat;
}

const forkBlock = extractBlock(html, 'DATA_CODEX_FORK');
if (!forkBlock) throw new Error('未找到 DATA_CODEX_FORK（解析失效 = 判据失效）');

const issues = [];
const stat = audit(forkBlock, issues);

// 判据 C：forkCodexOf 透传
const xfer = /pick\s*:\s*b\.pick\s*\|\|\s*""/.test(html);
if (!xfer) issues.push({ kind: '消费侧缺失', table: 'game', detail: 'forkCodexOf 未透传 pick（声明了但没传出去 → 渲染端拿不到）' });

// 判据 D：渲染侧真的读 b0.pick
const renders = /if\s*\(\s*b0\.pick\s*\)/.test(html);
if (!renders) issues.push({ kind: '渲染侧缺失', table: 'game', detail: 'fork 卡 draw 未读 b0.pick（填了没人看 = 白填）' });

// 判据 E：几何 —— pick 的 y 偏移必须在卡高内
//   渲染为 `by = r.y + BASE + i * PITCH;` 且 pick 画在 `by + PICKDY`，i 最大 1
const mBase = html.match(/by = r\.y \+ (\d+) \+ i \* (\d+);/);
const mPick = html.match(/hudFitText\(ctx, b0\.pick[^)]*\), r\.x \+ (\d+), by \+ (\d+)\)/);
const fkH = (html.match(/codexForkH:\s*(\d+)/) || [])[1];
if (!mBase || !mPick || !fkH) {
  issues.push({ kind: '解析失效', table: 'game', detail: '几何锚点未命中（base=' + !!mBase + ' pick=' + !!mPick + ' H=' + !!fkH + '）→ 判据没工作' });
} else {
  const base = +mBase[1], pitch = +mBase[2], dy = +mPick[2], H = +fkH;
  const bottomOf = (i) => base + i * pitch + dy + 5;   // +5 给字号半高
  const worst = bottomOf(1);
  if (worst > H) issues.push({ kind: '几何溢出', table: 'game', detail: 'pick 第二支底 y=' + worst + ' > 卡高 ' + H + '（会画到卡外/压下一卡）' });
}

// 解析自证
if (stat.branches === 0) issues.push({ kind: '解析失效', table: 'DATA_CODEX_FORK', detail: '解析出 0 条分支 → 判据没工作' });

// ---------- 阴性对照 ----------
const NEG = [
  { tag: 'A. 分支缺 pick', text: '[\n  { from: "w", branches: [{ id: "b1", feel: "七向扇铺" }, { id: "b2", feel: "叠弹暴雨", pick: "杂兵成排时选它" }] }\n]', expect: true },
  { tag: 'B. pick 为空串', text: '[\n  { from: "w", branches: [{ id: "b1", feel: "七向扇铺", pick: "" }] }\n]', expect: true },
  { tag: 'C. pick 太短 / 含禁用词', text: '[\n  { from: "w", branches: [{ id: "b1", feel: "x", pick: "选它" }, { id: "b2", feel: "x", pick: "选它就能无敌秒杀全场" }] }\n]', expect: true },
  { tag: 'D. pick 以标点结尾', text: '[\n  { from: "w", branches: [{ id: "b1", feel: "x", pick: "杂兵成排时选它。" }] }\n]', expect: true },
];
const negResults = NEG.map((n) => {
  const local = [];
  audit(n.text, local);
  return { tag: n.tag, n: local.length, ok: local.length > 0 === n.expect };
});

// ---------- 正对照 ----------
const POS = [
  { tag: 'A. 全部有合规 pick', text: '[\n  { from: "w", branches: [{ id: "b1", feel: "七向扇铺", pick: "要同时压两路时选它" }, { id: "b2", feel: "瞄准贯珠", pick: "专打一个厚目标时选它" }] }\n]', ok: true },
  { tag: 'B. 空组不误报', text: '[\n]', ok: true },
];
const posResults = POS.map((p) => {
  const local = [];
  audit(p.text, local);
  return { tag: p.tag, n: local.length, ok: local.length === 0 === p.ok };
});

const negOk = negResults.every((r) => r.ok);
const posOk = posResults.every((r) => r.ok);
const pass = issues.length === 0 && negOk && posOk;

// ---------- 报告 ----------
const md = [];
md.push('# 「选它当口」分支文案覆盖率门禁');
md.push('');
md.push('> 存在理由：配方图鉴每条进化分支此前只有 `feel`（3–4 字），玩家**没有依据做分支决策**。');
md.push('> v1.174 补 20 条 `pick`（每条 = 一行"什么局面选它"），本门禁守住它不再退化。');
md.push('');
md.push('| 项 | 值 |');
md.push('|---|---|');
md.push('| 分叉组 | ' + stat.forks + ' |');
md.push('| 分支总数 | ' + stat.branches + ' |');
md.push('| 有 pick | ' + stat.withPick + ' |');
md.push('| 缺 pick | ' + stat.missing.length + ' |');
md.push('');
md.push('## 判据');
md.push('A. 每条分支必须有非空 `pick`  ·  B. 质量：中文 ' + LEN_MIN + '–' + LEN_MAX + ' 字 · 不以标点结尾 · 不含禁用词');
md.push('C. `forkCodexOf` 必须透传 `pick`  ·  D. fork 卡 draw 必须真读 `b0.pick`  ·  E. pick 行 y 必须在卡高 `codexForkH`(' + fkH + ') 内');
md.push('');
md.push('## 阴性对照 / 正对照');
md.push('');
md.push('| 样本 | 应当 | 结论 | 结果 |');
md.push('|---|---|---|---|');
for (const r of negResults) md.push('| 负：' + r.tag + ' | 必须检出 | 检出 ' + r.n + ' 条 | ' + (r.ok ? '✅' : '❌') + ' |');
for (const r of posResults) md.push('| 正：' + r.tag + ' | 不得误报 | 检出 ' + r.n + ' 条 | ' + (r.ok ? '✅' : '❌') + ' |');
md.push('');
md.push('## 结论');
if (issues.length) for (const i of issues) md.push('- ❌ **' + i.kind + '** `' + i.table + '` — ' + i.detail);
else md.push('- ✅ 全部分支有合规 pick，且消费/渲染/几何三侧自证通过');
if (!negOk) md.push('- ❌ **阴性对照未通过 → 本判据自己失效**');
if (!posOk) md.push('- ❌ 正对照被误报 → 判据会误伤正确写法');
md.push('');
md.push('## **' + (pass ? 'PASS' : 'FAIL') + '** — ' + (pass ? '分支决策文案覆盖完整 ✅' : '存在缺口或判据失效 ❌'));

const OUT_DIR = process.env.OUT_DIR || path.join('ci', 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'branch-pick.md'), md.join('\n'));
console.log(md.join('\n'));
process.exit(pass ? 0 : 1);
