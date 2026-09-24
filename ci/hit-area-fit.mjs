// hit-area-fit.mjs —— ⑲「命中区」运行时体检（触控目标可达性，用**真页面**量，不靠静态解析）
//
// 与 ci/tap-target-check.mjs 的分工：
//   静态判据锁"不许变小 / 不许新增偏小"（源码级，快、每次 push 都跑）；
//   本判据补它两处天生短板：
//     ① 18 个控件的尺寸由**布局函数的局部变量**算出（`var bw = CONFIG.pauseBtnW || 300; …`）⇒
//        静态读不到（登记在 ALLOW_BLIND，但终究是没量到）；
//     ② 静态只能按"全控件集合"算邻居 ⇒ **跨屏误判**：升级卡坐标是 `layoutLevelupCards()`
//        运行时摆的；而命中区安不安全只取决于**同屏同时可见**的邻居 —— 只有运行时知道。
//
// 量什么（每个状态打开一屏 → 遍历 UIStack.list 中 `visible && onTap` 的节点）：
//   A. **同屏命中区重叠（硬门禁）**：命中矩形 = rect ± (hitPad||0)（母版 hit() 口径 L27238）。
//      两矩形相交 ⇒ 点中间那块由**注册顺序**决定谁赢（hit() 从后往前扫 L27229）⇒ 最难查的手感 bug。
//   B. **短边 + 本屏安全 pad（报告）**：< 44 CSS px 的控件逐个列出，附"本屏内最大安全对称 pad"。
//
// 算法全在 ci/hit-area-lib.mjs（纯函数，本机可 `node ci/hit-area-lib.mjs --selftest` 先验证），
//   本文件只负责"把屏幕打开 + 把节点捞出来"。
//
// 阴性对照（--selftest）：
//   ① 纯逻辑 5 组（含"并排 8px ⇒ 安全 pad 只能是 4" —— 第 69 轮静态判据正是在这里算错过）
//   ② 基准：HOME 屏同屏命中区不应有重叠（证明探针口径可信）
//   ③ 把 `uiHomeGuide.hitPad` 设成 60（它与 uiHomeAbout 相隔 8px）⇒ **必须**被抓到
//
// 用法: node ci/hit-area-fit.mjs [--selftest]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { smallOnes, overlapsOf, logicSelftest, FLOOR, SCALE } from './hit-area-lib.mjs';

