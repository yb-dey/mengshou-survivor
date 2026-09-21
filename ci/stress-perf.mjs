// stress-perf.mjs —— 重载帧时体检（云端；本机不参与渲染）
//
// 存在理由（真缺口，不是"再验一遍"）：
//   ci/verify.mjs 只在**开局轻载**下量 fps（8s 窗口，场上怪物个位数）。
//   而本作最重的场景是**怪潮**：ch6 无尽可达 `CONFIG.maxEnemy=200` 同屏。
//   轻载 60fps 完全不能证明重载不卡 —— 这是"验证覆盖不到的地方"，不是"验证通过的地方"。
//
// 判据（受 → 正向检测）：
//   1. 先把游戏推进到**怪潮窗口**并确认**确实有怪**（enemyCount 达阈值）
//      —— 否则"帧率好"可能只是"根本没怪"（假阴性，与"守卫自己坏了"同型）。
//   2. 再量**帧时间分布**（p50 / p95 / max），p95 超预算即 FAIL。
//
// 为什么量帧时间而不是 fps：
//   fps 是均值，会掩盖"偶发长帧"（卡顿感的真正来源）。
//   玩家感知的是**帧时间的尾部**，不是平均数。
//
// 阴性对照（必须做）：
//   在测量窗口内人为注入持续阻塞（主线程 busy-loop）→ 判据必须报 FAIL。
//   否则无法证明"PASS"来自游戏流畅，而不是"判据量不到"。

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const OUT = path.join('ci', 'out');
fs.mkdirSync(OUT, { recursive: true });

const gameDir = path.resolve(process.env.VERIFY_DIR || 'dist');
const htmlFiles = fs.readdirSync(gameDir).filter((f) => f.toLowerCase().endsWith('.html'));
if (!htmlFiles.length) { console.error('FAIL: ' + gameDir + ' 下找不到 .html'); process.exit(1); }
const entryName = htmlFiles[0];

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.wav': 'audio/wav', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    const abs = path.join(gameDir, rel);
    if (!abs.startsWith(gameDir) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(abs).pipe(res);
  } catch { res.writeHead(500); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'],
});

// —— 帧时间采样（在页面内跑，用 rAF 间隔，天然反映"主线程是否被拖住"）——
//   排除 >2000ms 的巨型间隔：那是标签页被挂起/弹窗阻塞，不是渲染卡顿（会污染 max）。
const FRAME_PROBE = `(ms) => new Promise((res) => {
  const gaps = []; let last = performance.now(); const t0 = last;
  const tick = () => {
    const now = performance.now(); const d = now - last; last = now;
    if (d > 0 && d < 2000) gaps.push(d);
    if (now - t0 < ms) requestAnimationFrame(tick); else res(gaps);
  };
  requestAnimationFrame(tick);
})`;

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return +(s[Math.min(s.length - 1, Math.floor(s.length * p))]).toFixed(2);
}

const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 250)));

await page.goto('http://127.0.0.1:' + port + '/' + encodeURIComponent(entryName), { waitUntil: 'load', timeout: 90000 });
await page.waitForTimeout(3000);

// 跳引导 → 进战斗
await page.evaluate(() => { try { window.guideSkipAll && window.guideSkipAll(); } catch (e) {} });
await page.waitForTimeout(1200);
const geom = await page.evaluate(() => {
  const c = document.querySelector('canvas'); const r = c.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height, cw: c.width, ch: c.height };
});
// 「正片出击」（画布逻辑坐标 316,617；与 verify.mjs 同源）
const cx = geom.left + (316 / geom.cw) * geom.width;
const cy = geom.top + (617 / geom.ch) * geom.height;
await page.mouse.click(cx, cy);
await page.waitForTimeout(2500);

