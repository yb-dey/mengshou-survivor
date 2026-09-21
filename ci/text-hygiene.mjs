#!/usr/bin/env node
// text-hygiene.mjs —— 文案卫生门禁（作者标注 / 占位符不得出现在玩家可见字符串里）
//
// 存在理由（v1.182 实测）：
//   本作有一套**作者标注约定**（源码注释里写明的）：
//     `[来源]` = 数值出自方案表 1 / 参数速查
//     `[假设]` = 自定初值、待调参
//   这套标注原本只该出现在**注释**里。但实测 `DATA_SUPER` 有 **7/20** 条把标注
//   写进了 `desc` 字符串内部 —— 而 `desc` 是**玩家可见文案字段**（经 `fillText` 上屏）。
//
//   ⚠ 本轮**关键的一步是先验证"是否真的可见"**，没有直接下"缺陷"结论：
//     穷举全部 `.desc` → 文本输出的路径后发现，`DATA_SUPER.desc` **当前没有任何渲染点**
//     （`pauseWeaponRows()` 读的是 `DATA_WEAPON[sd.from].desc`，即**源武器**的 desc）。
//     ⇒ 判定：**潜在隐患，不是当前可见缺陷**。修法因此也不同 ——
//       不是"修一个玩家能看到的错字"，而是**消除隐患面**：把标注移出字符串、放进注释。
//
//   本门禁把"字符串里不得有作者标注"变成**可执行的不变量**，
//   这样将来任何人给 super desc 接上渲染，也不会把 `【假设】` 漏给玩家。
//
// 判据（4 条）：
//   A. 任何**字符串字面量**内不得出现作者标注标记（【假设】/【来源】/【待定】/【草稿】）
//   B. 任何字符串内不得出现标准占位符（TODO / FIXME / XXX / TBD）
//   C. 数据表里"给玩家看"的字段（desc/name/feel/contrast/condText/gainText/knife/pick）
//      必须非空且不含标注
//   D. 消费侧自证：解析出的字符串数量必须 > 0（解析失效 ≡ 门禁失效，两者都全绿最危险）
//
// 阴性对照：内置违规样本，判据必须检出；内置合规样本，判据必须不误报。

import fs from 'node:fs';
import path from 'node:path';

const FILE = process.env.GAME_HTML || path.join('game', '萌兽消消岛.html');

// 作者标注标记（来自源码注释里的明文约定）
const AUTHOR_MARKS = ['【假设】', '【来源】', '【待定】', '【草稿】', '【待补】', '[假设]', '[来源]', '[待定]'];
// 标准占位符
const PLACEHOLDERS = ['TODO', 'FIXME', 'XXX', 'TBD', 'PLACEHOLDER'];
// 数据表里**面向玩家**的字段
const PLAYER_FIELDS = ['desc', 'feel', 'contrast', 'condText', 'gainText', 'knife', 'pick', 'tagline'];

function scanLiterals(src) {
  // 返回所有字符串字面量：{ text, index, inComment }
  const out = [];
  const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const text = m[1] ?? m[2] ?? m[3];
    if (text == null) continue;
    const ls = src.lastIndexOf('\n', m.index) + 1;
    const before = src.slice(ls, m.index);
    const inComment = /\/\//.test(before);
    out.push({ text, index: m.index, inComment });
  }
  return out;
}

