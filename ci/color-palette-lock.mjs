import { readFileSync } from 'node:fs';
// ci/color-palette-lock.mjs —— 卡道配色锁 + 色觉可达性台账（第 68 轮）
//
// 为什么不是"色盲判据"而是"锁+台账"：本轮实测**换色解决不了**这个问题（见台账里的扫描结论），
//   而给卡面加文字/图标是一次视觉改动（备案截图要换版）⇒ 属待拍板事项。
//   在拍板之前，这里能做且该做的是：**配色一旦变动就必须重新审查**（否则色觉结论会悄悄失效）。
//
// 判据：
//   1. 母版里六个"卡道色"的取值必须与台账一致（改了即 FAIL，提示重跑审查）；
//   2. 重算正常/deutan/protan 三模式下的两两 ΔE(OKLab×100)，写入报告；
//   3. **已知缺口显式登记**（KNOWN）：赤↔橙 在色盲下 <7 —— 台账里写明它是"已知且待修"，
//      这样将来有人看到 FAIL 之前先看到"这是登记过的缺口"，而不是以为判据坏了。
// 自证 --selftest：3 组样本（改一个色值必须 FAIL / 原样必须 PASS / 已知缺口必须出现在报告里）+ 真实母版。

const F_MASTER = process.env.MASTER || 'game/萌兽消消岛.html';
const LANES = [
  {
    "name": "武器",
    "key": "cardLaneWeapon",
    "hex": "#e6c24a"
  },
  {
    "name": "战斗",
    "key": "cardLaneCombat",
    "hex": "#c0392b"
  },
  {
    "name": "被动",
    "key": "cardLanePassive",
    "hex": "#3a7bd5"
  },
  {
    "name": "跟宠",
    "key": "(字面量 cardLaneColor 内)",
    "hex": "#c4782a"
  },
  {
    "name": "进化",
    "key": "(同武器道)",
    "hex": "#e6c24a"
  },
  {
    "name": "装备",
    "key": "(字面量 cardLaneColor 内)",
    "hex": "#3faf5a"
  }
];
// 已知缺口（本轮实测 + 候选扫描）：红绿色盲下"赤(战斗)↔橙(跟宠)"塌陷；换色路线已被证伪。
const KNOWN = [
  {
    "pair": "战斗↔跟宠",
    "deutan": 4.2,
    "protan": 5.3,
    "normal": 13.6,
    "why": "红绿色盲塌红绿轴；候选色扫描 8 个橙色最差 ΔE 仅 1.8–7.4 ⇒ 换色解决不了，需冗余文字/图标通道（待拍板，会让备案截图换版）"
  }
];

