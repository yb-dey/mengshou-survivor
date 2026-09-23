import { readFileSync } from 'node:fs';
// ci/tap-target-check.mjs —— 触控目标锁 + 审查表（第 69 轮）
//   换算：逻辑 px × 0.5417 = 390pt 手机上的 CSS px（1 CSS px ≈ 0.183 mm）。
//   通行下限：iOS HIG 44×44 CSS px / Android 48dp ⇒ 取 44 CSS px ≈ **81 逻辑px**。
//   本判据不禁止"偏小"，但**禁止变得更小、也禁止新增偏小控件**（新增必须显式登记到 ALLOW_NEW）。
const F_MASTER = process.env.MASTER || 'game/萌兽消消岛.html';
const FLOOR = 81;            // 44 CSS px
const BASE = [
// ── 冻结台账（v1.206 实测 27 个具名控件；由 ci/tap-target-check.mjs 采集，2026-09-24 冻结）──
//   达标（短边 ≥ 81 逻辑px ≈ 44 CSS px）：4 个
  { name: "homegear", w: 228, h: 148 },
  { name: "homeup", w: 152, h: 148 },
  { name: "homebeast", w: 152, h: 148 },
  { name: "homesettings", w: 140, h: 148 },
//   未达标（短边 < 81 逻辑px）—— 已登记为**待拍板清单**（见 产品视角-小游戏化.md §18）：23 个
  { name: "homeguide", w: 100, h: 44 },   // 短边 23.8 CSS px
  { name: "homeabout", w: 100, h: 44 },   // 短边 23.8 CSS px
  { name: "aboutlore", w: 220, h: 52 },   // 短边 28.2 CSS px
  { name: "guidereplay", w: 320, h: 56 },   // 短边 30.3 CSS px
  { name: "dailycancel", w: 240, h: 64 },   // 短边 34.7 CSS px
  { name: "upclose", w: 220, h: 64 },   // 短边 34.7 CSS px
  { name: "vaultclose", w: 220, h: 64 },   // 短边 34.7 CSS px
  { name: "beastclose", w: 220, h: 64 },   // 短边 34.7 CSS px
  { name: "settheme", w: 320, h: 64 },   // 短边 34.7 CSS px
  { name: "setbgm", w: 320, h: 64 },   // 短边 34.7 CSS px
  { name: "setexport", w: 320, h: 64 },   // 短边 34.7 CSS px
  { name: "setimport", w: 320, h: 64 },   // 短边 34.7 CSS px
  { name: "setclose", w: 220, h: 64 },   // 短边 34.7 CSS px
  { name: "gearmerge", w: 188, h: 64 },   // 短边 34.7 CSS px
  { name: "gearforge", w: 196, h: 64 },   // 短边 34.7 CSS px
  { name: "gearclose", w: 188, h: 64 },   // 短边 34.7 CSS px
  { name: "guideok", w: 220, h: 64 },   // 短边 34.7 CSS px
  { name: "aboutclose", w: 220, h: 64 },   // 短边 34.7 CSS px
  { name: "btnrevive", w: 320, h: 70 },   // 短边 37.9 CSS px
  { name: "btngiveup", w: 320, h: 70 },   // 短边 37.9 CSS px
  { name: "guideskiphall", w: 220, h: 72 },   // 短边 39.0 CSS px
  { name: "chapterconfirm", w: 220, h: 76 },   // 短边 41.2 CSS px
  { name: "chaptercancel", w: 220, h: 76 },   // 短边 41.2 CSS px
];
// 允许新增的偏小控件（**当前为空**：新加按钮请先补尺寸；确有理由则在此登记并写原因）
const ALLOW_NEW = [];
const SCALE = 390 / 720;
export function collect(src) {
  const out = [];
  // makeButton(id, x, y, w, h, …)：x/y 可能是表达式 ⇒ 用一个参数通配跳过它们
  for (const m of src.matchAll(/makeButton\(\s*"([^"]+)"\s*,\s*[^,]+,\s*[^,]+,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/g)) {
    out.push({ name: m[1], w: Number(m[2]), h: Number(m[3]) });
  }
  return out;
}
export function analyze(src) {
  const fails = [];
  const now = collect(src);
  const base = new Map(BASE.map((x) => [x.name, Math.min(x.w, x.h)]));
  const small = [];
  for (const c of now) {
    const short = Math.min(c.w, c.h);
    const b = base.get(c.name);
    if (b !== undefined && short < b) fails.push(`控件「${c.name}」短边从 ${b} 缩到 ${short} 逻辑px（${(short * SCALE).toFixed(1)} CSS px）`);
    if (b === undefined && short < FLOOR && !ALLOW_NEW.some((a) => a.name === c.name)) {
      fails.push(`新控件「${c.name}」短边只有 ${short} 逻辑px（${(short * SCALE).toFixed(1)} CSS px < 44）⇒ 请补尺寸或登记到 ALLOW_NEW`);
    }
    if (short < FLOOR) small.push({ name: c.name, w: c.w, h: c.h, css: +(short * SCALE).toFixed(1) });
  }
  return { fails, now, small, base };
}
const isMain = process.argv[1] && /tap-target-check\.mjs$/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain && process.argv.includes('--selftest')) {
  const real = readFileSync(F_MASTER, 'utf8');
  const a = analyze(real);
  const b = analyze(real + '\nvar _x = makeButton("_newtiny", 10, 10, 60, 40, "x", function () {});\n');
  // 夹具 C：把 homeguide 的高度 44 → 40（唯一字面量），应触发"变矮"判据
  const c = analyze(real.replace('makeButton("homeguide", 496, 6, 100, 44', 'makeButton("homeguide", 496, 6, 100, 40'));
  const cases = [
    ['阳性A：真实母版原样（不应有 FAIL）', a.fails.length === 0],
    ['阴性B：新增一个 60×40 的小按钮（必须 FAIL）', b.fails.length > 0],
    ['阴性C：把某个控件改矮（必须 FAIL）', c.fails.length > 0],
  ];
  let bad = 0;
  for (const [n, ok] of cases) { console.log((ok ? '✅' : '❌') + ' ' + n + ' ⇒ ' + ok); if (!ok) bad++; }
  if (b.fails.length) console.log('      · ' + b.fails[0]);
  if (c.fails.length) console.log('      · ' + c.fails[0]);
  console.log(bad ? '\n✗ 自测失败' : '\n✅ 触控目标锁自测通过（3 组样本）');
  process.exit(bad ? 1 : 0);
}
if (isMain) {
  const r = analyze(readFileSync(F_MASTER, 'utf8'));
  console.log(`  具名控件 ${r.now.length} 个 · 短边 <44 CSS px（${FLOOR} 逻辑px）的 ${r.small.length} 个：`);
  for (const s of r.small.sort((a, b) => a.css - b.css)) {
    console.log(`    ${s.name.padEnd(16)} ${String(s.w).padStart(4)}×${String(s.h).padEnd(4)} ⇒ 短边 ${String(s.css).padStart(4)} CSS px（${(s.css * 0.183).toFixed(1)} mm）`);
  }
  const worst = r.small.length ? r.small.reduce((a, b) => (a.css < b.css ? a : b)) : null;
  if (worst) console.log(`  ⚠ 待拍板清单：上面 ${r.small.length} 个低于通行下限（最紧 ${worst.name} ${worst.css} CSS px）；扩命中区需 gap-aware（静态算不全）⇒ 见 PM §18`);
  if (r.fails.length) { for (const f of r.fails) console.log('❌ ' + f); console.log('\n结论：FAIL'); process.exit(1); }
  console.log('\n结论：PASS —— 触控目标没有变小，也没有新增偏小控件（偏低清单已登记）');
}
