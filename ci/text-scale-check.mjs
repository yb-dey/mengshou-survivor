import { readFileSync } from 'node:fs';
// ci/text-scale-check.mjs —— 文字层级判据（第 65 轮新增）
//
// 存在理由（本轮实测）：逻辑画布 720 宽映射到 390pt 手机 ⇒ ×0.5417。于是
//   12px 逻辑 = 6.5 CSS px ≈ 1.2 mm 字身、15px = 8.1 ≈ 1.5 mm、18px = 9.8 ≈ 1.8 mm。
//   而微信小游戏的常见正文在 750 设计宽下是 24–30px（≈12–15 CSS px ≈ 2.3–3 mm）——
//   **我们的说明性文字只有平台惯例的一半左右**（对中老年用户尤其不友好）。
//
// 本轮的处置（v1.206）：
//   · **抬档**：设置页帮助行与「怎么玩」帮助页 15→17、16→18、18/19→21px（容器宽松、读一次、无截断风险）；
//   · **不动**：战斗 HUD（走 `hudFitText` 截断，字号一抬就先出"…"，要改需专门排版）、
//     合规公告带（正文是一整行 56 字，12px 已贴满 720 宽，抬 1px 即溢出，要改需重排整条）；
//   · **登记**：其余 <12px 站点进**例外台账**（下面 ALLOW），每条写清它是什么、为什么保持小号。
//
// 判据：任何 `ctx.font = "… Npx …"` 的 N < 12 **且不在台账里** ⇒ FAIL。
//   台账按"绘制调用片段"匹配（不用行号，避免漂移）。改动文案/字号时若台账失配会一并报出来。
// 自证 `--selftest`：3 组合成样本（10px 未登记必须 FAIL / 10px 已登记必须 PASS / 12px 必须 PASS）+ 真实母版 PASS。

const F_MASTER = process.env.MASTER || 'game/萌兽消消岛.html';
const FLOOR = 12;
const ALLOW = [
  {
    "px": 10,
    "label": "（未找到紧随的绘制调用）",
    "count": 1
  },
  {
    "px": 11,
    "label": "hudFitText(ctx",
    "count": 4
  },
  {
    "px": 9,
    "label": "\"珠\"",
    "count": 1
  },
  {
    "px": 11,
    "label": "\"走近才捡\"",
    "count": 1
  },
  {
    "px": 11,
    "label": "（未找到紧随的绘制调用）",
    "count": 1
  },
  {
    "px": 11,
    "label": "this.sub",
    "count": 1
  },
  {
    "px": 11,
    "label": "col.sub",
    "count": 1
  },
  {
    "px": 11,
    "label": "rn.desc",
    "count": 1
  },
  {
    "px": 11,
    "label": "col.sub.length > 20 ? col.sub.slice(0",
    "count": 1
  },
  {
    "px": 10,
    "label": "hudFitText(ctx",
    "count": 1
  },
  {
    "px": 11,
    "label": "chip",
    "count": 1
  },
  {
    "px": 11,
    "label": "d.tagline",
    "count": 1
  },
  {
    "px": 11,
    "label": "sheet.wpn",
    "count": 1
  },
  {
    // 【第 105 轮】原来登记的是 `sel ? "出战中" : "点选"`。v1.210q 把选中态那句文案改成「使用中」
    //   （因为它宣称"出战中"、实际那个签改的是**大厅**地面，不决定出战地面）——
    //   **字号没动、依然 11px**，但台账是**按源码原文匹配**的，改字即失效 ⇒ 云端 #35 门禁连红四个提交。
    //   这里把台账同步到新原文：例外依旧成立（同一枚小状态签、同样 11px），理由不变。
    //   （教训：改**玩家可见的字符串**时，先 grep 它在 `ci/` 里有没有被当锚点/台账键。）
    "px": 11,
    "label": "sel ? \"使用中\" : \"点选\"",
    "count": 1
  },
  {
    "px": 10,
    "label": "th.tag || \"\"",
    "count": 1
  },
  {
    "px": 10,
    "label": "\"×3\"",
    "count": 1
  }
];

