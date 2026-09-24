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
//   其余屏仅**记录**实测状态。⚠ 第 126 轮起 02-chapters / 04-upgrade 也进了 FLAGS
//   （此前它们是**空门**：只有"≠大厅/≠上一张"两道弱判据，面板开错也能过）。
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
  // 【第 126 轮】补上此前**两道空门**的两屏：02-chapters / 04-upgrade 原来既不在 EXPECT
  //   也不在 FLAGS ⇒ 只靠"≠大厅、≠上一张"两道弱判据，**面板开错也能过**。
  //   两屏都是"盖在 HOME 上的面板"（flow 不变；实测 state 都是 HOME）⇒ 只能用可见性开关断言。
  //   字段来自本轮给母版 `MENGSHOU_DEBUG.state()` 新增的 `chapters` / `upgrade`
  //   （纯调试接口，不动表现/数值；同时修掉了 `up` 里 `(f.ARMORY || f.UPGRADE)` 那个写法错）。
  "02-chapters": "chapters",
  "04-upgrade": "upgrade",
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
/** 画布「空不空」的两项读数：独特色数 + 主色占比（越高越空/越平）。
 *  【第 126 轮】原来这段**只写在 STEPS 循环里** ⇒ 11-battle / 12-levelup / 13-pause
 *  三屏在报告里一直是 `-`（没有读数）。**最常玩的一屏量得最少** —— 抽成函数让四类屏共用。 */
