// 云端美术审计 —— 把游戏**实际用于绘制的** SPRITES 全部导出成「联系表」+ 放大预览 + 实机截图。
//
// 关键：AI_ART_TABLE / AI_ART_READY 不是全局变量（在闭包里），
// 但 window.SPRITES 是全局的，且它正是 drawImage 真正用到的那份 —— 所以看它最准。
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

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

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://127.0.0.1:${port}/${encodeURIComponent(entryName)}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForTimeout(4000);

// 先跳引导并开局，让所有动态精灵被真正创建出来
await page.evaluate(() => { if (typeof window.guideSkipAll === 'function') window.guideSkipAll(); });
await page.waitForTimeout(1200);
const geom = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, cw: c.width, ch: c.height }; });
await page.mouse.click(geom.l + (316 / geom.cw) * geom.w, geom.t + (617 / geom.ch) * geom.h);
await page.waitForTimeout(8000);   // 让敌人/子弹/宝石都生成

// 等 SPRITES 稳定
let prev = -1, stab = 0;
for (let i = 0; i < 20; i++) {
  const n = await page.evaluate(() => (window.SPRITES ? Object.keys(window.SPRITES).length : -1));
  if (n === prev) { stab++; if (stab >= 3) break; } else stab = 0;
  prev = n;
  await page.waitForTimeout(500);
}

const info = await page.evaluate(() => {
  const S = window.SPRITES || {};
  const keys = Object.keys(S).sort();
  const stats = {};
  for (const k of keys) {
    const cv = S[k];
    if (!cv || !cv.width) { stats[k] = { err: 'no canvas' }; continue; }
    try {
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let opaque = 0, total = 0;
      // 颜色丰富度：AI 位图颜色多；程序化剪影/纯色块颜色极少 → 用它区分「AI 贴图 vs 程序化回退」
      const pal = new Set();
      for (let i = 0; i < d.length; i += 4) {
        total++;
        if (d[i + 3] > 8) {
          opaque++;
          if (pal.size < 64) pal.add((d[i] >> 3) * 1024 + (d[i + 1] >> 3) * 32 + (d[i + 2] >> 3));
        }
      }
      stats[k] = { w: cv.width, h: cv.height, half: cv.half ?? null,
                   fillPct: +(opaque / total * 100).toFixed(1), colors: pal.size };
    } catch (e) { stats[k] = { err: String(e).slice(0, 60) }; }
  }
  const D = window.MENGSHOU_DEBUG || {};
  const artHooks = Object.keys(D).filter((k) => /art|sprite|skin|ready/i.test(k));
  return { count: keys.length, keys, stats, artHooks };
});

// 疑似「程序化回退」= 颜色极少（<=4）且不透明占比正常
const flat = Object.entries(info.stats)
  .filter(([, v]) => typeof v.colors === 'number' && v.colors <= 4)
  .map(([k, v]) => k + '(' + v.colors + '色,' + v.w + 'px)');
const rich = Object.values(info.stats).filter((v) => typeof v.colors === 'number' && v.colors > 16).length;
console.log('SPRITES 条目: ' + info.count + '  颜色丰富(>16色, 疑似AI): ' + rich +
            '  颜色极少(<=4色, 疑似程序化): ' + flat.length);
if (flat.length) console.log('  疑似程序化清单: ' + flat.join(', '));

// 联系表
// 内存口径对齐：本项目的「像素内存」到底指什么？同时量三个口径，一次说清。
const mem = await page.evaluate(() => {
  const m = performance.memory || {};
  let canvasBytes = 0, n = 0, nonTileBytes = 0, nonTileN = 0;
  for (const k in window.SPRITES) {
    const cv = window.SPRITES[k];
    if (!cv || !cv.width) continue;
    const b = cv.width * cv.height * 4;
    canvasBytes += b; n++;
    if (k !== 'groundTile') { nonTileBytes += b; nonTileN++; }
  }
  const MB = 1048576;
  return {
    usedJSHeapMB: m.usedJSHeapSize ? +(m.usedJSHeapSize / MB).toFixed(2) : null,
    totalJSHeapMB: m.totalJSHeapSize ? +(m.totalJSHeapSize / MB).toFixed(2) : null,
    canvasMB: +(canvasBytes / MB).toFixed(2), canvasCount: n,
    canvasNonTileMB: +(nonTileBytes / MB).toFixed(2), canvasNonTileCount: nonTileN,
  };
});
console.log('内存口径: JS堆=' + mem.usedJSHeapMB + 'MB  画布总和=' + mem.canvasMB + 'MB(' + mem.canvasCount +
            '张)  画布(除地面瓦片)=' + mem.canvasNonTileMB + 'MB(' + mem.canvasNonTileCount + '张)');