// —— 推进到怪潮窗口 ——
//   取第一个 hordeTime，seek 到**潮窗中段**（潮会持续 durSec≈50s 灌怪），
//   让游戏有足够时间把怪堆到高位。seek 到"刚开始"会浪费窗口。
const plan = await page.evaluate(() => {
  try { return window.MENGSHOU_DEBUG.spine ? window.MENGSHOU_DEBUG.spine() : null; } catch (e) { return null; }
});
const hordeT = plan && plan.hordeTimes && plan.hordeTimes.length ? plan.hordeTimes[0] : 90;
await page.evaluate((t) => { try { window.MENGSHOU_DEBUG.seek(t); } catch (e) {} }, hordeT + 2);

// 灌怪期：等敌人数爬到高位。
//   ⚠ 必须"先证有怪" —— 否则"帧率好"可能只是"没怪"（假阴性，与"守卫自己坏了"同型）。
//   期间若弹升级/选卡（状态 LEVELUP_MODAL）会**暂停刷怪**，必须点掉才能继续灌。
const S = { LEVELUP: 'LEVELUP_MODAL', REVIVE: 'REVIVE_MODAL', WIN: 'RESULT_WIN', LOSE: 'RESULT_LOSE' };
let peak = { enemyCount: 0, activeTotal: 0 };
const LOAD_TARGET = +(process.env.LOAD_TARGET || 60);
const tWait0 = Date.now();
while (Date.now() - tWait0 < 55000) {
  const s = await page.evaluate(() => {
    const D = window.MENGSHOU_DEBUG || {};
    let st = ''; try { st = (D.state ? D.state() : {}).state || ''; } catch (e) {}
    let sk = null; try { sk = D.stress ? D.stress() : null; } catch (e) {}
    return { st, sk };
  });
  if (s.sk) {
    if (s.sk.enemyCount > peak.enemyCount) peak = s.sk;
    if (peak.enemyCount >= LOAD_TARGET) break;
  }
  // 弹窗会暂停刷怪 → 点画面中央推进（升级/选卡=点掉；复活=取消）
  if (s.st === S.LEVELUP || s.st === S.REVIVE) {
    await page.mouse.click(geom.left + geom.width / 2, geom.top + geom.height / 2);
    await page.waitForTimeout(400);
    continue;
  }
  // 结算/失败 → 这一波已过，重开一局再进潮
  if (s.st === S.WIN || s.st === S.LOSE) break;
  // 潮窗已过（idx 前移且场上怪在掉）→ 重新 seek 回潮首，继续灌
  if (s.sk && s.sk.hordeTimes && s.sk.hordeIdx >= 1 && peak.enemyCount < LOAD_TARGET) {
    const ht = s.sk.hordeTimes[Math.min(s.sk.hordeIdx, s.sk.hordeTimes.length - 1)];
    await page.evaluate((t) => { try { window.MENGSHOU_DEBUG.seek(t); } catch (e) {} }, ht + 1);
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(500);
}

// —— 量帧时间（重载窗口 5s）——
const gaps = await page.evaluate(new Function('return ' + FRAME_PROBE)(), 5000);
const stat = { p50: pct(gaps, 0.5), p95: pct(gaps, 0.95), max: +(Math.max.apply(null, gaps.length ? gaps : [0])).toFixed(2), n: gaps.length };
const fps = gaps.length ? +(1000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length)).toFixed(1) : 0;

// —— 阴性对照：注入 250ms 主线程阻塞 × 3 → 探针必须量到长帧 ——
const negGaps = await page.evaluate(async () => {
  const gaps = []; let last = performance.now(); const t0 = last;
  const tick = () => {
    const now = performance.now(); const d = now - last; last = now;
    if (d > 0 && d < 2000) gaps.push(d);
    if (now - t0 < 2000) requestAnimationFrame(tick); else window.__neg = gaps;
  };
  requestAnimationFrame(tick);
  for (let i = 0; i < 3; i++) { const s = performance.now(); while (performance.now() - s < 250) {} await new Promise(r => setTimeout(r, 50)); }
  await new Promise(r => setTimeout(r, 2200));
  return window.__neg || [];
});
const negStat = { p95: pct(negGaps, 0.95), max: +(Math.max.apply(null, negGaps.length ? negGaps : [0])).toFixed(2), n: negGaps.length };

