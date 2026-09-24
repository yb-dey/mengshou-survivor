import { readFileSync } from 'node:fs';
// ci/text-scale-check.mjs —— 文字层级判据（第 65 轮新增；第 108 轮加严）
//
// 存在理由（第 65 轮实测）：逻辑画布 720 宽映射到 390pt 手机 ⇒ ×0.5417。于是
//   12px 逻辑 = 6.5 CSS px ≈ 1.2 mm 字身、15px = 8.1 ≈ 1.5 mm、18px = 9.8 ≈ 1.8 mm。
//   而微信小游戏的常见正文在 750 设计宽下是 24–30px（≈12–15 CSS px ≈ 2.3–3 mm）——
//   **我们的说明性文字只有平台惯例的一半左右**（对中老年用户尤其不友好）。
//
// 第 65 轮的处置（v1.206）：
//   · **抬档**：设置页帮助行与「怎么玩」帮助页 15→17、16→18、18/19→21px（容器宽松、读一次、无截断风险）；
//   · **不动**：战斗 HUD（走 `hudFitText` 截断，字号一抬就先出"…"，要改需专门排版）、
//     合规公告带（正文是一整行 56 字，12px 已贴满 720 宽，抬 1px 即溢出，要改需重排整条）；
//   · **登记**：其余 <12px 站点进**例外台账**（下面 ALLOW），每条写清它是什么、为什么保持小号。
//
// ⚠ 第 108 轮加严的原因（诚实记录）：本文件从第 65 轮起就在标题里写着"每条写清理由"，
//   而 ALLOW 里 **16 条一条都没写**，PASS 行却照样打印「（每条都有理由）」——
//   **门禁在替台账吹牛**。现在理由由代码强制检查（缺 why / 条目失效都 FAIL），
//   且理由**只许抄源码裁决**：源码里没有裁决的，如实写"无明文裁决 · 历史存量"，
//   让"没有理由的小号字"是**看得见的债**，而不是藏在台账里假装有理由。
//
// 判据：任何 `ctx.font = "… Npx …"` 的 N < 12 **且不在台账里** ⇒ FAIL；
//   台账里缺 `why`、或某条在源码里已找不到对应站点（失效）⇒ 同样 FAIL。
//   台账按"绘制调用片段"匹配（不用行号，避免漂移）。
//
// 自证 `--selftest`：合成阴性/阳性样本 + **台账两项**（缺 why / 全失效）+ 真实母版（含台账健康度）。
//   `--reasons`：逐条打印被容许的站点在哪一行、上方 6 行内最近的注释是什么（写理由时抄它）。
//
// ⚠⚠ 做**主路径**阴性对照的正确姿势（我踩过，写在这里防复发）：
//   `MASTER=<临时母版路径> node ci/text-scale-check.mjs` —— F_MASTER 支持环境变量覆盖，
//   造一个只含 9px 未登记文字的临时母版就能让主路径 FAIL，或造一个没有任何小字的母版让台账**全失效**。
//   ⛔ 绝不要再"把本文件复制一份改名跑"：下面 isMain 的正则**只认文件名 text-scale-check.mjs**，
//     改名副本会**静默 exit 0**（什么都没检查却看起来通过了）；
//   ⛔ 更不要用 PowerShell 的 `Get-Content -Raw` + `WriteAllText` 去改本文件——
//     那条路会用系统旧代码页读 UTF-8，中文全变乱码、文件直接语法错误（第 108 轮实测）。

