// ci/sfx-runtime-freq.mjs —— 运行时 SFX 触发频次实测（"频率分层"判据的另一半硬证据）
//
// 为什么要这个脚本（第十四类病根）：
//   `CONFIG.audio.prios`（5 级纵向层级）与 `sfx-loudness.py` 头注共同写明了设计立场：
//     "高频事件（每秒数次）必须显著低于低频事件（每局几次），否则长局被磨耳朵"
//   → 判"某个音效是否过响"必须同时知道 **①响度 ②一局触发几次**。
//   此前所有门禁只看 ①（响度），档位内混进高频事件可完全静默通过。本脚本补上 ②。
//
// 方法（全是**运行时真值**）：
//   1) 挂钩 `AudioBufferSourceNode.prototype.start`，用 `buffer.length` 做**指纹**反查事件名
//      （游戏内每个 SFX 由 `_alloc(len, sr)` 定长生成；长度表见 LEN2SFX）。
//   2) **自动驱动器**：本作是自动开火的割草游戏，但玩家会死 → 死后弹 REVIVE_MODAL 暂停一切，
//      SFX 归零。第一版踩过：连续跑 4.5min 只有第 1 片有触发，后 5 片全 0。
//      驱动策略（每 500ms 一拍）：
//        · REVIVE_MODAL → `MENGSHOU_DEBUG.revive()` 满血继续（CONFIG.reviveUnlimited=true 已开）
//        · LEVELUP_MODAL → `MENGSHOU_DEBUG.levelupTap(0)` 自动选卡（否则选卡弹窗挂着不动）
//        · PAUSED_MENU → 不可能自发出现（无手输入），忽略
//        · 其余 → 什么都不做，让游戏自然刷怪/自瞄射击
//      ⚠ 不调 `killDemo`（它**凭空 spawn** 7 只 rabbit 再秒杀 → 测到的是 demo 频率，不是玩家的）。
//      ⚠ 不调 `seek`（它会重置 waveState/hordeState/eliteState，重启后采样到的是"开局稀疏"）。
//   3) 按 45s 切片计数 → 得"次/分钟"；切片间 CV 过大即判采样不可信。
//
// 与 ci/sfx-intent-vs-real.py 的分工：
//   - sfx-intent-vs-real.py：看 **档位之间** 响度单调（设计意图 vs 实际响度）
//   - 本脚本 + ci/sfx-freq-vs-loud.mjs：看 **档位之内** 是否混入高频事件（意图自相矛盾）
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

// ===== buffer 长度 → 事件名（与游戏 `_alloc(len)` 严格对应）=====
const LEN2SFX = {
  3087: 'SFX_FIRE',        // 0.07
  4410: 'SFX_HIT|GEM',     // 0.10（两音效同时长，长度指纹不可分 → 合并统计）
  5292: 'SFX_UI',          // 0.12
  6174: 'SFX_KILL',        // 0.14
  7938: 'SFX_CARD',        // 0.18
  8820: 'SFX_HURT',        // 0.20
  13230: 'SFX_CARDSHOW',   // 0.30
  15876: 'SFX_CHEST',      // 0.36
  16758: 'SFX_START',      // 0.38
  18522: 'SFX_LEVELUP|BOMB',// 0.42（同长度，合并）
  20286: 'SFX_EVO',        // 0.46
  22050: 'SFX_EVENT',      // 0.50
  25578: 'SFX_REVIVE',     // 0.58
  30869: 'SFX_BOSS_DIE',   // 0.70（0.7*44100=30870，alloc 用 floor(len*sr)）
  35280: 'SFX_BOSS_WARN',  // 0.80
  44982: 'SFX_WIN',        // 1.02
  59535: 'SFX_LOSE'        // 1.35
};
const KNOWN_LEN = new Set(Object.keys(LEN2SFX).map(Number));

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

// ---- 钩子：按 buffer 长度指纹计数；同时记录 BGM（>100k）以区分 ----
await page.addInitScript(() => {
  window.__sfx = { byLen: {}, bgm: 0, total: 0 };
  try {
    const origStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function () {
      try {
        const len = this.buffer ? this.buffer.length : 0;
        if (len >= 100000) { window.__sfx.bgm++; }
        else { window.__sfx.byLen[len] = (window.__sfx.byLen[len] || 0) + 1; window.__sfx.total++; }
      } catch (e) { /* 计数失败不影响游戏 */ }
      return origStart.apply(this, arguments);
    };
  } catch (e) { /* 老引擎无此原型 */ }
});

