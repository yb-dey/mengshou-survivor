// 云端美术审计 —— 把游戏里的 AI 贴图全部导出成「联系表」+ 放大预览 + 实机截图。
// 目的：用眼睛判断美术质量与加载状态，而不是靠日志猜。
// 产物：ci/out/contact-sheet.png（全部贴图）/ sprites-enemy-x4.png（敌人放大4倍）/ battle.png（实机）
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const OUT = path.join('ci', 'out');
fs.mkdirSync(OUT, { recursive: true });

const gameDir = path.resolve('game');
const htmlFiles = fs.readdirSync(gameDir).filter((f) => f.toLowerCase().endsWith('.html'));
const entryName = htmlFiles[0];

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

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://127.0.0.1:${port}/${encodeURIComponent(entryName)}`, { waitUntil: 'load', timeout: 90000 });

// 等 AI_ART_READY 填充稳定
await page.waitForTimeout(4000);
let prev = -1, stable = 0;
for (let i = 0; i < 20; i++) {
  const n = await page.evaluate(() => (window.AI_ART_READY ? Object.keys(window.AI_ART_READY).length : -1));
  if (n === prev) { stable++; if (stable >= 3) break; } else stable = 0;
  prev = n;
  await page.waitForTimeout(500);
}

const info = await page.evaluate(() => {
  const T = window.AI_ART_TABLE || {};
  const R = window.AI_ART_READY || {};
  const tk = Object.keys(T), rk = Object.keys(R);
  const missing = tk.filter((k) => !rk.includes(k));
  // 逐张统计：尺寸 + 非透明像素占比（检测空图）
  const stats = {};
  for (const k of rk) {
    const cv = R[k];
    if (!cv || !cv.width) { stats[k] = { err: 'no canvas' }; continue; }
    try {
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let opaque = 0, total = 0;
      for (let i = 3; i < d.length; i += 4) { total++; if (d[i] > 8) opaque++; }
      stats[k] = { w: cv.width, h: cv.height, fillPct: +(opaque / total * 100).toFixed(1) };
    } catch (e) { stats[k] = { err: String(e).slice(0, 60) }; }
  }
  return { tableCount: tk.length, readyCount: rk.length, missing, keys: rk, stats };
});

console.log('表内 ' + info.tableCount + ' 张，已就绪 ' + info.readyCount + ' 张，缺失 ' + info.missing.length + ' 张');
if (info.missing.length) console.log('缺失: ' + info.missing.join(', '));

// 联系表：10 列，格 104x104
const sheet = await page.evaluate((keys) => {
  const R = window.AI_ART_READY;
  const COLS = 10, CELL = 104, PAD = 8;
  const rows = Math.ceil(keys.length / COLS);
  const cv = document.createElement('canvas');
  cv.width = COLS * CELL; cv.height = rows * CELL;
  const g = cv.getContext('2d');
  g.fillStyle = '#1b1b22'; g.fillRect(0, 0, cv.width, cv.height);
  keys.forEach((k, i) => {
    const cx = (i % COLS) * CELL, cy = Math.floor(i / COLS) * CELL;
    g.strokeStyle = '#3a3a46'; g.strokeRect(cx + .5, cy + .5, CELL - 1, CELL - 1);
    const spr = R[k];
    if (spr && spr.width) {
      const s = Math.min((CELL - PAD * 2) / spr.width, (CELL - PAD * 2 - 14) / spr.height, 3);
      const w = spr.width * s, h = spr.height * s;
      g.drawImage(spr, cx + (CELL - w) / 2, cy + 4 + (CELL - 18 - h) / 2, w, h);
    }
    g.fillStyle = '#c9c9d4'; g.font = '11px sans-serif'; g.textAlign = 'center';
    g.fillText(k.slice(0, 13), cx + CELL / 2, cy + CELL - 5);
  });
  return cv.toDataURL('image/png');
}, info.keys);
fs.writeFileSync(path.join(OUT, 'contact-sheet.png'), Buffer.from(sheet.split(',')[1], 'base64'));

// 敌人放大 4 倍（看清细节）
const enemyIds = info.keys.filter((k) => !/^(gear_|tal_|field_|fx_)/.test(k) && !/_\d+$/.test(k)).slice(0, 24);
const zoom = await page.evaluate((ids) => {
  const R = window.AI_ART_READY;
  const COLS = 6, CELL = 200;
  const rows = Math.ceil(ids.length / COLS);
  const cv = document.createElement('canvas');
  cv.width = COLS * CELL; cv.height = rows * CELL;
  const g = cv.getContext('2d');
  g.fillStyle = '#12121a'; g.fillRect(0, 0, cv.width, cv.height);
  ids.forEach((k, i) => {
    const cx = (i % COLS) * CELL, cy = Math.floor(i / COLS) * CELL;
    g.strokeStyle = '#33333f'; g.strokeRect(cx + .5, cy + .5, CELL - 1, CELL - 1);
    const spr = R[k];
    if (spr && spr.width) {
      const s = Math.min((CELL - 20) / spr.width, (CELL - 34) / spr.height, 8);
      const w = spr.width * s, h = spr.height * s;
      g.imageSmoothingEnabled = false; // 放大看像素，别糊
      g.drawImage(spr, cx + (CELL - w) / 2, cy + 6 + (CELL - 26 - h) / 2, w, h);
    }
    g.fillStyle = '#e0e0ea'; g.font = '13px sans-serif'; g.textAlign = 'center';
    g.fillText(k, cx + CELL / 2, cy + CELL - 6);
  });
  return cv.toDataURL('image/png');
}, enemyIds);
fs.writeFileSync(path.join(OUT, 'sprites-zoom-x8.png'), Buffer.from(zoom.split(',')[1], 'base64'));

// 实机战斗截图
await page.evaluate(() => { if (typeof window.guideSkipAll === 'function') window.guideSkipAll(); });
await page.waitForTimeout(1500);
const geom = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, cw: c.width, ch: c.height }; });
const px = geom.l + (316 / geom.cw) * geom.w, py = geom.t + (617 / geom.ch) * geom.h;
await page.mouse.click(px, py);
await page.waitForTimeout(9000);
await page.screenshot({ path: path.join(OUT, 'battle.png') });

const report = { info, enemySample: enemyIds, ranAt: new Date().toISOString() };
fs.writeFileSync(path.join(OUT, 'art-audit.json'), JSON.stringify(report, null, 2));

const md = [
  '# 美术审计',
  '',
  '- 贴图表条目: ' + info.tableCount,
  '- 已就绪: **' + info.readyCount + '**',
  '- 缺失: ' + info.missing.length + (info.missing.length ? ' → `' + info.missing.join('`, `') + '`' : ''),
  '',
  '## 贴图尺寸分布（前 40）',
  '',
  '| id | 尺寸 | 非透明占比 |',
  '|---|---|---|',
  ...Object.entries(info.stats).slice(0, 40).map(([k, v]) => '| ' + k + ' | ' + (v.w || '-') + '×' + (v.h || '-') + ' | ' + (v.fillPct ?? v.err ?? '-') + '% |'),
  '',
].join('\n');
fs.writeFileSync(path.join(OUT, 'report.md'), md);
console.log(md);

await browser.close();
server.close();
process.exit(info.missing.length === 0 ? 0 : 1);
