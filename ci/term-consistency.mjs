// 术语一致性门禁 (term-consistency gate)
// 目的: 防"同一玩家概念被两个词指代"的漂移复发, 尤其是**玩家可见字符串**层面。
// 用法:
//   node ci/term-consistency.mjs            # 只报(默认)
//   node ci/term-consistency.mjs --selftest # 阴性对照自测
//
// 判据: 对每个「术语族」做**可见字符串**计数。
//  - 族内若某成员计数远超其他成员, 报 WARN(疑似漂移)。
//  - 只把**字符串字面量**(代码侧, 排除注释)计入, 因为注释不影响玩家。
//  - ⚠ 设计原则: **只报不拦**。术语是否真漂移需要人(或运行时观测)判定,
//    静态同类词也可能是有意的状态区分(见 站桩/站住 案例)。

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.');
const FILE = path.join(ROOT, 'game', '萌兽消消岛.html');
const SELFTEST = process.argv.includes('--selftest');

// 术语族: 同一玩家概念的不同措辞
const FAMILIES = [
  { id: 'home', label: '回大厅/回首页/返回大厅', words: ['回大厅', '回首页', '回主界面', '回主页'] },
  { id: 'stand', label: '站桩/站住', words: ['站桩', '站住'], note: '实为两个状态(rootActive vs rootOn), 见运行时实测' },
  { id: 'hall', label: '大厅/主界面/主页', words: ['大厅', '主界面', '主页'] },
  { id: 'gear', label: '锻造/升级(装备侧)', words: ['锻造', '升星'] },
  { id: 'run', label: '本局/这一局/当局', words: ['本局', '这一局', '当局'], note: '本局=局内状态口径' },
];

function stripComments(src) {
  // 粗略去注释: 去掉 // 行注释与 /* */ 块注释(不处理字符串内的 //, 但游戏里少)
  let out = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  out = out.split('\n').map(l => {
    const i = l.indexOf('//');
    if (i < 0) return l;
    // 若 // 在引号内则保留(近似: 数该行 // 前的引号数, 偶数视为真注释)
    const q = (l.slice(0, i).match(/["']/g) || []).length;
    return q % 2 === 1 ? l : l.slice(0, i);
  }).join('\n');
  return out;
}

function analyze(src) {
  const code = stripComments(src);
  const codeStr = code.match(/"[^"\n]*"|'[^'\n]*'/g) || [];
  const joined = codeStr.join('\n');
  const report = [];
  for (const fam of FAMILIES) {
    const counts = fam.words.map(w => ({ w, n: (joined.split(w).length - 1) }));
    const present = counts.filter(c => c.n > 0);
    if (present.length < 2) { report.push({ ...fam, counts, verdict: 'SKIP', why: '族内仅一个措辞在用(无竞争)' }); continue; }
    const tot = present.reduce((a, c) => a + c.n, 0);
    const sorted = [...present].sort((a, b) => b.n - a.n);
    const top = sorted[0], rest = sorted.slice(1);
    const minorityShare = rest.reduce((a, c) => a + c.n, 0) / tot;
    // 少数派存在且占比 < 20% 且本身计数 >=1 -> 疑似漂移
    const verdict = (minorityShare < 0.2 && rest.some(c => c.n >= 1)) ? 'WARN' : 'OK';
    report.push({ ...fam, counts: sorted, total: tot, minorityShare: +(minorityShare * 100).toFixed(1), verdict });
  }
  return report;
}

function print(report) {
  console.log('# 术语一致性（**只报不拦**）\n');
  let warn = 0;
  for (const r of report) {
    const line = r.counts.map(c => c.w + '×' + c.n).join(' / ');
    if (r.verdict === 'WARN') warn++;
    const tag = r.verdict === 'WARN' ? '⚠ WARN' : (r.verdict === 'OK' ? '· OK' : '· SKIP');
    console.log(`${tag}  [${r.id}] ${r.label}`);
    console.log(`      ${line}${r.total ? `  （少数派占比 ${r.minorityShare}%）` : ''}`);
    if (r.why) console.log(`      → ${r.why}`);
    if (r.note) console.log(`      注: ${r.note}`);
  }
  console.log(`\n合计: ${report.length} 族, ${warn} 条疑似漂移`);
  console.log('⚠ 本门禁不参与退出码。术语是否真漂移须用**运行时观测**或人判定');
  console.log('  （历史教训: 站桩/站住 看似漂移, 实测为两个状态, 误改会引入缺陷）');
  return warn;
}

function selftest() {
  console.log('=== 判据自测（阴性对照）===');
  const ok = (name, cond, expect) => console.log(`  ${cond === expect ? '✅' : '❌'} ${name} → ${cond}（应 ${expect}）`);

  // 1. 真实文件
  const real = analyze(fs.readFileSync(FILE, 'utf8'));
  const homeFam = real.find(r => r.id === 'home');
  const standFam = real.find(r => r.id === 'stand');
  console.log(`  [A] 真实文件 → home: ${homeFam.counts.map(c => c.w + '×' + c.n).join('/')} verdict=${homeFam.verdict}`);
  console.log(`               stand: ${standFam.counts.map(c => c.w + '×' + c.n).join('/')} verdict=${standFam.verdict}`);
  ok('修后 home 无少数派漂移', homeFam.verdict, 'SKIP');

  // 2. 合成阳性样本: 注入一个孤立的"回首页"字符串
  const bad = fs.readFileSync(FILE, 'utf8').replace(/return "[^"]*";\n(\s*)}\n/, 'return "回首页";\n$1}\n');
  const injected = bad === fs.readFileSync(FILE, 'utf8')
    ? fs.readFileSync(FILE, 'utf8') + '\nvar __T = "回首页";\n'
    : bad;
  const injRep = analyze(injected);
  const injHome = injRep.find(r => r.id === 'home');
  console.log(`  [B] 注入孤立「回首页」字符串 → home verdict=${injHome.verdict} (${injHome.counts.map(c => c.w + '×' + c.n).join('/')})`);
  ok('孤立措辞被抓', injHome.verdict, 'WARN');

  // 3. 阴性对照: 注释里的「回首页」不该被抓
  const commentOnly = fs.readFileSync(FILE, 'utf8') + '\n// 这条注释提到回首页, 不应计入\n';
  const cRep = analyze(commentOnly);
  const cHome = cRep.find(r => r.id === 'home');
  console.log(`  [C] 仅注释含「回首页」 → home verdict=${cHome.verdict} (${cHome.counts.map(c => c.w + '×' + c.n).join('/')})`);
  ok('注释不误报', cHome.verdict, 'SKIP');

  // 4. 阴性对照: 半数对半不该报(有意的两种说法)
  const half = fs.readFileSync(FILE, 'utf8') + '\nvar __A = "站桩";var __B = "站桩";var __C = "站住";var __D = "站住";\n';
  const hRep = analyze(half);
  const hStand = hRep.find(r => r.id === 'stand');
  console.log(`  [D] 对半使用两种措辞 → stand verdict=${hStand.verdict} (${hStand.counts.map(c => c.w + '×' + c.n).join('/')}, 少数派 ${hStand.minorityShare}%)`);
  ok('均衡使用不报警', hStand.verdict, 'OK');

  console.log(`\n实际文件: ${FILE}`);
  process.exit(0);
}

if (!fs.existsSync(FILE)) { console.error('找不到 ' + FILE); process.exit(2); }
if (SELFTEST) selftest();
const src = fs.readFileSync(FILE, 'utf8');
print(analyze(src));
process.exit(0);
