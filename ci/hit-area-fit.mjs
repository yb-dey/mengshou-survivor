// hit-area-fit.mjs —— ⑲「命中区」运行时体检（触控目标可达性，用**真页面**量，不靠静态解析）
//
// 与 ci/tap-target-check.mjs 的分工：
//   静态判据锁"不许变小 / 不许新增偏小"（源码级，快、每次 push 都跑）；
//   本判据补它两处天生短板：
//     ① 18 个控件的尺寸由**布局函数的局部变量**算出（`var bw = CONFIG.pauseBtnW || 300; …`）⇒
//        静态读不到（登记在 ALLOW_BLIND，但终究是没量到）；
//     ② 静态只能按"全控件集合"算邻居 ⇒ **跨屏误判**：升级卡坐标是 `layoutLevelupCards()`
//        运行时摆的；而命中区安不安全只取决于**同屏同时可见**的邻居 —— 只有运行时知道。
//
// 量什么（每个状态打开一屏 → 遍历 UIStack.list 中 `visible && onTap` 的节点）：
//   A. **同屏命中区重叠（硬门禁）**：命中矩形 = rect ± (hitPad||0)（母版 hit() 口径 L27238）。
//      两矩形相交 ⇒ 点中间那块由**注册顺序**决定谁赢（hit() 从后往前扫 L27229）⇒ 最难查的手感 bug。
//   B. **短边 + 本屏安全 pad（报告）**：< 44 CSS px 的控件逐个列出，附"本屏内最大安全对称 pad"。
//
// 算法全在 ci/hit-area-lib.mjs（纯函数，本机可 `node ci/hit-area-lib.mjs --selftest` 先验证），
//   本文件只负责"把屏幕打开 + 把节点捞出来"。
//
// 阴性对照（--selftest）：
//   ① 纯逻辑 5 组（含"并排 8px ⇒ 安全 pad 只能是 4" —— 第 69 轮静态判据正是在这里算错过）
//   ② 基准：HOME 屏同屏命中区不应有重叠（证明探针口径可信）
//   ③ 把 `uiHomeGuide.hitPad` 设成 60（它与 uiHomeAbout 相隔 8px）⇒ **必须**被抓到
//
// 用法: node ci/hit-area-fit.mjs [--selftest]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { smallOnes, overlapsOf, logicSelftest, FLOOR, SCALE } from './hit-area-lib.mjs';

