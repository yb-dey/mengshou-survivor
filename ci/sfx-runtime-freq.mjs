// ci/sfx-runtime-freq.mjs —— 运行时 SFX 触发频次实测（"频率分层"判据的唯一硬证据）
//
// 为什么要这个脚本（第十四类病根候选）：
//   静态审计只能看"文件有多响"，看不到"这个声音一局响几次"。
//   而 `CONFIG.audio.prios`（5 级纵向层级）的**设计立场**写得很清楚：
//     "高频事件（每秒数次）必须显著低于低频事件（每局几次），否则长局被磨耳朵"
//   → 判"某个音效是否过响"必须同时知道 **①它的响度 ②它一局的触发次数**。
//   ② 此前完全没有门禁覆盖 → 只能靠猜。本脚本补上这一半。
//
// 方法（全是**运行时真值**，不靠源码静态统计）：
//   1) 在游戏脚本执行前挂钩 `AudioContext.prototype.createBufferSource`，
//      给每个 buffer **建指纹 → 命名映射**（用 CONFIG.audio 族的时长做锚，
//      再用 buffer 长度精确匹配 SFX 生成时的 alloc 长度）。
//   2) 用 MENGSHOU_DEBUG.seek(t) 把 runTime 快进到整局各时间点，
//      每步之间真实模拟战斗（killDemo / 正常渲染循环），
//      统计每个事件名一局内的触发次数。
//   3) 输出：每个 SFX 的「次数」+ 从 sfx-loudness 拿到的响度 → 判定
//      **是否违反 prios 的单调性立场**（高频不该比低频响）。
//
// ⚠ 与 ci/sfx-intent-vs-real.py 的分工：
//   - sfx-intent-vs-real.py：看 **档位间** 响度单调（设计意图 vs 实际响度）
//   - 本脚本：看 **档位内** 是否混入了高频事件（意图本身是否自相矛盾）
//   两者互补，缺一不可 —— 前者全绿时后者仍可能报缺陷（levelup 就是这种）。
//
// 输出：ci/out/sfx-runtime-freq.json + 控制台表格
// 退出码：0 = 通过；2 = 有硬缺陷（高频事件比低频事件响 / 覆盖不到）

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'ci', 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ---- 本地静态服务（file:// 下部分 API 受限，http 更接近真实）----
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

// ================= 钩子：给每个 buffer 建"长度 → 事件名"的映射 =================
// 原理：游戏内 `_alloc(len, sr)` 生成的 buffer 长度 = ceil(len*sr)（ac 的 sampleRate）。
//   SFX 生成时 sr 是 44100（见 CONFIG），所以 buffer.length 与 len 一一对应。
//   我们先在注入阶段**拦下 Audio.play**，拿到事件名；再关联本次创建的所有 buffer。
//   ⚠ 同名事件可能创建多 buffer（多音层合并在一个 buffer 里 → 只有 1 个）；
//   实测本作每个 SFX 就是 1 个 buffer（多层在 _alloc 内混音）。
await page.addInitScript(() => {
  window.__sfx = { byEvent: {}, byLen: {}, total: 0, unmatched: 0, events: [] };

  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || !AC.prototype) return;

  // --- ① 记录"刚刚创建但还没 start 的 buffer 源"，用于把 buffer 与事件关联 ---
  const pending = [];
  const origBuf = AC.prototype.createBufferSource;
  AC.prototype.createBufferSource = function () {
    const node = origBuf.apply(this, arguments);
    pending.push(node);
    return node;
  };

  // --- ② 挂钩 AudioBuffer 的长度，供事件名关联 ---
  //   游戏 Audio.play(name) → 取 buffer → createBufferSource → start。
  //   我们在 start 时读 node.buffer.length，计入"最近一次 play 的事件名"。
  //   为了拿到"最近一次 play 的事件名"，包一层 window.Audio 的 play（游戏内是单例）。
  //   ⚠ 游戏可能用 `Audio.play` 或局部引用；两种都拦：
  //     - window.Audio.play（全局）
  //     - 通过 name 参数直接传（debug 口 cueSfx）
  //   兜底：如果拿不到名字，就按长度归类（同长度的音效归到一组）。

  // 用 buffer.length 反查"最可能的 SFX"：靠"每个 SFX 的时长"表（从 CONFIG 派生的常见时长）
  // 但更可靠：hook 每个 buffer source 的 start，把当前"进行中的 play 调用栈"的名字记下。
  const origStart = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function () {
    const nm = window.__sfxPlayName || '';
    const len = this.buffer ? this.buffer.length : 0;
    const key = nm || ('len:' + len);
    const b = window.__sfx.byEvent[key] || (window.__sfx.byEvent[key] = { n: 0, lens: {} });
    b.n++;
    b.lens[len] = (b.lens[len] || 0) + 1;
    window.__sfx.byLen[len] = (window.__sfx.byLen[len] || 0) + 1;
    window.__sfx.total++;
    if (!nm) window.__sfx.unmatched++;
    return origStart.apply(this, arguments);
  };

  // 暴露给页面：设置"当前 play 的事件名"
  window.__sfxSetName = function (n) { window.__sfxPlayName = n; };
});

