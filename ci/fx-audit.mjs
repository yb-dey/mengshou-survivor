// fx-audit.mjs —— 特效/反馈专项体检（第⑥部分），云端可复跑。
//
// 为什么要它：游戏的"受击白闪 / 死亡 / 拾取环 / 震屏 / 连杀"都是**短生命周期**对象，
//   截图碰运气拍不到；而项目**自带特效演示钩子**（killDemo / magnetDemo / shakeLayers …），
//   正好可以逐个触发、逐个验证"它到底有没有在画面上出现"。
//
// ⚠ 方法要点（否则结论不可信）：
//   游戏一直在动（粒子/敌人），**两帧之间本来就有差异** → 不能拿"有差异"当"特效生效"。
//   必须先量**阴性对照**：不触发任何特效时连续帧的平均差异 ctrl，
//   再看每个特效的帧差是否**显著高于 ctrl**（默认 >1.4×）。
//   任一项 ≤ ctrl 即判定"该特效在画面上不可见"→ **非零退出**。
//
// 用法: node ci/fx-audit.mjs   （产物在 ci/out/）
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

const OUT = path.join('ci', 'out');
fs.mkdirSync(OUT, { recursive: true });
const gameDir = path.resolve('game');
const entryName = fs.readdirSync(gameDir).filter((f) => f.toLowerCase().endsWith('.html'))[0];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.wav': 'audio/wav' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const abs = path.join(gameDir, rel);
  if (!abs.startsWith(gameDir) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(abs).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// 特效多数是"瞬时"的，用最小化渲染负担的方式跑：仍走 GPU 开关环境变量（WB_GL）
const launchArgs = ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files'];
if (process.env.WB_GL) launchArgs.push('--use-gl=' + process.env.WB_GL);
const browser = await chromium.launch({ args: launchArgs });
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
await page.goto(`http://127.0.0.1:${port}/${encodeURIComponent(entryName)}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForTimeout(4000);
await page.evaluate(() => { if (typeof window.guideSkipAll === 'function') window.guideSkipAll(); });
await page.waitForTimeout(1500);

const SIG_N = 32;
async function sig() {
  return await page.evaluate((N) => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const bw = Math.max(1, Math.floor(c.width / N)), bh = Math.max(1, Math.floor(c.height / N));
    const out = [];
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        let s = 0, n = 0;
        for (let y = gy * bh; y < (gy + 1) * bh; y += 3) {
          for (let x = gx * bw; x < (gx + 1) * bw; x += 3) {
            const i = (y * c.width + x) * 4;
            s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
            n++;
          }
        }
        out.push(n ? s / n : 0);
      }
    }
    return out;
  }, SIG_N);
}
function diff(a, b) {
  if (!a || !b) return -1;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}
// ⚠ 只取平均差会漏判"平移类"特效（震屏只移动几个像素，32×32 平均后被抹平）→ 同时取**最大格差**
function diffMax(a, b) {
  if (!a || !b) return -1;
  let m = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > m) m = d; }
  return m;
}

async function enterBattle() {
  await page.evaluate(() => {
    const D = window.MENGSHOU_DEBUG || {};
    try { if (D.pause) D.pause(false); } catch (e) { void e; }
    try { if (D.closeSettings) D.closeSettings(); } catch (e) { void e; }
    try { if (D.closeBeast) D.closeBeast(); } catch (e) { void e; }
    try { if (D.closeGear) D.closeGear(); } catch (e) { void e; }
    try { if (D.goHome) D.goHome(); } catch (e) { void e; }
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => { if (window.MENGSHOU_DEBUG.hall) window.MENGSHOU_DEBUG.hall(); });
  await page.waitForTimeout(600);
  const g = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, cw: c.width, ch: c.height }; });
  await page.mouse.click(g.l + (316 / g.cw) * g.w, g.t + (617 / g.ch) * g.h);
  await page.waitForTimeout(7000);
}
/** ⚠ 存活检测：连拍两帧若几乎完全一致 → 画面已冻结（暂停/结算/弹窗），必须先恢复，
 *  否则后续所有特效都会量到 0（实测踩过：第一次 killDemo 后状态漂移，后面三项全是 0.00）。
 *  ⚠ 另一个坑：killDemo 会打死怪 → **触发升级三选一 → 游戏暂停**，
 *  此时 magnetDemo 因 `state !== PLAYING` 直接返回 0（实测 03-gemrush 因此判"未见效"）
 *  → 所以恢复动作里必须**把升级卡点掉**，而不只是解暂停。 */
async function ensureLive(label) {
  for (let t = 0; t < 4; t++) {
    // 先看有没有升级卡开着（cards 是"可见卡"的权威来源）
    const cards = await page.evaluate(() => { try { const s = window.MENGSHOU_DEBUG.levelup(); return (s && s.cards) ? s.cards.length : 0; } catch (e) { return 0; } });
    if (cards > 0) {
      console.log('  · ' + label + ' 前清掉 ' + cards + ' 张升级卡（否则游戏处于暂停态，特效不会生效）');
      await page.evaluate(() => { const D = window.MENGSHOU_DEBUG || {}; try { if (D.levelupTap) D.levelupTap(); } catch (e) { void e; } });
      await page.waitForTimeout(500);
      continue;
    }
    const a = await sig();
    await page.waitForTimeout(150);
    const b = await sig();
    if (diff(a, b) > 0.03) return true;
    console.log('  ⚠ ' + label + ' 前检测到画面冻结（第 ' + (t + 1) + ' 次），尝试恢复…');
    await page.evaluate(() => { const D = window.MENGSHOU_DEBUG || {}; try { if (D.pause) D.pause(false); } catch (e) { void e; } });
    await page.waitForTimeout(500);
  }
  await enterBattle();
  return true;
}

// ---- 进入战斗 ----
await enterBattle();

// ---- 阴性对照：不触发任何特效，连拍 6 帧求平均帧间差 ----
const ctrlSamples = [];
const ctrlMaxSamples = [];
let prev = await sig();
for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(110);
  const cur = await sig();
  ctrlSamples.push(diff(prev, cur));
  ctrlMaxSamples.push(diffMax(prev, cur));
  prev = cur;
}
const ctrl = ctrlSamples.reduce((a, b) => a + b, 0) / ctrlSamples.length;
const ctrlMax = ctrlMaxSamples.reduce((a, b) => a + b, 0) / ctrlMaxSamples.length;

// ---- 逐个特效 ----
const FX = [
  { name: '01-idle', hook: null, note: '基线（不触发）' },
  { name: '02-kill', hook: 'killDemo', note: '击杀/死亡/连杀反馈' },
  { name: '03-gemrush', hook: 'magnetDemo', note: '磁吸/拾取环' },
  { name: '04-shake', hook: 'shakeLayers', note: '三层震屏' },
  { name: '05-kill-again', hook: 'killDemo', note: '击杀（复测，看是否稳定）' },
];
const rows = [];
for (const fx of FX) {
  await ensureLive(fx.name);
  const before = await sig();
  let ret = null;
  if (fx.hook) {
    ret = await page.evaluate((h) => { try { return window.MENGSHOU_DEBUG[h](); } catch (e) { return 'ERR ' + e; } }, fx.hook);
  }
  await page.waitForTimeout(110);
  const after = await sig();
  const d = diff(before, after);
  const dm = diffMax(before, after);
  const shotP = path.join(OUT, 'fx-' + fx.name + '.png');
  await page.screenshot({ path: shotP });
  const h = crypto.createHash('sha1').update(fs.readFileSync(shotP)).digest('hex').slice(0, 10);
  rows.push({ name: fx.name, hook: fx.hook || '-', note: fx.note, delta: +d.toFixed(2), dmax: +dm.toFixed(1), hash: h, ret: ret === null ? '' : JSON.stringify(ret).slice(0, 90) });
}

const THRESH = +(process.env.FX_THRESH || 1.4);
// 判定看**平均差高于对照** 或 **最大格差显著**（后者覆盖平移类特效如震屏）
const bad = rows.filter((r) => r.hook !== '-' && r.delta <= ctrl * THRESH && r.dmax < ctrlMax * 2);

// ---- 死亡帧：用项目自带证据口 `deathMarks()` 的累计计数做**定量**证明 ----
//   （闭包内数组外部探不到，项目为此专门开了 spawned/drawn 计数口）
const dmBefore = await page.evaluate(() => { try { return window.MENGSHOU_DEBUG.deathMarks(); } catch (e) { return null; } });
await ensureLive('死亡帧复测');
await page.evaluate(() => { try { window.MENGSHOU_DEBUG.killDemo(); } catch (e) { void e; } });
await page.waitForTimeout(900);
const dmAfter = await page.evaluate(() => { try { return window.MENGSHOU_DEBUG.deathMarks(); } catch (e) { return null; } });
const dmOk = !!(dmBefore && dmAfter && dmAfter.spawned > dmBefore.spawned && dmAfter.drawn > dmBefore.drawn);
const dmLine = dmBefore && dmAfter
  ? `- 死亡帧计数：spawned ${dmBefore.spawned}→**${dmAfter.spawned}** ／ drawn ${dmBefore.drawn}→**${dmAfter.drawn}** ／ _dead 贴图 ${dmAfter.sprites} 张 → **${dmOk ? '✅ 确认触发并绘制' : '❌'}**`
  : '- 死亡帧计数：读取失败 ❌';

const md = [
  '# 特效/反馈专项体检（fx-audit）',
  '',
  `- 阴性对照 ctrl: 平均差 **${ctrl.toFixed(2)}** ／ 最大格差 **${ctrlMax.toFixed(1)}**`,
  `- 判定: 平均差 > ctrl × ${THRESH} = **${(ctrl * THRESH).toFixed(2)}**，或最大格差 ≥ ctrlMax×2 = **${(ctrlMax * 2).toFixed(1)}** 即算"可见"`,
  `- 未捕获异常: ${errs.length}`,
  '',
  '| 项 | 钩子 | 说明 | 平均差 | 最大格差 | vs ctrl | 判定 |',
  '|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.name} | ${r.hook} | ${r.note} | ${r.delta} | ${r.dmax} | ${ctrl ? (r.delta / ctrl).toFixed(1) + '×' : '-'} | ${r.hook === '-' ? '基线' : ((r.delta > ctrl * THRESH || r.dmax >= ctrlMax * 2) ? '✅ 可见' : '❌ 未见效')} |`),
  '',
  '> 「平均差/最大格差」= 触发前后 32×32 灰度指纹。游戏一直在动，**必须与 ctrl 比**；',
  '> 只取平均会漏判平移类特效（震屏），故并列最大格差。',
  '',
  '## 死亡帧（计数口证据，比帧差更硬）',
  '',
  dmLine,
  '',
  '> `deathMarks()` 是项目为此专设的证据口：`spawned` 证明"确实触发过"，`drawn` 证明"确实画出来过"。',
  '',
].join('\n');
fs.writeFileSync(path.join(OUT, 'fx-report.md'), md);
fs.writeFileSync(path.join(OUT, 'fx-report.json'), JSON.stringify({ ctrl: +ctrl.toFixed(2), thresh: THRESH, rows, errs }, null, 2));
console.log(md);

await browser.close();
server.close();
if (errs.length) { console.error('❌ 有未捕获异常'); process.exit(3); }
if (!dmOk) { console.error("❌ 死亡帧未被确认触发/绘制"); process.exit(5); }
if (bad.length) { console.error('❌ 以下特效在画面上不可见: ' + bad.map((b) => b.name).join(', ')); process.exit(2); }
process.exit(0);
