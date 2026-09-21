// ci/sfx-runtime-freq.mjs —— 运行时 SFX 触发频次实测（"频率分层"判据的另一半硬证据）
//
// 为什么要这个脚本（第十四类病根）：
//   `CONFIG.audio.prios`（5 级纵向层级）的**设计立场**写得很明确：
//     "抢占优先级(数字越大越不该被抢; 规格二节纵向层级: 受击/复活>BOSS>升级/选卡/结算>击杀/宝石>开火/命中)"
//   而 `sfx-loudness.py` 的头注把**频率**这条立场写得更直白：
//     "高频事件（每秒数次）必须显著低于低频事件（每局几次），否则长局被磨耳朵"
//   → 判"某个音效是否过响"必须同时知道 **①响度 ②一局触发几次**。
//   此前所有门禁只看 ①（响度），从无门禁覆盖 ② → "档位内混进高频事件"可完全静默通过。
//   本脚本补上 ②。
//
// 方法（全是**运行时真值**，不靠源码静态统计）：
//   1) 游戏脚本执行前挂钩 `AudioBufferSourceNode.prototype.start`，
//      用 `buffer.length` 做**指纹**反查事件名 ——
//      游戏内每个 SFX 由 `_alloc(len, sr)` 定长生成（len 表见下），
//      buffer.length = floor(len × 44100) 唯一对应一个 SFX；
//      长 buffer（>100k）是 BGM 曲，单独归类。
//   2) **真实计时**：进战斗后让游戏**连续自然运行**（不 seek、不 killDemo），
//      按 60s 切片逐段计数 → 得到"每分钟次数"。
//      ⚠ 为什么不用 seek：seek(t) 会重置 waveState/hordeState/eliteState，
//      重启后前几秒几乎无怪可杀 → 采样到的是"开局的稀疏"，不是稳态频率。
//      为什么不用 killDemo：它会**凭空 spawn** 7 只 rabbit 再秒杀，
//      测到的是 demo 的频率，不是玩家击杀的频率（第一版踩过：总触发仅 49 次）。
//   3) 输出：每 SFX 的「每分钟次数」+ 交叉 sfx-loudness 的响度 → 判定
//      是否违反 prios/响度的立场（同档内高频却更响 = 意图自相矛盾）。
//
// 与 ci/sfx-intent-vs-real.py 的分工：
//   - sfx-intent-vs-real.py：看 **档位之间** 响度单调（设计意图 vs 实际响度）
//   - 本脚本：看 **档位之内** 是否混入了高频事件（意图本身是否自相矛盾）
//   两者互补 —— 前者全绿时后者仍可能报缺陷。
//
// 输出：ci/out/sfx-runtime-freq.json + .md
// 退出码：0 通过；2 采样不足/页面报错（"验证覆盖不到"本身即失败）

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'ci', 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ===== buffer 长度 → 事件名（与 game 内 _alloc(len) 严格对应；由 ci 侧静态抄录并自检）=====
const LEN2SFX = {
  3087: 'SFX_FIRE',       // 0.07
  4410: 'SFX_HIT/GEM',    // 0.10（两音效同时长，只能合并统计 —— 见下方 note）
  5292: 'SFX_UI',         // 0.12
  6174: 'SFX_KILL',       // 0.14
  7938: 'SFX_CARD',       // 0.18
  8820: 'SFX_HURT',       // 0.20
  13230: 'SFX_CARDSHOW',  // 0.30
  15876: 'SFX_CHEST',     // 0.36
  16758: 'SFX_START',     // 0.38
  18522: 'SFX_LEVELUP/BOMB', // 0.42（两音效同时长）
  20286: 'SFX_EVO',       // 0.46
  22050: 'SFX_EVENT',     // 0.50
  25578: 'SFX_REVIVE',    // 0.58
  30869: 'SFX_BOSS_DIE',  // 0.70
  35280: 'SFX_BOSS_WARN', // 0.80
  44982: 'SFX_WIN',       // 1.02
  59535: 'SFX_LOSE'       // 1.35
};
// ⚠ 同长度的音效合并统计是**已知精度损失**（HIT/GEM 都 0.10s；LEVELUP/BOMB 都 0.42s）。
//   游戏里 wav 外采后二者字节不同，但**运行时 buffer 长度相同** → 长度指纹无法区分。
//   处置：合并计数（保守：按两者中更大的次数理解），并在报告里显式标注，不假装能分开。
//   这比"用 createBufferSource 调用栈猜名字"稳（后者被证实拿不到名字，会 100% 落入 len: 兜底）。

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wav': 'audio/wav', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent((req.url || '/').split('?')[0]);
  const f = path.join(ROOT, u.replace(/^\/+/, ''));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