await browser.close();
server.close();

// —— 判定 ——
// p95 预算：60fps=16.7ms。CI 跑的是 **swiftshader 软件渲染**（无 GPU 加速），
//   逐帧光栅化比真机慢得多 → 预算按"软件渲染下的可接受尾部"设，别拿它当真机标准。
//   真机有 GPU，同一场景会快数倍；此处的价值是**回归哨兵**（改坏了会掉出预算）。
const P95_BUDGET_MS = +(process.env.P95_BUDGET || 34);
const LOAD_MIN = +(process.env.LOAD_TARGET || 60);   // "这确实是重载"的最低同屏怪数
const NEG_MIN_P95 = 60;      // 阴性对照：注入阻塞后 p95 必须显著高于预算，否则判据量不到

const loaded = peak.enemyCount >= LOAD_MIN;
const pass = loaded && stat.p95 <= P95_BUDGET_MS && negStat.p95 >= NEG_MIN_P95 && pageErrors.length === 0;

const md = [];
md.push('# 重载帧时体检（怪潮）');
md.push('');
md.push('> 为什么量帧时间而不是 fps：fps 是均值，会掩盖偶发长帧；玩家感知的是**帧时间的尾部**。');
md.push('> ⚠ CI 为 **swiftshader 软件渲染**（无 GPU）→ 绝对值比真机慢数倍，此处作**回归哨兵**用，不当真机标准。');
md.push('> ✅ 判据**先证有怪再判帧率** —— 否则"帧率好"可能只是"没怪"（假阴性）。');
md.push('');
md.push('| 指标 | 值 |');
md.push('|---|---|');
md.push('| 同屏怪数（峰值 enemyCount） | ' + peak.enemyCount + ' / maxEnemy ' + (peak.maxEnemy || '?') + ' |');
md.push('| 活跃实体总数（含精英/BOSS） | ' + (peak.activeTotal || 0) + ' |');
md.push('| 帧时间 p50 | ' + stat.p50 + ' ms |');
md.push('| 帧时间 p95 | ' + stat.p95 + ' ms（预算 ≤' + P95_BUDGET_MS + '） |');
md.push('| 帧时间 max | ' + stat.max + ' ms |');
md.push('| 平均 fps | ' + fps + ' |');
md.push('| 采样帧数 | ' + stat.n + ' |');
md.push('| 未捕获异常 | ' + pageErrors.length + ' |');
md.push('');
md.push('## 阴性对照（注入 250ms×3 主线程阻塞）');
md.push('- p95 = ' + negStat.p95 + ' ms（须 ≥ ' + NEG_MIN_P95 + '，否则判据量不到卡顿）');
md.push('- max = ' + negStat.max + ' ms ｜ 采样 ' + negStat.n + ' 帧');
md.push('');
md.push('## 结论');
if (!loaded) md.push('- ❌ **未进入重载**：同屏怪数峰值 ' + peak.enemyCount + ' < ' + LOAD_MIN + ' → 样本无效（"帧率好"可能只是"没怪"）');
if (pageErrors.length) md.push('- ❌ 未捕获异常 ' + pageErrors.length + ' 个：' + pageErrors.slice(0, 3).join(' | '));
if (stat.p95 > P95_BUDGET_MS) md.push('- ❌ p95 ' + stat.p95 + 'ms 超预算 ' + P95_BUDGET_MS + 'ms');
if (negStat.p95 < NEG_MIN_P95) md.push('- ❌ 阴性对照不达标：判据可能量不到卡顿（守卫自己坏了）');
md.push('');
md.push('## **' + (pass ? 'PASS' : 'FAIL') + '** — ' + (pass ? '重载下帧时尾部在预算内且判据有效 ✅' : '存在未达标项 ❌'));

fs.writeFileSync(path.join(OUT, 'stress-perf.md'), md.join('\n'));
console.log(md.join('\n'));
process.exit(pass ? 0 : 1);