const F_MASTER = process.env.MASTER || 'game/萌兽消消岛.html';
const FLOOR = 12;
const ALLOW = [
  // 【第 108 轮】给每一条补 `why`（门禁从此强制要求）。规矩：**理由抄源码裁决，不编**。
  { "px": 10, "label": "（未找到紧随的绘制调用）", "count": 1, "why": "L4878 装备条图标下：该 font 赋值后 12 行内没有绘制调用 ⇒ 只用于量宽/占位，不落像素" },
  { "px": 11, "label": "hudFitText(ctx", "count": 4, "why": "L7255/L28570/L33654/L33759 窄条里的次要信息：宽度由 hudFitText 截断兜底，无明文裁决 · 历史存量" },
  { "px": 9, "label": "\"珠\"", "count": 1, "why": "L26152 裁决原文：【v1.180】世界「珠」字更小更淡, 不抢杂兵剪影; 获取条仍走 obtainFx" },
  { "px": 11, "label": "\"走近才捡\"", "count": 1, "why": "L26302 场物提示短句：无明文裁决 · 历史存量（大厅那枚常驻提示已在 v1.210s 抬到 19px，此处是另一处）" },
  { "px": 11, "label": "（未找到紧随的绘制调用）", "count": 1, "why": "L27775 同 L4878：只量宽不绘制，无明文裁决 · 历史存量" },
  { "px": 11, "label": "this.sub", "count": 1, "why": "L28538 按钮副标：尺寸受按钮盒约束，无明文裁决 · 历史存量" },
  { "px": 11, "label": "col.sub", "count": 1, "why": "L29758 升级卡列副标（卡片高度固定），无明文裁决 · 历史存量" },
  { "px": 11, "label": "rn.desc", "count": 1, "why": "L30008 结算行说明（同处注释只讲了配色改值，未裁决字号）· 历史存量" },
  { "px": 11, "label": "col.sub.length > 20 ? col.sub.slice(0", "count": 1, "why": "L31318 列副标的长句分支（自行截断到 20 字），无明文裁决 · 历史存量" },
  { "px": 10, "label": "hudFitText(ctx", "count": 1, "why": "L33670 裁决原文：【v1.174】选它当口：分支决策依据（此前只有 3–4 字 feel，玩家无法据此选）" },
  { "px": 11, "label": "chip", "count": 1, "why": "L33765 小签文字，无明文裁决 · 历史存量" },
  { "px": 11, "label": "d.tagline", "count": 1, "why": "L33966 跟宠标语（卡片第二行），无明文裁决 · 历史存量" },
  { "px": 11, "label": "sheet.wpn", "count": 1, "why": "L33985 立绘武器名，无明文裁决 · 历史存量" },
  {
    // 【第 105 轮】原来登记的是 `sel ? "出战中" : "点选"`。v1.210q 把选中态那句文案改成「使用中」
    //   （因为它宣称"出战中"、实际那个签改的是**大厅**地面，不决定出战地面）——
    //   **字号没动、依然 11px**，但台账是**按源码原文匹配**的，改字即失效 ⇒ 云端 #35 门禁连红四个提交。
    //   这里把台账同步到新原文：例外依旧成立（同一枚小状态签、同样 11px），理由不变。
    //   （教训：改**玩家可见的字符串**时，先 grep 它在 `ci/` 里有没有被当锚点/台账键。）
    "px": 11,
    "label": "sel ? \"使用中\" : \"点选\"",
    "count": 1,
    "why": "L34237 主题签状态字（第 105 轮把「出战中」改为「使用中」时同步过台账键；字号未动）· 历史存量"
  },
  { "px": 10, "label": "th.tag || \"\"", "count": 1, "why": "L34255 主题签名：芯片内第三行，可用竖向空间只有 r.h-16 到 r.h-5 这一段 · 历史存量" },
  { "px": 10, "label": "\"×3\"", "count": 1, "why": "L34429 可合成次数徽标：画在 36×16 的圆角盒里，抬高会顶出盒外 · 历史存量" }
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
  return { bad, allowed, ok, seen };
}

// 台账自身的健康度：缺理由 / 已失效（源码里再也找不到对应站点）都要报出来。
// 第 108 轮新增——此前 PASS 行写着「每条都有理由」而实际一条理由都没有。
export function ledgerProblems(allow, seen) {
  const noWhy = allow.filter((a) => !a.why || String(a.why).trim().length < 6);
  const stale = allow.filter((a) => !(seen && seen.get(a.px + '|' + a.label)));
  return { noWhy, stale };
}

// `--reasons`：逐条打印被容许的站点在源码的哪一行、上方 6 行内最近的注释（写 why 时抄它，不要编）
export function allowedSites(src) {
  const lines = src.split('\n');
  return analyze(src).allowed.map((a) => {
    let note = '';
    for (let k = a.line - 2; k >= Math.max(0, a.line - 7); k--) {
      const t = lines[k];
      if (/\/\/|\/\*|\*/.test(t) && t.trim().length > 4) { note = t.trim().slice(0, 90); break; }
    }
    return { ...a, note };
  });
}