export function analyze(src) {
  const lines = src.split('\n');
  const bad = [], allowed = [], ok = [];
  const seen = new Map();   // ⚠ 计数必须**每次调用重置**：早先直接写在 ALLOW 上，导致自测里第二次 analyze 误报（状态泄漏）
  lines.forEach((L, i) => {
    const m = /\.font\s*=\s*["'`]([^"'`]+)["'`]/.exec(L);
    if (!m) return;
    const s = /(\d+(?:\.\d+)?)px/.exec(m[1]);
    if (!s) return;
    const px = Number(s[1]);
    if (px >= FLOOR) { ok.push({ px, line: i + 1 }); return; }
    let label = '';
    for (let k = i; k < Math.min(lines.length, i + 12); k++) {
      const t = /(?:fill|stroke)Text\(\s*([^,]+),/.exec(lines[k]);
      if (t) { label = t[1].trim().slice(0, 40); break; }
    }
    const rec = { px, label: label || '（未找到紧随的绘制调用）', line: i + 1 };
    const hit = ALLOW.find((a) => a.px === px && a.label === rec.label);
    // ⚠ 台账按 (px, 标签, 条数) 计数比对：同标签多出来的**新**站点仍会 FAIL（否则新加的小字会冒用旧台账）。
    if (hit) {
      const k = px + '|' + rec.label;
      const n = (seen.get(k) || 0) + 1;
      seen.set(k, n);
      (n <= hit.count ? allowed : bad).push(rec);
    } else bad.push(rec);
  });
  return { bad, allowed, ok };
}

const isMain = process.argv[1] && /text-scale-check\.mjs$/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain && process.argv.includes('--selftest')) {
  const cases = [
    { name: '阴性A：10px 正文且未登记', src: 'function d(ctx){ ctx.font = "10px X"; ctx.fillText("说明文字", 1, 2); }', wantFail: true },
    { name: '阳性C：12px 达标', src: 'function d(ctx){ ctx.font = "12px X"; ctx.fillText("正文", 1, 2); }', wantFail: false },
  ];
  // 阳性B 从**台账自身**取一条"引号包裹"的标签来构造（生成期不插值，避免引用生成器作用域的变量）
  const pick = ALLOW.find((a) => /^".*"$/.test(a.label));
  if (pick) cases.push({ name: '阳性B：' + pick.px + 'px 且已在台账里', src: 'function d(ctx){ ctx.font = "' + pick.px + 'px X"; ctx.fillText(' + pick.label + ', 1, 2); }', wantFail: false });
  else console.log('⚠ 台账里没有引号包裹的标签，跳过阳性B');
  let bad = 0;
  for (const c of cases) {
    const r = analyze(c.src);
    const failed = r.bad.length > 0;
    const good = failed === c.wantFail;
    console.log(`${good ? '✅' : '❌'} ${c.name} ⇒ ${failed ? 'FAIL' : 'PASS'}（期望 ${c.wantFail ? 'FAIL' : 'PASS'}）`);
    for (const b of r.bad) console.log(`      · 第 ${b.line} 行 ${b.px}px「${b.label}」未登记`);
    if (!good) bad++;
  }
  try {
    const r = analyze(readFileSync(F_MASTER, 'utf8'));
    console.log(`${r.bad.length ? '❌' : '✅'} 真实母版：达标 ${r.ok.length} · 台账 ${r.allowed.length} · **未登记 ${r.bad.length}**`);
    for (const b of r.bad) console.log(`      · 第 ${b.line} 行 ${b.px}px「${b.label}」`);
    if (r.bad.length) bad++;
  } catch (e) { console.log('⚠ 真实母版跳过：' + e.message); }
  console.log(bad ? `\n✗ 自测失败 ${bad} 项` : '\n✅ 文字层级判据自测通过（3 组合成样本 + 真实母版）');
  process.exit(bad ? 1 : 0);
}
if (isMain) {
  const r = analyze(readFileSync(F_MASTER, 'utf8'));
  const css = (px, w) => (px * (w / 720)).toFixed(1);
  console.log(`  font 赋值：达标(${FLOOR}px+) ${r.ok.length} · 台账 ${r.allowed.length} · **未登记 ${r.bad.length}**`);
  for (const a of r.allowed) console.log(`  · 台账：${a.px}px「${a.label}」（${css(a.px, 390)} CSS px @390pt）`);
  if (r.bad.length) {
    for (const b of r.bad) console.log(`❌ 第 ${b.line} 行 ${b.px}px「${b.label}」< ${FLOOR}px 且未登记（${css(b.px, 390)} CSS px @390pt）`);
    console.log(`\n结论：FAIL（${r.bad.length} 条未登记）—— 要么抬字号，要么在 ci/text-scale-check.mjs 的 ALLOW 里登记并写理由`);
    process.exit(1);
  }
  console.log('\n结论：PASS —— 所有 <12px 的文字都在台账里（每条都有理由）');
}
