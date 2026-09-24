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
// PICK_ENTRY_FILTERED: 排除 _ 前缀（_ = 临时/备份），防审计到备份文件（v1.187 实测）
const entryName = fs.readdirSync(gameDir).filter((f) => f.toLowerCase().endsWith('.html') && !f.startsWith('_')).sort()[0];
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
              // 【v1.167j】接缝检查：循环点是否"断崖"。
              //   ⚠ 口径两次踩坑，最终确定「物理正确」版本：
              //   ① 旧版 max(|末-首|, max_{k<128}|d[n-1-k]-d[k]|)/peak < 0.15 —— **假阳性**：
              //      阴性对照（数学上完美循环的正弦）也报 0.361 FAIL → 判据本身不成立。
              //      错在第二项取"任意样本对最大差"，44.1kHz 下相邻两样本跨半周期就能差 ~0.5。
              //   ② 正确量法：循环回跳到头部那**一步**的样本跳变 seamJump = |d[0] - d[n-1]|，
              //      再除以"缓冲内部相邻样本差的 P95"归一 → ≈1~3× 表示与正常波形起伏同级（听不出）。
              let seam = -1;
              if (b.duration > 3 && d.length > 48000) {
                const jump = Math.abs(d[0] - d[d.length - 1]);
                const diffs = [];
                for (let z = 1; z < d.length; z += 16) diffs.push(Math.abs(d[z] - d[z - 1]));
                diffs.sort((p, q) => p - q);
                const p95 = diffs[Math.floor(diffs.length * 0.95)] || 1e-6;
                seam = +(jump / p95).toFixed(2);
              }
              const rec = { dur: +b.duration.toFixed(3), peak: +peak.toFixed(4), rms: +rms.toFixed(4), seam: seam };
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
// 【第 118 轮】**先把"战斗真的开始了"证明出来，再去判音频**（O25）。
//   实测那次红点里 ② 的计数是 `1→1` —— 真相是**驱动那一下没进战斗**，而老版本把它报成"音频不达标" ✗。
//   与我们这一季反复踩的是同一类错：**把"没量到"当成"量到了不合格"**。
//   现在：点不进去就重试；三次都进不去 ⇒ 判据②**无数据**，用独立退出码 6 报出来，与"音频真坏了"(2) 分开。
await page.evaluate(() => { if (window.MENGSHOU_DEBUG.hall) window.MENGSHOU_DEBUG.hall(); });
await page.waitForTimeout(600);
const g = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, cw: c.width, ch: c.height }; });
const isPlaying = async () => await page.evaluate(() => { try { return !!(window.MENGSHOU_DEBUG && MENGSHOU_DEBUG.state && MENGSHOU_DEBUG.state().playing); } catch (e) { return false; } });
let entered = false, tries = 0;
for (tries = 1; tries <= 3 && !entered; tries++) {
  await page.mouse.click(g.l + (316 / g.cw) * g.w, g.t + (617 / g.ch) * g.h);
  await page.waitForTimeout(2500);
  entered = await isPlaying();
}
const t2 = await read();
await page.waitForTimeout(entered ? 3500 : 6000);
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
  const seamArr = srt(st.filter((r) => r.seam >= 0).map((r) => r.seam));
  const med = (arr) => (arr.length ? arr[(arr.length / 2) | 0] : 0);
  return {
    n: st.length,
    clips: (a.clips || []).length,
    peakMed: +(med(pk) || 0).toFixed(3), peakMax: +(pk.length ? pk[pk.length - 1] : 0).toFixed(3),
    rmsMed: +(med(rm) || 0).toFixed(4), rmsMin: +(rm.length ? rm[0] : 0).toFixed(4),
    durMed: +(med(du) || 0).toFixed(3), durMax: +(du.length ? du[du.length - 1] : 0).toFixed(3),
    quiet: st.filter((r) => r.rms < 0.005).length,
    seamMax: +(seamArr.length ? seamArr[seamArr.length - 1] : 0).toFixed(3),
  };
});
const okClip = q.clips === 0;                 // 有削波 → 可能刺耳
const okLoud = q.n > 0 && q.rmsMed >= 0.01;   // 整体太轻 → 可能听不见
// 【v1.167j】接缝阈值：seamJump ÷ 相邻样本差 P95。与正常波形起伏同级（≤4×）即听不出跳。
//   ⚠ 附**阴性对照**（见下 selftest）：判据必须先证明"完美循环能过"，否则不许上岗。
const SEAM_LIMIT = 4;
const okSeam = q.seamMax < SEAM_LIMIT;

// ---- 阴性对照：判据自检（完美循环必须 PASS；人为断崖必须 FAIL）----
//   没有这一步，"永远失败"的守卫比没有守卫更危险（本项目已踩过：旧口径对完美正弦报 FAIL）。
const selftest = await page.evaluate(() => {
  const SR = 44100;
  const metric = (d) => {
    const jump = Math.abs(d[0] - d[d.length - 1]);
    const diffs = [];
    for (let z = 1; z < d.length; z += 16) diffs.push(Math.abs(d[z] - d[z - 1]));
    diffs.sort((p, q) => p - q);
    const p95 = diffs[Math.floor(diffs.length * 0.95)] || 1e-6;
    return +(jump / p95).toFixed(2);
  };
  const n = SR * 5;
  const perfect = new Float64Array(n);
  for (let i = 0; i < n; i++) perfect[i] = Math.sin(2 * Math.PI * (SR / 4410) * i / SR);   // 整数周期 → 天然无缝
  const broken = Float64Array.from(perfect);
  for (let i = n - 3000; i < n; i++) broken[i] = 0.5;                                      // 尾段抬到 0.5 → 真断崖
  return { perfect: metric(perfect), broken: metric(broken) };
});
const okSelftest = selftest.perfect < SEAM_LIMIT && selftest.broken >= SEAM_LIMIT;