const isMain = process.argv[1] && /text-scale-check\.mjs$/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain && process.argv.includes('--reasons')) {
  const src = readFileSync(F_MASTER, 'utf8');
  for (const a of allowedSites(src)) {
    console.log(`  ${a.px}px「${a.label}」 ← 第 ${a.line} 行`);
    console.log(`      上方注释：${a.note || '（上方 6 行内无注释）'}`);
  }
  const { seen } = analyze(src);
  const { noWhy } = ledgerProblems(ALLOW, seen);
  console.log(`\n  台账 ${ALLOW.length} 条 · 没写理由 ${noWhy.length} 条`);
}
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
  // 台账两项阴性（第 108 轮）：**缺 why** 与 **条目失效** 都必须被逮到，否则门禁又在替台账吹牛
  {
    const l1 = ledgerProblems(ALLOW.map((a, i) => (i === 0 ? { px: a.px, label: a.label, count: a.count } : a)), new Map([[ALLOW[0].px + '|' + ALLOW[0].label, 1]]));
    const ok1 = l1.noWhy.length === 1;
    console.log(`${ok1 ? '✅' : '❌'} 阴性D：台账第 1 条抽掉 why ⇒ 缺理由 ${l1.noWhy.length} 条（期望 1）`);
    if (!ok1) bad++;
    const l2 = ledgerProblems(ALLOW, new Map());
    const ok2 = l2.stale.length === ALLOW.length;
    console.log(`${ok2 ? '✅' : '❌'} 阴性E：used 传空（等同源码里一个站点都没有）⇒ 失效 ${l2.stale.length}/${ALLOW.length} 条（期望全部失效）`);
    if (!ok2) bad++;
  }
  try {
    const src = readFileSync(F_MASTER, 'utf8');
    const r = analyze(src);
    const { noWhy, stale } = ledgerProblems(ALLOW, r.seen);
    const clean = !r.bad.length && !noWhy.length && !stale.length;
    console.log(`${clean ? '✅' : '❌'} 真实母版：达标 ${r.ok.length} · 台账 ${r.allowed.length} · **未登记 ${r.bad.length}** · 没写理由 ${noWhy.length} · 失效 ${stale.length}`);
    for (const b of r.bad) console.log(`      · 第 ${b.line} 行 ${b.px}px「${b.label}」`);
    for (const a of noWhy) console.log(`      · 缺理由：${a.px}px「${a.label}」`);
    for (const a of stale) console.log(`      · 已失效：${a.px}px「${a.label}」`);
    if (!clean) bad++;
  } catch (e) { console.log('⚠ 真实母版跳过：' + e.message); }
  console.log(bad ? `\n✗ 自测失败 ${bad} 项` : '\n✅ 文字层级判据自测通过（3 组合成样本 + 台账 2 项阴性 + 真实母版台账健康度）');
  process.exit(bad ? 1 : 0);
}
if (isMain) {
  const src = readFileSync(F_MASTER, 'utf8');
  const r = analyze(src);
  const { noWhy, stale } = ledgerProblems(ALLOW, r.seen);
  const css = (px, w) => (px * (w / 720)).toFixed(1);
  console.log(`  font 赋值：达标(${FLOOR}px+) ${r.ok.length} · 台账 ${r.allowed.length} · **未登记 ${r.bad.length}**`);
  for (const a of r.allowed) console.log(`  · 台账：${a.px}px「${a.label}」（${css(a.px, 390)} CSS px @390pt）`);
  for (const b of r.bad) console.log(`❌ 第 ${b.line} 行 ${b.px}px「${b.label}」< ${FLOOR}px 且未登记（${css(b.px, 390)} CSS px @390pt）`);
  for (const a of noWhy) console.log(`❌ 台账 ${a.px}px「${a.label}」没写 why（"为什么它该保持小号"必须写清；没有裁决就写"无明文裁决 · 历史存量"）`);
  for (const a of stale) console.log(`❌ 台账 ${a.px}px「${a.label}」已失效：源码里找不到这个站点了（改了文案/字号就要同步台账；确实删掉了就该删这条）`);
  const problems = r.bad.length + noWhy.length + stale.length;
  if (problems) {
    console.log(`\n结论：FAIL（未登记 ${r.bad.length} · 缺理由 ${noWhy.length} · 失效 ${stale.length}）—— 要么抬字号，要么在 ci/text-scale-check.mjs 的 ALLOW 里登记并写清理由；文案改了要同步台账键`);
    process.exit(1);
  }
  console.log(`\n结论：PASS —— 所有 <12px 的文字都在台账里，且台账 ${ALLOW.length}/${ALLOW.length} 条都写了理由、没有失效条目`);
}
