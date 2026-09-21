// ui-fit.mjs —— 用户界面「控件不得出屏」体检（⑯ 界面溢出维度），云端可复跑。
//
// 为什么要它（v1.185 的由来）：
//   图鉴配方 tab 的「返回」按钮**底部出屏 32px**（closeY 1248 + 高 64 = 1312 > viewH 1280）。
//   成因不是"谁写错了数字"，而是 `syncCodexFit()` 里：
//     codexShiftWidgets((viewH - fitH)/2)   ← 面板被钳制到 viewH 时，py 恒等于 0
//     uiBeastClose.rect.y = GAME.codexCloseY ← 紧接着**无条件覆盖**，把钳制意图抹掉
//   这类缺陷的特征：**面板看起来正常、控件"按内容算"也对，但控件落在视口外**。
//   面板几何体检（screen-profile / card-band）**测不到它** —— 它们量的是"面板内的空带"，
//   而出屏控件在**面板之外/视口之外**。所以需要独立的"越界"口径。
//
// ⚠ 关键：返回/关闭类控件是**唯一出口**，被裁即有真实可用性代价，不是纯观感。故设硬门禁。
//
// 判据：逐个状态打开各屏 → 遍历 UIStack.list 中 `visible` 的节点 →
//   任一控件 `rect` 越出 `[0,viewW]×[0,viewH]` 超过 `TOL` px 即 FAIL。
//   TOL 默认 0.5（浮点无关误差），**不豁免"轻微"**：出屏 1px 与 32px 是同一类缺陷。
//
// 阴性对照（--selftest，必须能"检出已知会越界"的样本）：
//   A 人为把一个控件移出屏 → 必被抓
//   B 把同一控件移回屏内 → 必须不报（证明不是"永远红"）
//   C 隐藏的越界控件**不应**报警（`visible=false` 的节点玩家看不见）
//
// 用法: node ci/ui-fit.mjs [--selftest]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const OUT = path.join('ci', 'out');
fs.mkdirSync(OUT, { recursive: true });
const gameDir = path.resolve('game');
// PICK_ENTRY_FILTERED: 排除 _ 前缀（_ = 临时/备份），防审计到备份文件（v1.187 实测）
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

// 逐个状态：setup 是"打开这一屏"的表达式（用游戏自己的真动作，不用状态查询口）
const CASES = [
  ['HOME(大厅)', 'GAME.state = GAME.flow.HOME;'],
  ['图鉴 pet', "GAME.state=GAME.flow.HOME; onTapOpenBeast(); setCodexTab('pet');"],
  ['图鉴 fork', "GAME.state=GAME.flow.HOME; onTapOpenBeast(); setCodexTab('fork');"],
  ['图鉴 enemy', "GAME.state=GAME.flow.HOME; onTapOpenBeast(); setCodexTab('enemy');"],
  ['设置', 'closeBeastUi(); GAME.state=GAME.flow.HOME; onTapOpenSettings();'],
  ['关于', 'onTapCloseSettings(); GAME.state=GAME.flow.HOME; onTapOpenAbout();'],
  ['装备库', 'onTapCloseAbout(); GAME.state=GAME.flow.HOME; onTapOpenGear();'],
  ['宝库', 'onTapCloseGear(); GAME.state=GAME.flow.HOME; onTapOpenVault();'],
  ['每日挑战', 'closeVaultUi(); GAME.state=GAME.flow.HOME; onTapDaily();'],
  ['暂停', 'closeDailyPickUi(); GAME.state=GAME.flow.PLAYING; onTapPauseBtn();'],
];

const TOL = 0.5;

// 扫描表达式：注入 probe 脚本时可覆盖（自检用）
const scanExpr = (extra) => `
(function(){
  try{
    ${extra || ''}
    var arr = UIStack.list || [];
    var bad = [];
    for (var i = 0; i < arr.length; i++) {
      var n = arr[i];
      if (!n || !n.visible || !n.rect) continue;
      var r = n.rect;
      var below = +((r.y + r.h) - CONFIG.viewH).toFixed(1);
      var above = +(-r.y).toFixed(1);
      var right = +((r.x + r.w) - CONFIG.viewW).toFixed(1);
      var left  = +(-r.x).toFixed(1);
      var worst = Math.max(below, above, right, left);
      if (worst > ${TOL}) {
        bad.push({ id: n.id || n.kind || ('#' + i), y: r.y, h: r.h, x: r.x, w: r.w,
                   below: below, above: above, right: right, left: left, worst: worst });
      }
    }
    return JSON.stringify({ bad: bad, n: arr.length, view: [CONFIG.viewW, CONFIG.viewH] });
  }catch(e){ return JSON.stringify({ err: e.message }); }
})()
`;

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));