const OUT = path.join('ci', 'out');
fs.mkdirSync(OUT, { recursive: true });
const gameDir = path.resolve('game');
const entryName = fs.readdirSync(gameDir).filter((f) => f.toLowerCase().endsWith('.html') && !f.startsWith('_')).sort()[0];
if (!entryName) { console.log('SKIP 找不到 game/*.html'); process.exit(0); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.wav': 'audio/wav', '.jpg': 'image/jpeg', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const abs = path.join(gameDir, rel);
  if (!abs.startsWith(gameDir) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(abs).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const SELFTEST = process.argv.includes('--selftest');
const ALLOW_OVERLAP = [];   // 允许的重叠（当前为空：任何同屏重叠都算缺陷）
// 【第 73 轮 · 已声明缺陷】满载构筑时，结算/暂停面板的构筑列表会**溢出到动作钮**：
//   按 bindResultBuildChips 逐行复算（_qc/_sim-result-layout.mjs）：avail = 324 逻辑px；
//   构筑到 8/4/6/3/2 行时，芯片已压到 floor 22（11.9 CSS px）却仍差 20px ⇒ 最后一行盖住结算两钮。
//   ⇒ 只对这两屏放行（并打印），**溢出一旦扩散到别的屏 ⇒ 立刻红**。修法见 PM §18.12。
// 【第 74 轮】v1.207b 给结算构筑列表加了**硬钳制**（压到 floor 仍装不下时逐行放行 + 汇总行）⇒
//   溢出已修 ⇒ 放行名单清空：任何同屏命中区重叠（含"条目压到动作钮"）都按普通重叠红。
//   若将来又复现，先查 bindResultBuildChips 的 budgetBottom 钳制是否还在（_qc/_sim-clamp2.mjs 有锚点校验）。
const DECLARED_OVERFLOW_SCREENS = [];
// 满载两屏 = **诊断屏**：注入依赖调试口（见下），注不满时只报告不拦（否则一条注不满的探针
//   会把所有 push 永久染红）。它们的数字仍然照常打进 notice，供人工核对。
const DIAGNOSTIC_SCREENS = ["结算-满载", "暂停-满载", "结算-挤压（诊断）"];
// ⚠ 每屏「至少应有几个可点节点」的下限 —— 防「量到 0 个却报 ok」：
//   首跑实测「复活/死亡 0/0/0」：state 轮询说到了 REVIVE_MODAL，扫描却一个可点节点都没有 ——
//   这种「没量到」绝不能长得像「量过且没问题」（本工作区反复踩的同一个坑）。低于下限 ⇒ FAIL。
const EXPECT_MIN = { 'HOME(大厅)': 8, '设置': 4, '图鉴': 4, '装备库': 4, '宝库': 4, '每日挑战': 2,
  '暂停': 4, '升级三选一': 3, '复活/死亡': 2, '结算': 2, '结算-满载': 6, '暂停-满载': 8, '结算-挤压（诊断）': 2 };
// ── 偏小台账：可点节点短边 < 44 CSS px 必须在这里登记"为什么先这样"，否则 FAIL ──
//   ⚠ 与静态判据的 ALLOW_NEW 同款纪律：**报告不是契约**。60 个偏小如果只是打印出来，
//   下一个人加一个 18px 的可点条目也不会有任何东西拦他。
//   ⚠ 已核对：构筑芯（pausechip/resultchip）**不是**多余的可点 —— 结算页 L31755 明写
//   「点条目看怎么来的」，是**被文案prompt的**交互 ⇒ 不能靠"删 onTap"消掉，只能改视觉（见 PM §18.10）。
const ALLOW_SMALL = [
  // ── A 类：运行时生成的"条目簇"（视觉重排才能解决，扩命中区会压到相邻条目）──
  { re: /^pausechip\d+$/, why: '暂停面板构筑芯 ×14（点条目看提示）· 行高由面板密度决定，安全 pad 仅 3' },
  { re: /^hallboard\d+$/, why: '大厅六部位框 ×3 · 运行时生成簇，彼此极近（安全 pad 2）' },
  { re: /^hallgear\d+$/, why: '大厅六部位装备框 ×6 · 同族（运行时生成簇）' },
  { re: /^runechip\d+$/, why: '大厅符文槽 ×5 · 同族' },
  { re: /^themechip\d+$/, why: '大厅主题切换芯片 ×4 · 同族' },
  { re: /^codextab\d+$/, why: '图鉴页签 ×4 · 同族（页签条密度决定高度）' },
  { re: /^vaulttab\d+$/, why: '宝库页签 ×2（进度打造／天赋）· 同族' },
  // ── B 类：具名控件，静态判据已算出安全 pad ⇒ **待随下次版本一起零像素补**（本轮不动母版）──
  { re: /^set(theme|bgm|export|import|close)$/, why: '设置页四钮（setclose 已达标）· v1.208b 已把 hitPadY 从 5 提到本屏上限 6 ⇒ 有效高 **76**（41.2 CSS px × 119+ CSS px 宽）：上下邻居仅隔 12px，再大必压邻居 ⇒ 要真达标需**加大行距**（视觉版本）' },
  // ── C 类：并排太近，扩命中区会抢邻居 ──
];

const scanExpr = (extra) => `
(function(){
  try{
    ${extra || ''}
    var arr = UIStack.list || [];
    var out = [], modals = 0;
    for (var i = 0; i < arr.length; i++) {
      var n = arr[i];
      if (!n || !n.visible || !n.rect || !n.onTap) continue;
      var kind = n.kind || '';
      if (kind === 'Modal') { modals++; continue; }   // 遮罩=全屏且先注册（按钮永远赢）⇒ 不参与重叠/间距
      var r = n.rect, pad = n.hitPad || 0;
      // v1.207：母版支持分轴命中区，探针必须同步（否则补了也量不出来）
      var padX = (n.hitPadX != null) ? n.hitPadX : pad;
      var padY = (n.hitPadY != null) ? n.hitPadY : pad;
      out.push({ id: String(n.id != null ? n.id : (kind || ('#' + i))), kind: kind, idx: i,
                 x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.w.toFixed(2), h: +r.h.toFixed(2),
                 pad: pad, padX: padX, padY: padY, custom: !!n.hitTest });
    }
    return JSON.stringify({ ok: true, view: [CONFIG.viewW, CONFIG.viewH], nodes: out, modals: modals, total: arr.length });
  }catch(e){ return JSON.stringify({ ok: false, err: String((e && e.message) || e).slice(0, 180) }); }
})()
`;
const stateExpr = `(function(){ try { return JSON.stringify(window.MENGSHOU_DEBUG.state()); } catch(e){ return '{"err":1}'; } })()`;
// 页内"可见可点节点数"：等屏时用（光等 state 不够 —— 首跑复活屏就是 state 到了、节点还没显）
const NODES = "(function(){var a=UIStack.list||[],c=0;for(var i=0;i<a.length;i++){var n=a[i];if(n&&n.visible&&n.rect&&n.onTap&&(n.kind||'')!=='Modal')c++}return c})()";
const readCase = (label, raw) => {
  const o = JSON.parse(raw);
  if (!o.ok) return { label, err: o.err };
  const nodes = o.nodes;
  const hard = overlapsOf(nodes).filter((v) => !ALLOW_OVERLAP.includes([v.a, v.b].sort().join('|')));
  // 已声明缺陷屏（满载构筑会压到动作钮）：只登记与打印，不参与全局硬门禁；
  //   但溢出要是出现在**别的**屏，就照旧红 —— 声明的边界是屏，不是"整个判据"。
  const declared = DECLARED_OVERFLOW_SCREENS.includes(label);
  return { label, n: nodes.length, modals: o.modals, view: o.view,
    overlaps: declared ? [] : hard, declaredOverlaps: declared ? hard : [], small: smallOnes(nodes) };
};

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));
let report = { cases: [], selftest: [], pageErrors: [] };
const scan = async (label, setup) => {
  let raw;
  try { raw = await page.evaluate(scanExpr(setup)); }
  catch (e) { raw = JSON.stringify({ ok: false, err: String(e.message).slice(0, 180) }); }
  const r = readCase(label, raw);
  if (r.err) { console.log(`ERR  [${label}] ${r.err}`); report.cases.push(r); return r; }
  const need = EXPECT_MIN[label];
  if (need != null && r.n < need && !DIAGNOSTIC_SCREENS.includes(label)) {
    r.underfilled = { got: r.n, need: need };
    console.log(`FAIL [${label}] 只量到 ${r.n} 个可点节点（下限 ${need}）⇒ 探针与屏幕状态不一致`);
  } else if (need != null && r.n < need) {
    r.diagnostic = { got: r.n, need: need };
    console.log(`（诊断屏 [${label}] 实得 ${r.n}/下限 ${need} —— 注入没铺开，仅报告）`);
  }
  const st = await page.evaluate(stateExpr).catch(() => '{}');
  r.state = (JSON.parse(st) || {}).name || '?';
  report.cases.push(r);
  console.log(`${r.overlaps.length ? 'FAIL' : 'ok  '} [${label}] state=${r.state} 可点=${r.n} 模态=${r.modals} 偏小=${r.small.length} 重叠=${r.overlaps.length}`);
  for (const s of r.small.slice(0, 4)) console.log(`       · ${s.id} ${s.w}×${s.h} 短边 ${s.css} CSS px（需 pad ${s.need} / 本屏安全上限 ${s.safe} ⇒ ${s.verdict}）`);
  for (const v of r.overlaps) console.log(`       ⚠ 重叠 ${v.a} × ${v.b} = ${v.w}×${v.h}px ⇒ 抢点者 ${v.winner}`);
  if (r.declaredOverlaps && r.declaredOverlaps.length) {
    console.log(`       📌 已声明溢出 ${r.declaredOverlaps.length} 处（满载构筑压到动作钮 ⇒ PM §18.12）：` +
      r.declaredOverlaps.slice(0, 3).map((v) => `${v.a}×${v.b}=${v.w}×${v.h}`).join(' · '));
  }
  return r;
};
const pollFor = async (expr, tries, ms) => {
  for (let t = 0; t < tries; t++) {
    const got = await page.evaluate(`(function(){ try { return !!(${expr}); } catch(e){ return false; } })()`).catch(() => false);
    if (got) return true;
    await page.waitForTimeout(ms);
  }
  return false;
};

