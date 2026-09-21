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
      let opaque = 0, total = 0, lumSum = 0, satSum = 0;
      // 颜色丰富度：AI 位图颜色多；程序化剪影/纯色块颜色极少 → 用它区分「AI 贴图 vs 程序化回退」
      const pal = new Set();
      for (let i = 0; i < d.length; i += 4) {
        total++;
        if (d[i + 3] > 8) {
          opaque++;
          const R = d[i], G = d[i + 1], B = d[i + 2];
          lumSum += 0.2126 * R + 0.7152 * G + 0.0722 * B;    // 感知亮度：找"在暗场上看不见"的单位
          const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
          satSum += mx ? (mx - mn) / mx : 0;                 // 饱和度：找"灰掉了"的图
          if (pal.size < 64) pal.add((R >> 3) * 1024 + (G >> 3) * 32 + (B >> 3));
        }
      }
      stats[k] = { w: cv.width, h: cv.height, half: cv.half ?? null,
                   fillPct: +(opaque / total * 100).toFixed(1), colors: pal.size,
                   lum: +(lumSum / Math.max(1, opaque)).toFixed(1),
                   sat: +(satSum / Math.max(1, opaque)).toFixed(3) };
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

// 离群检测（上次靠这招找到"乌鸦在暗场上看不见"）
const ENEMY = /^(leaptoad|rabbit|bear|mouse|fox|raven|orbitcrab|boomfruit|sporecap|burrowmole|hedgehog|chargerhino|shieldbug|honeypot|boss1|rollshell|boss2|boss3|badger|boar|monkey)_?(dead|hit|enraged)?$/;

// ===== 2026-09-21 扩展：原来只体检 ENEMY，其余类别（跟宠/图标/子弹/宝石/主角）从未体检 =====
// 家族归类：先按已知前缀，再按剥离状态后缀的基名 —— 这样新类别会自动成组，不需要维护清单
const FAMILY_PREFIX = /^(blt|bs|gear|tal|field|pas|evo|gem|pet|beastsil|beast|hero|coin|item|fx|ui)_/;
function familyOf(k) {
  if (ENEMY.test(k)) return 'ENEMY';
  const m = FAMILY_PREFIX.exec(k);
  return m ? m[1].toUpperCase() : ('OTHER_' + k.replace(/_(dead|hit|enraged|m)$/, ''));
}
const byFam = {};
for (const [k, v] of Object.entries(info.stats)) {
  if (typeof v.lum !== 'number') continue;
  const f = familyOf(k);
  (byFam[f] = byFam[f] || []).push([k, v]);
}
const statOf = (rows, f) => {
  const a = rows.map(([, v]) => v[f]);
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return { m, sd: Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length) };
};