const OUT = path.join('ci', 'out');
fs.mkdirSync(OUT, { recursive: true });
const gameDir = path.resolve('game');
const entryName = fs.readdirSync(gameDir).filter((f) => f.toLowerCase().endsWith('.html') && !f.startsWith('_')).sort()[0];
if (!entryName) { console.log('SKIP 找不到 game/*.html'); process.exit(0); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.wav': 'audio/wav', '.jpg': 'image/jpeg', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const abs = path.join(gameDir, rel);
  if (!abs.startsWith(gameDir) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(abs).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const SELFTEST = process.argv.includes('--selftest');
const ALLOW_OVERLAP = [];   // 允许的重叠（当前为空：任何同屏重叠都算缺陷）
// ⚠ 每屏「至少应有几个可点节点」的下限 —— 防「量到 0 个却报 ok」：
//   首跑实测「复活/死亡 0/0/0」：state 轮询说到了 REVIVE_MODAL，扫描却一个可点节点都没有 ——
//   这种「没量到」绝不能长得像「量过且没问题」（本工作区反复踩的同一个坑）。低于下限 ⇒ FAIL。
const EXPECT_MIN = { 'HOME(大厅)': 8, '设置': 4, '图鉴': 4, '装备库': 4, '宝库': 4, '每日挑战': 2,
  '暂停': 4, '升级三选一': 3, '复活/死亡': 2, '结算': 2 };
// ── 偏小台账：可点节点短边 < 44 CSS px 必须在这里登记"为什么先这样"，否则 FAIL ──
//   ⚠ 与静态判据的 ALLOW_NEW 同款纪律：**报告不是契约**。60 个偏小如果只是打印出来，
//   下一个人加一个 18px 的可点条目也不会有任何东西拦他。
//   ⚠ 已核对：构筑芯（pausechip/resultchip）**不是**多余的可点 —— 结算页 L31755 明写
//   「点条目看怎么来的」，是**被文案prompt的**交互 ⇒ 不能靠"删 onTap"消掉，只能改视觉（见 PM §18.10）。
const ALLOW_SMALL = [
  // ── A 类：运行时生成的"条目簇"（视觉重排才能解决，扩命中区会压到相邻条目）──
  { re: /^pausechip\d+$/, why: '暂停面板构筑芯 ×14（点条目看提示）· 行高由面板密度决定，安全 pad 仅 3' },
  { re: /^resultchip\d+$/, why: '结算面板构筑芯 ×2 · **18.4 CSS px 全游戏最紧**；结算页文案明写「点条目看怎么来的」⇒ 被 prompt 的交互，只能改视觉' },
  { re: /^hallboard\d+$/, why: '大厅六部位框 ×3 · 运行时生成簇，彼此极近（安全 pad 2）' },
  { re: /^hallgear\d+$/, why: '大厅六部位装备框 ×6 · 同族（运行时生成簇）' },
  { re: /^runechip\d+$/, why: '大厅符文槽 ×5 · 同族' },
  { re: /^themechip\d+$/, why: '大厅主题切换芯片 ×4 · 同族' },
  { re: /^codextab\d+$/, why: '图鉴页签 ×4 · 同族（页签条密度决定高度）' },
  { re: /^vaulttab\d+$/, why: '宝库页签 ×2（进度打造／天赋）· 同族' },
  // ── B 类：具名控件，静态判据已算出安全 pad ⇒ **待随下次版本一起零像素补**（本轮不动母版）──
  { re: /^(homedaily|homevault)$/, why: '大厅后置加菜／仓库兑换 · 安全 pad 13 / 11（≤26 / ≤67）⇒ 待零像素补' },
  { re: /^set(theme|bgm|export|import|close)$/, why: '设置页五钮 · 安全 pad 9 ⇒ 待零像素补' },
  { re: /^(beastclose|vaultclose|gearclose|dailycancel)$/, why: '各面板关闭钮（34.7 CSS px 档）· 安全 pad 9 ⇒ 待零像素补' },
  { re: /^(gearmerge|gearforge)$/, why: '装备库合成／锻造 · 安全 pad 9 ⇒ 待零像素补' },
  { re: /^(btnrevive|btngiveup)$/, why: '复活／放弃结算（死亡决策，**误触代价最高**）· 两者相距 20px ⇒ 安全 pad 6 ≤ 10 ⇒ 待零像素补' },
  { re: /^btnreroll$/, why: '升级页「换一批」 · 安全 pad 7 ≤ 14 ⇒ 待零像素补' },
  { re: /^(btndouble|resulthome)$/, why: '结算页两钮 · 尺寸由 resultActionLayout() 局部变量算出（静态盲区）⇒ 用运行时安全 pad 复核后再补' },
  // ── C 类：并排太近，扩命中区会抢邻居 ──
  { re: /^(homeguide|homeabout)$/, why: '大厅右上并排入口（间隔仅 8px）· 安全 pad 只有 4 ⇒ 需重排（PM §18.6 第 2 件）' },
];

const scanExpr = (extra) => `
(function(){
  try{
    ${extra || ''}
    var arr = UIStack.list || [];
    var out = [], modals = 0;
    for (var i = 0; i < arr.length; i++) {
      var n = arr[i];
      if (!n || !n.visible || !n.rect || !n.onTap) continue;
      var kind = n.kind || '';
      if (kind === 'Modal') { modals++; continue; }   // 遮罩=全屏且先注册（按钮永远赢）⇒ 不参与重叠/间距
      var r = n.rect, pad = n.hitPad || 0;
      out.push({ id: String(n.id != null ? n.id : (kind || ('#' + i))), kind: kind, idx: i,
                 x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.w.toFixed(2), h: +r.h.toFixed(2),
                 pad: pad, custom: !!n.hitTest });
    }
    return JSON.stringify({ ok: true, view: [CONFIG.viewW, CONFIG.viewH], nodes: out, modals: modals, total: arr.length });
  }catch(e){ return JSON.stringify({ ok: false, err: String((e && e.message) || e).slice(0, 180) }); }
})()
`;
const stateExpr = `(function(){ try { return JSON.stringify(window.MENGSHOU_DEBUG.state()); } catch(e){ return '{"err":1}'; } })()`;
// 页内"可见可点节点数"：等屏时用（光等 state 不够 —— 首跑复活屏就是 state 到了、节点还没显）
const NODES = "(function(){var a=UIStack.list||[],c=0;for(var i=0;i<a.length;i++){var n=a[i];if(n&&n.visible&&n.rect&&n.onTap&&(n.kind||'')!=='Modal')c++}return c})()";
const readCase = (label, raw) => {
  const o = JSON.parse(raw);
  if (!o.ok) return { label, err: o.err };
  const nodes = o.nodes;
  const overlaps = overlapsOf(nodes).filter((v) => !ALLOW_OVERLAP.includes([v.a, v.b].sort().join('|')));
  return { label, n: nodes.length, modals: o.modals, view: o.view, overlaps, small: smallOnes(nodes) };
};

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));
let report = { cases: [], selftest: [], pageErrors: [] };
const scan = async (label, setup) => {
  let raw;
  try { raw = await page.evaluate(scanExpr(setup)); }
  catch (e) { raw = JSON.stringify({ ok: false, err: String(e.message).slice(0, 180) }); }
  const r = readCase(label, raw);
  if (r.err) { console.log(`ERR  [${label}] ${r.err}`); report.cases.push(r); return r; }
  const need = EXPECT_MIN[label];
  if (need != null && r.n < need) {
    r.underfilled = { got: r.n, need: need };
    console.log(`FAIL [${label}] 只量到 ${r.n} 个可点节点（下限 ${need}）⇒ 探针与屏幕状态不一致`);
  }
  const st = await page.evaluate(stateExpr).catch(() => '{}');
  r.state = (JSON.parse(st) || {}).name || '?';
  report.cases.push(r);
  console.log(`${r.overlaps.length ? 'FAIL' : 'ok  '} [${label}] state=${r.state} 可点=${r.n} 模态=${r.modals} 偏小=${r.small.length} 重叠=${r.overlaps.length}`);
  for (const s of r.small.slice(0, 4)) console.log(`       · ${s.id} ${s.w}×${s.h} 短边 ${s.css} CSS px（需 pad ${s.need} / 本屏安全上限 ${s.safe} ⇒ ${s.verdict}）`);
  for (const v of r.overlaps) console.log(`       ⚠ 重叠 ${v.a} × ${v.b} = ${v.w}×${v.h}px ⇒ 抢点者 ${v.winner}`);
  return r;
};
const pollFor = async (expr, tries, ms) => {
  for (let t = 0; t < tries; t++) {
    const got = await page.evaluate(`(function(){ try { return !!(${expr}); } catch(e){ return false; } })()`).catch(() => false);
    if (got) return true;
    await page.waitForTimeout(ms);
  }
  return false;
};