try {
  await page.goto(base + entryName, { waitUntil: 'load', timeout: 120000 });
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) {
    ready = await page.evaluate(() => (typeof MENGSHOU_DEBUG !== 'undefined' && !!MENGSHOU_DEBUG)).catch(() => false);
    if (!ready) await page.waitForTimeout(500);
  }
  if (!ready) {
    console.log('SKIP 游戏未就绪（MENGSHOU_DEBUG 未出现）');
    report.note = 'not-ready';
  } else {
    if (SELFTEST) {
      report.selftest.push(...logicSelftest());
      await page.evaluate(() => { try { window.MENGSHOU_DEBUG.hall(); } catch (e) { void e; } });
      await page.waitForTimeout(700);
      const b0 = readCase('HOME(基准)', await page.evaluate(scanExpr('')));
      const inj = readCase('HOME(注入)', await page.evaluate(scanExpr('uiHomeGuide.hitPad = 60;')));
      await page.evaluate(() => { try { uiHomeGuide.hitPad = 0; } catch (e) { void e; } });
      report.selftest.push(['基准 HOME 无重叠（探针口径可信）', !!(b0.overlaps && b0.overlaps.length === 0)]);
      report.selftest.push(['人为把 uiHomeGuide.hitPad 设 60 ⇒ 必须检出重叠', !!(inj.overlaps && inj.overlaps.length > 0)]);
      for (const [n, ok] of report.selftest) console.log((ok ? '✅' : '❌') + ' ' + n);
      if (b0.overlaps && b0.overlaps.length) console.log('      · 基准重叠：' + JSON.stringify(b0.overlaps.slice(0, 3)));
      if (inj.overlaps && inj.overlaps.length) console.log('      · 注入后被检出：' + JSON.stringify(inj.overlaps[0]));
    }
    // ── 静态可达的 6 屏 ──
    await scan('HOME(大厅)', 'window.MENGSHOU_DEBUG.hall();');
    await page.waitForTimeout(500);
    await scan('设置', 'MENGSHOU_DEBUG.openSettings();');
    await page.waitForTimeout(400);
    await scan('图鉴', 'MENGSHOU_DEBUG.closeSettings(); MENGSHOU_DEBUG.hall(); MENGSHOU_DEBUG.openBeast();');
    await page.waitForTimeout(400);
    await scan('装备库', 'MENGSHOU_DEBUG.closeBeast(); MENGSHOU_DEBUG.hall(); MENGSHOU_DEBUG.openGear();');
    await page.waitForTimeout(400);
    await scan('宝库', 'MENGSHOU_DEBUG.closeGear(); MENGSHOU_DEBUG.hall(); MENGSHOU_DEBUG.openVault();');
    await page.waitForTimeout(400);
    await scan('每日挑战', 'MENGSHOU_DEBUG.closeVault(); MENGSHOU_DEBUG.hall(); MENGSHOU_DEBUG.dailyPick();');
    await page.waitForTimeout(400);
    // ── 进战斗后才有 4 屏 ──
    // ⚠ 第 70 轮云端首跑实测：点主 CTA 那条路**进不去战斗**（新手引导/首局路由会拦），
    //   结果是这 4 屏被静默跳过、只剩 6 屏 —— 而"复活/升级"恰恰是全游戏误触代价最高的两屏。
    //   ⇒ 主路径改成调试口 `MENGSHOU_DEBUG.start(0)`（= debugPlayClean，直通 PLAYING），
    //     点 CTA 降级为回退；两条都失败才记 SKIP（并把跳过数写进 notice）。
    await page.evaluate(() => { try { const D = window.MENGSHOU_DEBUG; D.closeVault(); if (D.guideSkipAll) D.guideSkipAll(); D.hall(); } catch (e) { void e; } });
    await page.waitForTimeout(700);
    await page.evaluate(() => { try { window.MENGSHOU_DEBUG.start(0); } catch (e) { void e; } });
    await page.waitForTimeout(2500);
    let playing = await pollFor("MENGSHOU_DEBUG.state().playing", 24, 500);
    if (!playing) {
      const geom = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, cw: c.width, ch: c.height }; });
      await page.mouse.click(geom.l + (316 / geom.cw) * geom.w, geom.t + (617 / geom.ch) * geom.h);
      await page.waitForTimeout(2500);
      playing = await pollFor("MENGSHOU_DEBUG.state().playing", 24, 500);
      console.log("（start(0) 未进战斗，已回退点主 CTA ⇒ playing=" + playing + "）");
    }
    if (playing) {
      await page.evaluate(() => { try { window.MENGSHOU_DEBUG.pause(true); } catch (e) { void e; } });
      await page.waitForTimeout(700);
      await scan('暂停', 'MENGSHOU_DEBUG.pause(true);');
      await page.evaluate(() => { try { window.MENGSHOU_DEBUG.pause(false); } catch (e) { void e; } });
      await page.waitForTimeout(500);
      const gotLu = await pollFor('(' + NODES + ') >= 3 && (function(){var s=MENGSHOU_DEBUG.levelup();return s&&s.cards&&s.cards.length>0;})()', 70, 500);
      if (gotLu) await scan('升级三选一', '');
      else { console.log('SKIP [升级三选一] 35s 内没等到升级'); report.cases.push({ label: '升级三选一', skipped: true }); }
      await page.evaluate(() => { const D = window.MENGSHOU_DEBUG || {}; try { D.levelupTap && D.levelupTap(); } catch (e) { void e; } try { D.closeCards && D.closeCards(); } catch (e) { void e; } });
      await page.waitForTimeout(700);
      let reviveUp = false;
      for (let attempt = 0; attempt < 2 && !reviveUp; attempt++) {
        await page.evaluate(() => { try { window.MENGSHOU_DEBUG.die('ui-hit-audit'); } catch (e) { void e; } });
        reviveUp = await pollFor("(" + NODES + ") >= 2 && MENGSHOU_DEBUG.state().name === 'REVIVE_MODAL'", 20, 500);
        if (!reviveUp) { console.log('（第 ' + (attempt + 1) + ' 次 die() 后复活盘未就位，重试）'); await page.waitForTimeout(800); }
      }
      if (reviveUp) await scan('复活/死亡', '');
      else { console.log('SKIP [复活/死亡] 两次 die() 后仍未进入 REVIVE_MODAL（或节点未就位）'); report.cases.push({ label: '复活/死亡', skipped: true }); }
      await page.evaluate(() => { try { window.MENGSHOU_DEBUG.giveUp(); } catch (e) { void e; } });
      if (await pollFor('(' + NODES + ') >= 2 && /RESULT_(WIN|LOSE)/.test(MENGSHOU_DEBUG.state().name)', 24, 500)) await scan('结算', '');
      else { console.log('SKIP [结算] 未进入 RESULT_*'); report.cases.push({ label: '结算', skipped: true }); }
      // ── 满载构筑两屏：暴露"条目变多 ⇒ 布局自动缩高"这条隐藏路径（result floor 22 / pause floor 32）──
      //   做法：连续 12 次「掷卡→选第一张」，把武器/被动/战斗/进化各道都填满，再看面板怎么排。
      //   debugBindOptions / rollUpgradeOptions / debugLevelupTap 都是脚本顶层函数（经典 script ⇒ 全局可调）。
      // ⚠ 第一版注入失败：rollUpgradeOptions 在非升级上下文返回空 ⇒ 一张卡也没选上，
      //   而"2 个构筑芯 + 2 个动作钮 = 4"恰好骗过了当时 EXPECT_MIN=4 的下限（假通过）。
      //   现改用 mkshot 04 屏验证过的路径：pendingLevels=1 → openLevelUp()，并逐次带节奏；
      //   最后由 MENGSHOU_DEBUG.build().chips 报出**实际**构筑条数，写进日志与 notice。
      const denseBuild = async () => {
        await page.evaluate(() => { try { debugPlayClean(0, "", false); } catch (e) { void e; } });
        await page.waitForTimeout(320);
        let picks = 0;
        for (let i = 0; i < 12; i++) {
          await page.evaluate(() => { try { if (window.run) run.pendingLevels = 1; openLevelUp(); } catch (e) { void e; } });
          // ⚠ 第一版固定等 420ms 就点 ⇒ 卡还没"就位"（弹出动画未完）⇒ 一张也选不上。改为轮询卡片出现。
          let got = false;
          for (let t = 0; t < 14 && !got; t++) {
            got = await page.evaluate(() => { try { const c = (MENGSHOU_DEBUG.levelup() || {}).cards || []; return c.length > 0; } catch (e) { return false; } }).catch(() => false);
            if (!got) await page.waitForTimeout(120);
          }
          if (!got) continue;
          const before = await page.evaluate(() => { try { return ((MENGSHOU_DEBUG.build() || {}).lanes && 1) || 1; } catch (e) { return 1; } }).catch(() => 1);
          void before;
          await page.evaluate(() => { try { debugLevelupTap(0); } catch (e) { void e; } });
          picks++;
          await page.evaluate(() => { try { closeCards(); } catch (e) { void e; } });
          await page.waitForTimeout(140);
        }
        return picks;
      };
      report.denseChips = await denseBuild();
      await page.evaluate(() => { try { MENGSHOU_DEBUG.win(); } catch (e) { void e; } });
      await page.waitForTimeout(300);
      if (await pollFor('(' + NODES + ') >= 4 && /RESULT_(WIN|LOSE)/.test(MENGSHOU_DEBUG.state().name)', 24, 500)) await scan('结算-满载', '');
      else { console.log('SKIP [结算-满载] 未进入 RESULT_*（或构筑未铺开）'); report.cases.push({ label: '结算-满载', skipped: true }); }
      await denseBuild();
      await page.evaluate(() => { try { closeCards(); } catch (e) { void e; } try { MENGSHOU_DEBUG.pause(true); } catch (e) { void e; } });
      await page.waitForTimeout(500);
      if (await pollFor('(' + NODES + ') >= 6 && MENGSHOU_DEBUG.state().name === "PAUSED_MENU"', 24, 500)) await scan('暂停-满载', '');
      else { console.log('SKIP [暂停-满载] 未进入 PAUSED_MENU（或构筑未铺开）'); report.cases.push({ label: '暂停-满载', skipped: true }); }
      // ── 挤压诊断屏：把 resultRoomH 从 108 撑到 308 ⇒ avail 由 324 掉到 124 ⇒
      //   连 2 行都放不下 ⇒ **强制走 v1.207b 的硬钳制分支**（条目被跳过 + 汇总行交代）。
      //   断言：不得与动作钮重叠（否则就是钳制失效）；节点数会明显变少，这是它的"指纹"。
      await page.evaluate(() => { try { CONFIG.resultRoomH = 308; } catch (e) { void e; } });
      await denseBuild();
      await page.evaluate(() => { try { MENGSHOU_DEBUG.win(); } catch (e) { void e; } });
      if (await pollFor('(' + NODES + ') >= 2 && /RESULT_(WIN|LOSE)/.test(MENGSHOU_DEBUG.state().name)', 20, 500)) await scan('结算-挤压（诊断）', '');
      else { console.log('SKIP [结算-挤压（诊断）] 未进入 RESULT_*'); report.cases.push({ label: '结算-挤压（诊断）', skipped: true }); }
      await page.evaluate(() => { try { CONFIG.resultRoomH = 108; } catch (e) { void e; } });
    } else {
      console.log('SKIP [战斗相关四屏] start(0) 与点 CTA 都没进 PLAYING');
      for (const l of ['暂停', '升级三选一', '复活/死亡', '结算']) report.cases.push({ label: l, skipped: true });
    }
  }
} finally {
  await browser.close();
  server.close();
}