await page.goto(`http://127.0.0.1:${port}/${encodeURIComponent(ENTRY)}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(6000);
await page.evaluate(() => { if (typeof window.guideSkipAll === 'function') window.guideSkipAll(); });
await page.waitForTimeout(1500);
await page.mouse.click(360, 640);
await page.waitForTimeout(1000);

const read = () => page.evaluate(() => {
  const s = window.__sfx || { byLen: {}, bgm: 0, total: 0 };
  return { byLen: Object.assign({}, s.byLen), bgm: s.bgm | 0, total: s.total | 0 };
});
const deltaLen = (a, b) => {
  const o = {};
  Object.keys(b.byLen).forEach((k) => { const d = b.byLen[k] - (a.byLen[k] || 0); if (d > 0) o[k] = d; });
  return o;
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

// ---- 自动驱动器（每 500ms 一拍）----
//   目的：让 run 一直留在 PLAYING，从而持续产生自然 SFX。
//   只处理"会暂停游戏"的弹窗，其余一律不干预。
const driver = { revives: 0, levelups: 0, ticks: 0, lastState: '' };
async function driveTick() {
  try {
    const r = await page.evaluate(() => {
      const D = window.MENGSHOU_DEBUG || {};
      let s = null, ex = null;
      try { s = D.state(); } catch (e) { void e; }
      try { ex = D.exclusive ? D.exclusive() : null; } catch (e) { void e; }
      const out = { name: s ? s.name : '?', act: '' };
      if (ex && ex.revive) { try { D.revive(); out.act = 'revive'; } catch (e) { out.act = 'revive-fail'; } }
      else if (ex && ex.levelup) { try { D.levelupTap(0); out.act = 'pick'; } catch (e) { out.act = 'pick-fail'; } }
      else if (ex && ex.result) { try { D.confirm ? D.confirm() : null; out.act = 'confirm'; } catch (e) { out.act = 'confirm-fail'; } }
      return out;
    });
    driver.ticks++;
    driver.lastState = r.name;
    if (r.act === 'revive') driver.revives++;
    if (r.act === 'pick') driver.levelups++;
  } catch (e) { /* 页面切换瞬间可能失败，忽略 */ }
}

// ---- 连续自然运行：多切片 ----
//   每 500ms 驱动一次；切片只影响统计口径，不改变驱动节奏。
const SLICES = 8, SLICE_MS = 45000;
const slices = [];
let prev = await read();
let bgmPrev = prev.bgm;
let bgmTotal = 0;
for (let i = 0; i < SLICES; i++) {
  const steps = Math.ceil(SLICE_MS / 500);
  for (let s = 0; s < steps; s++) { await driveTick(); await page.waitForTimeout(500); }
  const cur = await read();
  bgmTotal += cur.bgm - bgmPrev; bgmPrev = cur.bgm;
  slices.push({ i, d: deltaLen(prev, cur), total: cur.total - prev.total, revives: driver.revives, levelups: driver.levelups });
  prev = cur;
}

const raw = await read();
const spine = await page.evaluate(() => { try { return window.MENGSHOU_DEBUG.spine(); } catch (e) { return null; } });

await browser.close();
server.close();

// ===== 汇总 =====
const minutes = (SLICES * SLICE_MS) / 60000;
const agg = {};
slices.forEach((s) => Object.keys(s.d).forEach((k) => { agg[k] = (agg[k] || 0) + s.d[k]; }));

const rows = Object.keys(agg).map((L) => {
  const len = Number(L);
  return { len, name: LEN2SFX[len] || '(未知)', n: agg[L], perMin: +(agg[L] / minutes).toFixed(2), known: KNOWN_LEN.has(len) };
}).sort((a, b) => b.perMin - a.perMin);

const stability = {};
Object.keys(agg).forEach((L) => {
  const xs = slices.map((s) => s.d[L] || 0);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  stability[L] = mean < 1 ? null : +(Math.sqrt(xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / xs.length) / mean).toFixed(2);
});

const payload = {
  entry: ENTRY, state: st0, driver,
  spine: spine ? { ch: spine.ch, durMin: spine.durMin, winTime: spine.winTime } : null,
  slices: SLICES, sliceMs: SLICE_MS, minutes, rows, stability,
  byLen: raw.byLen, total: raw.total, bgmTotal, pageErrors: errs
};
fs.writeFileSync(path.join(OUT_DIR, 'sfx-runtime-freq.json'), JSON.stringify(payload, null, 2), 'utf8');

const L = [];
L.push('# SFX 运行时触发频次实测');
L.push('');
L.push('> 口径：进战斗后**连续自然运行** ' + minutes.toFixed(1) + ' 分钟（自动驱动器只清"暂停类弹窗"，不造怪不 seek）。');
L.push('> 用 `buffer.length` 指纹反查事件名。用途：给"高频必须比低频轻"这条立场提供**次数**这一半证据。');
L.push('');
L.push('- 章节 ' + (payload.spine ? payload.spine.ch : '?') + ' · 局长 ' + (payload.spine ? payload.spine.durMin : '?') + ' min · 采样 ' + minutes.toFixed(1) + ' min');
L.push('- SFX 总触发 **' + raw.total + '** 次 · BGM 起播 ' + bgmTotal + ' 次 · 页面错误 ' + errs.length);
L.push('- 驱动计数：复活 ' + driver.revives + ' 次 · 自动选卡 ' + driver.levelups + ' 次 · 拍数 ' + driver.ticks);
L.push('');
L.push('## 每分钟触发次数');
L.push('');
L.push('| buffer 长度 | 事件 | 总次数 | **次/分钟** | 切片CV |');
L.push('|---|---|---|---|---|');
rows.forEach((r) => L.push('| ' + r.len + ' | ' + r.name + ' | ' + r.n + ' | **' + r.perMin + '** | ' + (stability[r.len] === null ? '—' : stability[r.len]) + ' |'));
L.push('');
L.push('> ⚠ 精度说明：同长度的音效无法用长度指纹区分 —— `SFX_HIT`/`SFX_GEM` 都 0.10s；');
L.push('> `SFX_LEVELUP`/`SFX_BOMB` 都 0.42s。已合并成一行（`|` 分隔），未假装能分开。');
L.push('');
L.push('## 每切片（看采样稳定性）');
L.push('');
L.push('| 切片 | 秒 | SFX 触发 | 累计复活 | 累计选卡 |');
L.push('|---|---|---|---|---|');
slices.forEach((s) => L.push('| ' + (s.i + 1) + ' | ' + (s.i + 1) * (SLICE_MS / 1000) + ' | ' + s.total + ' | ' + s.revives + ' | ' + s.levelups + ' |'));

fs.writeFileSync(path.join(OUT_DIR, 'sfx-runtime-freq.md'), L.join('\n'), 'utf8');
console.log(L.join('\n'));
console.log('\nJSON → ' + path.join(OUT_DIR, 'sfx-runtime-freq.json'));

// ===== 硬门禁 =====
if (errs.length) { console.error('❌ 页面报错 ' + errs.length + ' 个，测量不可信'); errs.slice(0, 5).forEach((e) => console.error('   ' + e)); process.exit(2); }
if (raw.total < 400) { console.error('❌ SFX 触发采样过少（' + raw.total + ' < 400），本次测量不可信'); process.exit(2); }
const unknown = rows.filter((r) => !r.known);
if (unknown.length) { console.error('❌ 未知 buffer 长度（指纹表需更新）: ' + unknown.map((r) => r.len + '(' + r.n + '次)').join(', ')); process.exit(2); }
// 采样必须"每片都有声" —— 否则说明驱动没把 run 留在 PLAYING（第一版就是全 0）
const dead = slices.filter((s) => s.total === 0);
if (dead.length > slices.length / 4) { console.error('❌ ' + dead.length + '/' + slices.length + ' 个切片零触发 → 驱动器未让 run 持续运行'); process.exit(2); }
console.log('✅ 频次采集合规（' + raw.total + ' 次 / ' + minutes.toFixed(1) + ' min，' + slices.length + ' 片均有声）');