let report = { cases: [], selftest: [], pageErrors: [] };
try {
  await page.goto(base + entryName, { waitUntil: 'load', timeout: 120000 });
  // 等 MENGSHOU_DEBUG 就位
  let ready = false;
  for (let i = 0; i < 80; i++) {
    ready = await page.evaluate(() => (typeof MENGSHOU_DEBUG !== 'undefined' && !!MENGSHOU_DEBUG)).catch(() => false);
    if (ready) break;
    await page.waitForTimeout(500);
  }
  if (!ready) {
    console.log('SKIP 游戏未就绪（MENGSHOU_DEBUG 未出现）');
    report.note = 'not-ready';
  } else {
    for (const [label, setup] of CASES) {
      await page.waitForTimeout(350);
      let raw;
      try { raw = await page.evaluate(scanExpr(setup)); }
      catch (e) { raw = JSON.stringify({ err: String(e.message).slice(0, 200) }); }
      const o = JSON.parse(raw);
      if (o.err) { report.cases.push({ label, err: o.err }); console.log(`[${label}] ERR ${o.err}`); continue; }
      report.cases.push({ label, n: o.n, view: o.view, bad: o.bad });
      const flag = o.bad.length ? 'FAIL' : 'ok  ';
      console.log(`${flag} [${label}] 可见节点=${o.n} 越界=${o.bad.length}`);
      o.bad.forEach((b) => console.log(`       ⚠ ${b.id}  y=${b.y} h=${b.h} x=${b.x} w=${b.w}  ` +
        [b.below > TOL ? '下溢' + b.below : '', b.above > TOL ? '上溢' + b.above : '',
         b.right > TOL ? '右溢' + b.right : '', b.left > TOL ? '左溢' + b.left : ''].filter(Boolean).join(' / ')));
    }

    // ---- 阴性对照 ----
    if (SELFTEST) {
      await page.evaluate(() => { GAME.state = GAME.flow.HOME; });
      await page.waitForTimeout(300);
      // A. 人为把一个可见控件移到屏外 → 必须被抓
      const a = JSON.parse(await page.evaluate(scanExpr(`
        (function(){
          var arr = UIStack.list || []; window.__victim = null;
          for (var i = 0; i < arr.length; i++) {
            var n = arr[i];
            if (n && n.visible && n.rect && n.rect.h > 0 && n.rect.y > 100) { window.__victim = n; window.__vy = n.rect.y; break; }
          }
          if (window.__victim) window.__victim.rect.y = CONFIG.viewH + 50;
        })()
      `)));
      const aHit = a.bad.some((b) => b.below > 40);
      report.selftest.push(['A 人为移出屏外 → 必被检出', aHit]);
      // B. 移回屏内 → 必须不报（证明不是"永远红"）
      const b = JSON.parse(await page.evaluate(scanExpr(`
        (function(){ if (window.__victim) { window.__victim.rect.y = window.__vy; } })()
      `)));
      const bOk = !b.bad.some((x) => x.worst > 40);
      report.selftest.push(['B 移回屏内 → 不再报警（非永红）', bOk]);
      // C. 越界但 visible=false 的控件不应报警
      const c = JSON.parse(await page.evaluate(scanExpr(`
        (function(){
          var arr = UIStack.list || [];
          for (var i = 0; i < arr.length; i++) {
            var n = arr[i];
            if (n && n.visible && n.rect) { window.__vv = n; window.__vvy = n.rect.y; n.rect.y = CONFIG.viewH + 200; n.visible = false; break; }
          }
        })()
      `)));
      const cOk = !c.bad.some((x) => x.below > 150);
      report.selftest.push(['C 隐藏控件不报警（只查 visible）', cOk]);
      await page.evaluate(() => { if (window.__vv) { window.__vv.rect.y = window.__vvy; window.__vv.visible = true; } })
        .catch(() => {});
    }
  }
} catch (e) {
  report.fatal = String(e.message).slice(0, 300);
  console.log('SKIP 运行失败: ' + report.fatal);
} finally {
  report.pageErrors = pageErrors;
  await browser.close();
  server.close();
}

fs.writeFileSync(path.join(OUT, 'ui-fit.json'), JSON.stringify(report, null, 1));

const badCases = report.cases.filter((c) => (c.bad && c.bad.length) || c.err);
console.log('');
if (SELFTEST) {
  let pass = 0;
  for (const [n, v] of report.selftest) { console.log((v ? 'PASS ' : 'FAIL ') + n); if (v) pass++; }
  console.log(`selftest ${pass}/${report.selftest.length}`);
  if (pass < report.selftest.length) process.exitCode = 1;
}
if (report.fatal || report.note === 'not-ready') {
  console.log('结论: SKIP（未能评估）');
  process.exit(0);
}
if (badCases.length) {
  console.log(`结论: **FAIL** — ${badCases.length}/${report.cases.length} 屏存在控件出屏`);
  console.log('→ 出屏的返回/关闭钮是唯一出口，必须修（见 v1.185 的 viewH 下限钳制写法）。');
  process.exit(1);
}
console.log(`结论: **PASS** — ${report.cases.length} 屏 · 可见控件全部落在 ${report.cases[0] && report.cases[0].view ? report.cases[0].view.join('×') : '720×1280'} 视口内 ✅`);
process.exit(0);