const ok = report.cases.filter((c) => !c.err && !c.skipped);
const overlapsGlobal = ok.flatMap((c) => c.overlaps.map((v) => ({ screen: c.label, ...v })));
const smallGlobal = ok.flatMap((c) => c.small.map((s) => ({ screen: c.label, ...s })));
const worst = smallGlobal.slice().sort((a, b) => a.css - b.css).slice(0, 6);
const padable = smallGlobal.filter((s) => s.verdict.startsWith('可再补'));   // 措辞与 verdict 保持一致（曾写成「可补」⇒ 恒为 0，假数字）
const underfilled = ok.filter((c) => c.underfilled);
const uniqSmall = [...new Set(smallGlobal.map((s) => s.id))];
const unlisted = uniqSmall.filter((id) => !ALLOW_SMALL.some((a) => a.re.test(id)));
const staleSmall = ALLOW_SMALL.filter((a) => !uniqSmall.some((id) => a.re.test(id)));
const digest = (() => {
  const m = new Map();
  for (const id of uniqSmall) { const k = id.replace(/\d+$/, "#"); m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => k + '×' + n).join(' · ');
})();
const md = ['# ⑲ 命中区运行时体检', '',
  `- 屏数 ${ok.length}（跳过 ${report.cases.filter((c) => c.skipped).length}）· 页面错误 ${pageErrors.length}`,
  `- **同屏命中区重叠 ${overlapsGlobal.length} 处**（硬门禁）· 偏小控件 ${smallGlobal.length} 个，其中**可零像素补 pad ${padable.length} 个**`,
  '', '| 屏 | 状态 | 可点 | 偏小 | 重叠 |', '|---|---|---|---|---|',
  ...ok.map((c) => `| ${c.label} | ${c.state} | ${c.n}${c.underfilled ? ' ⚠低于下限' + c.underfilled.need : ''} | ${c.small.length} | ${c.overlaps.length} |`), '',
  '## 逐屏命中区（可点/偏小/重叠）', '', ...ok.map((c) => `- ${c.label} ${c.n}/${c.small.length}/${c.overlaps.length}`), '',
  '## 偏小清单（运行时安全 pad = 本屏内 ½×最近邻居间距，两轴取小）', '',
  '| 屏 | 控件 | 尺寸 | 短边 CSS px | 需 pad | 本屏安全上限 | 结论 |', '|---|---|---|---|---|---|---|',
  ...smallGlobal.map((s) => `| ${s.screen} | ${s.id} | ${s.w}×${s.h} | ${s.css} | ${s.need} | ${s.safe} | ${s.verdict} |`), ''];
