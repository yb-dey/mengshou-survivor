// lane-tag-channel.mjs —— 「卡道类型必须有不依赖颜色的文字通道」（GATE · 第 75 轮）
//
// 背景（第 68 轮 §17.4 的结论被本轮推翻）：
//   静态色觉审查测出 战斗(赤 #c0392b) ↔ 跟宠(橙 #c4782a) 在红绿色盲下 ΔE 只有 4.2（正常 13.6），
//   于是建议"给四类各加一个短标签"。**但那条建议的前提是错的** —— 我当轮只看到「装备/进化」在用
//   `tag` 通道，没查升级选项构造器：
//     L6480 武器·升星/满星 · L6497 武器·新 · L6512 被动·新/升星/满级 ·
//     L6523 战斗·立刻回血/主动炸弹/关掉卡后 · L6552 战斗·进化/超进化 · L6567 跟宠·升星/满星
//   而且卡面用 **bold 18px** 把它画在左上角（L29132-29136）—— 比正文 12px 下限还大。
//   出图复核（_qc/shots-v1207c 的 04-升级三选一）肉眼可见：「武器·升星」「武器·新」「被动·新」。
//   ⇒ 该缺口**早已被既有文字通道缓解**，不需要动视觉，更不需要为此重出备案截图。
//
// 本判据的任务：把"类型不依赖颜色"这件事**锁住** —— 以后谁把标签前缀去掉、或新增一类没有前缀的
//   选项，就必须在这里红，而不是悄悄退回"只能靠颜色分辨"。
//
// 判据：
//   A. 四个卡道（武器/战斗/被动/跟宠）各自至少有一条带该前缀的标签字面量；
//   B. 选项构造器区域里的**每条**标签字面量都必须以已知前缀开头（武器/战斗/被动/跟宠/装备/升级/超武）；
//   C. 卡面确实把这个标签**画出来**（存在 `ctx.fillText(card.tag` 且字号 ≥ 14px）。
//
// 阴性对照（--selftest）：① 真实母版必须 PASS；② 抹掉某条前缀 ⇒ FAIL；③ 抹掉整个跟宠前缀 ⇒ FAIL；
//   ④ 把字号改小到 11px ⇒ FAIL。
import { readFileSync } from 'node:fs';
const F_MASTER = process.env.MASTER || 'game/萌兽消消岛.html';
const LANES = ['武器', '战斗', '被动', '跟宠'];
const KNOWN = LANES.concat(['装备', '升级', '超武', '分叉']);
const SRC_SCAN_FROM = 6400, SRC_SCAN_TO = 6700;   // 选项构造器区域（buildOption 一类）

export function analyze(src) {
  const fails = [];
  const region = src.split('\n').slice(SRC_SCAN_FROM - 1, SRC_SCAN_TO).join('\n');
  // 选项标签：`out.tag = "…"` 之类的赋值右侧字面量（含三元里的多个字面量）
  const lits = [...region.matchAll(/tag\s*=\s*([^;]+);/g)]
    .flatMap((m) => [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]))
    // 只留展示用字面量：三元条件里的选项 id（newPassive / drumstick / bomb）是 ASCII，标签一律含中文
    .filter((t) => /[\u4e00-\u9fff]/.test(t));
  if (!lits.length) fails.push('选项构造器区域里一条 tag 字面量都没找到（区域锚点可能已失效，请重新定位）');
  // A. 四道覆盖
  for (const lane of LANES) {
    if (!lits.some((t) => t.startsWith(lane))) fails.push(`卡道「${lane}」没有任何带该前缀的标签字面量 ⇒ 该类型只能靠颜色分辨`);
  }
  // B. 每条都必须有已知前缀
  const bad = lits.filter((t) => !KNOWN.some((k) => t.startsWith(k)));
  if (bad.length) fails.push(`这些标签没有类型前缀（色觉玩家无法判断类型）：${bad.slice(0, 4).map((t) => '"' + t + '"').join(' / ')}`);
  // C. 卡面画出标签且字号达 14px+
  if (!/ctx\.fillText\(card\.tag/.test(src)) fails.push('卡面没有把 card.tag 画出来（fillText(card.tag …) 找不到）');
  const fontM = /ctx\.font\s*=\s*"bold\s+(\d+)px\s*"\s*\+\s*FONT_STACK;\s*\n\s*ctx\.textAlign\s*=\s*"left";\s*\n\s*ctx\.textBaseline\s*=\s*"top";\s*\n\s*ctx\.fillText\(card\.tag/.exec(src);
  if (!fontM) fails.push('找不到 card.tag 的绘制字号（可能被改动 ⇒ 请人工确认标签仍清晰可读）');
  else if (Number(fontM[1]) < 14) fails.push(`card.tag 字号只有 ${fontM[1]}px（<14px）⇒ 作为"不依赖颜色"的通道太弱`);
  return { fails, lits: lits.length, lanes: LANES.filter((l) => lits.some((t) => t.startsWith(l))), font: fontM ? Number(fontM[1]) : null };
}
const isMain = process.argv[1] && /lane-tag-channel\.mjs$/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain && process.argv.includes('--selftest')) {
  const real = readFileSync(F_MASTER, 'utf8');
  const a = analyze(real);
  const b = analyze(real.replace('out.tag = "武器·新";', 'out.tag = "新";'));
  const c = analyze(real.replace(/"跟宠·/g, '"'));                       // 真的抹掉「跟宠·」前缀
  const d = analyze(real.replace(/ctx\.font = "bold 18px " \+ FONT_STACK;\n  ctx\.textAlign = "left";\n  ctx\.textBaseline = "top";\n  ctx\.fillText\(card\.tag/, 'ctx.font = "bold 11px " + FONT_STACK;\n  ctx.textAlign = "left";\n  ctx.textBaseline = "top";\n  ctx.fillText(card.tag'));
  const cases = [
    ['阳性A：真实母版（类型标签齐备）', a.fails.length === 0],
    ['阴性B：抹掉「武器」前缀（必须 FAIL）', b.fails.length > 0],
    ['阴性C：抹掉整个「跟宠」前缀（必须 FAIL）', c.fails.length > 0],
    ['阴性D：把标签字号改到 11px（必须 FAIL）', d.fails.length > 0],
  ];
  let bad = 0;
  for (const [n, ok] of cases) { console.log((ok ? '✅' : '❌') + ' ' + n + ' ⇒ ' + ok); if (!ok) bad++; }
  for (const r of [b, c, d]) if (r.fails.length) console.log('      · ' + r.fails[0]);
  console.log(bad ? '\n✗ 自测失败' : `\n✅ 卡道文字通道自测通过（4 组）· 标签字面量 ${a.lits} 条 · 覆盖 ${a.lanes.join('/')} · 字号 ${a.font}px`);
  process.exit(bad ? 1 : 0);
}
if (isMain) {
  const r = analyze(readFileSync(F_MASTER, 'utf8'));
  console.log(`  标签字面量 ${r.lits} 条 · 覆盖卡道 ${r.lanes.join(' / ')} · 卡面字号 ${r.font}px`);
  if (r.fails.length) { for (const f of r.fails) console.log('❌ ' + f); console.log('\n结论：FAIL'); process.exit(1); }
  console.log('\n结论：PASS —— 四类卡道都有 ≥14px 的粗体文字标签，类型不依赖色觉');
}
