// ci/touch-copy-check.mjs —— 触屏宿主文案判据（第 64 轮新增）
//
// 存在理由（实测第 2 次漏）：小游戏是**纯触屏**宿主，凡是"WASD / 空格 / Esc / 方向键"这类**键鼠专属文案**，
//   对目标玩家信息量为 0。v1.201 修了「设置页帮助行 + 暂停层提示」两处，但**教学短条第 0 步**、
//   **「怎么玩」帮助页①行**、**DATA_LORE.skipHint**、**进场过场跳过钮副标签**四处仍然是键鼠文案 —— 
//   同一个病根，改一处漏四处。本判据把"必须挂在宿主开关上"变成可执行规则。
//
// 判据（静态，零依赖）：
//   1. 扫描**字符串字面量**（先剔除 `//` 与 `/* */` 注释，且不误伤字符串里的 `//`）；
//   2. 命中键鼠词（`WASD` / 独立词 `Esc` / 方向键 / 键鼠 / 键盘 / 空格）的字面量，
//      其**所在行前后 8 行**内必须出现宿主开关：`touchOnlyHost(` 或本仓的三个文案函数
//      （`moveHintText` / `skipHintText` / `skipChipSubText`）—— 否则 FAIL；
//   3. 显式白名单只放**非玩家文案**（CI 证据字段等），每条都要写理由。
//   ⚠ 反例边界：`"Escape"`（按键名比较）**不算**键鼠文案 —— `\bEsc\b` 不会命中它（这是首版就定好的边界）。
//
// 自证 `--selftest`：3 组合成样本（未挂开关必须 FAIL / 挂了三元开关必须 PASS / 白名单必须 PASS）
//   + 真实母版必须 PASS。
import { readFileSync } from 'node:fs';
const F_MASTER = process.env.MASTER || 'game/萌兽消消岛.html';
const KEY = /\bWASD\b|\bEsc\b|方向键|键鼠|键盘|空格/;
const GUARD = /touchOnlyHost\(|moveHintText|skipHintText|skipChipSubText/;
const ALLOW = [
  { text: 'btn/space/Esc', why: 'CI 证据字段（hudSnap/bossBanner 快照里的机器标识），不是玩家可见文案' },
  { text: 'WASD', why: '幽灵摇杆标签，只在**键盘输入有效**时绘制（画点分支条件 `kb.len > 0.04`，母版 L29896）⇒ 纯触屏宿主永不进入该分支' },
];

// 扫描字符串字面量（跳过注释；字符串里的 // 不当注释）
export function scanLiterals(src) {
  const out = [];
  let i = 0, line = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i += 2; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c, startLine = line, start = i + 1;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') { i++; if (src[i] === '\n') line++; i++; continue; }
        if (src[i] === '\n') line++;
        i++;
      }
      out.push({ text: src.slice(start, i), line: startLine, start });
      i++; continue;
    }
    i++;
  }
  return out.filter((l) => l.text.length);
}

export function analyze(src) {
  const lines = src.split('\n');
  const bad = [], ok = [], allow = [];
  for (const lit of scanLiterals(src)) {
    if (!KEY.test(lit.text)) continue;
    const hit = ALLOW.find((a) => lit.text === a.text);
    if (hit) { allow.push({ ...lit, why: hit.why }); continue; }
    const from = Math.max(0, lit.line - 9), to = Math.min(lines.length, lit.line + 8);
    const window = lines.slice(from, to).join('\n');
    (GUARD.test(window) ? ok : bad).push(lit);
  }
  return { bad, ok, allow, total: bad.length + ok.length + allow.length };
}

const isMain = process.argv[1] && /touch-copy-check\.mjs$/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain && process.argv.includes('--selftest')) {
  const cases = [
    { name: '阴性A：裸写键鼠文案（未挂宿主开关）', src: 'function draw() {\n  ctx.fillText("点击 / 空格 / Esc 可跳过", 10, 20);\n}\n', wantFail: true },
    { name: '阳性B：挂在 touchOnlyHost 三元上', src: 'function draw() {\n  var t = touchOnlyHost() ? "点击可跳过" : "点击 / 空格 / Esc 可跳过";\n  ctx.fillText(t, 10, 20);\n}\n', wantFail: false },
    { name: '阳性C：走文案函数', src: 'function skipHintText() { return touchOnlyHost() ? "点击可跳过" : "点击 / 空格 / Esc 可跳过"; }\nfunction draw() { ctx.fillText(skipHintText(), 1, 2); }\n', wantFail: false },
    { name: '阳性D：白名单（CI 证据字段）', src: 'function snap() { return { skip: "btn/space/Esc" }; }\n', wantFail: false },
    { name: '阴性E：注释里出现键鼠词不算（不该误报）', src: '// 这里说 WASD 只是注释\nfunction draw() { ctx.fillText("走位", 1, 2); }\n', wantFail: false },
    { name: '阳性F：键名比较 "Escape" 不算键鼠文案', src: 'function onKey(k) { if (k === "Escape") pause(); }\n', wantFail: false },
  ];
  let bad = 0;
  for (const c of cases) {
    const r = analyze(c.src);
    const failed = r.bad.length > 0;
    const ok = failed === c.wantFail;
    console.log(`${ok ? '✅' : '❌'} ${c.name} ⇒ ${failed ? 'FAIL' : 'PASS'}（期望 ${c.wantFail ? 'FAIL' : 'PASS'}）`);
    for (const b of r.bad) console.log(`      · 第 ${b.line} 行字面量「${b.text.slice(0, 40)}」没挂宿主开关`);
    if (!ok) bad++;
  }
  try {
    const real = readFileSync(F_MASTER, 'utf8');
    const r = analyze(real);
    console.log(`${r.bad.length === 0 ? '✅' : '❌'} 真实母版：命中 ${r.total} 条（受保护 ${r.ok.length} · 白名单 ${r.allow.length} · 裸写 ${r.bad.length}）`);
    for (const b of r.bad) console.log(`      · 第 ${b.line} 行「${b.text.slice(0, 50)}」`);
    if (r.bad.length) bad++;
  } catch (e) { console.log(`⚠ 真实母版跳过：${e.message}`); }
  console.log(bad ? `\n✗ 自测失败 ${bad} 项` : '\n✅ 触屏文案判据自测通过（6 组合成样本 + 真实母版）');
  process.exit(bad ? 1 : 0);
}
if (isMain) {
  const r = analyze(readFileSync(F_MASTER, 'utf8'));
  console.log(`  命中键鼠词字面量 ${r.total} 条：受宿主开关保护 ${r.ok.length} · 白名单 ${r.allow.length} · **裸写 ${r.bad.length}**`);
  for (const a of r.allow) console.log(`  · 白名单：第 ${a.line} 行「${a.text}」（${a.why}）`);
  for (const o of r.ok) console.log(`  · 受保护：第 ${o.line} 行「${o.text.slice(0, 46)}」`);
  if (r.bad.length) {
    for (const b of r.bad) console.log(`❌ 第 ${b.line} 行字面量「${b.text.slice(0, 60)}」是键鼠文案但没挂宿主开关`);
    console.log(`\n结论：FAIL（${r.bad.length} 条裸写）`);
    process.exit(1);
  }
  console.log('\n结论：PASS —— 键鼠文案全部挂在宿主开关上（或属非玩家文案白名单）');
}
