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
    'openVault', 'showGearPick', 'heroSheet', 'openUp', 'gearPreview',
    'codexTab', 'openSettings', 'closeSettings', 'dailyPick', 'levelupTap', 'pauseBuildChip'];   // 【2026-09-21】补齐真实动作型钩子
  return want.filter((k) => typeof D[k] === 'function');
});

// 【2026-09-21 再修】原 07/08/10 用的 `codex` / `heroSheet` / `daily` **全是"状态查询"函数**
//   （return 状态对象），不是打开动作 → 截图永远是大厅（与大厅基线 Δ=0.00）。
//   正确动作：07 用 `codexTab('enemy')`（顺带打开图鉴并切到敌人页）；10 用 `dailyPick()`；
//   08 原本指向的"英雄卡界面"**并不存在**（heroSheet 只是数据查询，英雄信息是大厅内的卡片）
//   → 换成真实存在却从未被巡检的 **设置页** `openSettings()`。
// 【2026-09-21】目标屏断言表（数据，不是人肉核特征）——
//   此前只证明"这一屏 ≠ 大厅"，结果两处假成功（拍到上一个弹窗 / 拍到普通战斗帧）都放过去了。
//   EXPECT：flow 状态名必须等于该值（强断言）
//   FLAGS ：该标志必须为真（弹窗类，用 `state()` 返回的开合标志）
//   其余屏仅**记录**实测状态，留给下一轮收紧（不瞎猜）。
const EXPECT = {
  "01-home": "HOME",
  "08-settings": "SETTINGS",
  "09-about": "ABOUT",
};
const FLAGS = {
  "05-vault": "vault",
  "06-beast": "beast",
  "07-codex-enemy": "beast",
  "10-daily": "dailyPick",
};
const STEPS = [
  { name: '01-home', call: 'hall' },
  { name: '02-chapters', call: 'openChapters' },
  { name: '03-gear', call: 'openGear' },
  { name: '04-upgrade', call: 'openUp' },
  { name: '05-vault', call: 'openVault' },
  { name: '06-beast', call: 'openBeast' },
  { name: '07-codex-enemy', call: 'codexTab', arg: 'enemy' },
  { name: '08-settings', call: 'openSettings' },
  { name: '09-about', call: 'about' },
  { name: '10-daily', call: 'dailyPick' },
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
    // ① 复位：goHome 回大厅，关掉可能开着的面板（不存在时静默）
    await page.evaluate(() => {
      const D = window.MENGSHOU_DEBUG || {};
      try { if (D.closeGear) D.closeGear(); } catch (e) { void e; }
      try { if (D.closeSettings) D.closeSettings(); } catch (e) { void e; }
      try { if (D.closeBeast) D.closeBeast(); } catch (e) { void e; }
      try { if (D.goHome) D.goHome(); } catch (e) { void e; }
    });
    await page.waitForTimeout(450);
    await page.evaluate((o) => {
      try { window.MENGSHOU_DEBUG[o.c](o.a); } catch (e) { return String(e); }
    }, { c: s.call, a: s.arg });
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
    // 【v1.167】目标屏断言：读一次 state() 拿全 flow 状态与弹窗开合
    let stGot = null, stateOk = true;
    try { stGot = await page.evaluate(() => { try { return window.MENGSHOU_DEBUG.state(); } catch (e) { return null; } }); } catch (e) { stGot = null; }
    if (stGot) {
      if (EXPECT[s.name]) stateOk = (stGot.name === EXPECT[s.name]);
      else if (FLAGS[s.name]) stateOk = (stGot[FLAGS[s.name]] === true);
      if (!stateOk) console.log('  ⚠ ' + s.name + ' 目标屏断言不通过：实测 state=' + stGot.name + ' / 期望 ' + (EXPECT[s.name] || FLAGS[s.name] + '=true'));
    }
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
    shots.push({ name: s.name, hook: s.call, dens, dup, hash: h, dHome: dHome >= 0 ? +dHome.toFixed(2) : null, sameAsHome,
      state: stGot ? stGot.name : null, stateOk });
  } catch (e) {
    shots.push({ name: s.name, error: String(e).slice(0, 150) });
  }
}

/** 依次尝试多个钩子，直到画面真的变化；候选可写 `'name'` 或 `{ n:'name', a:参数 }`
 *  —— 避免"钩子没生效"被当成成功。⚠ 有的动作**必须带参数**（如 `pause(open)`），
 *  无参调用等于空操作；也有的名字像动作其实是快照查询（`levelup` vs `levelupTap`）。 */