try {
  await page.goto(base + entryName, { waitUntil: 'load', timeout: 120000 });
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) {
    ready = await page.evaluate(() => (typeof MENGSHOU_DEBUG !== 'undefined' && !!MENGSHOU_DEBUG)).catch(() => false);
    if (!ready) await page.waitForTimeout(500);
  }
  if (!ready) {
    console.log('SKIP 游戏未就绪（MENGSHOU_DEBUG 未出现）');
    report.note = 'not-ready';
  } else {
    if (SELFTEST) {
      report.selftest.push(...logicSelftest());
      await page.evaluate(() => { try { window.MENGSHOU_DEBUG.hall(); } catch (e) { void e; } });
      await page.waitForTimeout(700);
      const b0 = readCase('HOME(基准)', await page.evaluate(scanExpr('')));
      const inj = readCase('HOME(注入)', await page.evaluate(scanExpr('uiHomeGuide.hitPad = 60;')));
      await page.evaluate(() => { try { uiHomeGuide.hitPad = 0; } catch (e) { void e; } });
      report.selftest.push(['基准 HOME 无重叠（探针口径可信）', !!(b0.overlaps && b0.overlaps.length === 0)]);
      report.selftest.push(['人为把 uiHomeGuide.hitPad 设 60 ⇒ 必须检出重叠', !!(inj.overlaps && inj.overlaps.length > 0)]);
      for (const [n, ok] of report.selftest) console.log((ok ? '✅' : '❌') + ' ' + n);
      if (b0.overlaps && b0.overlaps.length) console.log('      · 基准重叠：' + JSON.stringify(b0.overlaps.slice(0, 3)));
      if (inj.overlaps && inj.overlaps.length) console.log('      · 注入后被检出：' + JSON.stringify(inj.overlaps[0]));
    }
    // ── 静态可达的 6 屏 ──
    await scan('HOME(大厅)', 'window.MENGSHOU_DEBUG.hall();');
    await page.waitForTimeout(500);
    await scan('设置', 'MENGSHOU_DEBUG.openSettings();');
    await page.waitForTimeout(400);
    await scan('图鉴', 'MENGSHOU_DEBUG.closeSettings(); MENGSHOU_DEBUG.hall(); MENGSHOU_DEBUG.openBeast();');
    await page.waitForTimeout(400);
    await scan('装备库', 'MENGSHOU_DEBUG.closeBeast(); MENGSHOU_DEBUG.hall(); MENGSHOU_DEBUG.openGear();');
    await page.waitForTimeout(400);
    await scan('宝库', 'MENGSHOU_DEBUG.closeGear(); MENGSHOU_DEBUG.hall(); MENGSHOU_DEBUG.openVault();');
    await page.waitForTimeout(400);
    await scan('每日挑战', 'MENGSHOU_DEBUG.closeVault(); MENGSHOU_DEBUG.hall(); MENGSHOU_DEBUG.dailyPick();');
    await page.waitForTimeout(400);
    // ── 进战斗后才有 4 屏 ──
    // ⚠ 第 70 轮云端首跑实测：点主 CTA 那条路**进不去战斗**（新手引导/首局路由会拦），
    //   结果是这 4 屏被静默跳过、只剩 6 屏 —— 而"复活/升级"恰恰是全游戏误触代价最高的两屏。
    //   ⇒ 主路径改成调试口 `MENGSHOU_DEBUG.start(0)`（= debugPlayClean，直通 PLAYING），
    //     点 CTA 降级为回退；两条都失败才记 SKIP（并把跳过数写进 notice）。
    await page.evaluate(() => { try { const D = window.MENGSHOU_DEBUG; D.closeVault(); if (D.guideSkipAll) D.guideSkipAll(); D.hall(); } catch (e) { void e; } });
    await page.waitForTimeout(700);
    await page.evaluate(() => { try { window.MENGSHOU_DEBUG.start(0); } catch (e) { void e; } });
    await page.waitForTimeout(2500);
    let playing = await pollFor("MENGSHOU_DEBUG.state().playing", 24, 500);
    if (!playing) {
      const geom = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, cw: c.width, ch: c.height }; });
      await page.mouse.click(geom.l + (316 / geom.cw) * geom.w, geom.t + (617 / geom.ch) * geom.h);
      await page.waitForTimeout(2500);
      playing = await pollFor("MENGSHOU_DEBUG.state().playing", 24, 500);
      console.log("（start(0) 未进战斗，已回退点主 CTA ⇒ playing=" + playing + "）");
    }
    if (playing) {
      await page.evaluate(() => { try { window.MENGSHOU_DEBUG.pause(true); } catch (e) { void e; } });
      await page.waitForTimeout(700);
      await scan('暂停', 'MENGSHOU_DEBUG.pause(true);');
      await page.evaluate(() => { try { window.MENGSHOU_DEBUG.pause(false); } catch (e) { void e; } });
      await page.waitForTimeout(500);
      const gotLu = await pollFor('(' + NODES + ') >= 3 && (function(){var s=MENGSHOU_DEBUG.levelup();return s&&s.cards&&s.cards.length>0;})()', 70, 500);
      if (gotLu) await scan('升级三选一', '');
      else { console.log('SKIP [升级三选一] 35s 内没等到升级'); report.cases.push({ label: '升级三选一', skipped: true }); }
      await page.evaluate(() => { const D = window.MENGSHOU_DEBUG || {}; try { D.levelupTap && D.levelupTap(); } catch (e) { void e; } try { D.closeCards && D.closeCards(); } catch (e) { void e; } });
      await page.waitForTimeout(700);
      let reviveUp = false;
      for (let attempt = 0; attempt < 2 && !reviveUp; attempt++) {
        await page.evaluate(() => { try { window.MENGSHOU_DEBUG.die('ui-hit-audit'); } catch (e) { void e; } });
        reviveUp = await pollFor("(" + NODES + ") >= 2 && MENGSHOU_DEBUG.state().name === 'REVIVE_MODAL'", 20, 500);
        if (!reviveUp) { console.log('（第 ' + (attempt + 1) + ' 次 die() 后复活盘未就位，重试）'); await page.waitForTimeout(800); }
      }
      if (reviveUp) await scan('复活/死亡', '');
      else { console.log('SKIP [复活/死亡] 两次 die() 后仍未进入 REVIVE_MODAL（或节点未就位）'); report.cases.push({ label: '复活/死亡', skipped: true }); }
      await page.evaluate(() => { try { window.MENGSHOU_DEBUG.giveUp(); } catch (e) { void e; } });
      if (await pollFor('(' + NODES + ') >= 2 && /RESULT_(WIN|LOSE)/.test(MENGSHOU_DEBUG.state().name)', 24, 500)) await scan('结算', '');
      else { console.log('SKIP [结算] 未进入 RESULT_*'); report.cases.push({ label: '结算', skipped: true }); }
    } else {
      console.log('SKIP [战斗相关四屏] start(0) 与点 CTA 都没进 PLAYING');
      for (const l of ['暂停', '升级三选一', '复活/死亡', '结算']) report.cases.push({ label: l, skipped: true });
    }
  }
} finally {
  await browser.close();
  server.close();
}