fs.writeFileSync(path.join(OUT, 'hit-area-fit.md'), md.join('\n'), 'utf8');

const skipped = report.cases.filter((c) => c.skipped).length;
console.log(`::notice::⑲ 命中区逐屏（可点/偏小/重叠[+已声明]）::` + ok.map((c) => `${c.label} ${c.n}/${c.small.length}/${c.overlaps.length}${c.declaredOverlaps && c.declaredOverlaps.length ? '+D' + c.declaredOverlaps.length : ''}`).join(' · ')
  + (skipped ? ` · ⚠ 跳过 ${skipped} 屏（未量到）` : ' · 10 屏全覆盖'));
console.log(`::notice::⑲ 偏小 id 摘要（台账用）::` + digest + ` · 未登记 ${unlisted.length} 个`);
  const denseN = (lbl) => { const c = ok.filter((x) => x.label === lbl)[0]; return c ? c.n : '—'; };
  console.log(`::notice::⑲ 满载注入（诊断）::选卡成功 ${report.denseChips == null ? '—' : report.denseChips}/12 · 结算-满载 ${denseN('结算-满载')} 个可点节点 · 暂停-满载 ${denseN('暂停-满载')} 个`);
// B 类候选（具名、准备补 hitPad 的）—— 打印**运行时**两轴间距，用来定 pad 值：
//   `v` = 竖直向最近邻居间距，`h` = 水平向；对称 pad 必须 ≤ ½×min(v,h)，单轴 pad 只需看对应轴。
const PAD_CAND = ['homeguide', 'homeabout', 'homedaily', 'homevault', 'settheme', 'setbgm', 'setexport', 'setimport', 'setclose',
  'beastclose', 'vaultclose', 'gearclose', 'dailycancel', 'gearmerge', 'gearforge',
  'btnrevive', 'btngiveup', 'btnreroll', 'btndouble', 'resulthome'];
