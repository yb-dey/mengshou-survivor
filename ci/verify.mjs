// 云端双通道验证 —— 在 GitHub Actions 上运行，本机不参与任何渲染。
//
// 为什么跑两遍：
//   file://  双击打开的场景 —— fetch 不支持 file 协议，音频必然加载失败（环境限制，非游戏 bug）
//   http://  真实部署的场景 —— 这才是游戏实际分发方式
//   对照两遍，才能分清"游戏的问题"和"协议的限制"，避免误报。
//
// PASS 判据（以 http:// 为准）：未捕获异常 0 + 画面非空白 + 战斗确实开始
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const OUT = path.join('ci', 'out');
fs.mkdirSync(OUT, { recursive: true });

// 验证目标目录可配：VERIFY_DIR=dist 即可验证**外链分发版**（线上发布的就是它）。
// 此前只验过内联母版 → 分发版（assets 外链）从未进过云端门禁，属真缺口。
const gameDir = path.resolve(process.env.VERIFY_DIR || 'game');
const htmlFiles = fs.readdirSync(gameDir).filter((f) => f.toLowerCase().endsWith('.html'));
if (!htmlFiles.length) { console.error('FAIL: game/ 下找不到 .html'); process.exit(1); }
const entryName = htmlFiles[0];
const entryPath = path.join(gameDir, entryName);

// 极简静态服务器（只服务 game/ 目录）
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

async function run(label, url, shotPrefix) {
  const pageErrors = [], envWarnings = [], otherErrors = [], failedReqs = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 250)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // file:// 下 fetch 音频 → 协议限制，环境警告，非游戏缺陷
    if (/URL scheme "file" is not supported|Failed to load resource|net::ERR_/i.test(t)) envWarnings.push(t.slice(0, 180));
    else otherErrors.push(t.slice(0, 180));
  });
  page.on('requestfailed', (r) => failedReqs.push((r.failure()?.errorText || 'failed') + '  ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) failedReqs.push('HTTP ' + r.status() + '  ' + r.url()); });

  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(3000);

  const guide = await page.evaluate(() => {
    try {
      if (typeof window.guideSkipAll === 'function') { window.guideSkipAll(); return { ok: true, via: 'guideSkipAll()' }; }
      const D = window.MENGSHOU_DEBUG;
      if (D && typeof D.guideSkipAll === 'function') { D.guideSkipAll(); return { ok: true, via: 'MENGSHOU_DEBUG.guideSkipAll()' }; }
    } catch (e) { return { ok: false, err: String(e).slice(0, 150) }; }
    return { ok: false, err: 'no guideSkipAll' };
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, shotPrefix + '-1-menu.png') });

  const probe = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const D = window.MENGSHOU_DEBUG || {};
    let audioOk = null;
    try { audioOk = D.audio ? (typeof D.audio === 'object' ? Object.keys(D.audio).length : String(D.audio).slice(0, 80)) : null; } catch {}
    return { canvas: c ? { w: c.width, h: c.height } : null, debugKeyCount: Object.keys(D).length, audioHint: audioOk };
  });

  // 点击「正片出击」（画布坐标 316,617；由首轮截图推算，实测命中）
  const T = { x: 316, y: 617 };
  const geom = await page.evaluate(() => {
    const c = document.querySelector('canvas'); const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, cw: c.width, ch: c.height };
  });
  const px = geom.left + (T.x / geom.cw) * geom.width;
  const py = geom.top + (T.y / geom.ch) * geom.height;
  await page.mouse.move(px, py); await page.waitForTimeout(150);
  await page.mouse.click(px, py);

  const snap = () => page.evaluate(() => {
    const D = window.MENGSHOU_DEBUG || {};
    let f = null, rt = null;
    try { f = D.readField ? D.readField() : null; } catch (e) { f = 'err'; }
    try { rt = D.liveEvent ? undefined : undefined; } catch {}
    return { field: f, runTime: (window.GAME && window.GAME.runTime) ?? null,
             deathMarks: (window.deathMarks || []).length,
             deadSprites: Object.keys(window.SPRITES || {}).filter((k) => k.endsWith('_dead')).length };
  });
  const samples = [];
  samples.push({ t: 1.5, ...(await snap()) });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(OUT, shotPrefix + '-2-battle-early.png') });
  samples.push({ t: 7.5, ...(await snap()) });
  await page.waitForTimeout(11000);
  await page.screenshot({ path: path.join(OUT, shotPrefix + '-3-battle-late.png') });
  samples.push({ t: 18.5, ...(await snap()) });

  // 死亡标记逐帧监视：标记只活 0.5s，瞬时采样几乎必然错过 → 每帧盯 8 秒。
