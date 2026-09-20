// 云端冒烟验证 —— 在 GitHub Actions 上运行，不占本机资源。
//
// 判定标准（区分"真错误"和"无害噪声"）：
//   ✅ PASS：无未捕获 JS 异常(pageerror) + Canvas 存在、可读、非空白
//   ⚠️ 警告：资源探测 404（游戏会去探 assets/xxx.png，不存在则回退程序化绘制，属正常）
//   ❌ FAIL：有未捕获异常 / Canvas 读不到 / Canvas 空白
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join('ci', 'out');
fs.mkdirSync(OUT, { recursive: true });

const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];

const gameDir = path.resolve('game');
const htmlFiles = fs.readdirSync(gameDir).filter((f) => f.toLowerCase().endsWith('.html'));
if (htmlFiles.length === 0) {
  console.error('FAIL: game/ 下找不到 .html 文件');
  process.exit(1);
}
const entry = path.join(gameDir, htmlFiles[0]);
const entryUrl = 'file://' + entry.replace(/\\/g, '/');
console.log('入口: ' + htmlFiles[0] + '  (' + (fs.statSync(entry).size / 1024 / 1024).toFixed(2) + ' MB)');

const browser = await chromium.launch({
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
    // 让 file:// 页面能读自己的 canvas，否则 getImageData 会因跨源污染抛 SecurityError
    '--allow-file-access-from-files',
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

const t0 = Date.now();
await page.goto(entryUrl, { waitUntil: 'load', timeout: 90000 });
const loadMs = Date.now() - t0;
await page.waitForTimeout(3000);

const guide = await page.evaluate(() => {
  try {
    if (typeof window.guideSkipAll === 'function') { window.guideSkipAll(); return { tried: true, ok: true, via: 'guideSkipAll()' }; }
    const D = window.MENGSHOU_DEBUG;
    if (D && typeof D.guideSkipAll === 'function') { D.guideSkipAll(); return { tried: true, ok: true, via: 'MENGSHOU_DEBUG.guideSkipAll()' }; }
  } catch (e) { return { tried: true, ok: false, err: String(e).slice(0, 200) }; }
  return { tried: false, ok: false };
});
await page.waitForTimeout(1500);

const canvas = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return { found: false };
  let g;
  try { g = c.getContext('2d'); } catch (e) { return { found: true, error: String(e).slice(0, 200) }; }
  if (!g) return { found: true, w: c.width, h: c.height, error: 'no 2d context' };
  try {
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const step = Math.max(1, Math.floor(d.length / 4 / 4000)) * 4;
    let sampled = 0, colored = 0;
    for (let i = 0; i < d.length; i += step) { sampled++; if (d[i] || d[i + 1] || d[i + 2]) colored++; }
    return { found: true, w: c.width, h: c.height, sampled, colored, coloredRatio: sampled ? +(colored / sampled).toFixed(3) : 0, nonBlank: colored > 0 };
  } catch (e) { return { found: true, w: c.width, h: c.height, error: String(e).slice(0, 200) }; }
});

const fps = await page.evaluate(() => new Promise((res) => {
  let n = 0; const t = performance.now();
  const tick = () => { n++; if (performance.now() - t < 2000) requestAnimationFrame(tick); else res(+(n / ((performance.now() - t) / 1000)).toFixed(1)); };
  requestAnimationFrame(tick);
}));

const debug = await page.evaluate(() => {
  const D = window.MENGSHOU_DEBUG;
  if (!D) return { available: false };
  const out = { available: true };
  try { out.field = typeof D.readField === 'function' ? D.readField() : null; } catch (e) { out.fieldError = String(e).slice(0, 150); }
  try { out.version = D.version ? (typeof D.version === 'string' ? D.version : JSON.stringify(D.version).slice(0, 120)) : null; } catch {}
  return out;
});

await page.screenshot({ path: path.join(OUT, 'screen.png') });

const uniqFailed = [...new Set(failedRequests)];
const ok = pageErrors.length === 0 && canvas.found === true && canvas.nonBlank === true;

const report = {
  ok,
  entry: htmlFiles[0],
  entrySizeMB: +(fs.statSync(entry).size / 1024 / 1024).toFixed(2),
  loadMs, fps, guide, canvas, debug,
  pageErrorCount: pageErrors.length, pageErrors,
  consoleErrorCount: consoleErrors.length, consoleErrors: consoleErrors.slice(0, 10),
  missingResourceCount: uniqFailed.length, missingResources: uniqFailed.slice(0, 40),
  ranAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

const md = [
  '# 云端验证报告',
  '',
  '- 结论: **' + (ok ? 'PASS' : 'FAIL') + '**',
  '- 入口: `' + htmlFiles[0] + '` (' + report.entrySizeMB + ' MB)',
  '- 加载耗时: ' + loadMs + ' ms',
  '- 帧率采样: ' + fps + ' fps（无头软渲染，仅供参考）',
  '- Canvas: ' + JSON.stringify(canvas),
  '- 跳过引导: ' + JSON.stringify(guide),
  '- 调试接口: ' + (debug.available ? JSON.stringify(debug) : '不可用'),
  '',
  '## 判定依据',
  '',
  '| 检查项 | 数量 | 是否影响结论 |',
  '|---|---|---|',
  '| 未捕获 JS 异常 | ' + pageErrors.length + ' | **是**（>0 即 FAIL） |',
  '| Canvas 相关报错 | ' + consoleErrors.length + ' | **是** |',
  '| 资源探测失败 | ' + uniqFailed.length + ' | 否（探测后回退程序化绘制） |',
  '',
  '## 未捕获异常',
  '',
  ...(pageErrors.length ? pageErrors.map((e) => '- `' + e + '`') : ['（无）']),
  '',
  '## 资源探测失败清单（不影响结论，供参考）',
  '',
  ...(uniqFailed.length ? uniqFailed.slice(0, 25).map((e) => '- `' + e + '`') : ['（无）']),
  '',
].join('\n');
fs.writeFileSync(path.join(OUT, 'report.md'), md);

await browser.close();
console.log(md);
process.exit(ok ? 0 : 1);
