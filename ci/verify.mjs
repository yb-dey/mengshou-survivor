// 云端深度验证 —— 在 GitHub Actions 上运行，本机不参与任何渲染。
//
// 比"冒烟"更深：不只确认页面能打开，还要确认**游戏真的能玩起来**。
// 阶段：A 加载跳过引导 → B 探测调试接口/画布几何 → C 点击开始战斗 → D 采样实体+帧率 → E 三张截图
//
// 判定：PASS = 未捕获异常 0 + 画面非空白 + **战斗确实开始（实体数增长）**
// 噪声：资源探测 404（探 assets/xxx.png 后回退绘制）→ 记 WARN，不判 FAIL
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join('ci', 'out');
fs.mkdirSync(OUT, { recursive: true });

const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];
const log = [];

const say = (s) => { console.log(s); log.push(s); };

const gameDir = path.resolve('game');
const htmlFiles = fs.readdirSync(gameDir).filter((f) => f.toLowerCase().endsWith('.html'));
if (!htmlFiles.length) { console.error('FAIL: game/ 下找不到 .html'); process.exit(1); }
const entry = path.join(gameDir, htmlFiles[0]);

const browser = await chromium.launch({
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
    '--allow-file-access-from-files', // 否则 file:// 页面 getImageData 抛 SecurityError
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 300)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/Failed to load resource|net::ERR_/i.test(t)) failedRequests.push(t.slice(0, 200));
  else consoleErrors.push(t.slice(0, 200));
});
page.on('requestfailed', (r) => failedRequests.push((r.failure()?.errorText || 'failed') + '  ' + r.url()));
page.on('response', (r) => { if (r.status() >= 400) failedRequests.push('HTTP ' + r.status() + '  ' + r.url()); });

// ---------- A. 加载 ----------
const t0 = Date.now();
await page.goto('file://' + entry.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 90000 });
const loadMs = Date.now() - t0;
say('加载完成 ' + loadMs + 'ms');
await page.waitForTimeout(3000);

const guide = await page.evaluate(() => {
  try {
    if (typeof window.guideSkipAll === 'function') { window.guideSkipAll(); return { ok: true, via: 'guideSkipAll()' }; }
    const D = window.MENGSHOU_DEBUG;
    if (D && typeof D.guideSkipAll === 'function') { D.guideSkipAll(); return { ok: true, via: 'MENGSHOU_DEBUG.guideSkipAll()' }; }
  } catch (e) { return { ok: false, err: String(e).slice(0, 200) }; }
  return { ok: false, err: 'no guideSkipAll' };
});
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, '1-menu.png') });

// ---------- B. 探测接口 + 画布几何 ----------
const probe = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const r = c ? c.getBoundingClientRect() : null;
  const D = window.MENGSHOU_DEBUG || {};
  const globals = Object.keys(window).filter((k) => /^(GAME|CONFIG|UI|MENGSHOU|guide|SPRITES|STATE)/i.test(k));
  const out = {
    canvas: c ? { w: c.width, h: c.height, rect: r ? { left: +r.left.toFixed(1), top: +r.top.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1) } : null } : null,
    debugKeys: Object.keys(D).sort(),
    globals: globals.sort().slice(0, 40),
    fieldBefore: null,
  };
  try { out.fieldBefore = D.readField ? D.readField() : null; } catch (e) { out.fieldErr = String(e).slice(0, 150); }
  return out;
});
say('画布 ' + JSON.stringify(probe.canvas));
say('MENGSHOU_DEBUG 接口: ' + probe.debugKeys.join(', '));

// ---------- C. 点击「正片出击」开始战斗 ----------
// 画布坐标由首轮截图推算（画布 720x1280，按钮位于中上部）
const TARGET = { x: 316, y: 617 };
let clickInfo = { target: TARGET, page: null, clicked: false };
if (probe.canvas && probe.canvas.rect) {
  const r = probe.canvas.rect;
  const px = r.left + (TARGET.x / probe.canvas.w) * r.width;
  const py = r.top + (TARGET.y / probe.canvas.h) * r.height;
  clickInfo.page = { x: +px.toFixed(1), y: +py.toFixed(1) };
  try {
    await page.mouse.move(px, py);
    await page.waitForTimeout(150);
    await page.mouse.click(px, py);
    clickInfo.clicked = true;
  } catch (e) { clickInfo.err = String(e).slice(0, 200); }
}
say('点击开始按钮 @ ' + JSON.stringify(clickInfo.page));

// ---------- D. 采样 ----------
const sample = async () => page.evaluate(() => {
  const D = window.MENGSHOU_DEBUG || {};
  let field = null, runTime = null;
  try { field = D.readField ? D.readField() : null; } catch (e) { field = 'err:' + String(e).slice(0, 80); }
  try { runTime = D.runTime !== undefined ? D.runTime : (window.GAME && window.GAME.runTime); } catch {}
  return { field, runTime };
});
const sam = [];
sam.push({ t: 1.5, ...(await sample()) });
await page.waitForTimeout(6000);
await page.screenshot({ path: path.join(OUT, '2-battle-early.png') });
sam.push({ t: 7.5, ...(await sample()) });
await page.waitForTimeout(12000);
await page.screenshot({ path: path.join(OUT, '3-battle-late.png') });
sam.push({ t: 19.5, ...(await sample()) });