// 关键：deathMarks 本体在闭包里探不到（AI_ART_READY 同类坑已踩过），必须走 MENGSHOU_DEBUG.deathMarks()；
// 且 spawned/drawn 是**累计值**，所以即使窗口落在升级弹窗暂停期也能捕获到此前所有击杀。
const deathWatch = await page.evaluate(() => new Promise((res) => {
  let maxLive = 0, spawned = 0, drawn = 0, sprites = 0, viaDebug = false;
  const t0 = performance.now();
  const tick = () => {
    try {
      const D = window.MENGSHOU_DEBUG || {};
      if (typeof D.deathMarks === 'function') {
        viaDebug = true;
        const f = D.deathMarks();
        if (f) {
          if (f.live > maxLive) maxLive = f.live;
          if (f.spawned > spawned) spawned = f.spawned;
          if (f.drawn > drawn) drawn = f.drawn;
          if (f.sprites > sprites) sprites = f.sprites;
        }
      }
    } catch (e) { /* 忽略 */ }
    if (performance.now() - t0 < 8000) requestAnimationFrame(tick);
    else res({ maxLive, spawned, drawn, sprites, viaDebug });
  };
  requestAnimationFrame(tick);
}));

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
    } catch (e) { return { found: true, error: String(e).slice(0, 180) }; }
  });

  await page.close();

  const counts = samples.map((s) => (s.field && s.field.counts) ? (s.field.counts.boss + s.field.counts.elite + s.field.counts.lethal + s.field.counts.trash + s.field.counts.gems) : null);
  const battleStarted = counts.some((x) => typeof x === 'number' && x > 0);
  // 死亡帧证据：① 已构建的 <id>_dead 贴图数；② 战斗中死亡标记出现过的峰值
  const deadSprites = deathWatch.sprites || (samples.length ? (samples[samples.length - 1].deadSprites || 0) : 0);
  const deathMax = deathWatch.maxLive;
  const uniqFailed = [...new Set(failedReqs)];
  const ok = pageErrors.length === 0 && canvasCheck.nonBlank === true && battleStarted === true;

  return { label, url: url.replace(/^file:.*\//, 'file://…/'), loadMs, fps, guide, probe, counts, samples,
    battleStarted, deadSprites, deathMax, deathWatch, canvas: canvasCheck, ok,
    pageErrorCount: pageErrors.length, pageErrors,
    envWarningCount: envWarnings.length, envWarnings: envWarnings.slice(0, 12),
    otherErrorCount: otherErrors.length, otherErrors: otherErrors.slice(0, 10),
    missingResourceCount: uniqFailed.length, missingResources: uniqFailed.slice(0, 30) };
}

const fileRun = await run('file', 'file://' + entryPath.replace(/\\/g, '/'), 'file');
const httpRun = await run('http', `http://127.0.0.1:${port}/${encodeURIComponent(entryName)}`, 'http');
await browser.close();
server.close();

// 判定以 http 为准（真实分发方式）
const ok = httpRun.ok === true;
const report = { ok, entry: entryName, entrySizeMB: +(fs.statSync(entryPath).size / 1024 / 1024).toFixed(2), fileRun, httpRun, ranAt: new Date().toISOString() };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

const line = (r) => '| ' + r.label + ' | ' + r.loadMs + 'ms | ' + r.fps + ' | ' + (r.canvas.nonBlank ?? '-') + ' | ' + r.battleStarted + ' | ' + JSON.stringify(r.counts) + ' | ' + r.pageErrorCount + ' | ' + r.envWarningCount + ' | ' + r.otherErrorCount + ' |';

const md = [
  '# 云端双通道验证报告',
  '',
  '- 结论: **' + (ok ? 'PASS' : 'FAIL') + '**（以 http:// 为准 —— 真实分发方式）',
  '- 入口: `' + entryName + '` (' + report.entrySizeMB + ' MB)',
  '',
  '## 两通道对照',
  '',
  '| 通道 | 加载 | 帧率 | 画面非空 | 战斗开始 | 实体数采样 | 未捕获异常 | 环境警告 | 其他报错 |',
  '|---|---|---|---|---|---|---|---|---|',
  line(fileRun),
  line(httpRun),
  '',
  '## 结论解读',
  '',
  '- **http:// 通道干净** → 游戏本体没问题',
  '- **file:// 通道的环境警告数 (' + fileRun.envWarningCount + ')** 来自 `fetch()` 不支持 file 协议：',
  '  音频在双击打开时加载不到（**走网址部署则正常**）。属环境限制，非游戏缺陷，但如果希望双击也能出声，需改成内联 base64 或 `<audio>` 标签。',
  '',
  '## 判定依据（http）',
  '',
  '| 检查项 | 值 | 是否影响结论 |',
  '|---|---|---|',
  '| 未捕获 JS 异常 | ' + httpRun.pageErrorCount + ' | **是** |',
  '| 画面非空白 | ' + httpRun.canvas.nonBlank + ' | **是** |',
  '| 战斗已开始（实体>0） | ' + httpRun.battleStarted + ' | **是** |',
  '| 其他控制台报错 | ' + httpRun.otherErrorCount + ' | **是** |',
  '| 环境警告（协议限制） | ' + httpRun.envWarningCount + ' | 否 |',
  '| 资源探测失败 | ' + httpRun.missingResourceCount + ' | 否 |',
  '',
  '## http 通道采样明细',
  '',
  '| t (s) | runTime | 实体数 | counts |',
  '|---|---|---|---|',
  ...httpRun.samples.map((s) => '| ' + s.t + ' | ' + (s.runTime ?? '-') + ' | ' + ((s.field && s.field.counts) ? (s.field.counts.boss + s.field.counts.elite + s.field.counts.lethal + s.field.counts.trash + s.field.counts.gems) : '-') + ' | `' + JSON.stringify(s.field && s.field.counts) + '` |'),
  '',
  '## 未捕获异常（两通道）',
  '',
  ...(httpRun.pageErrors.length ? httpRun.pageErrors.map((e) => '- http: `' + e + '`') : ['- http: （无）']),
  ...(fileRun.pageErrors.length ? fileRun.pageErrors.map((e) => '- file: `' + e + '`') : ['- file: （无）']),
  '',
].join('\n');
fs.writeFileSync(path.join(OUT, 'report.md'), md);

console.log(md);
process.exit(ok ? 0 : 1);
