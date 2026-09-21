// audio-audit.mjs —— 音频专项体检（"听到的"），云端可复跑。
//
// 为什么需要：截图验不了声音。但 WebAudio 的**音源创建是可计数的** ——
//   在游戏脚本执行**之前**挂钩 `AudioContext.prototype.createOscillator / createBufferSource / createGain`，
//   就能数出"这一段时间里到底有没有在发声"，以及"静音/关音效有没有真的少发声"。
//
// ⚠ 注意：本项目音频是**程序化合成**（`audio/*.wav` 缺失时的保底路径 = 运行时渲染），
//   所以"没有 wav 文件"不等于"没声音"——这正是本脚本要区分的。
//
// 判定（任一不过 → 非零退出）：
//   1. 大厅静置时应有持续音源（BGM）           → bgm > 0
//   2. 战斗 + killDemo 后音源数应显著跳增（SFX）→ battle > bgm×1.3
//   3. 静音开启后音源数应显著下降               → muted < battle×0.5
//
// 用法: node ci/audio-audit.mjs
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
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));

// ⚠ 必须在游戏脚本执行前挂钩（addInitScript 在 document 创建时注入）
await page.addInitScript(() => {
  window.__ac = { osc: 0, buf: 0, gain: 0, ctxMade: 0, play: 0, lastAt: 0, clips: [], stats: [] };
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || !AC.prototype) return;
  const wrap = (name, key) => {
    const orig = AC.prototype[name];
    if (typeof orig !== 'function') return;
    AC.prototype[name] = function () {
      window.__ac[key]++;
      window.__ac.lastAt = performance.now();
      return orig.apply(this, arguments);
    };
  };
  wrap('createOscillator', 'osc');
  wrap('createGain', 'gain');
  // 【v1.167】不只数个数 —— 顺手把送进播放的 AudioBuffer **内容**量出来：
  //   对每个 buffer source 的 start() 采样其通道数据，算 时长/峰值/RMS/削波。
  //   这样"听到的"才有第二条证据链：不是"有没有声"，而是"声好不好"（削波刺耳 / 太轻听不见）。
  const origBuf = AC.prototype.createBufferSource;
  if (typeof origBuf === 'function') {
    AC.prototype.createBufferSource = function () {
      window.__ac.buf++;
      window.__ac.lastAt = performance.now();
      const node = origBuf.apply(this, arguments);
      try {
        const origStart = node.start;
        node.start = function () {
          try {
            const b = node.buffer;
            if (b) {
              const d = b.getChannelData(0);
              let peak = 0, sum = 0, n = 0;
              for (let i = 0; i < d.length; i += 8) {
                const v = Math.abs(d[i]);
                if (v > peak) peak = v;
                sum += d[i] * d[i];
                n++;
              }
              const rms = Math.sqrt(sum / Math.max(1, n));
              const rec = { dur: +b.duration.toFixed(3), peak: +peak.toFixed(4), rms: +rms.toFixed(4) };
              window.__ac.stats.push(rec);
              if (peak >= 0.999) window.__ac.clips.push(rec);
            }
          } catch (e) { /* 某些实现缓冲不可读，忽略 */ }
          return origStart.apply(this, arguments);
        };
      } catch (e) { /* 保底：计数已足够 */ }
      return node;
    };
  }
  // 记录 context 创建（部分实现需要 new，包一层构造器）
  try {
    const Wrapped = function () { window.__ac.ctxMade++; return new AC(); };
    Wrapped.prototype = AC.prototype;
    window.AudioContext = Wrapped;
  } catch (e) { /* 保底：原型钩子已足够 */ }
});

