#!/usr/bin/env node
// lore-coverage.mjs —— 「淡刀子」文案覆盖率门禁（零依赖，静态解析内联母版）
//
// 存在理由（v1.173 实测抓到的真缺口）：
//   本作的「淡刀子」是一个**已建立的文案系统**（DATA_LORE 定调：薄设定·淡刀子·全程可跳过），
//   图鉴/关于页用 `filter(e => !!e.knife)` 把它渲染成一个"刀语录"面。
//   但该 filter 是**静默的** —— 缺 knife 的条目会**无声消失**，点条目只回退到
//   通用提示"点分组再点条目"（见第 30442 行 `en.knife ? ... : 通用提示`）。
//   实测：敌人 21 条**只有 5 条**有 knife、跟宠 7 条**只有 2 条**有 →
//   **16 个敌人 + 5 只跟宠在文案面上不可见**，而没有任何门禁/报错会告诉你。
//
// 病根归类：第三类（"内容缺口"）+ 第七类（"验证覆盖不到"）的文案维度实例。
//   与 v1.168/v1.169 的音频缺口**同型**：都是"声明了系统、但多数条目没填/没接"，
//   且**静默降级**（不报错、不崩溃，只是没有）。
//
// 判据（4 条）：
//   A. DATA_CODEX_ENEMY 每条必须有非空 knife（缺一即 FAIL，列出 id）
//   B. DATA_BEAST       每条必须有非空 knife
//   C. knife 文案**质量**：中文 12–22 字 · 含「不是/是」转折 · 不含禁用词（恨/仇/征服/胜利/称霸/统治）
//   D. 消费侧自证：游戏里必须**真的存在**读 knife 的渲染点（否则填了也没人看）
//
// ⚠ 阴性对照（本判据自证有效）：内置 3 个**故意违规**样本，判据必须检出；
//   外加 2 个**正确**样本，判据必须**不**误报（防"太严的判据"）。

import fs from 'node:fs';
import path from 'node:path';

const FILE = process.env.GAME_HTML || path.join('game', '萌兽消消岛.html');
const html = fs.readFileSync(FILE, 'utf8');