// 绝对底线：家族若整体偏暗/偏灰，±2σ 什么也抓不到 —— 必须另设与家族无关的硬阈值
const ABS_DARK = 55, ABS_GRAY = 0.12, MIN_FILL = 15;
const famReport = [];
for (const [fam, rows] of Object.entries(byFam).sort((a, b) => b[1].length - a[1].length)) {
  const L = statOf(rows, 'lum'), Sa = statOf(rows, 'sat');
  const rec = { fam, n: rows.length, lum: +L.m.toFixed(1), lumSd: +L.sd.toFixed(1),
                sat: +Sa.m.toFixed(3), satSd: +Sa.sd.toFixed(3) };
  if (rows.length >= 4) {
    rec.darkOut = rows.filter(([, v]) => L.sd > 0 && v.lum < L.m - 2 * L.sd).map(([k, v]) => k + '(' + v.lum + ')');
    rec.grayOut = rows.filter(([, v]) => Sa.sd > 0 && v.sat < Sa.m - 2 * Sa.sd).map(([k, v]) => k + '(' + v.sat + ')');
    rec.tooDark = rows.filter(([, v]) => v.lum < ABS_DARK && v.fillPct > MIN_FILL).map(([k, v]) => k + '(' + v.lum + ')');
    rec.washed = rows.filter(([, v]) => v.sat < ABS_GRAY && v.fillPct > MIN_FILL).map(([k, v]) => k + '(' + v.sat + ')');
  }
  famReport.push(rec);
}
console.log('\n===== 分类体检（家族 n≥4 才有统计意义）=====');
for (const r of famReport) {
  console.log('  ' + r.fam.padEnd(12) + 'n=' + String(r.n).padStart(3)
    + '  亮度 ' + String(r.lum).padStart(6) + ' ±' + String(r.lumSd).padStart(5)
    + '  饱和 ' + String(r.sat).padStart(6) + ' ±' + String(r.satSd).padStart(6));
  if (r.darkOut && r.darkOut.length) console.log('       暗离群(<-2σ): ' + r.darkOut.join(', '));
  if (r.grayOut && r.grayOut.length) console.log('       灰离群(<-2σ): ' + r.grayOut.join(', '));
  if (r.tooDark && r.tooDark.length) console.log('       ⚠ 绝对过暗(<' + ABS_DARK + '): ' + r.tooDark.join(', '));
  if (r.washed && r.washed.length) console.log('       ⚠ 绝对过灰(<' + ABS_GRAY + '): ' + r.washed.join(', '));
}
// 老结论（保持兼容）：敌人亮度离群
const eRows = Object.entries(info.stats).filter(([k, v]) => ENEMY.test(k) && typeof v.lum === 'number');
const lums = eRows.map(([, v]) => v.lum);
const eMean = lums.reduce((a, b) => a + b, 0) / Math.max(1, lums.length);
const eSd = Math.sqrt(lums.reduce((a, b) => a + (b - eMean) ** 2, 0) / Math.max(1, lums.length));
const outLum = eRows.filter(([, v]) => v.lum < eMean - 2 * eSd).map(([k, v]) => k + '(亮度' + v.lum + ')');
const lowSat = Object.entries(info.stats)
  .filter(([, v]) => typeof v.sat === 'number' && v.sat < 0.10 && (v.fillPct ?? 0) > 12)
  .map(([k, v]) => k + '(饱和' + v.sat + ')');
console.log('敌人亮度 均值 ' + eMean.toFixed(1) + ' σ ' + eSd.toFixed(1) +
            ' ｜ 离群(低于均值−2σ): ' + (outLum.join(', ') || '无'));
console.log('低饱和(<0.10)候选(前 12): ' + (lowSat.slice(0, 12).join(', ') || '无'));

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
// 本轮新生成的贴图做风格一致性核对（此前只肉眼验过 1 张，属 QA 缺口）
const NEW_IDS = /^(leaptoad|raven|orbitcrab|boomfruit|sporecap|burrowmole|hedgehog|chargerhino|shieldbug|honeypot|rollshell|bear|rabbit|boss1)$/;
const enemyIds = info.keys.filter((k) => /_(dead|hit)$/.test(k) && NEW_IDS.test(k.replace(/_(dead|hit)$/, '')));
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

const report = { info, enemySample: enemyIds, famReport, ranAt: new Date().toISOString() };
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
  '## 离群检测（可读性）',
  '',
  '- 敌人亮度：均值 ' + eMean.toFixed(1) + ' · σ ' + eSd.toFixed(1),
  '- **低于均值−2σ 的离群（潜在"在暗场上看不见"）**：' + (outLum.join('、') || '无 ✅'),
  '- 低饱和候选（<0.10，前 12）：' + (lowSat.slice(0, 12).join('、') || '无'),
  '',
  '| id | 尺寸 | 亮度 | 饱和度 | 非透明% |',
  '|---|---|---|---|---|',
  ...Object.entries(info.stats).filter(([k]) => ENEMY.test(k)).map(([k, v]) =>
    '| ' + k + ' | ' + (v.w || '-') + '×' + (v.h || '-') + ' | ' + (v.lum ?? '-') + ' | ' + (v.sat ?? '-') + ' | ' + (v.fillPct ?? '-') + ' |'),
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