const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const hex2rgb = (h) => { const s = h.replace('#', ''); const n = s.length === 3 ? s.split('').map((x) => x + x).join('') : s; return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255); };
const SIM = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  deutan: [[0.6250, 0.3750, 0.0], [0.7000, 0.3000, 0.0], [0.0, 0.3000, 0.7000]],
  protan: [[0.5667, 0.4333, 0.0], [0.5583, 0.4417, 0.0], [0.0, 0.2417, 0.7583]],
};
const sim = (rgb, M) => { const l = rgb.map(lin); const o = M.map((r) => r[0] * l[0] + r[1] * l[1] + r[2] * l[2]); return o.map((v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055)); };
const oklab = (rgb) => {
  const [r, g, b] = rgb.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
};
export const dE = (a, b) => { const A = oklab(a), B = oklab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]) * 100; };
export function matrix(lanes) {
  const out = {};
  for (const mode of ['normal', 'deutan', 'protan']) {
    for (let i = 0; i < lanes.length; i++) for (let j = i + 1; j < lanes.length; j++) {
      const key = lanes[i].name + '↔' + lanes[j].name;
      (out[key] = out[key] || {})[mode] = +dE(sim(hex2rgb(lanes[i].hex), SIM[mode]), sim(hex2rgb(lanes[j].hex), SIM[mode])).toFixed(1);
    }
  }
  return out;
}
export function analyze(src) {
  const fails = [];
  const found = {};
  const gw = /cardLaneWeapon\s*:\s*"(#[0-9a-fA-F]{3,8})"/.exec(src);
  const gc = /cardLaneCombat\s*:\s*"(#[0-9a-fA-F]{3,8})"/.exec(src);
  const gp = /cardLanePassive\s*:\s*"(#[0-9a-fA-F]{3,8})"/.exec(src);
  if (!gw || !gc || !gp) fails.push('读不到三个 cardLane* 色值（改名了？）');
  else {
    found['武器'] = gw[1]; found['战斗'] = gc[1]; found['被动'] = gp[1];
    found['进化'] = gw[1];
    const pet = /lane === "pet"\s*\)\s*return\s*"(#[0-9a-fA-F]{3,8})"/.exec(src);
    const gear = /lane === "gear"\s*\)\s*return\s*"(#[0-9a-fA-F]{3,8})"/.exec(src);
    if (!pet || !gear) fails.push('读不到跟宠/装备的卡道色（cardLaneColor 改写了？）');
    else { found['跟宠'] = pet[1]; found['装备'] = gear[1]; }
  }
  for (const l of LANES) {
    if (found[l.name] && found[l.name].toLowerCase() !== l.hex.toLowerCase()) {
      fails.push(`卡道色「${l.name}」变了：台账 ${l.hex} → 实际 ${found[l.name]} ⇒ 必须重跑色觉审查并更新台账（含 KNOWN）`);
    }
  }
  const lanes = LANES.map((l) => ({ name: l.name, hex: found[l.name] || l.hex }));
  return { fails, lanes, m: matrix(lanes) };
}

const isMain = process.argv[1] && /color-palette-lock\.mjs$/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain && process.argv.includes('--selftest')) {
  const real = readFileSync(F_MASTER, 'utf8');
  const a = analyze(real);
  const b = analyze(real.replace('cardLaneCombat: "#c0392b"', () => 'cardLaneCombat: "#cc3333"'));
  const c = analyze(real);
  const knownHit = Object.keys(c.m).some((k) => c.m[k].deutan < 7 && KNOWN.some((x) => k === x.pair));
  const cases = [
    ['阳性A：真实母版原样', a.fails.length === 0, true],
    ['阴性B：改动战斗卡道色', b.fails.length > 0, true],
    ['阳性C：已知缺口出现在报告里', knownHit, true],
  ];
  let bad = 0;
  for (const [name, got, want] of cases) {
    const ok = got === want;
    console.log(`${ok ? '✅' : '❌'} ${name} ⇒ ${got}`);
    if (!ok) bad++;
  }
  if (a.fails.length) for (const f of a.fails) console.log('      · ' + f);
  console.log(bad ? '\n✗ 自测失败' : '\n✅ 配色锁自测通过（3 组样本）');
  process.exit(bad ? 1 : 0);
}
if (isMain) {
  const r = analyze(readFileSync(F_MASTER, 'utf8'));
  console.log('  卡道色 → OKLab ΔE×100（normal / deutan / protan）：');
  for (const k of Object.keys(r.m)) {
    const v = r.m[k];
    const flag = v.deutan < 7 || v.protan < 7 ? ' ⚠' : '';
    console.log(`    ${k.padEnd(12)} ${String(v.normal).padStart(5)} / ${String(v.deutan).padStart(5)} / ${String(v.protan).padStart(5)}${flag}`);
  }
  console.log('  已知缺口（登记在案，待拍板：加冗余文字/图标通道）：');
  for (const x of KNOWN) console.log(`    ${x.pair}：deutan ${x.deutan} / protan ${x.protan}（正常 ${x.normal}）—— ${x.why}`);
  if (r.fails.length) { for (const f of r.fails) console.log('❌ ' + f); console.log('\n结论：FAIL'); process.exit(1); }
  console.log('\n结论：PASS —— 卡道配色与台账一致（色觉缺口已登记）');
}
