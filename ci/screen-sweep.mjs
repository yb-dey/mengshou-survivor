// 全界面巡检（云端）—— 用 MENGSHOU_DEBUG 的界面钩子逐个打开并截图。
// 目的：把「哪一屏做得差」从猜测变成可看的事实，而不是继续凭印象猜。
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

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files'] });
// 【2026-09-21】视口默认改为 720x1280（= CONFIG.viewW/viewH）：
//   原 1280x720 会把 720 宽的逻辑画布缩到 ~405px → 截图细节被抹掉，**无法用于美术评审**。
//   1:1 取像后，肉眼能看清图标/描边/字重，art 审查才成立。SWEEP_W/SWEEP_H 可覆盖。
const SWEEP_W = parseInt(process.env.SWEEP_W || '720', 10);
const SWEEP_H = parseInt(process.env.SWEEP_H || '1280', 10);
const page = await browser.newPage({ viewport: { width: SWEEP_W, height: SWEEP_H } });
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
// 【2026-09-21 实测修】原实现只调 `open*` 就截图 → **前一个弹窗仍开着**时后续"打开"调用被守卫忽略，
//   结果 13 张里有 9 张与上一张**字节完全相同**（03/04/05 同、06~10 同、11/12/13 同），
//   工具却照样打印"完成" —— 属"假成功"，9 个界面**从未真正被巡检过**。
//   两条修法：① 每屏前先复位到大厅 + 关掉可能开着的面板；② 截图后算哈希，与上一张重复即标记 dup。
// 【2026-09-21 补】只比"字节相同"**抓不到"动画导致的不相同"**：粒子每帧都在变，
//   codex/heroSheet/daily 三屏其实还是大厅，却因哈希不同被判为成功。
//   → 再加一层：**32x32 缩略指纹 vs 大厅基线的平均绝对差**，低于阈值即判定"仍是大厅"。
//   缩略平均天然对粒子噪声不敏感，但对"弹窗整块出现"极敏感。
const SIG_N = 32;
async function screenSig() {
  return await page.evaluate((N) => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const bw = Math.max(1, Math.floor(c.width / N)), bh = Math.max(1, Math.floor(c.height / N));
    const out = [];
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        let sum = 0, n = 0;
        for (let y = gy * bh; y < (gy + 1) * bh; y += 3) {
          for (let x = gx * bw; x < (gx + 1) * bw; x += 3) {
            const i = (y * c.width + x) * 4;
            sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
            n++;
          }
        }
        out.push(n ? sum / n : 0);
      }
    }
    return out;
  }, SIG_N);
}
function sigDiff(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}
const HOME_DUP_MAX = 2.0;   // 与大厅基线平均差 < 2 亮度级 → 判定"这一屏根本没打开"
let prevHash = '';
let homeSig = null;
for (const s of STEPS) {
  if (!available.includes(s.call)) { shots.push({ name: s.name, skipped: 'no hook ' + s.call }); continue; }
  try {
    // ① 复位：goHome 回大厅，closeGear 关面板（不存在时静默）
    await page.evaluate(() => {
      const D = window.MENGSHOU_DEBUG || {};
      try { if (D.closeGear) D.closeGear(); } catch (e) { void e; }
      try { if (D.goHome) D.goHome(); } catch (e) { void e; }
    });
    await page.waitForTimeout(450);
    await page.evaluate((c) => { try { window.MENGSHOU_DEBUG[c](); } catch (e) { return String(e); } }, s.call);
    await page.waitForTimeout(1400);
    const shotPath = path.join(OUT, s.name + '.png');
    await page.screenshot({ path: shotPath });
    // ②a 重复检测：与上一张同哈希 = 这一屏根本没打开
    const h = crypto.createHash('sha1').update(fs.readFileSync(shotPath)).digest('hex').slice(0, 12);
    const dup = (h === prevHash);
    prevHash = h;
    // ②b 与大厅基线的像素差（抓"动画导致的不相同"）
    const sig = await screenSig();
    if (s.name === '01-home') homeSig = sig;
    const dHome = sigDiff(sig, homeSig);
    const sameAsHome = (s.name !== '01-home') && dHome >= 0 && dHome < HOME_DUP_MAX;
    if (dup) console.log('  ⚠ ' + s.name + ' 与上一屏截图完全相同 → 该界面未真正打开');
    if (sameAsHome) console.log('  ⚠ ' + s.name + ' 与大厅基线几乎无差异(Δ=' + dHome.toFixed(2) + ') → 该界面未真正打开');
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
    shots.push({ name: s.name, hook: s.call, dens, dup, hash: h, dHome: dHome >= 0 ? +dHome.toFixed(2) : null, sameAsHome });
  } catch (e) {
    shots.push({ name: s.name, error: String(e).slice(0, 150) });
  }
}