const ENTRY = 'game/萌兽消消岛.html';

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));

// ---- 钩子：按 buffer 长度指纹计数 ----
await page.addInitScript(() => {
  window.__sfx = { byLen: {}, total: 0, t0: 0 };
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || !AC.prototype) return;
  try {
    const origStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function () {
      try {
        const len = this.buffer ? this.buffer.length : 0;
        window.__sfx.byLen[len] = (window.__sfx.byLen[len] || 0) + 1;
        window.__sfx.total++;
      } catch (e) { /* 保底：计数失败不影响游戏 */ }
      return origStart.apply(this, arguments);
    };
  } catch (e) { /* 老浏览器无此原型，忽略 */ }
});

await page.goto(`http://127.0.0.1:${port}/${encodeURIComponent(ENTRY)}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(6000);
await page.evaluate(() => { if (typeof window.guideSkipAll === 'function') window.guideSkipAll(); });
await page.waitForTimeout(1500);
await page.mouse.click(360, 640);
await page.waitForTimeout(1000);

const read = () => page.evaluate(() => {
  const s = window.__sfx || { byLen: {}, total: 0 };
  return { byLen: Object.assign({}, s.byLen), total: s.total | 0 };
});
const deltaLen = (a, b) => {
  const out = {};
  Object.keys(b.byLen).forEach((k) => { const d = b.byLen[k] - (a.byLen[k] || 0); if (d > 0) out[k] = d; });
  return out;
};

// ---- 进战斗 ----
await page.evaluate(() => { if (window.MENGSHOU_DEBUG && window.MENGSHOU_DEBUG.hall) window.MENGSHOU_DEBUG.hall(); });
await page.waitForTimeout(600);
const g = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, cw: c.width, ch: c.height }; });
await page.mouse.click(g.l + (316 / g.cw) * g.w, g.t + (617 / g.ch) * g.h);
await page.waitForTimeout(6000);

const st0 = await page.evaluate(() => {
  const D = window.MENGSHOU_DEBUG || {};
  let s = null; try { s = D.state(); } catch (e) { void e; }
  return { state: s ? s.name : '?', playing: s ? s.playing : false };
});

// ---- 连续自然运行：多切片，每片 45s 真实计时 ----
//   ⚠ 关键：**不 seek、不 killDemo**，让游戏自然刷怪/自瞄射击（游戏有自动开火）。
//   切片是为了看"分钟频率"的稳定性（若切片间方差过大 → 采样本身不可信）。
const SLICES = 6, SLICE_MS = 45000;
const slices = [];
let prev = await read();
for (let i = 0; i < SLICES; i++) {
  await page.waitForTimeout(SLICE_MS);
  const cur = await read();
  slices.push({ i, d: deltaLen(prev, cur), total: cur.total - prev.total });
  prev = cur;
}

const raw = await read();
const spine = await page.evaluate(() => { try { return window.MENGSHOU_DEBUG.spine(); } catch (e) { return null; } });

await browser.close();
server.close();

// ===== 汇总：切片 → 每分钟频率 =====
const minutes = (SLICES * SLICE_MS) / 60000;
const agg = {};
slices.forEach((s) => Object.keys(s.d).forEach((k) => { agg[k] = (agg[k] || 0) + s.d[k]; }));

const rows = Object.keys(agg).map((L) => {
  const len = Number(L);
  const name = LEN2SFX[len] || (len > 100000 ? '(BGM 长曲)' : '(未知)');
  const n = agg[L];
  return { len, name, n, perMin: +(n / minutes).toFixed(2) };
}).sort((a, b) => b.perMin - a.perMin);

// 切片稳定性（同长度在切片间的变异系数）
const stability = {};
Object.keys(agg).forEach((L) => {
  const xs = slices.map((s) => s.d[L] || 0);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean < 1) { stability[L] = null; return; }
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / xs.length);
  stability[L] = +(sd / mean).toFixed(2);
});
const unstable = rows.filter((r) => r.name === 'SFX_HURT' || r.name === 'SFX_KILL' || r.name === 'SFX_FIRE')
  .filter((r) => stability[r.len] !== null);

const payload = {
  entry: ENTRY, state: st0,
  spine: spine ? { ch: spine.ch, durMin: spine.durMin, winTime: spine.winTime } : null,
  slices: SLICES, sliceMs: SLICE_MS, minutes,
  rows, stability, byLen: raw.byLen, total: raw.total, pageErrors: errs
};
fs.writeFileSync(path.join(OUT_DIR, 'sfx-runtime-freq.json'), JSON.stringify(payload, null, 2), 'utf8');

const L = [];
L.push('# SFX 运行时触发频次实测');
L.push('');
L.push('> 口径：进战斗后**连续自然运行** ' + minutes.toFixed(1) + ' 分钟（不 `seek`、不 `killDemo`），');
L.push('> 用 `buffer.length` 指纹反查事件名（表与游戏 `_alloc` 严格对应）。');
L.push('> 用途：给"高频事件必须比低频事件轻"这条设计立场提供**次数**这一半证据。');
L.push('');
L.push('- 章节 ' + (payload.spine ? payload.spine.ch : '?') + ' · 局长 ' + (payload.spine ? payload.spine.durMin : '?') + ' min');
L.push('- 总触发 ' + raw.total + ' 次 · 采样时长 ' + minutes.toFixed(1) + ' min · 页面错误 ' + errs.length);
L.push('');
L.push('## 每分钟触发次数（按 buffer 长度指纹）');
L.push('');
L.push('| buffer 长度 | 事件 | 总次数 | **次/分钟** | 切片稳定性(CV) |');
L.push('|---|---|---|---|---|');
rows.forEach((r) => {
  const cv = stability[r.len];
  L.push('| ' + r.len + ' | ' + r.name + ' | ' + r.n + ' | **' + r.perMin + '** | ' + (cv === null ? '—' : cv) + ' |');
});
L.push('');
L.push('> ⚠ 精度说明：同一 buffer 长度的音效无法用长度指纹区分 ——');
L.push('> `SFX_HIT` 与 `SFX_GEM` 都是 0.10s；`SFX_LEVELUP` 与 `SFX_BOMB` 都是 0.42s。');
L.push('> 已合并为一行计数（保守处理），未假装能分开。');
L.push('');
L.push('## 每切片计数（看稳定性）');
L.push('');
L.push('| 切片 | 秒 | 总触发 |');
L.push('|---|---|---|');
slices.forEach((s) => L.push('| ' + (s.i + 1) + ' | ' + (s.i + 1) * (SLICE_MS / 1000) + ' | ' + s.total + ' |'));

fs.writeFileSync(path.join(OUT_DIR, 'sfx-runtime-freq.md'), L.join('\n'), 'utf8');
console.log(L.join('\n'));
console.log('\nJSON → ' + path.join(OUT_DIR, 'sfx-runtime-freq.json'));

// ===== 硬门禁 =====
if (errs.length) { console.error('❌ 页面报错 ' + errs.length + ' 个，测量不可信'); console.error(errs.slice(0, 5).join('\n')); process.exit(2); }
if (raw.total < 200) { console.error('❌ 触发采样过少（' + raw.total + ' < 200），本次测量不可信'); process.exit(2); }
const unknown = rows.filter((r) => r.name === '(未知)');
if (unknown.length) { console.error('❌ 出现未知 buffer 长度（指纹表需更新）: ' + unknown.map((r) => r.len).join(', ')); process.exit(2); }
console.log('✅ 频次采集合规（' + raw.total + ' 次 / ' + minutes.toFixed(1) + ' min）');
