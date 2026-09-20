// 云端冒烟验证 —— 在 GitHub Actions 上运行，不占本机资源。
// 检查：页面加载无 JS 报错 / Canvas 渲染非空白 / 调试接口可用 / 帧率采样。
// 产出：ci/out/report.json、ci/out/report.md、ci/out/screen.png
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join('ci', 'out');
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const consoleMsgs = [];

// 找到 game/ 下的入口 HTML（不硬编码中文文件名，避免编码问题）
const gameDir = path.resolve('game');
const htmlFiles = fs.readdirSync(gameDir).filter((f) => f.toLowerCase().endsWith('.html'));
if (htmlFiles.length === 0) {
  console.error('FAIL: game/ 下找不到 .html 文件');
  process.exit(1);
}
const entry = path.join(gameDir, htmlFiles[0]);
const entryUrl = 'file://' + entry.replace(/\\/g, '/');
console.log('入口文件: ' + htmlFiles[0]);
console.log('大小: ' + (fs.statSync(entry).size / 1024 / 1024).toFixed(2) + ' MB');

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text());
  else consoleMsgs.push(m.type() + ': ' + m.text());
});

const t0 = Date.now();
await page.goto(entryUrl, { waitUntil: 'load', timeout: 90000 });
const loadMs = Date.now() - t0;

await page.waitForTimeout(3000);

// 试着跳过引导（优先调游戏内部函数，不靠坐标点击）
const guide = await page.evaluate(() => {
  const out = { tried: false, ok: false };
  try {
    if (typeof window.guideSkipAll === 'function') {
      window.guideSkipAll();
      out.tried = true;
      out.ok = true;
      out.via = 'global guideSkipAll()';
      return out;
    }
    const D = window.MENGSHOU_DEBUG;
    if (D && typeof D.guideSkipAll === 'function') {
      D.guideSkipAll();
      out.tried = true;
      out.ok = true;
      out.via = 'MENGSHOU_DEBUG.guideSkipAll()';
      return out;
    }
  } catch (e) {
    out.err = String(e);
  }
  return out;
});

await page.waitForTimeout(1500);

// Canvas 非空白检查
const canvas = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return { found: false };
  let g;
  try {
    g = c.getContext('2d');
  } catch (e) {
    return { found: true, error: String(e) };
  }
  if (!g) return { found: true, w: c.width, h: c.height, error: 'no 2d context' };
  try {
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const step = Math.max(1, Math.floor(d.length / 4 / 4000)) * 4;
    let sampled = 0;
    let colored = 0;
    for (let i = 0; i < d.length; i += step) {
      sampled++;
      if (d[i] || d[i + 1] || d[i + 2]) colored++;
    }
    return {
      found: true,
      w: c.width,
      h: c.height,
      sampled,
      colored,
      coloredRatio: sampled ? +(colored / sampled).toFixed(3) : 0,
      nonBlank: colored > 0,
    };
  } catch (e) {
    return { found: true, w: c.width, h: c.height, error: String(e) };
  }
});

// 帧率采样（2 秒）
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let n = 0;
      const t = performance.now();
      const tick = () => {
        n++;
        if (performance.now() - t < 2000) requestAnimationFrame(tick);
        else resolve(+(n / ((performance.now() - t) / 1000)).toFixed(1));
      };
      requestAnimationFrame(tick);
    })
);

// 调试接口采样
const debug = await page.evaluate(() => {
  const D = window.MENGSHOU_DEBUG;
  if (!D) return { available: false };
  const out = { available: true, keys: Object.keys(D).slice(0, 40) };
  try {
    out.field = typeof D.readField === 'function' ? D.readField() : null;
  } catch (e) {
    out.fieldError = String(e);
  }
  try {
    out.guide = typeof D.guide === 'function' ? D.guide() : null;
  } catch (e) {
    out.guideError = String(e);
  }
  return out;
});

await page.screenshot({ path: path.join(OUT, 'screen.png') });

const ok = errors.length === 0 && canvas.found === true && canvas.nonBlank === true;

const report = {
  ok,
  entry: htmlFiles[0],
  entrySizeMB: +(fs.statSync(entry).size / 1024 / 1024).toFixed(2),
  loadMs,
  fps,
  guide,
  canvas,
  debug,
  errorCount: errors.length,
  errors,
  consoleCount: consoleMsgs.length,
  ranAt: new Date().toISOString(),
};

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

const md = [
  '# 云端验证报告',
  '',
  '- 结论: **' + (ok ? 'PASS' : 'FAIL') + '**',
  '- 入口: `' + htmlFiles[0] + '` (' + report.entrySizeMB + ' MB)',
  '- 加载耗时: ' + loadMs + ' ms',
  '- 帧率采样: ' + fps + ' fps',
  '- Canvas: ' + JSON.stringify(canvas),
  '- 跳过引导: ' + JSON.stringify(guide),
  '- 调试接口: ' + (debug.available ? JSON.stringify(debug.field) : '不可用'),
  '- JS 报错: ' + errors.length + ' 条',
  '',
  '## 错误明细',
  '',
  ...(errors.length ? errors.map((e) => '- `' + e + '`') : ['（无）']),
  '',
].join('\n');
fs.writeFileSync(path.join(OUT, 'report.md'), md);

await browser.close();

console.log(JSON.stringify(report, null, 2));
process.exit(ok ? 0 : 1);