/** 依次尝试多个钩子，直到画面真的变化；返回 {name, hook, dup} —— 避免"钩子没生效"被当成成功 */
async function tryShoot(outName, candidates) {
  const p = path.join(OUT, outName + '.png');
  let base = prevHash;
  for (const c of candidates) {
    if (!available.includes(c)) continue;
    await page.evaluate((k) => { try { window.MENGSHOU_DEBUG[k](); } catch (e) { void e; } }, c);
    await page.waitForTimeout(1300);
    await page.screenshot({ path: p });
    const h = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 12);
    if (h !== base) { prevHash = h; shots.push({ name: outName, hook: c, hash: h }); return; }
  }
  await page.screenshot({ path: p });
  const h = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 12);
  prevHash = h;
  console.log('  ⚠ ' + outName + ' 试过 [' + candidates.join(', ') + '] 画面均未变化 → 该界面可能无法用钩子打开');
  shots.push({ name: outName, hook: candidates.join('/'), dup: true, hash: h });
}

// 战斗内：升级三选一 + 暂停（每个都试多个钩子，画面没变就如实标记，不当成成功）
try {
  await page.evaluate(() => { if (window.MENGSHOU_DEBUG.hall) window.MENGSHOU_DEBUG.hall(); });
  await page.waitForTimeout(800);
  const geom = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, cw: c.width, ch: c.height }; });
  await page.mouse.click(geom.l + (316 / geom.cw) * geom.w, geom.t + (617 / geom.ch) * geom.h);
  await page.waitForTimeout(7000);
  await page.screenshot({ path: path.join(OUT, '11-battle.png') });
  prevHash = crypto.createHash('sha1').update(fs.readFileSync(path.join(OUT, '11-battle.png'))).digest('hex').slice(0, 12);
  shots.push({ name: '11-battle', hook: 'mouse', hash: prevHash });
  await tryShoot('12-levelup', ['levelup', 'upgradeView', 'showGearPick']);
  await tryShoot('13-pause', ['pause', 'resultBuild']);
} catch (e) { shots.push({ name: 'battle-series', error: String(e).slice(0, 150) }); }

const md = [
  '# 全界面巡检',
  '',
  '- 可用界面钩子: ' + available.length + ' 个',
  '- 未捕获异常: ' + errs.length,
  '',
  '| 截图 | 钩子 | 画布 | 独特色数 | 主色占比 | 与大厅Δ | 备注 |',
  '|---|---|---|---|---|---|---|',
  ...shots.map((s) => '| ' + s.name + ' | ' + (s.hook || '-') + ' | ' +
    (s.dens && s.dens.w ? s.dens.w + '×' + s.dens.h : '-') + ' | ' + (s.dens && s.dens.distinct || '-') + ' | ' +
    (s.dens && s.dens.dominantPct !== undefined ? s.dens.dominantPct + '%' : '-') + ' | ' +
    (s.dHome !== undefined && s.dHome !== null ? s.dHome : '-') + ' | ' +
    (s.dup ? '⚠ **与上一屏完全相同（未真正打开）**'
      : (s.sameAsHome ? '⚠ **仍是大厅（与大厅基线 Δ=' + s.dHome + '，未真正打开）**'
        : (s.skipped || s.error || ''))) + ' |'),
  '',
  '> 「主色占比」= 出现最多的那一种颜色占采样点的比例。**越高说明画面越空/越平**。',
  '',
  '> ⚠ 备注列标 `与上一屏完全相同` 的，表示**该界面没有被真正打开**（截图与上一屏字节相同）。',
  '> 这类条目**不能当作"已巡检"** —— 修法：先复位到大厅，或换一个能生效的钩子。',
  '',
  '## 未捕获异常',
  '',
  ...(errs.length ? errs.map((e) => '- `' + e + '`') : ['（无）']),
  '',
].join('\n');
fs.writeFileSync(path.join(OUT, 'screens.md'), md);
const dupList = shots.filter((s) => s.dup || s.sameAsHome).map((s) => s.name);
fs.writeFileSync(path.join(OUT, 'screens.json'),
  JSON.stringify({ available, shots, errs, distinctScreens: shots.length - dupList.length, dups: dupList }, null, 2));
console.log(md);

await browser.close();
server.close();
// 【2026-09-21】有"未真正打开"的就以非零退出 —— 让"没真正巡检"无法被当成成功
//   （判定双重：与上一屏字节相同 / 与大厅基线像素差 < HOME_DUP_MAX）。修好后应回到 0。
if (dupList.length) {
  console.error('\n❌ 有 ' + dupList.length + ' 屏未真正打开: ' + dupList.join(', '));
  process.exit(2);
}
process.exit(0);