async function tryShoot(outName, candidates) {
  const p = path.join(OUT, outName + '.png');
  let base = prevHash;
  for (const c of candidates) {
    const nm = (typeof c === 'string') ? c : c.n;
    const arg = (typeof c === 'string') ? undefined : c.a;
    if (!available.includes(nm)) continue;
    await page.evaluate((o) => { try { window.MENGSHOU_DEBUG[o.n](o.a); } catch (e) { void e; } }, { n: nm, a: arg });
    await page.waitForTimeout(1300);
    await page.screenshot({ path: p });
    const h = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 12);
    if (h !== base) {
      prevHash = h;
      const dHome = sigDiff(await screenSig(), homeSig);
      shots.push({ name: outName, hook: nm + (arg === undefined ? '' : '(' + arg + ')'), hash: h, dHome: dHome >= 0 ? +dHome.toFixed(2) : null });
      return;
    }
  }
  await page.screenshot({ path: p });
  const h = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 12);
  prevHash = h;
  console.log('  ⚠ ' + outName + ' 试过 [' + candidates.map((c) => (typeof c === 'string' ? c : c.n + '(' + c.a + ')')).join(', ') + '] 画面均未变化 → 该界面可能无法用钩子打开');
  shots.push({ name: outName, hook: candidates.map((c) => (typeof c === 'string' ? c : c.n)).join('/'), dup: true, hash: h });
}