const rows = [
  { name: '大厅静置(BGM)', ...bgm },
  { name: '战斗+击杀(SFX)', ...battle },
  { name: '静音后', ...muted },
];
// ⚠ 判定口径修正（实测踩过）：BGM 通常是**开机创建一次、loop 播放**的长 buffer source，
//   窗口期（4s）内的"增量"会是 0 —— 那是**度量窗口问题，不是没声音**。
//   → BGM 看**自加载以来的累计音源数**（t1.src），SFX/静音才看增量。
const okBgm = t1.src > 0;
// 【第 118 轮】判据②改成不依赖那个几乎恒为 1 的 `bgm.src × 1.3`（BGM 是"开机建一次 + loop"，
//   4 秒窗口里的增量本来就是 0~1 ⇒ 老写法等于要求"窗口里至少 2 个 SFX"却把阈值伪装成比值）：
//   直接要求 **窗口内 ≥2 个音源且多于 BGM 窗口**；再叠加"确实进了战斗"这个前置条件（见上）。
const okBattle = battle.src >= 2 && battle.src > bgm.src;
const battleData = entered && okBattle;
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
  `- ② 战斗+击杀高于 BGM 窗口（${bgm.src}→${battle.src}）: **${battleData ? '✅' : (entered ? '❌' : '⚠ 无数据')}**` +
    (entered ? '' : `（**驱动没能进入战斗**：点击重试 ${tries - 1} 次仍未 \`playing\` ⇒ 本条不作音频结论，见 O25）`),
  `- ③ 静音后显著下降（${battle.src}→${muted.src}）: **${okMute ? '✅' : '❌'}**`,
  '',
  '## 音质（把送进播放的 AudioBuffer 内容量出来）',
  '',
  `- 采样到的播放缓冲: **${q.n}** 个`,
  `- 峰值 中位 **${q.peakMed}** / 最高 **${q.peakMax}**；RMS 中位 **${q.rmsMed}** / 最低 **${q.rmsMin}**`,
  `- 时长 中位 **${q.durMed}s** / 最长 **${q.durMax}s**`,
  `- ④ 无削波（峰值≥0.999 的缓冲 = 0）: **${okClip ? '✅' : '❌ 有 ' + q.clips + ' 个'}**`,
  `- ⑤ 整体不偏轻（RMS 中位 ≥0.01）: **${okLoud ? '✅' : '❌'}**（RMS<0.005 的 ${q.quiet} 个）`,
  `- ⑥ 循环接缝连续（回跳幅度 ${q.seamMax}× 相邻样本差P95 < ${SEAM_LIMIT}）: **${okSeam ? '✅' : '❌ 循环点有断崖'}**`,
  `- ⑥′ 判据自检（阴性对照）: 完美循环 **${selftest.perfect}×**（须 <${SEAM_LIMIT}）/ 人为断崖 **${selftest.broken}×**（须 ≥${SEAM_LIMIT}）: **${okSelftest ? '✅ 判据有效' : '❌ 判据失效'}**`,
  '',
  '> 方法：挂钩 `createBufferSource` 返回的节点，在其 `start()` 时读 `node.buffer` 的通道数据算指标。',
  '> ⚠ 这是**静态内容**指标（不含实时混音/限幅），但足以抓"削波刺耳"与"轻到听不见"。',
  '> ⑥ 接缝口径（v1.167j 修正）：一度用「首尾各 512 样本最大差 ÷ 峰值 < 0.15」，',
  '>   **阴性对照打穿**（数学上完美循环的正弦也报 0.361 → FAIL）→ 该判据不成立。',
  '>   现口径 = `|d[0] - d[n-1]| ÷ 相邻样本差 P95`；循环回跳与波形正常起伏同级即无缝。',
  '>   ⑥′ 自检是本判据的"上岗证"：完美循环必须过、人为断崖必须挂，两者都对才认 ⑥ 的结论。',
  '',
  '> 计数钩子挂在 `AudioContext.prototype.createOscillator/createBufferSource` 上，在游戏脚本执行前注入。',
  '> ⚠ BGM 是"开机建一次 + loop"的形态 → **窗口增量会为 0，属正常**，故 BGM 用累计量判定。',
  '',
].join('\n');
fs.writeFileSync(path.join(OUT, 'audio-report.md'), md);
fs.writeFileSync(path.join(OUT, 'audio-report.json'), JSON.stringify({ bgm, battle, muted, ctxMade: t1.ctxMade, entered, tries: tries - 1, quality: q, selftest, errs, ok: { okBgm, okBattle, battleData, okMute, okClip, okLoud, okSeam, okSelftest } }, null, 2));
console.log(md);

await browser.close();
server.close();
if (errs.length) { console.error('❌ 有未捕获异常'); process.exit(3); }
// 【第 118 轮】顺序很重要：**驱动都没进战斗**就先说清楚，别让它伪装成音频结论。
if (!entered) { console.error('❌ 判据②无数据：驱动点击 ' + (tries - 1) + ' 次仍未进入战斗（这是驱动问题，不是音频结论；见 OPEN-ITEMS O25）'); process.exit(6); }
if (!(okBgm && okBattle && okMute)) { console.error('❌ 音频体检未通过（BGM/SFX/静音）'); process.exit(2); }
if (!okSelftest) { console.error('❌ 接缝判据自检失败（判据本身不可信，结论作废）'); process.exit(5); }
if (!(okClip && okLoud && okSeam)) { console.error('❌ 音质体检未通过（削波/偏轻/循环接缝）'); process.exit(4); }
process.exit(0);