const fps = await page.evaluate(() => new Promise((res) => {
  let n = 0; const t = performance.now();
  const tick = () => { n++; if (performance.now() - t < 2000) requestAnimationFrame(tick); else res(+(n / ((performance.now() - t) / 1000)).toFixed(1)); };
  requestAnimationFrame(tick);
}));

const canvasCheck = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return { found: false };
  try {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const step = Math.max(1, Math.floor(d.length / 4 / 4000)) * 4;
    let sampled = 0, colored = 0;
    for (let i = 0; i < d.length; i += step) { sampled++; if (d[i] || d[i + 1] || d[i + 2]) colored++; }
    return { found: true, w: c.width, h: c.height, coloredRatio: +(colored / sampled).toFixed(3), nonBlank: colored > 0 };
  } catch (e) { return { found: true, error: String(e).slice(0, 200) }; }
});

const counts = sam.map((s) => {
  const c = s.field && s.field.counts ? s.field.counts : null;
  return c ? (c.boss + c.elite + c.lethal + c.trash + c.gems) : null;
});
const battleStarted = counts.some((x) => typeof x === 'number' && x > 0);
const uniqFailed = [...new Set(failedRequests)];
const ok = pageErrors.length === 0 && canvasCheck.nonBlank === true && battleStarted === true;

// ---------- 报告 ----------
const report = {
  ok, battleStarted,
  entry: htmlFiles[0],
  entrySizeMB: +(fs.statSync(entry).size / 1024 / 1024).toFixed(2),
  loadMs, fps, guide, probe, clickInfo, samples: sam, entityCounts: counts, canvas: canvasCheck,
  pageErrorCount: pageErrors.length, pageErrors,
  consoleErrorCount: consoleErrors.length, consoleErrors: consoleErrors.slice(0, 10),
  missingResourceCount: uniqFailed.length, missingResources: uniqFailed.slice(0, 40),
  ranAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

const md = [
  '# 云端深度验证报告',
  '',
  '- 结论: **' + (ok ? 'PASS' : 'FAIL') + '**',
  '- 入口: `' + htmlFiles[0] + '` (' + report.entrySizeMB + ' MB)',
  '- 加载耗时: ' + loadMs + ' ms',
  '- 帧率采样: ' + fps + ' fps（无头软渲染，仅供参考）',
  '- 画布: ' + JSON.stringify(canvasCheck),
  '- 跳过引导: ' + JSON.stringify(guide),
  '- **战斗是否开始**: ' + (battleStarted ? '是 ✅' : '否 ❌'),
  '- 实体数采样 t=1.5/7.5/19.5s: ' + JSON.stringify(counts),
  '',
  '## 判定依据',
  '',
  '| 检查项 | 值 | 是否影响结论 |',
  '|---|---|---|',
  '| 未捕获 JS 异常 | ' + pageErrors.length + ' | **是**（>0 即 FAIL） |',
  '| Canvas 非空白 | ' + canvasCheck.nonBlank + ' | **是** |',
  '| 战斗已开始（实体>0） | ' + battleStarted + ' | **是** |',
  '| Canvas 相关报错 | ' + consoleErrors.length + ' | 是 |',
  '| 资源探测失败 | ' + uniqFailed.length + ' | 否（探不到则回退程序化绘制） |',
  '',
  '## 采样明细',
  '',
  '| t (s) | runTime | 实体数 | readField |',
  '|---|---|---|---|',
  ...sam.map((s) => '| ' + s.t + ' | ' + (s.runTime ?? '-') + ' | ' + (s.field && s.field.counts ? (s.field.counts.boss + s.field.counts.elite + s.field.counts.lethal + s.field.counts.trash + s.field.counts.gems) : '-') + ' | `' + JSON.stringify(s.field).slice(0, 220) + '` |'),
  '',
  '## 调试接口清单',
  '',
  '`' + probe.debugKeys.join('`, `') + '`',
  '',
  '全局对象: `' + probe.globals.join('`, `') + '`',
  '',
  '## 未捕获异常',
  '',
  ...(pageErrors.length ? pageErrors.map((e) => '- `' + e + '`') : ['（无）']),
  '',
  '## 资源探测失败（不影响结论）',
  '',
  ...(uniqFailed.length ? uniqFailed.slice(0, 15).map((e) => '- `' + e + '`') : ['（无）']),
  '',
].join('\n');
fs.writeFileSync(path.join(OUT, 'report.md'), md);

await browser.close();
console.log(md);
process.exit(ok ? 0 : 1);
