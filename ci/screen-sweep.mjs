// 全界面巡检（云端）—— 用 MENGSHOU_DEBUG 的界面钩子逐个打开并截图。
// 目的：把「哪一屏做得差」从猜测变成可看的事实，而不是继续凭印象猜。
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
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
await page.goto(`http://127.0.0.1:${port}/${encodeURIComponent(entryName)}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForTimeout(4000);
await page.evaluate(() => { if (typeof window.guideSkipAll === 'function') window.guideSkipAll(); });
await page.waitForTimeout(1800);

// 可用作导航的 debug 钩子（先探测存在性）
const available = await page.evaluate(() => {
  const D = window.MENGSHOU_DEBUG || {};
  const want = ['hall', 'goHome', 'openGear', 'closeGear', 'openUp', 'openVault', 'openBeast', 'openChapters',
    'openPetCard', 'codex', 'about', 'lore', 'pause', 'levelup', 'resultBuild', 'win', 'lose', 'daily',
    'startDaily', 'enterRoom', 'enterSkip', 'upgradeView', 'forgeView', 'vaultTapCraft', 'vaultTapTalent',
    'openVault', 'showGearPick', 'heroSheet', 'openUp', 'gearPreview'];
  return want.filter((k) => typeof D[k] === 'function');
});

const STEPS = [
  { name: '01-home', call: 'hall' },
  { name: '02-chapters', call: 'openChapters' },
  { name: '03-gear', call: 'openGear' },
  { name: '04-upgrade', call: 'openUp' },
  { name: '05-vault', call: 'openVault' },
  { name: '06-beast', call: 'openBeast' },
  { name: '07-codex', call: 'codex' },
  { name: '08-hero', call: 'heroSheet' },
  { name: '09-about', call: 'about' },
  { name: '10-daily', call: 'daily' },
];

const shots = [];
for (const s of STEPS) {
  if (!available.includes(s.call)) { shots.push({ name: s.name, skipped: 'no hook ' + s.call }); continue; }
  try {
    await page.evaluate((c) => { try { window.MENGSHOU_DEBUG[c](); } catch (e) { return String(e); } }, s.call);
    await page.waitForTimeout(1400);
    await page.screenshot({ path: path.join(OUT, s.name + '.png') });
    // 顺手量一下这一屏的「有效内容占比」：非背景色像素比例（越低越空）
    const dens = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      if (!c) return null;
      try {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const buckets = new Map();
        let n = 0;
        for (let i = 0; i < d.length; i += 16) {
          n++;
          const k = (d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4);
          buckets.set(k, (buckets.get(k) || 0) + 1);
        }
        let top = 0;
        for (const v of buckets.values()) if (v > top) top = v;
        return { w: c.width, h: c.height, distinct: buckets.size, dominantPct: +(top / n * 100).toFixed(1) };
      } catch (e) { return { err: String(e).slice(0, 80) }; }
    });
    shots.push({ name: s.name, hook: s.call, dens });
  } catch (e) {
    shots.push({ name: s.name, error: String(e).slice(0, 150) });
  }
}

// 战斗内：升级三选一 + 暂停
try {
  await page.evaluate(() => { if (window.MENGSHOU_DEBUG.hall) window.MENGSHOU_DEBUG.hall(); });
  await page.waitForTimeout(800);
  const geom = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, cw: c.width, ch: c.height }; });
  await page.mouse.click(geom.l + (316 / geom.cw) * geom.w, geom.t + (617 / geom.ch) * geom.h);
  await page.waitForTimeout(7000);
  await page.screenshot({ path: path.join(OUT, '11-battle.png') });
  shots.push({ name: '11-battle' });
  if (available.includes('levelup')) {
    await page.evaluate(() => { try { window.MENGSHOU_DEBUG.levelup(); } catch (e) {} });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, '12-levelup.png') });
    shots.push({ name: '12-levelup' });
  }
  if (available.includes('pause')) {
    await page.evaluate(() => { try { window.MENGSHOU_DEBUG.pause(); } catch (e) {} });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, '13-pause.png') });
    shots.push({ name: '13-pause' });
  }
} catch (e) { shots.push({ name: 'battle-series', error: String(e).slice(0, 150) }); }

const md = [
  '# 全界面巡检',
  '',
  '- 可用界面钩子: ' + available.length + ' 个',
  '- 未捕获异常: ' + errs.length,
  '',
  '| 截图 | 钩子 | 画布 | 独特色数 | 主色占比 | 备注 |',
  '|---|---|---|---|---|---|',
  ...shots.map((s) => '| ' + s.name + ' | ' + (s.hook || '-') + ' | ' +
    (s.dens && s.dens.w ? s.dens.w + '×' + s.dens.h : '-') + ' | ' + (s.dens && s.dens.distinct || '-') + ' | ' +
    (s.dens && s.dens.dominantPct !== undefined ? s.dens.dominantPct + '%' : '-') + ' | ' +
    (s.skipped || s.error || '') + ' |'),
  '',
  '> 「主色占比」= 出现最多的那一种颜色占采样点的比例。**越高说明画面越空/越平**。',
  '',
  '## 未捕获异常',
  '',
  ...(errs.length ? errs.map((e) => '- `' + e + '`') : ['（无）']),
  '',
].join('\n');
fs.writeFileSync(path.join(OUT, 'screens.md'), md);
fs.writeFileSync(path.join(OUT, 'screens.json'), JSON.stringify({ available, shots, errs }, null, 2));
console.log(md);

await browser.close();
server.close();
process.exit(0);