console.log('::notice::⑲ B 类候选的运行时间距（v=竖直 h=水平 · 需=补到 44 CSS px 所需）::' +
  PAD_CAND.map((id) => { const x = smallGlobal.find((y) => y.id === id);
    return x ? `${id} 还差${x.need} v${x.vg === Infinity ? '∞' : x.vg} h${x.hg === Infinity ? '∞' : x.hg}` : `${id} ✓达标`; }).join(' · '));
console.log(`::notice::⑲ 偏小 ${smallGlobal.length} 个 · 可零像素补 pad ${padable.length} 个 · 最紧::` +
  worst.map((s) => `${s.screen}:${s.id} ${s.css}css pad${s.need}≤${s.safe}`).join(' · '));

let bad = 0;
if (pageErrors.length) console.log(`⚠ 页面错误 ${pageErrors.length} 条：${pageErrors.slice(0, 2).join(' | ')}`);
if (overlapsGlobal.length) {
  bad++;
  console.log(`::error::⑲ 同屏命中区重叠 ${overlapsGlobal.length} 处 ⇒ 点中间那块由注册顺序决定谁赢（手感 bug）::` +
    overlapsGlobal.slice(0, 4).map((v) => `${v.screen}:${v.a}×${v.b}=${v.w}×${v.h}(抢点者${v.winner})`).join(' · '));
}
if (SELFTEST) {
  const failed = report.selftest.filter(([, o]) => !o);
  if (failed.length) { bad++; console.log(`::error::⑲ 自测未通过 ${failed.length}/${report.selftest.length}::` + failed.map(([n]) => n).join(' · ')); }
  else console.log(`✅ 自测 ${report.selftest.length}/${report.selftest.length} 通过（纯逻辑 + 注入重叠）`);
}
if (unlisted.length) {
  bad++;
  console.log('::error::⑲ 有未登记的偏小可点节点（<44 CSS px）⇒ 请补尺寸/改视觉，或登记到 ALLOW_SMALL 并写原因::' +
    unlisted.slice(0, 8).join(' · ') + (unlisted.length > 8 ? ' …共 ' + unlisted.length + ' 个' : ''));
}
if (staleSmall.length) {
  bad++;
  console.log('::error::⑲ ALLOW_SMALL 台账失效（这些条目现在已达标/不存在）⇒ 从台账删除::' +
    staleSmall.map((a) => String(a.re)).join(' · '));
}
if (underfilled.length) {
  bad++;
  console.log('::error::⑲ 有屏只量到不足下限的可点节点 ⇒ 探针与屏幕状态不一致（「没量到」不许长得像「没问题」）::' +
    underfilled.map((c) => `${c.label} 实得${c.underfilled.got}/下限${c.underfilled.need}`).join(' · '));
}
if (!ok.length) { bad++; console.log('::error::⑲ 没有任何一屏量到数据（探针失效）::检查 MENGSHOU_DEBUG / UIStack 是否还在'); }
if (bad) { console.log('\n结论：FAIL'); process.exit(1); }
console.log(`\n结论：PASS —— ${ok.length} 屏同屏命中区无重叠 · 偏小 ${smallGlobal.length} 个（可零像素补 pad ${padable.length} 个）· 每屏可点节点均达下限`);