// 战斗内：升级三选一 + 暂停（每个都试多个钩子，画面没变就如实标记，不当成成功）
try {
  // ⚠ 实测坑：第 10 步的"每日挑战"弹窗**不会**被 hall() 关掉 → 点击落在弹窗上，
  //   拍出的 11-battle 其实是"每日挑战面板"（Δ 与大厅不同，所以旧检测拦不住）。
  //   → 进战斗前先做一次完整复位（关掉所有可能开着的面板 + 回大厅）。
  await page.evaluate(() => {
    const D = window.MENGSHOU_DEBUG || {};
    try { if (D.closeGear) D.closeGear(); } catch (e) { void e; }
    try { if (D.closeSettings) D.closeSettings(); } catch (e) { void e; }
    try { if (D.closeBeast) D.closeBeast(); } catch (e) { void e; }
    try { if (D.closeVault) D.closeVault(); } catch (e) { void e; }
    try { if (D.goHome) D.goHome(); } catch (e) { void e; }
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => { if (window.MENGSHOU_DEBUG.hall) window.MENGSHOU_DEBUG.hall(); });
  await page.waitForTimeout(800);
  const geom = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, cw: c.width, ch: c.height }; });
  await page.mouse.click(geom.l + (316 / geom.cw) * geom.w, geom.t + (617 / geom.ch) * geom.h);
  await page.waitForTimeout(7000);
  // 【第 53 轮修】7 s 无人操作足够升一级 ⇒「升级三选一」会整块盖住战场，state 变成 LEVELUP_MODAL，
  //   下面那句 playing===true 的断言必然失败（云端实测：11-battle 判「LEVELUP_MODAL ❌」→ 整条 sweep 红）。
  //   ⚠ 这不是游戏缺陷：升级弹窗本来就该拦住操作。是**探针**没清场 —— 与第 51 轮我在本机探针上
  //     踩到的是同一个坑（弹窗抢屏：dh/err 全绿，只有看图/读 state 才发现）。
  //   ⇒ 截图前先清掉待结算升级并显式回到 PLAYING；12-levelup 那一屏才是「该弹窗」的合法截图。
  await page.evaluate(() => {
    try {
      if (window.run) window.run.pendingLevels = 0;
      if (typeof window.closeLevelupUi === 'function') window.closeLevelupUi();
      if (typeof window.closePauseUi === 'function') window.closePauseUi();
      if (window.GAME && window.GAME.flow) window.GAME.setState(window.GAME.flow.PLAYING);
    } catch (e) { void e; }
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '11-battle.png') });
  prevHash = crypto.createHash('sha1').update(fs.readFileSync(path.join(OUT, '11-battle.png'))).digest('hex').slice(0, 12);
  {
    const dHome = sigDiff(await screenSig(), homeSig);
    // 【v1.167】战斗是**最容易假成功**的一屏（此前拍到的是没关掉的每日面板）→ 硬断言 PLAYING
    const st = await page.evaluate(() => { try { return window.MENGSHOU_DEBUG.state(); } catch (e) { return null; } });
    const stateOk = !!(st && st.playing === true);
    if (!stateOk) console.log('  ⚠ 11-battle 目标屏断言不通过：实测 state=' + (st ? st.name : 'null') + ' / 期望 PLAYING');
    shots.push({ name: '11-battle', hook: 'mouse', hash: prevHash, dHome: dHome >= 0 ? +dHome.toFixed(2) : null,
      state: st ? st.name : null, stateOk });
  }
  // ⚠ 已知坑：
  //  · `levelup` 是**快照查询**（返回 {ready,armed,state,cards}）→ 不能用来"打开升级"，
  //    但**正好可以当探针轮询**"升级是否已出现"，出现再截图；
  //  · `pause` 只在 `GAME.state === PLAYING` 时生效 → 若此刻升级卡还开着，调用等于空操作。
  //    → 先点掉升级卡回到战斗，再轮询重试 pause(true)。
  // ⚠ 判据修正：`levelup().ready` = `!(cardPopT>0)`（**弹出动画结束**），
  //   **没有卡时也返回 true** → 用它轮询会立刻"就绪"，拍到的是普通战斗帧（实测踩过）。
  //   正确判据是 `cards.length > 0`（debugCardSnap 已按 `visible` 过滤 = 真正在屏的三选一）。
  let lu = null;
  for (let t = 0; t < 70; t++) {
    lu = await page.evaluate(() => { try { return window.MENGSHOU_DEBUG.levelup(); } catch (e) { return null; } });
    if (lu && lu.cards && lu.cards.length > 0) break;
    await page.waitForTimeout(500);
  }
  const cardsVis = !!(lu && lu.cards && lu.cards.length > 0);
  if (cardsVis) {
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, '12-levelup.png') });
    const h = crypto.createHash('sha1').update(fs.readFileSync(path.join(OUT, '12-levelup.png'))).digest('hex').slice(0, 12);
    prevHash = h;
    const dHome = sigDiff(await screenSig(), homeSig);
    shots.push({ name: '12-levelup', hook: '轮询 cards.length>0 (' + lu.cards.length + ' 张)', hash: h, dHome: dHome >= 0 ? +dHome.toFixed(2) : null });
  } else {
    console.log('  ⚠ 12-levelup 等待超时：35s 内没有出现升级三选一（战斗可能未进入/时间不够）');
    shots.push({ name: '12-levelup', hook: '轮询 cards.length>0 超时', dup: true });
  }
  // 点掉升级卡 + 清助力卡，回到可暂停的战斗态
  await page.evaluate(() => {
    const D = window.MENGSHOU_DEBUG || {};
    try { if (D.levelupTap) D.levelupTap(); } catch (e) { void e; }
    try { if (D.closeCards) D.closeCards(); } catch (e) { void e; }
  });
  let paused = false;
  for (let t = 0; t < 24 && !paused; t++) {
    const before = prevHash;
    await page.evaluate(() => { try { window.MENGSHOU_DEBUG.pause(true); } catch (e) { void e; } });
    await page.waitForTimeout(700);
    const p = path.join(OUT, '13-pause.png');
    await page.screenshot({ path: p });
    const h = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 12);
    if (h !== before) {
      prevHash = h;
      const dHome = sigDiff(await screenSig(), homeSig);
      const st2 = await page.evaluate(() => { try { return window.MENGSHOU_DEBUG.state(); } catch (e) { return null; } });
      const ok2 = !!(st2 && st2.pause === true);
      if (!ok2) console.log('  ⚠ 13-pause 目标屏断言不通过：实测 state=' + (st2 ? st2.name : 'null') + ' / 期望 PAUSED_MENU');
      shots.push({ name: '13-pause', hook: 'pause(true) 轮询成功', hash: h, dHome: dHome >= 0 ? +dHome.toFixed(2) : null,
        state: st2 ? st2.name : null, stateOk: ok2 });
      paused = true;
    }
  }
  if (!paused) {
    console.log('  ⚠ 13-pause 轮询 17s 仍未进入暂停态');
    shots.push({ name: '13-pause', hook: 'pause(true) 轮询超时', dup: true });
  }
} catch (e) { shots.push({ name: 'battle-series', error: String(e).slice(0, 150) }); }

const md = [
  '# 全界面巡检',
  '',
  '- 可用界面钩子: ' + available.length + ' 个',
  '- 未捕获异常: ' + errs.length,
  '',
  '| 截图 | 钩子 | 画布 | 独特色数 | 主色占比 | 与大厅Δ | 实测状态 | 备注 |',
  '|---|---|---|---|---|---|---|---|',
  ...shots.map((s) => '| ' + s.name + ' | ' + (s.hook || '-') + ' | ' +
    (s.dens && s.dens.w ? s.dens.w + '×' + s.dens.h : '-') + ' | ' + (s.dens && s.dens.distinct || '-') + ' | ' +
    (s.dens && s.dens.dominantPct !== undefined ? s.dens.dominantPct + '%' : '-') + ' | ' +
    (s.dHome !== undefined && s.dHome !== null ? s.dHome : '-') + ' | ' +
    (s.state || '-') + (s.stateOk === false ? ' ❌' : '') + ' | ' +
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
const dupList = shots.filter((s) => s.dup || s.sameAsHome || s.stateOk === false).map((s) => s.name);
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
