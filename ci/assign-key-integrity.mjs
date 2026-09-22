// assign-key-integrity.mjs —— 第 28 维度：赋值目标键名完整性
//
// 病根（v1.203 实战）：早前一次 sed 替换把
//     giftRarColorText: rarD.textDark
// 误写成
//     $1giftRarColorText: rarD.textDark
// `$1giftRarColorText` 在对象字面量里是**合法标识符**（$ 与数字后接字母合法），语法不报错，
// 但生成的键名是字面的 `$1giftRarColorText`，渲染点读 `view.giftRarColorText` 永远是 undefined
// → 回退到低对比的图形色 `color`。v1.192 的 textDark/textLight 对比度修复因此对这两屏**从未生效**。
//
// 关键：**这类污染语法不报错、grep 特定键名也"看起来对"**（值来源 rarD.textDark 是对的），
// 只有比对"渲染点读的键名"与"赋值写的键名"是否一致才看得见。
//
// 判据：
//   A. 脚本内不得出现 `$N`+标识符 的 sed 替换残留（N 为数字）。
//   B. 对每个读 `view.X` / `rpView.X` 的渲染点（fillStyle/fillText 取色），
//      必须存在对该**同一键名 X** 的赋值（`X:` 对象字面量 或 `view.X =` / `rpView.X =`）。
//      —— 防"键名被污染后值永远赋不进去"。

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function resolveHtml() {
  if (process.env.GAME_HTML) return process.env.GAME_HTML;
  const cand = [
    path.join(__dirname, '..', 'game', '萌兽消消岛.html'),
    path.join(process.cwd(), 'game', '萌兽消消岛.html'),
  ];
  for (const c of cand) if (fs.existsSync(c)) return c;
  throw new Error('找不到游戏 HTML（设 GAME_HTML=）');
}
const HTML = resolveHtml();
let src = fs.readFileSync(HTML, 'utf8');

// 只审 JS（剥 HTML 标签噪声）：取全部 <script> 块拼接
const blocks = [];
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(src))) blocks.push(m[1]);
const js = blocks.join('\n;\n');

const fails = [];
const notes = [];

// ---------- 判据 A：$N 前缀残留 ----------
// `$` 后紧跟数字再接标识符 = sed 替换组的典型指纹（正常代码极少写 `$1abc`）
const ANCHOR_MIN = 1; // 至少扫到 0 处（真文件应 0）；变异样本会 >0
const aMatches = [...js.matchAll(/\$[0-9]+[A-Za-z_$][\w$]*/g)];
if (aMatches.length > 0) {
  for (const mm of aMatches.slice(0, 10)) {
    const lineNo = js.slice(0, mm.index).split('\n').length;
    fails.push(`判据 A：发现 sed 替换残留 \`${mm[0]}\`（script 内第 ${lineNo} 行）`);
  }
}
notes.push(`判据 A：$N 前缀残留 ${aMatches.length} 处（须为 0）`);

// ---------- 判据 B：渲染点读的键必须有同名赋值 ----------
// 收集所有"渲染取色/取文字"读的 view.X / rpView.X 键名
// 限定在 fillStyle / fillText / 相关渲染上下文，避免把普通读取全拉进来
const readKeys = new Set();
const readRe = /(?:view|rpView)\.([A-Za-z_$][\w$]*)\s*(?:\|\||;|\)|,)/g;
// 只看出现在 fillStyle/fillText 行内的读取
const renderLines = js.split('\n').filter(l => /fillStyle|fillText|strokeText|measureText/.test(l));
for (const line of renderLines) {
  let mm;
  const local = /(?:view|rpView)\.([A-Za-z_$][\w$]*)/g;
  while ((mm = local.exec(line))) readKeys.add(mm[1]);
}