const sheet = await page.evaluate((keys) => {
  const S = window.SPRITES;
  const COLS = 12, CELL = 96, PAD = 6;
  const rows = Math.ceil(keys.length / COLS);
  const cv = document.createElement('canvas');
  cv.width = COLS * CELL; cv.height = rows * CELL;
  const g = cv.getContext('2d');
  g.fillStyle = '#1b1b22'; g.fillRect(0, 0, cv.width, cv.height);
  keys.forEach((k, i) => {
    const cx = (i % COLS) * CELL, cy = Math.floor(i / COLS) * CELL;
    g.strokeStyle = '#3a3a46'; g.strokeRect(cx + .5, cy + .5, CELL - 1, CELL - 1);
    const spr = S[k];
    if (spr && spr.width) {
      const s = Math.min((CELL - PAD * 2) / spr.width, (CELL - PAD * 2 - 12) / spr.height, 3);
      const w = spr.width * s, h = spr.height * s;
      g.drawImage(spr, cx + (CELL - w) / 2, cy + 3 + (CELL - 16 - h) / 2, w, h);
    }
    g.fillStyle = '#c9c9d4'; g.font = '10px sans-serif'; g.textAlign = 'center';
    g.fillText(k.slice(0, 15), cx + CELL / 2, cy + CELL - 4);
  });
  return cv.toDataURL('image/png');
}, info.keys);
fs.writeFileSync(path.join(OUT, 'contact-sheet.png'), Buffer.from(sheet.split(',')[1], 'base64'));

// 敌人放大 8 倍（看清笔触）
const enemyIds = info.keys.filter((k) => /^(rabbit|bear|mouse|fox|raven|orbitcrab|boomfruit|sporecap|burrowmole|hedgehog|chargerhino|shieldbug|honeypot|leaptoad|rollshell|boss1|boss2|boss3|player|gem0|gem1|gem2|coin)$/.test(k));
const zoom = await page.evaluate((ids) => {
  const S = window.SPRITES;
  const COLS = 6, CELL = 200;
  const rows = Math.ceil(ids.length / COLS);
  const cv = document.createElement('canvas');
  cv.width = COLS * CELL; cv.height = rows * CELL;
  const g = cv.getContext('2d');
  g.fillStyle = '#12121a'; g.fillRect(0, 0, cv.width, cv.height);
  ids.forEach((k, i) => {
    const cx = (i % COLS) * CELL, cy = Math.floor(i / COLS) * CELL;
    g.strokeStyle = '#33333f'; g.strokeRect(cx + .5, cy + .5, CELL - 1, CELL - 1);
    const spr = S[k];
    if (spr && spr.width) {
      const s = Math.min((CELL - 16) / spr.width, (CELL - 30) / spr.height, 9);
      const w = spr.width * s, h = spr.height * s;
      g.imageSmoothingEnabled = false;
      g.drawImage(spr, cx + (CELL - w) / 2, cy + 4 + (CELL - 24 - h) / 2, w, h);
    }
    g.fillStyle = '#e0e0ea'; g.font = '13px sans-serif'; g.textAlign = 'center';
    g.fillText(k, cx + CELL / 2, cy + CELL - 5);
  });
  return cv.toDataURL('image/png');
}, enemyIds);
fs.writeFileSync(path.join(OUT, 'sprites-zoom-x8.png'), Buffer.from(zoom.split(',')[1], 'base64'));

await page.screenshot({ path: path.join(OUT, 'battle.png') });

const report = { info, enemySample: enemyIds, ranAt: new Date().toISOString() };
fs.writeFileSync(path.join(OUT, 'art-audit.json'), JSON.stringify(report, null, 2));

const md = [
  '# 美术审计（基于实际绘制的 SPRITES）',
  '',
  '## 内存口径（先对齐，再谈优化）',
  '',
  '| 口径 | 数值 |',
  '|---|---|',
  '| JS 堆 usedJSHeapSize | ' + (mem.usedJSHeapMB ?? '-') + ' MB |',
  '| 画布总和（全部 ' + mem.canvasCount + ' 张） | **' + mem.canvasMB + ' MB** |',
  '| 画布总和（除地面瓦片） | ' + mem.canvasNonTileMB + ' MB（' + mem.canvasNonTileCount + ' 张） |',
  '',
  '- SPRITES 条目: **' + info.count + '**',
  '- 颜色丰富（>16 色，疑似 AI 位图）: **' + rich + '**',
  '- 颜色极少（≤4 色，疑似程序化回退）: **' + flat.length + '**',
  '',
  '## 疑似程序化回退清单（颜色 ≤4，是最可能的「缺美术」候选）',
  '',
  ...(flat.length ? flat.map((f) => '- `' + f + '`') : ['（无）']),
  '',
  '## 逐项：尺寸 / half / 非透明占比 / 颜色数',
  '',
  '| id | 尺寸 | half | 非透明% | 颜色数 |',
  '|---|---|---|---|---|',
  ...Object.entries(info.stats).map(([k, v]) => '| ' + k + ' | ' + (v.w || '-') + '×' + (v.h || '-') + ' | ' + (v.half ?? '-') + ' | ' + (v.fillPct ?? v.err ?? '-') + ' | ' + (v.colors ?? '-') + ' |'),
  '',
].join('\n');
fs.writeFileSync(path.join(OUT, 'report.md'), md);
console.log(md);

await browser.close();
server.close();
process.exit(0);