function check(html) {
  const lits = scanLiterals(html);
  const codeLits = lits.filter(l => !l.inComment);   // 只查**代码内**（注释里的标注是合规用法）

  const alarms = [];

  // A. 作者标注不得出现在代码字符串里
  for (const l of codeLits) {
    for (const mk of AUTHOR_MARKS) {
      if (l.text.includes(mk)) {
        // 允许"这是判定这一行是否在注释里的探针"等元用途 —— 但游戏文件里不该有
        alarms.push({ rule: 'A', msg: '代码字符串含作者标注 ' + mk + ' :: "' + l.text.slice(0, 60) + '"' });
        break;
      }
    }
  }

  // B. 占位符
  for (const l of codeLits) {
    for (const p of PLACEHOLDERS) {
      if (new RegExp('\\b' + p + '\\b').test(l.text)) {
        alarms.push({ rule: 'B', msg: '代码字符串含占位符 ' + p + ' :: "' + l.text.slice(0, 60) + '"' });
        break;
      }
    }
  }

  // C. 玩家字段不得含标注；**且**在数据表里不得为空
  //    ⚠ 这里踩过一个"判据太严 = 假阳性"的坑，必须记下：
  //      第一版把"空玩家字段"全库都报 → 立刻抓到两条，
  //      查证后**两条都是合法的动态默认值**，不是内容缺口：
  //        ① `if (!mine) mine = { id: sid, feel: "", reqName: ... }` —— 代码里的兜底对象
  //        ② 房间视图 `knife: ""` —— 该视图的 knife 槽有时为空是设计
  //      ⇒ 判据必须**限定作用域**：空值只在 `DATA_*` 数据表内才是缺口。
  //        （判据太严会逼人加豁免，而豁免一多就没人再看它。）
  const tableRanges = [];
  {
    const tre = /(?:var|const|let)\s+(DATA_[A-Z0-9_]+)\s*=\s*[\[{]/g;
    let tm;
    while ((tm = tre.exec(html)) !== null) {
      const start = tm.index;
      let i = tm.index + tm[0].length - 1;
      const open = html[i];
      const [oc, cc] = open === '{' ? ['{', '}'] : ['[', ']'];
      let d = 0, s = null, j = i;
      for (; j < html.length; j++) {
        const c = html[j];
        if (s) { if (c === '\\') { j++; continue; } if (c === s) s = null; continue; }
        if (c === '"' || c === "'" || c === '`') { s = c; continue; }
        if (c === '/' && html[j + 1] === '/') { while (j < html.length && html[j] !== '\n') j++; continue; }
        if (c === oc) d++; else if (c === cc) { d--; if (d === 0) { j++; break; } }
      }
      tableRanges.push({ name: tm[1], start, end: j });
    }
  }
  const inTable = (idx) => tableRanges.find(r => idx >= r.start && idx < r.end);

  let fieldN = 0, emptyInTable = 0;
  const fieldRe = new RegExp('(?:' + PLAYER_FIELDS.join('|') + '):\\s*"([^"]*)"', 'g');
  let fm;
  while ((fm = fieldRe.exec(html)) !== null) {
    fieldN++;
    const v = fm[1];
    const ls = html.lastIndexOf('\n', fm.index) + 1;
    const before = html.slice(ls, fm.index);
    if (/\/\//.test(before)) continue;      // 注释里的别管
    const tb = inTable(fm.index);
    if (!v.trim()) {
      if (tb) { emptyInTable++; alarms.push({ rule: 'C', msg: '数据表 ' + tb.name + ' 玩家字段为空 :: ' + fm[0].slice(0, 60) }); }
      continue;
    }
    for (const mk of AUTHOR_MARKS) {
      if (v.includes(mk)) alarms.push({ rule: 'C', msg: '玩家字段含标注 ' + mk + ' :: "' + v.slice(0, 60) + '"' });
    }
  }

  // D. 解析侧自证
  if (lits.length === 0) alarms.push({ rule: 'D', msg: '解析出 0 个字符串字面量 —— 解析失效 ≡ 门禁失效' });
  if (fieldN === 0) alarms.push({ rule: 'D', msg: '解析出 0 个玩家字段 —— 解析失效 ≡ 门禁失效' });

  return { alarms, litN: lits.length, codeLitN: codeLits.length, fieldN };
}

function selftest() {
  console.log('=== 判据自测（阴性对照）===');
  let ok = 0, tot = 0;

  // A. 真实文件必须 0 报警
  const html = fs.readFileSync(FILE, 'utf8');
  const r = check(html);
  tot++;
  console.log('  [A] 真实文件 → 代码字符串 ' + r.codeLitN + ' / 玩家字段 ' + r.fieldN + ' → 报警 ' + r.alarms.length);
  if (r.alarms.length === 0) { ok++; console.log('       → 0 报警 ✅'); }
  else { r.alarms.slice(0, 5).forEach(a => console.log('       ⚠ [' + a.rule + '] ' + a.msg)); }

  // B. 注入一条作者标注 → 必须抓到
  const inj = html.replace('desc: "松果连弩+花蜜', 'desc: "松果连弩+花蜜【假设】');
  tot++;
  const rb = check(inj);
  const gotB = rb.alarms.some(a => a.msg.includes('【假设】'));
  console.log('  [B] 往 desc 注入【假设】→ 抓到? ' + gotB + '（应 True）');
  if (gotB) ok++;

  // C. 注入占位符 → 必须抓到
  const injC = html.replace('name: "狂风橡果暴雨"', 'name: "狂风橡果暴雨TODO"');
  tot++;
  const rc = check(injC);
  const gotC = rc.alarms.some(a => a.rule === 'B' || a.msg.includes('TODO'));
  console.log('  [C] 注入 TODO → 抓到? ' + gotC + '（应 True）');
  if (gotC) ok++;

  // D. 注释里的标注 → 必须**不**误报（合规用法）
  const sample = 'var x = 1; // 这个值 [假设]\nvar y = "正常文案";\n';
  tot++;
  const rd = check(sample);
  const cleanD = !rd.alarms.some(a => a.rule === 'A');
  console.log('  [D] 注释内标注 → 不误报? ' + cleanD + '（应 True，注释里是合规用法）');
  if (cleanD) ok++;

  // E. 空玩家字段（**在数据表内**）→ 必须抓到
  const sample2 = 'var DATA_X = [ { id: "a", desc: "" } ];';
  tot++;
  const re2 = check(sample2);
  const gotE = re2.alarms.some(a => a.rule === 'C');
  console.log('  [E] 数据表内空 desc → 抓到? ' + gotE + '（应 True）');
  if (gotE) ok++;

  // F. 空玩家字段（**在普通代码里**，合法默认值）→ 必须**不**误报
  const sample3 = 'function f(){ if(!mine) mine = { id: sid, feel: "" }; }';
  tot++;
  const re3 = check(sample3);
  const cleanF = !re3.alarms.some(a => a.rule === 'C');
  console.log('  [F] 代码内兜底空值 → 不误报? ' + cleanF + '（应 True，动态默认值不是缺口）');
  if (cleanF) ok++;

  console.log('  --- ' + ok + '/' + tot + ' 通过');
  return ok === tot;
}

function main() {
  if (process.argv.includes('--selftest')) {
    return selftest() ? 0 : 1;
  }
  const html = fs.readFileSync(FILE, 'utf8');
  const r = check(html);
  console.log('# 文案卫生门禁（作者标注 / 占位符不得进玩家可见字符串）');
  console.log('');
  console.log('- 扫描字符串字面量：' + r.litN + ' 个（其中代码内 ' + r.codeLitN + ' 个）');
  console.log('- 扫描玩家可见字段：' + r.fieldN + ' 个');
  console.log('');
  if (!r.alarms.length) {
    console.log('## ✅ 通过（0 报警）');
    console.log('');
    console.log('- 无作者标注泄漏到代码字符串');
    console.log('- 无占位符残留');
    console.log('- 玩家可见字段全部非空且干净');
    return 0;
  }
  console.log('## ⚠ 发现 ' + r.alarms.length + ' 处');
  console.log('');
  for (const a of r.alarms) console.log('- [' + a.rule + '] ' + a.msg);
  return 1;
}

process.exit(main());