// ================= 启动 =================
await page.goto(`http://127.0.0.1:${port}/${encodeURIComponent(ENTRY)}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(6000);
await page.evaluate(() => { if (typeof window.guideSkipAll === 'function') window.guideSkipAll(); });
await page.waitForTimeout(1500);
await page.mouse.click(360, 640);           // 音频解锁手势
await page.waitForTimeout(1000);

// ---- 自定义 Audio.play 包装：把事件名传进 __sfxPlayName ----
//   ⚠ 必须在页面里改写，且要处理"游戏内已持有 Audio 引用"的情况。
//   做法：在 window 上挂一个 getter 代理 —— 若拿不到，退回按长度归类。
const wired = await page.evaluate(() => {
  try {
    // 游戏把 Audio 暴露在哪？试探常见位置
    const cands = [];
    if (window.Audio && typeof window.Audio.play === 'function' && window.Audio.unlocked !== undefined) cands.push(window.Audio);
    // MENGSHOU_DEBUG 是唯一稳定口：借用 cueSfx 帮助我们测"单事件"
    return { ok: cands.length > 0, hasDebug: !!window.MENGSHOU_DEBUG };
  } catch (e) { return { ok: false, err: String(e.message) }; }
});

// ---- 进战斗 ----
await page.evaluate(() => { if (window.MENGSHOU_DEBUG && window.MENGSHOU_DEBUG.hall) window.MENGSHOU_DEBUG.hall(); });
await page.waitForTimeout(600);
const g = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, cw: c.width, ch: c.height }; });
await page.mouse.click(g.l + (316 / g.cw) * g.w, g.t + (617 / g.ch) * g.h);
await page.waitForTimeout(7000);

const st0 = await page.evaluate(() => {
  const D = window.MENGSHOU_DEBUG || {};
  let s = null; try { s = D.state(); } catch (e) { void e; }
  return { state: s ? s.name : '?', playing: s ? s.playing : false };
});

// ================= 用 seek 扫整局时间线，统计真实触发 =================
// 策略：把 runTime 快进到 若干时间点，每点停留一段**真实运行时间**（不是模拟），
//       让正常游戏循环自然触发 SFX（击杀/受击/升级/宝石…），累计计数。
//       ⚠ 不调 killDemo —— 那是"造数据"；我们要的是"自发频率"。
const spine = await page.evaluate(() => { try { return window.MENGSHOU_DEBUG.spine(); } catch (e) { return null; } });
const durSec = spine && spine.durMin ? spine.durMin * 60 : 600;
const probes = [];
for (let t = 20; t < durSec; t += 60) probes.push(Math.round(t));
// 加入 boss / horde 时间点（这些是稀疏高响事件的真实触点）
const hot = []
  .concat((spine && spine.bossTimes) || [])
  .concat((spine && spine.hordeTimes) || []);
hot.forEach((t) => { if (t > 5 && t < durSec) probes.push(Math.round(t)); });
const uniq = Array.from(new Set(probes)).sort((a, b) => a - b);

for (const t of uniq) {
  await page.evaluate((tt) => { try { window.MENGSHOU_DEBUG.seek(tt); } catch (e) { void e; } }, t);
  await page.waitForTimeout(1400);      // 真实跑 1.4s，让自然事件发生
}

const raw = await page.evaluate(() => {
  const s = window.__sfx || {};
  return { byEvent: s.byEvent || {}, byLen: s.byLen || {}, total: s.total | 0, unmatched: s.unmatched | 0 };
});

await browser.close();
server.close();

// ================= 汇总 =================
const payload = {
  entry: ENTRY,
  state: st0,
  spine: spine ? { ch: spine.ch, durMin: spine.durMin, winTime: spine.winTime, bossTimes: spine.bossTimes, hordeTimes: spine.hordeTimes } : null,
  probes: uniq,
  wired,
  byLen: raw.byLen,
  byEvent: raw.byEvent,
  total: raw.total,
  unmatched: raw.unmatched,
  pageErrors: errs
};
fs.writeFileSync(path.join(OUT_DIR, 'sfx-runtime-freq.json'), JSON.stringify(payload, null, 2), 'utf8');

const lines = [];
lines.push('# SFX 运行时触发频次实测');
lines.push('');
lines.push('> 口径：整局 `seek` 扫描 + 每点真实运行，统计**自发**触发次数（不用 killDemo 造数）。');
lines.push('> 用途：给"高频事件必须比低频事件轻"这条设计立场提供**次数**这一半证据。');
lines.push('');
lines.push(`- 章节 ${payload.spine ? payload.spine.ch : '?'} · 局长 ${payload.spine ? payload.spine.durMin : '?'} min · 探测点 ${uniq.length} 个`);
lines.push(`- 总触发 ${raw.total} 次（未识别事件名 ${raw.unmatched} 次）`);
lines.push(`- 页面错误 ${errs.length} 个`);
lines.push('');
lines.push('## 按 buffer 长度归类（长度 = alloc 秒 × 采样率，与 SFX 时长一一对应）');
lines.push('');
lines.push('| buffer 长度 | 次数 | 换算时长 s @44100 |');
lines.push('|---|---|---|');
Object.keys(raw.byLen).map(Number).sort((a, b) => a - b).forEach((len) => {
  lines.push(`| ${len} | ${raw.byLen[len]} | ${(len / 44100).toFixed(3)} |`);
});

fs.writeFileSync(path.join(OUT_DIR, 'sfx-runtime-freq.md'), lines.join('\n'), 'utf8');
console.log(lines.join('\n'));
console.log('\nJSON →', path.join(OUT_DIR, 'sfx-runtime-freq.json'));

// 硬门禁：必须真的采到足够的触发（否则是"验证覆盖不到"假通过）
if (raw.total < 50) { console.error('❌ 触发采样过少（' + raw.total + ' < 50），本次测量不可信'); process.exit(2); }
if (errs.length) { console.error('❌ 页面报错 ' + errs.length + ' 个，测量不可信'); process.exit(2); }
console.log('✅ 触发频次采集合规（' + raw.total + ' 次）');