await page.goto(`http://127.0.0.1:${port}/${encodeURIComponent(entryName)}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForTimeout(4500);
await page.evaluate(() => { if (typeof window.guideSkipAll === 'function') window.guideSkipAll(); });
await page.waitForTimeout(1800);
// 音频需要用户手势解锁：点一下画面
await page.mouse.click(360, 640);
await page.waitForTimeout(800);

const read = async () => await page.evaluate(() => {
  const a = window.__ac || {};
  return { osc: a.osc | 0, buf: a.buf | 0, gain: a.gain | 0, ctxMade: a.ctxMade | 0, src: (a.osc | 0) + (a.buf | 0) };
});
const delta = (a, b) => ({ osc: b.osc - a.osc, buf: b.buf - a.buf, gain: b.gain - a.gain, src: b.src - a.src });

// ---- 1) 大厅静置：应有 BGM ----
const t0 = await read();
await page.waitForTimeout(4000);
const t1 = await read();
const bgm = delta(t0, t1);

// ---- 2) 进战斗 + killDemo：SFX 应跳增 ----
await page.evaluate(() => { if (window.MENGSHOU_DEBUG.hall) window.MENGSHOU_DEBUG.hall(); });
await page.waitForTimeout(600);
const g = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, cw: c.width, ch: c.height }; });
await page.mouse.click(g.l + (316 / g.cw) * g.w, g.t + (617 / g.ch) * g.h);
await page.waitForTimeout(6000);
const t2 = await read();
await page.evaluate(() => { try { window.MENGSHOU_DEBUG.killDemo(); } catch (e) { void e; } });
await page.waitForTimeout(400);
await page.evaluate(() => { try { window.MENGSHOU_DEBUG.cueSfx && window.MENGSHOU_DEBUG.cueSfx('hit'); } catch (e) { void e; } });
await page.waitForTimeout(3600);
const t3 = await read();
const battle = delta(t2, t3);

// ---- 3) 静音后应显著下降 ----
await page.evaluate(() => {
  const D = window.MENGSHOU_DEBUG || {};
  try { if (D.sfx) D.sfx(false); } catch (e) { void e; }
  try { if (D.masterMute) D.masterMute(true); } catch (e) { void e; }
});
await page.waitForTimeout(600);
const t4 = await read();
await page.evaluate(() => { try { window.MENGSHOU_DEBUG.killDemo(); } catch (e) { void e; } });
await page.waitForTimeout(3600);
const t5 = await read();
const muted = delta(t4, t5);

// ---- 4) 音质：缓冲区内容统计 ----
const q = await page.evaluate(() => {
  const a = window.__ac || {};
  const st = a.stats || [];
  const srt = (arr) => arr.slice().sort((x, y) => x - y);
  const pk = srt(st.map((r) => r.peak));
  const rm = srt(st.map((r) => r.rms));
  const du = srt(st.map((r) => r.dur));
  const med = (arr) => (arr.length ? arr[(arr.length / 2) | 0] : 0);
  return {
    n: st.length,
    clips: (a.clips || []).length,
    peakMed: +(med(pk) || 0).toFixed(3), peakMax: +(pk.length ? pk[pk.length - 1] : 0).toFixed(3),
    rmsMed: +(med(rm) || 0).toFixed(4), rmsMin: +(rm.length ? rm[0] : 0).toFixed(4),
    durMed: +(med(du) || 0).toFixed(3), durMax: +(du.length ? du[du.length - 1] : 0).toFixed(3),
    quiet: st.filter((r) => r.rms < 0.005).length,
  };
});
const okClip = q.clips === 0;                 // 有削波 → 可能刺耳
const okLoud = q.n > 0 && q.rmsMed >= 0.01;   // 整体太轻 → 可能听不见

const rows = [
  { name: '大厅静置(BGM)', ...bgm },
  { name: '战斗+击杀(SFX)', ...battle },
  { name: '静音后', ...muted },
];
// ⚠ 判定口径修正（实测踩过）：BGM 通常是**开机创建一次、loop 播放**的长 buffer source，
//   窗口期（4s）内的"增量"会是 0 —— 那是**度量窗口问题，不是没声音**。
//   → BGM 看**自加载以来的累计音源数**（t1.src），SFX/静音才看增量。
const okBgm = t1.src > 0;
const okBattle = battle.src > Math.max(bgm.src * 1.3, 0);
const okMute = muted.src < Math.max(2, battle.src * 0.5);
const md = [
  '# 音频专项体检（audio-audit）',
  '',
  `- AudioContext 创建次数: ${t1.ctxMade}（0 = 根本没初始化音频）`,
  `- **自加载以来累计音源**: ${t1.src}（振荡器 ${t1.osc} + buffer ${t1.buf}）`,
  `- 未捕获异常: ${errs.length}`,
  '',
  '| 阶段（窗口内增量） | 振荡器 | 音频源(buffer) | 音源合计 |',
  '|---|---|---|---|',
  ...rows.map((r) => `| ${r.name} | ${r.osc} | ${r.buf} | ${r.src} |`),
  '',
  `- ① 有 BGM（**累计**音源 > 0）: **${okBgm ? '✅' : '❌'}**`,
  `- ② 战斗+击杀高于 BGM 窗口（${bgm.src}→${battle.src}）: **${okBattle ? '✅' : '❌'}**`,
  `- ③ 静音后显著下降（${battle.src}→${muted.src}）: **${okMute ? '✅' : '❌'}**`,
  '',
  '## 音质（把送进播放的 AudioBuffer 内容量出来）',
  '',
  `- 采样到的播放缓冲: **${q.n}** 个`,
  `- 峰值 中位 **${q.peakMed}** / 最高 **${q.peakMax}**；RMS 中位 **${q.rmsMed}** / 最低 **${q.rmsMin}**`,
  `- 时长 中位 **${q.durMed}s** / 最长 **${q.durMax}s**`,
  `- ④ 无削波（峰值≥0.999 的缓冲 = 0）: **${okClip ? '✅' : '❌ 有 ' + q.clips + ' 个'}**`,
  `- ⑤ 整体不偏轻（RMS 中位 ≥0.01）: **${okLoud ? '✅' : '❌'}**（RMS<0.005 的 ${q.quiet} 个）`,
  '',
  '> 方法：挂钩 `createBufferSource` 返回的节点，在其 `start()` 时读 `node.buffer` 的通道数据算指标。',
  '> ⚠ 这是**静态内容**指标（不含实时混音/限幅），但足以抓"削波刺耳"与"轻到听不见"。',
  '',
  '> 计数钩子挂在 `AudioContext.prototype.createOscillator/createBufferSource` 上，在游戏脚本执行前注入。',
  '> ⚠ BGM 是"开机建一次 + loop"的形态 → **窗口增量会为 0，属正常**，故 BGM 用累计量判定。',
  '',
].join('\n');
fs.writeFileSync(path.join(OUT, 'audio-report.md'), md);
fs.writeFileSync(path.join(OUT, 'audio-report.json'), JSON.stringify({ bgm, battle, muted, ctxMade: t1.ctxMade, quality: q, errs, ok: { okBgm, okBattle, okMute, okClip, okLoud } }, null, 2));
console.log(md);

await browser.close();
server.close();
if (errs.length) { console.error('❌ 有未捕获异常'); process.exit(3); }
if (!(okBgm && okBattle && okMute)) { console.error('❌ 音频体检未通过（BGM/SFX/静音）'); process.exit(2); }
if (!(okClip && okLoud)) { console.error('❌ 音质体检未通过（削波/偏轻）'); process.exit(4); }
process.exit(0);