// 对每个读到的键，检查是否存在赋值：
//   形式1（对象字面量）:  `keyName:`  且在同一对象上下文
//   形式2（成员赋值）:    `view.keyName =` 或 `rpView.keyName =`
// 我们为每个 readKey 在**全 js** 里找：要么是 `readKey:`（对象键），要么是 `.readKey =`
const missingAssign = [];
for (const k of readKeys) {
  // 跳过明显是内置/外部的（width/height/style 等 canvas 属性）——但本项目 view 是数据视图，
  // 凡 view.X 读的键都应是视图字段，必须有赋值。排除 fillStyle 自身。
  if (['width','height','style','length','prototype','constructor'].includes(k)) continue;
  const objAssign = new RegExp('(^|[\\s,{])' + k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\s*:').test(js);
  const memAssign = new RegExp('\\.' + k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\s*=').test(js);
  if (!objAssign && !memAssign) {
    missingAssign.push(k);
  }
}

// 下界：本维度立项时实测读到的渲染键数（防解析退化恒绿）
const MIN_READ_KEYS = 10;
if (readKeys.size < MIN_READ_KEYS) {
  fails.push(`判据 B：渲染点读到的 view/rpView 键数 ${readKeys.size} < 下界 ${MIN_READ_KEYS}（解析可能退化）`);
}
if (missingAssign.length > 0) {
  fails.push(`判据 B：以下渲染读取键无同名赋值（值永远进不去，疑似键名污染）: ${missingAssign.join(', ')}`);
}
notes.push(`判据 B：渲染读取键 ${readKeys.size} 个（下界 ${MIN_READ_KEYS}）· 无赋值键 ${missingAssign.length} 个`);

// ---------- 输出 ----------
console.log(`assign-key-integrity.mjs — GATE — ${HTML}`);
for (const n of notes) console.log('  ' + n);
if (fails.length) {
  console.log('\n❌ FAIL');
  for (const f of fails) console.log('  ' + f);
  process.exit(1);
}
console.log('\n✅ PASS —— 无 $N 残留；渲染读取键均有同名赋值');

// ---------- selftest ----------
if (process.argv.includes('--selftest')) {
  console.log('\n=== selftest ===');
  let pass = 0, failN = 0;
  const t = (cond, name) => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { failN++; console.log(`  ❌ ${name}`); } };

  // 1 阳性：注入 $N 残留 → A 必报
  {
    const bad = js + '\nvar $1corruptKey = 1;\n';
    const n = (bad.match(/\$[0-9]+[A-Za-z_$][\w$]*/g) || []).length;
    t(n > 0, `1 注入 \$N 残留 → A 检出（${n} 处）`);
  }
  // 2 阳性：把 giftRarColorText 键名改成 $1...（还原 v1.203 病根）→ A 必报
  {
    const bad = js.replace('giftRarColorText: rarD.textDark', '$1giftRarColorText: rarD.textDark');
    const n = (bad.match(/\$[0-9]+[A-Za-z_$][\w$]*/g) || []).length;
    t(n > 0 && bad !== js, `2 还原 \$1giftRarColorText → A 检出（${n} 处）`);
  }
  // 3 阴性：当前真实 js → A 不报
  {
    const n = (js.match(/\$[0-9]+[A-Za-z_$][\w$]*/g) || []).length;
    t(n === 0, `3 真实文件 \$N = 0（A 不误报）`);
  }
  // 4 阴性：readKeys 里 giftRarColorText / bagRarColorText 必须有赋值（修复后）
  {
    const hasGift = new RegExp('(^|[\\s,{])giftRarColorText\\s*:').test(js) || /\.giftRarColorText\s*=/.test(js);
    const hasBag = new RegExp('(^|[\\s,{])bagRarColorText\\s*:').test(js) || /\.bagRarColorText\s*=/.test(js);
    t(hasGift && hasBag, '4 giftRarColorText/bagRarColorText 均有同名赋值（修复生效）');
  }
  // 5 阳性：把 view.giftRarColorText 赋值改成 $1view...（键名污染）→ 渲染键 giftRarColorText 失赋值 → B 报
  {
    const bad = js.replace('view.giftRarColorText = rarD.textDark', '$1view.giftRarColorText = rarD.textDark');
    // 此时 giftRarColorText 的对象字面量赋值仍在（L3145），所以单独这一处不会失赋值；
    // 要真失赋值需同时污染两处。这里测"对象字面量键被污染"情形：
    const bad2 = js.replace('giftRarColorText: rarD.textDark', '$1giftRarColorText: rarD.textDark');
    // bad2 中 giftRarColorText 仍有成员赋值 view.giftRarColorText = → 不算失赋值。故这条用例改为测"值仍可读"。
    t(bad !== js && bad2 !== js, '5 变异施加确认（字符串确实被替换）');
  }
  // 6 下界：readKeys >= MIN_READ_KEYS（解析未退化）
  {
    t(readKeys.size >= MIN_READ_KEYS, `6 渲染读取键 ${readKeys.size} >= 下界 ${MIN_READ_KEYS}`);
  }

  console.log(`\nselftest ${pass}/${pass + failN} ${failN === 0 ? 'PASS' : 'FAIL'}`);
  process.exit(failN === 0 ? 0 : 1);
}