const ok = report.cases.filter((c) => !c.err && !c.skipped);
const overlapsGlobal = ok.flatMap((c) => c.overlaps.map((v) => ({ screen: c.label, ...v })));
const smallGlobal = ok.flatMap((c) => c.small.map((s) => ({ screen: c.label, ...s })));
const worst = smallGlobal.slice().sort((a, b) => a.css - b.css).slice(0, 6);
const padable = smallGlobal.filter((s) => s.verdict.startsWith('可补'));
const underfilled = ok.filter((c) => c.underfilled);
const uniqSmall = [...new Set(smallGlobal.map((s) => s.id))];
const unlisted = uniqSmall.filter((id) => !ALLOW_SMALL.some((a) => a.re.test(id)));
const staleSmall = ALLOW_SMALL.filter((a) => !uniqSmall.some((id) => a.re.test(id)));
const digest = (() => {
  const m = new Map();
  for (const id of uniqSmall) { const k = id.replace(/\d+$/, "#"); m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => k + '×' + n).join(' · ');
})();
const md = ['# ⑲ 命中区运行时体检', '',
  `- 屏数 ${ok.length}（跳过 ${report.cases.filter((c) => c.skipped).length}）· 页面错误 ${pageErrors.length}`,
  `- **同屏命中区重叠 ${overlapsGlobal.length} 处**（硬门禁）· 偏小控件 ${smallGlobal.length} 个，其中**可零像素补 pad ${padable.length} 个**`,
  '', '| 屏 | 状态 | 可点 | 偏小 | 重叠 |', '|---|---|---|---|---|',
  ...ok.map((c) => `| ${c.label} | ${c.state} | ${c.n}${c.underfilled ? ' ⚠低于下限' + c.underfilled.need : ''} | ${c.small.length} | ${c.overlaps.length} |`), '',
  '## 逐屏命中区（可点/偏小/重叠）', '', ...ok.map((c) => `- ${c.label} ${c.n}/${c.small.length}/${c.overlaps.length}`), '',
  '## 偏小清单（运行时安全 pad = 本屏内 ½×最近邻居间距，两轴取小）', '',
  '| 屏 | 控件 | 尺寸 | 短边 CSS px | 需 pad | 本屏安全上限 | 结论 |', '|---|---|---|---|---|---|---|',
  ...smallGlobal.map((s) => `| ${s.screen} | ${s.id} | ${s.w}×${s.h} | ${s.css} | ${s.need} | ${s.safe} | ${s.verdict} |`), ''];