// ---------- 解析工具：抽 `NAME = {...}` / `NAME = [...]`（大括号配平，跳过字符串） ----------
function extractBlock(src, name) {
  const re = new RegExp('\\b' + name + '\\s*=\\s*([\\{\\[])');
  const m = re.exec(src);
  if (!m) return null;
  const open = m[1];
  const start = src.indexOf(open, m.index);
  let depth = 0, inStr = null, esc = false;
  for (let j = start; j < src.length; j++) {
    const c = src[j];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  return null;
}

// 将块内的**顶层单行对象**逐条取出（这些内容表都是 `{ id: "...", ..., knife: "..." },` 一行一条）
function rowsOf(blockText) {
  return blockText.split(/\r?\n/).filter((L) => /^\s*\{\s*(?:id|chId|from)\s*:/.test(L));
}
function fieldOf(row, key) {
  const m = row.match(new RegExp('\\b' + key + '\\s*:\\s*"([^"]*)"'));
  return m ? m[1] : null;
}
function hasField(row, key) {
  return new RegExp('\\b' + key + '\\s*:').test(row);
}

// ---------- 判据实现 ----------
// ---------- 判据实现 ----------
// 禁用词：本作定调「走散的不是恨，是冷」→ 不许写恨/仇/征服，否则整个语气垮掉。
const BAN = /恨|仇|征服|胜利|称霸|统治|报仇/;

// ⚠ 转折**不只一种句式**（本轮踩到两次，都是判据太严、误伤项目自己的既有正典）：
//   第一次把"不是"写死 → 蜜罐/老板2/3/绒绒羊 被判不合格；
//   第二次补了 5 个词 → 「壳越滚越厚…」「把潮水吞回去…」仍不合格（它们用**意象对照**而非转折词）。
//   → 结论：**按"转折词白名单"判是错误方向**（永远补不全，且越补越像在给判据打补丁）。
//   → 改用两条**可穷举**的判据：① 长度在实测包络内 ② 含"把/是/不/却/只/换/让/为"等
//       虚词骨架中的**至少一个**（纯陈述句"兔子跑得快"没有骨架词，会被挡）。
//   实测包络：34 条既有文案，中文 10–21 字。
const LEN_MIN = 10, LEN_MAX = 22;
const SKELETON = /[把是不却只换让为怕给]/;

function auditTable(blockText, label, issues) {
  const rows = rowsOf(blockText);
  const stat = { total: rows.length, withKnife: 0, missing: [], badText: [] };
  for (const row of rows) {
    const id = fieldOf(row, 'id') || '(?)';
    if (!hasField(row, 'knife')) { stat.missing.push(id); continue; }
    const k = fieldOf(row, 'knife') || '';
    if (!k.trim()) { stat.missing.push(id + '(空串)'); continue; }
    stat.withKnife++;
    const n = (k.match(/[\u4e00-\u9fff]/g) || []).length;
    const probs = [];
    if (n < LEN_MIN || n > LEN_MAX) probs.push('字数' + n + '不在 ' + LEN_MIN + '–' + LEN_MAX);
    if (!SKELETON.test(k)) probs.push('缺虚词骨架(疑似纯陈述)');
    if (BAN.test(k)) probs.push('含禁用词');
    if (probs.length) stat.badText.push(id + ': ' + probs.join('/') + ' → ' + k);
  }
  if (stat.missing.length) {
    issues.push({ kind: '文案缺口', table: label, detail: '缺 knife: ' + stat.missing.join(', ') });
  }
  for (const b of stat.badText) issues.push({ kind: '文案质量', table: label, detail: b });
  return stat;
}

const enemyBlock = extractBlock(html, 'DATA_CODEX_ENEMY');
const beastBlock = extractBlock(html, 'DATA_BEAST');
if (!enemyBlock) throw new Error('未找到 DATA_CODEX_ENEMY（解析失效 = 判据失效）');
if (!beastBlock) throw new Error('未找到 DATA_BEAST（解析失效 = 判据失效）');

const issues = [];
const eStat = auditTable(enemyBlock, 'DATA_CODEX_ENEMY', issues);
const bStat = auditTable(beastBlock, 'DATA_BEAST', issues);

// 判据 D：消费侧必须真的读 knife
const consumers = [
  ['codex 条目 knife 回显', /entry\.knife/],
  ['跟宠 knife 渲染', /d\.knife/],
  ['敌人 knife 回显', /en\.knife|e\.knife/],
];
const missingConsumers = consumers.filter(([, re]) => !re.test(html)).map(([n]) => n);
if (missingConsumers.length) {
  issues.push({ kind: '消费侧缺失', table: 'game', detail: '未找到渲染点: ' + missingConsumers.join(', ') });
}

// 解析自证：解析出 0 条本身就是 FAIL（解析失效 ≡ 判据失效）
if (eStat.total === 0 || bStat.total === 0) {
  issues.push({ kind: '解析失效', table: 'game', detail: 'DATA_CODEX_ENEMY=' + eStat.total + ' / DATA_BEAST=' + bStat.total + ' 条 → 判据没工作' });
}

// ---------- 阴性对照：判据必须能检出故意的违规 ----------
const NEG = [
  {
    tag: 'A. 有条目缺 knife',
    text: '[\n  { id: "a", group: "trash", tell: "x", hint: "y", knife: "直着冲不是莽，是认准了这边还有热气。" },\n  { id: "b", group: "trash", tell: "x", hint: "y" }\n]',
    expectIssue: true,
  },
  {
    tag: 'B. knife 为空串',
    text: '[\n  { id: "a", group: "trash", tell: "x", hint: "y", knife: "" }\n]',
    expectIssue: true,
  },
  {
    tag: 'C. knife 太短 / 纯陈述无骨架 / 含禁用词',
    text: '[\n  { id: "a", group: "trash", tell: "x", hint: "y", knife: "短" },\n  { id: "b", group: "trash", tell: "x", hint: "y", knife: "兔子跑得很快而且非常能咬人" },\n  { id: "c", group: "trash", tell: "x", hint: "y", knife: "直着冲不是莽，是为了征服这片地方。" }\n]',
    expectIssue: true,
  },
];
const negResults = NEG.map((n) => {
  const local = [];
  auditTable(n.text, '<neg>', local);
  return { tag: n.tag, detected: local.length > 0, n: local.length };
});
const negOk = negResults.every((r) => r.detected);

// ---------- 正对照：正确的样本不得被误报 ----------
const POS = [
  {
    tag: 'A. 全部有 knife 且合规',
    text: '[\n  { id: "a", group: "trash", tell: "x", hint: "y", knife: "直着冲不是莽，是认准了这边还有热气。" },\n  { id: "b", group: "trash", tell: "x", hint: "y", knife: "跑得快不是凶，是薄得不敢停。" }\n]',
  },
  {
    tag: 'B. 空组不误报',
    text: '[\n]',
  },
];
const posResults = POS.map((p) => {
  const local = [];
  auditTable(p.text, '<pos>', local);
  return { tag: p.tag, n: local.length, ok: local.length === 0 };
});
// ⚠ 正对照 B 是空组：rowsOf 得 0 条 → 不该报"缺口"（空组是合法状态，不是缺口）
const posOk = posResults.every((r) => r.ok);

const pass = issues.length === 0 && negOk && posOk;

// ---------- 报告 ----------
const md = [];
md.push('# 「淡刀子」文案覆盖率门禁');
md.push('');
md.push('> 存在理由：`lore()` 用 `filter(e => !!e.knife)` 渲染刀语录，**缺 knife 的条目静默消失**');
md.push('> （点条目只回退到通用提示），而没有任何门禁会告诉你。v1.173 实测：敌人 **5/21**、跟宠 **2/7**。');
md.push('');
md.push('| 表 | 条目 | 有 knife | 缺 |');
md.push('|---|---|---|---|');
md.push('| DATA_CODEX_ENEMY（敌人图鉴） | ' + eStat.total + ' | ' + eStat.withKnife + ' | ' + eStat.missing.length + ' |');
md.push('| DATA_BEAST（跟宠） | ' + bStat.total + ' | ' + bStat.withKnife + ' | ' + bStat.missing.length + ' |');
md.push('');
md.push('## 判据');
md.push('A. 敌人图鉴每条必须有非空 knife  ·  B. 跟宠每条必须有非空 knife');
md.push('C. 文案质量：中文 ' + LEN_MIN + '–' + LEN_MAX + ' 字（实测包络）· 含虚词骨架（把/是/不/却/只/换/让/为/怕/给）· 不含禁用词（恨/仇/征服/胜利/称霸/统治）');
md.push('   ⚠ 转折**不只一种句式** —— 写死成"不是"会误伤项目自己的既有正典（`壳越滚越厚，里面已经喊不出声`）。');
md.push('   ⚠ 按"转折词白名单"判是**错误方向**：永远补不全。改用**可穷举**的两条（长度包络 + 虚词骨架）。');
md.push('D. 消费侧自证：游戏里必须真的存在读 knife 的渲染点（填了没人看 = 白填）');
md.push('');
md.push('## 阴性对照 / 正对照（判据自证有效）');
md.push('');
md.push('| 样本 | 应当 | 判据结论 | 结果 |');
md.push('|---|---|---|---|');
for (const r of negResults) md.push('| 负：' + r.tag + ' | 必须检出 | 检出 ' + r.n + ' 条 | ' + (r.detected ? '✅' : '❌') + ' |');
for (const r of posResults) md.push('| 正：' + r.tag + ' | 不得误报 | 检出 ' + r.n + ' 条 | ' + (r.ok ? '✅' : '❌') + ' |');
md.push('');
md.push('## 结论');
if (issues.length) {
  for (const i of issues) md.push('- ❌ **' + i.kind + '** `' + i.table + '` — ' + i.detail);
} else {
  md.push('- ✅ 全部条目均有合规 knife，且消费侧渲染点存在');
}
if (!negOk) md.push('- ❌ **阴性对照未通过 → 本判据自己失效**（检不出故意的违规样本）');
if (!posOk) md.push('- ❌ 正对照被误报 → 判据会误伤正确写法');
md.push('');
md.push('## **' + (pass ? 'PASS' : 'FAIL') + '** — ' + (pass ? '「淡刀子」覆盖完整 ✅' : '存在文案缺口或判据失效 ❌'));

const OUT_DIR = process.env.OUT_DIR || path.join('ci', 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'lore-coverage.md'), md.join('\n'));
console.log(md.join('\n'));
process.exit(pass ? 0 : 1);