async function measureDens() {
  return await page.evaluate(() => {
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
}
/** 读一次战斗态：流程状态名 + 应力快照（enemyCount 等）。读不到就如实回 null。 */
async function battleProbe() {
  return await page.evaluate(() => {
    const D = window.MENGSHOU_DEBUG || {};
    let st = ''; try { st = (D.state ? D.state() : {}).state || ''; } catch (e) { void e; }
    let sk = null; try { sk = D.stress ? D.stress() : null; } catch (e) { void e; }
    return { st, sk };
  });
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
    const dens = await measureDens();
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
  // 【第 126 轮】11-battle 必须拍到**真的在打仗**，而不是开场第 7 秒的空场。
  //   发现过程（量出来的，不是看出来的）：`_qc/_imgstat.mjs` 对 13 屏量局部对比，
  //   11-battle 的 edgePct = **4.37%**，是**全场最低**；而同一份报告里 11-battle 连
  //   「独特色数/主色占比」都是 `-`（那段量只写在 STEPS 循环里）。
  //   ⇒ **玩家花 90% 时间的那一屏，恰好是这套巡检量得最少的一屏。**
  //   根因：原来的固定 `waitForTimeout(7000)` 不是为了"拍战斗"，而是为了让无人操作的玩家
  //   **攒出一个升级弹窗**给下一屏（12-levelup）—— 它顺便定义了 11-battle 的画面 =
  //   开局第 7 秒、几乎没怪。而 `stress-perf.mjs` 实测真实战斗中同屏怪可达 **45+**。
  //   ⇒ 改法：**别再钉死秒数**，改成"轮询到真的有怪才拍"（自然推进，不 seek）。
  //   ⛔ **为什么不用 `seek()` 跳到潮期**（我第一版就是那么写的，读了源码后撤回）：
  //     `debugSeekRunTime(t)` 只把 `GAME.runTime` 与刷怪调度器推到 t，**不动玩家的等级/强化** ⇒
  //     seek(92) 等于"让 1 级玩家面对 92 秒的压力" ⇒ 他会被淹死，拍到的是复活盘而不是战斗。
  //     （stress-perf 之所以敢 seek，正是因为它**要**玩家弱、并且反复点复活盘续命；
  //       那一套的目的是量帧时间，不是拍一张代表常态的图。）
  //   ⚠ 取卡策略也因此与 stress-perf 相反：那边**故意不选卡**把密度堆到 45+（极端态），
  //     这里要的是**常态战斗** ⇒ 正常选卡（玩家变强、活得下来、密度落在常态区间）。
  //   ⚠ 阈值取 **10**：stress-perf 的轨迹原文是「选卡 21 次 ⇒ 同屏怪 **1–14** 震荡、峰值 14」，
  //     14 是该区间上沿（拿它当阈值会几乎每次都报"未达阈值"——**永远会响的警告等于没有警告**）；
  //     10 落在同一区间的偏高段，既证明"真的有怪"，又不掷骰子。**这个数来自那份实测记录，不是我拍的。**
  //   ⚠ 到不了阈值**不算失败**：照拍，并把实测怪数原样写进报告（`⚠ 未达阈值`）。
  //     不在这里硬判红，是因为本 workflow 的结论被 verify-dist 的「门禁收口」读走 ——
  //     先让读数存在，再由人/后续门禁决定阈值（避免把一个绿色门禁改成掷骰子）。
  const BATTLE_MIN_ENEMY = +(process.env.BATTLE_MIN_ENEMY || 10);
  const BATTLE_WAIT_MS = +(process.env.BATTLE_WAIT_MS || 60000);
  let bEnemy = 0, bPeak = 0, bState = '', bTries = 0, bWhy = '', bReached = false;
  {
    const t0 = Date.now();
    while (Date.now() - t0 < BATTLE_WAIT_MS) {
      bTries++;
      const s = await battleProbe();
      bState = s.st;
      bEnemy = s.sk ? (s.sk.enemyCount | 0) : 0;
      if (bEnemy > bPeak) bPeak = bEnemy;
      if (bState === 'PLAYING' && bEnemy >= BATTLE_MIN_ENEMY) { bReached = true; bWhy = '达到 ' + BATTLE_MIN_ENEMY + ' 只'; break; }
      if (bState === 'LEVELUP_MODAL') {
        // 正常选卡（与 stress-perf 的"清场不选"相反，理由见上）
        await page.evaluate(() => { try { window.MENGSHOU_DEBUG.levelupTap(); } catch (e) { void e; } });
      } else if (bState === 'REVIVE_MODAL') {
        // 与 stress-perf 同一套已验证钩子（点画面中央实测点不掉）
        await page.evaluate(() => { try { if (typeof window.onTapReviveBtn === 'function') window.onTapReviveBtn(); } catch (e) { void e; } });
      } else if (bState === 'RESULT_LOSE' || bState === 'RESULT_WIN') {
        bWhy = '本局已结算（' + bState + '），不再硬闯'; break;
      }
      await page.waitForTimeout(400);
    }
    if (!bWhy) bWhy = '等满 ' + Math.round(BATTLE_WAIT_MS / 1000) + 's 未达阈值（峰值 ' + bPeak + '）';
  }
  // 清掉待结算升级并显式回到 PLAYING（保住 11-battle 的硬断言与 12-levelup 的前置）
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
    const dens = await measureDens();
    // 【v1.167】战斗是**最容易假成功**的一屏（此前拍到的是没关掉的每日面板）→ 硬断言 PLAYING
    const st = await page.evaluate(() => { try { return window.MENGSHOU_DEBUG.state(); } catch (e) { return null; } });
    const stateOk = !!(st && st.playing === true);
    if (!stateOk) console.log('  ⚠ 11-battle 目标屏断言不通过：实测 state=' + (st ? st.name : 'null') + ' / 期望 PLAYING');
    if (!bReached) console.log('::warning::11-battle 未达密度阈值 ' + BATTLE_MIN_ENEMY + '：' + bWhy + '（实测 ' + bEnemy + '，峰值 ' + bPeak + '）—— 这张图不代表常态战斗，评审前先看这个数');
    console.log('::notice::11-battle 采样密度 同屏怪=' + bEnemy + ' 峰值=' + bPeak + ' 目标=' + BATTLE_MIN_ENEMY + ' 轮询=' + bTries + ' 结束=' + bWhy);
    shots.push({ name: '11-battle', hook: 'mouse+轮询怪数', hash: prevHash, dHome: dHome >= 0 ? +dHome.toFixed(2) : null,
      dens, state: st ? st.name : null, stateOk,
      battleEnemy: bEnemy, battlePeak: bPeak, battleTries: bTries, battleReached: bReached, battleWhy: bWhy });
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
    // 【第 126 轮】战斗现在是从**潮期**开始的（11-battle 改成轮询到真的有怪），玩家可能在这一段里倒下 ⇒
    //   原实现只干等 35s，人死了就永远等不到卡（12-levelup 判 dup ⇒ 整条 sweep 红）。
    //   这里补上 stress-perf 已验证的两个钩子：复活盘点掉、结算则如实放弃（不假装成功）。
    if (t % 4 === 3) {
      const pr = await battleProbe();
      if (pr.st === 'REVIVE_MODAL') {
        await page.evaluate(() => { try { if (typeof window.onTapReviveBtn === 'function') window.onTapReviveBtn(); } catch (e) { void e; } });
      } else if (pr.st === 'RESULT_LOSE' || pr.st === 'RESULT_WIN') {
        console.log('  ⚠ 12-levelup 等待期间本局已结算（' + pr.st + '）⇒ 等不到升级卡');
        break;
      }
    }
    await page.waitForTimeout(500);
  }
  const cardsVis = !!(lu && lu.cards && lu.cards.length > 0);
  if (cardsVis) {
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, '12-levelup.png') });
    const h = crypto.createHash('sha1').update(fs.readFileSync(path.join(OUT, '12-levelup.png'))).digest('hex').slice(0, 12);
    prevHash = h;
    const dHome = sigDiff(await screenSig(), homeSig);
    shots.push({ name: '12-levelup', hook: '轮询 cards.length>0 (' + lu.cards.length + ' 张)', hash: h, dHome: dHome >= 0 ? +dHome.toFixed(2) : null,
      dens: await measureDens() });
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
    // 【第 126 轮】`pause(true)` 只在 PLAYING 生效（见本文件上方已知坑）。战斗现在从潮期开始、
    //   玩家可能已倒下 ⇒ 先确认状态并点掉复活盘/升级卡，否则这一屏会以"轮询超时"收场 ⇒ dup ⇒ sweep 退 2。
    const pre = await battleProbe();
    if (pre.st === 'REVIVE_MODAL') {
      await page.evaluate(() => { try { if (typeof window.onTapReviveBtn === 'function') window.onTapReviveBtn(); } catch (e) { void e; } });
      await page.waitForTimeout(300);
    } else if (pre.st === 'LEVELUP_MODAL') {
      await page.evaluate(() => {
        try {
          if (window.run) window.run.pendingLevels = 0;
          if (typeof window.closeLevelupUi === 'function') window.closeLevelupUi();
          if (window.GAME && window.GAME.flow) window.GAME.setState(window.GAME.flow.PLAYING);
        } catch (e) { void e; }
      });
      await page.waitForTimeout(300);
    }
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
        dens: await measureDens(),
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
        : (s.skipped || s.error || '')))
    // 【第 126 轮】战斗屏**自带密度标签**：不写清楚这一张是"几只怪"的那一刻，评审者没法判断它代不代表常态
    + (s.battleEnemy !== undefined
      ? (s.battleEnemy !== null ? (s.battleEnemy >= +(process.env.BATTLE_MIN_ENEMY || 10) ? '' : '⚠ ') +
        '同屏怪 **' + s.battleEnemy + '** 只（峰值 ' + s.battlePeak + '，目标 ' + (+(process.env.BATTLE_MIN_ENEMY || 10)) + '）' : '')
      : '') + ' |'),
  '',
  '> 「主色占比」= 出现最多的那一种颜色占采样点的比例。**越高说明画面越空/越平**。',
  '',
  '> ⚠ **11-battle 自带密度标签（第 126 轮新增）**：这一屏原来固定在"进战斗后第 7 秒"拍，',
  '> 那个时点几乎没怪 —— 实测 13 屏里它的局部对比 edgePct=4.37% 是**全场最低**，',
  '> 而玩家 90% 的时间恰恰花在这一屏。现在改成：`seek()` 跳到潮期 → 轮询到 `enemyCount ≥ 目标` 才拍，',
  '> 并把**实测同屏怪数**写进备注列。**没有这个数，就不该拿这一屏下美术结论。**',
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