fs.writeFileSync(path.join(OUT, 'hit-area-fit.md'), md.join('\n'), 'utf8');

const skipped = report.cases.filter((c) => c.skipped).length;
console.log(`::notice::⑲ 命中区逐屏（可点/偏小/重叠）::` + ok.map((c) => `${c.label} ${c.n}/${c.small.length}/${c.overlaps.length}`).join(' · ')
  + (skipped ? ` · ⚠ 跳过 ${skipped} 屏（未量到）` : ' · 10 屏全覆盖'));
console.log(`::notice::⑲ 偏小 id 摘要（台账用）::` + digest + ` · 未登记 ${unlisted.length} 个`);
console.log(`::notice::⑲ 偏小 ${smallGlobal.length} 个 · 可零像素补 pad ${padable.length} 个 · 最紧::` +
  worst.map((s) => `${s.screen}:${s.id} ${s.css}css pad${s.need}≤${s.safe}`).join(' · '));

let bad = 0;
if (pageErrors.length) console.log(`⚠ 页面错误 ${pageErrors.length} 条：${pageErrors.slice(0, 2).join(' | ')}`);
if (overlapsGlobal.length) {
  bad++;
  console.log(`::error::⑲ 同屏命中区重叠 ${overlapsGlobal.length} 处 ⇒ 点中间那块由注册顺序决定谁赢（手感 bug）::` +
    overlapsGlobal.slice(0, 4).map((v) => `${v.screen}:${v.a}×${v.b}=${v.w}×${v.h}(抢点者${v.winner})`).join(' · '));
}
if (SELFTEST) {
  const failed = report.selftest.filter(([, o]) => !o);
  if (failed.length) { bad++; console.log(`::error::⑲ 自测未通过 ${failed.length}/${report.selftest.length}::` + failed.map(([n]) => n).join(' · ')); }
  else console.log(`✅ 自测 ${report.selftest.length}/${report.selftest.length} 通过（纯逻辑 + 注入重叠）`);
}
if (unlisted.length) {
  bad++;
  console.log('::error::⑲ 有未登记的偏小可点节点（<44 CSS px）⇒ 请补尺寸/改视觉，或登记到 ALLOW_SMALL 并写原因::' +
    unlisted.slice(0, 8).join(' · ') + (unlisted.length > 8 ? ' …共 ' + unlisted.length + ' 个' : ''));
}
if (staleSmall.length) {
  bad++;
  console.log('::error::⑲ ALLOW_SMALL 台账失效（这些条目现在已达标/不存在）⇒ 从台账删除::' +
    staleSmall.map((a) => String(a.re)).join(' · '));
}
if (underfilled.length) {
  bad++;
  console.log('::error::⑲ 有屏只量到不足下限的可点节点 ⇒ 探针与屏幕状态不一致（「没量到」不许长得像「没问题」）::' +
    underfilled.map((c) => `${c.label} 实得${c.underfilled.got}/下限${c.underfilled.need}`).join(' · '));
}
if (!ok.length) { bad++; console.log('::error::⑲ 没有任何一屏量到数据（探针失效）::检查 MENGSHOU_DEBUG / UIStack 是否还在'); }
if (bad) { console.log('\n结论：FAIL'); process.exit(1); }
console.log(`\n结论：PASS —— ${ok.length} 屏同屏命中区无重叠 · 偏小 ${smallGlobal.length} 个（可零像素补 pad ${padable.length} 个）· 每屏可点节点均达下限`);
