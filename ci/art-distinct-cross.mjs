#!/usr/bin/env node
/**
 * art-distinct-cross.mjs —— 美术辨识度审计（**只报不拦**）
 *
 * 为什么需要：
 *   本项目的门禁已经覆盖了"内容在不在"（content-gap-scan）、"看不看得见"（art-audit 的
 *   亮度/饱和度）、"接线有没有"（beast-art-audit），但**"玩家分辨得开吗"从未被量过**。
 *   这一维度恰好是最容易悄悄退化的：新加一只敌人/一颗子弹，只要素材齐、亮度够，所有门禁
 *   全绿，但玩家在第一眼可能分不开它是谁。
 *
 * ⚠⚠⚠ 本脚本**只报不拦**（打印候选，不 exit 1）。原因是实测出来的：
 *   本轮（v1.190）沿"辨识度"量了一整条链路（敌人 21 只 → 每章刷怪池 → 子弹/图标 47 个），
 *   共 3 次接近误报，**全部被"前提验证"拦住**：
 *
 *   ① 剪影 IoU 最高的一对 hedgehog ~ rollshell (0.872，全 210 对最高)
 *      → 看图：棕刺猬 vs 灰绿岩石壳，颜色/纹理/造型全不同 → **假阳性**
 *        根因：萌兽贴图都是"圆身坐姿"，**纯 alpha 掩膜天然趋同**
 *        ⇒ 纯轮廓指标对这类素材**没有分辨力**，不可作判据
 *
 *   ② 颜色最近的一对 bear ~ boar (hue 距 0.011) / orbitcrab ~ boomfruit (rgb 距 0.037)
 *      → 看图：獠牙+鬃毛 vs 圆耳白肚 / 蟹钳六腿 vs 叶顶火焰 → 造型差异明确
 *        ⇒ **颜色趋同是事实，但不构成"看混"**（敌人是要躲的对象，尺寸大、看得久）
 *
 *   ③ 全表非敌人对里颜色最近 maplecross ~ mapledart (rgb 距 0.029，三个枫叶)
 *      → 查 DATA_UPGRADE.branches：**同源二选一，永不同屏**
 *        ⇒ 既不同屏，"分不开"就无从发生 ⇒ **不是缺陷，是设计**
 *
 *   结论：**"像不像"这件事不能靠单一量化指标判缺陷**。本脚本因此降级为"提示"，真正
 *   的判定必须走「量数据 → 读渲染/玩法路径 → 看图」三步，缺一不可。
 *
 * 阴性/阳性对照（--selftest，保证脚本本身不是"永远 PASS 的假门禁"）：
 *   阳性：把某只的色相复制一份 → 必须被列为候选
 *   阴性：把两只明显不同的（bear~raven）→ 必须不被列为候选
 *   同时断言：结构解析退化（解析不到武器表/敌人表）即抛错，不留静默通过路径。
 *
 * 用法: node ci/art-distinct-cross.mjs             # 全量审计（报告模式）
 *       node ci/art-distinct-cross.mjs --selftest  # 对照自检（必须全绿）
 */
import fs from 'fs';
import path from 'path';

const SELFTEST = process.argv.includes('--selftest');

const GAME_DIR = process.env.GAME_DIR || 'game';
const ASSETS = process.env.ASSETS_DIR || path.join('dist', 'assets');
const htmlName = fs.readdirSync(GAME_DIR).filter((f) => f.toLowerCase().endsWith('.html') && !f.startsWith('_')).sort()[0];
const HTML = path.join(GAME_DIR, htmlName);
const h = fs.readFileSync(HTML, 'utf8');

// ────────────────────────────────────────────────────────────
// 0. 依赖声明：① 贴图 → 需要 Playwright 解码 webp 取像素；无则跳过像素级、只做结构级
// ────────────────────────────────────────────────────────────
let chromium = null;
try { ({ chromium } = await import('playwright')); } catch (e) { /* 结构级模式 */ }
const HAVE_ASSETS = fs.existsSync(ASSETS);

// ────────────────────────────────────────────────────────────
// 1. 从活文件抽取「结构关系」—— 这是判"该不该相像"的唯一依据
// ────────────────────────────────────────────────────────────
function cutBody(text, name) {
  const re = new RegExp('(?:const|var|let)\\s+' + name + '\\s*=\\s*');
  const m = re.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  const open = text[start];
  const close = open === '[' ? ']' : open === '{' ? '}' : null;
  if (!close) return null;
  let d = 0, i = start, inS = null, esc = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inS) { if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; } if (c === inS) inS = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === open) d++; else if (c === close) { d--; if (d === 0) { i++; break; } }
  }
  return text.slice(start, i);
}
function splitTop(body, baseline = 1) {
  const out = []; let d = 0, inS = null, esc = false, cur = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inS) { if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; } if (c === inS) inS = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '{' || c === '[') { d++; if (d === baseline + 1 && c === '{' && cur === null) cur = i; }
    else if (c === '}' || c === ']') { if (d === baseline + 1 && c === '}' && cur !== null) { out.push(body.slice(cur, i + 1)); cur = null; } d--; }
  }
  return out;
}
const fieldOf = (b, f) => { const m = new RegExp('\\b' + f + '\\s*:\\s*(\'[^\']*\'|"[^"]*"|[A-Za-z0-9_.\\-]+)').exec(b); return m ? m[1].replace(/^['"]|['"]$/g, '') : null; };

// 1a. 武器家族：base → [upgrades]（同源分支**永不同屏**，也不算"该相像"，而是"允许相像"）
const WPN_RE = /^\s*([a-z][a-z0-9_]*):\s*\{\s*id:\s*"[a-z0-9_]+",\s*name:\s*"[^"]*",[^}]*?from:\s*"([a-z0-9_]+)"/gm;
const upgradeOf = {};   // upgrade id -> base id
let wm;
while ((wm = WPN_RE.exec(h))) upgradeOf[wm[1]] = wm[2];
// 同级分支：同一个 from 的多个升级 = 互斥（二选一）
const branchesOf = {};
Object.entries(upgradeOf).forEach(([u, base]) => { (branchesOf[base] = branchesOf[base] || []).push(u); });
const SAME_TREE = (a, b) => a === b || upgradeOf[a] === upgradeOf[b] && upgradeOf[a] !== undefined;

// 1b. 每章敌人池（同屏共存关系）
const chBody = cutBody(h, 'DATA_CHAPTER');
const chapters = chBody ? splitTop(chBody).map((b) => {
  const id = fieldOf(b, 'id');
  const main = (/enemyIds\s*:\s*(\[[^\]]*\])/.exec(b) || [, '[]'])[1];
  const horde = (/horde\s*:\s*\{[^}]*enemyIds\s*:\s*(\[[^\]]*\])/.exec(b) || [, '[]'])[1];
  const parse = (s) => { try { return JSON.parse(s); } catch (e) { return [...s.matchAll(/["']([a-z0-9_]+)["']/g)].map((m) => m[1]); } };
  return { id, pool: [...new Set(parse(main).concat(parse(horde)))] };
}) : [];

// 1c. 敌人家族：从 DATA_ENEMY 取 id 列表
const eBody = cutBody(h, 'DATA_ENEMY');
const enemyIds = eBody ? splitTop(eBody).map((b) => fieldOf(b, 'id')).filter(Boolean) : [];

// ── 解析器自检：结构退化即抛错（不留静默通过路径）──────────────
// ⚠ 期望值是**实测**的（v1.190：10 件基础武器 → 20 条升级关系）。
//   写错期望值会让 selftest 直接失败 —— 这是设计意图（强迫期望值与现实对齐）。
const TABLE_EXPECT = { chapters: 6, upgrades: 20, enemies: 21 };
function assertParsers() {
  const problems = [];
  if (chapters.length !== TABLE_EXPECT.chapters) problems.push(`DATA_CHAPTER 解析到 ${chapters.length} 条，期望 ${TABLE_EXPECT.chapters}`);
  if (Object.keys(upgradeOf).length !== TABLE_EXPECT.upgrades)
    problems.push(`武器升级关系解析到 ${Object.keys(upgradeOf).length} 条，期望 ${TABLE_EXPECT.upgrades}`);
  if (enemyIds.length !== TABLE_EXPECT.enemies)
    problems.push(`DATA_ENEMY 解析到 ${enemyIds.length} 条，期望 ${TABLE_EXPECT.enemies}`);
  if (chapters.some((c) => !c.pool.length)) problems.push(`章节敌人池解析为空: ${chapters.map((c) => c.id + ':' + c.pool.length).join(' ')}`);
  if (problems.length) throw new Error('结构解析器退化 —— 门禁已失效，必须先修解析：\n  - ' + problems.join('\n  - '));
}

// ────────────────────────────────────────────────────────────
// 2. 像素级：贴图 → 归一化掩膜 + 12 桶色相直方图
// ────────────────────────────────────────────────────────────
async function measure(ids) {
  const list = ids
    .map((id) => ({ id, p: path.join(ASSETS, id + '.webp') }))
    .filter((f) => fs.existsSync(f.p));
  if (!list.length) throw new Error(`assets 里找不到任何贴图（ASSETS=${ASSETS}，试了 ${ids.length} 个 id）`);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const out = await page.evaluate(async (items) => {
    const res = []; const N = 64;
    for (const it of items) {
      const img = new Image();
      await new Promise((r, j) => { img.onload = r; img.onerror = () => j(new Error('load fail ' + it.id)); img.src = it.dataUrl; });
      const W = img.naturalWidth, H = img.naturalHeight;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, W, H).data;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (d[(y * W + x) * 4 + 3] > 96) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      // 归一化裁剪 64×64 → 掩膜
      const cc = document.createElement('canvas'); cc.width = N; cc.height = N;
      const gg = cc.getContext('2d');
      const s = Math.min(N / bw, N / bh), dw = bw * s, dh = bh * s;
      gg.drawImage(c, x0, y0, bw, bh, (N - dw) / 2, (N - dh) / 2, dw, dh);
      const md = gg.getImageData(0, 0, N, N).data;
      const mask = new Uint8Array(N * N); let filled = 0;
      const hue = new Array(12).fill(0);
      let rS = 0, gS = 0, bS = 0;
      for (let i = 0; i < N * N; i++) {
        if (md[i * 4 + 3] <= 96) continue;
        mask[i] = 1; filled++;
        rS += md[i * 4]; gS += md[i * 4 + 1]; bS += md[i * 4 + 2];
        const R = md[i * 4] / 255, G = md[i * 4 + 1] / 255, B = md[i * 4 + 2] / 255;
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B), df = mx - mn;
        let Hh = 0;
        if (df > 0) { if (mx === R) Hh = ((G - B) / df + 6) % 6; else if (mx === G) Hh = (B - R) / df + 2; else Hh = (R - G) / df + 4; }
        Hh *= 60;
        let bin = Math.floor(Hh / 30); if (bin < 0) bin = 0; if (bin > 11) bin = 11;
        hue[bin] += (mx > 0 ? df / mx : 0) > 0.18 && mx > 0.15 ? 1 : 0.12;
      }
      const hs = hue.reduce((a, b) => a + b, 0) || 1;
      res.push({ id: it.id, mask: Array.from(mask).join(''), hue: hue.map((x) => +(x / hs).toFixed(4)),
                 rgb: [+(rS / filled).toFixed(1), +(gS / filled).toFixed(1), +(bS / filled).toFixed(1)], fill: filled });
    }
    return res;
  }, list.map((f) => ({ id: f.id, dataUrl: 'data:image/webp;base64,' + fs.readFileSync(f.p).toString('base64') })));
  await browser.close();
  return out;
}

const N = 64;
const iou = (a, b) => { let i = 0, u = 0; for (let k = 0; k < N * N; k++) { const A = a[k] === '1', B = b[k] === '1'; if (A && B) i++; if (A || B) u++; } return u ? i / u : 0; };
const hueDist = (p, q) => { let it = 0; for (let i = 0; i < p.length; i++) it += Math.min(p[i], q[i]); return 1 - it; };
const rgbDist = (p, q) => Math.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2) / 441.66;

// 候选阈值（**校准自实测**：见文件头注释，误报率 100% → 仅提示）
const TH = { hue: 0.20, rgb: 0.10, iou: 0.78 };

function judgePairs(rows, opts = {}) {
  const out = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const A = rows[i], B = rows[j];
    const H = hueDist(A.hue, B.hue), R = rgbDist(A.rgb || [0, 0, 0], B.rgb || [0, 0, 0]), I = iou(A.mask, B.mask);
    if (H < TH.hue && R < TH.rgb && I > TH.iou) out.push({ a: A.id, b: B.id, hue: +H.toFixed(3), rgb: +R.toFixed(3), iou: +I.toFixed(3), sameTree: SAME_TREE(A.id, B.id) });
  }
  return out.sort((x, y) => x.hue - y.hue);
}

// ────────────────────────────────────────────────────────────
// 3. 对照自检
// ────────────────────────────────────────────────────────────
if (SELFTEST) {
  const fails = [];
  const ck = (name, cond, extra = '') => { console.log(`  ${cond ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) fails.push(name); };

  // 解析器对照（结构退化必须抛错）
  try { assertParsers(); ck('解析器：正常输入不抛错', true, `chapters=${chapters.length} upgrades=${Object.keys(upgradeOf).length} enemies=${enemyIds.length}`); }
  catch (e) { ck('解析器：正常输入不抛错', false, e.message.split('\n')[0]); }

  // 阳性对照：完全同色同形 → 必须被列为候选
  const mk = (id, mask, hue) => ({ id, mask, hue, rgb: [150, 90, 60] });
  const m1 = '1'.repeat(N * N / 2) + '0'.repeat(N * N / 2);
  const hueA = new Array(12).fill(0); hueA[0] = 1;
  const posHits = judgePairs([mk('pos_a', m1, hueA), mk('pos_b', m1, hueA)]);
  ck('阳性对照：同色同形必被列为候选', posHits.length === 1 && posHits[0].a === 'pos_a', JSON.stringify(posHits));

  // 阴性对照：色相差异极大 → 必须不被列为候选
  const hueB = new Array(12).fill(0); hueB[8] = 1;
  const negHits = judgePairs([mk('neg_a', m1, hueA), mk('neg_b', m1, hueB)]);
  ck('阴性对照：色相完全不同必不列为候选', negHits.length === 0, JSON.stringify(negHits));

  // 阴性对照2：色相同但形状差异极大 → 必须不被列为候选（掩膜不同）
  const m2 = '1'.repeat(200) + '0'.repeat(N * N - 400) + '1'.repeat(200);
  const negHits2 = judgePairs([mk('n2_a', m1, hueA), mk('n2_b', m2, hueA)]);
  ck('阴性对照：同色但形状差异大必不列为候选', negHits2.length === 0, JSON.stringify(negHits2));

  // 同源判定对照
  ck('同源判定：mapletornado/maplecross 认作同源', SAME_TREE('mapletornado', 'maplecross') === true);
  ck('同源判定：bear/boar 不认作同源', SAME_TREE('bear', 'boar') === false);

  console.log(`\n对照 ${fails.length ? '❌ ' + fails.length + ' 项失败' : '✅ 全绿'}`);
  if (fails.length) process.exit(1);
  process.exit(0);
}

// ────────────────────────────────────────────────────────────
// 4. 全量审计
// ────────────────────────────────────────────────────────────
assertParsers();

console.log('# 美术辨识度审计（**只报不拦**）\n');
console.log(`- HTML: ${HTML}`);
console.log(`- assets: ${ASSETS}${HAVE_ASSETS ? '' : ' ⚠ 不存在'}`);
console.log(`- 结构: 章节 ${chapters.length} · 武器升级关系 ${Object.keys(upgradeOf).length} · 敌人 ${enemyIds.length}\n`);

if (!chromium || !HAVE_ASSETS) {
  console.log('⚠ 缺 playwright 或 dist/assets → **跳过像素级**，只报结构关系（接线级）。');
  console.log('  结构关系（同源分支 = 永不同屏，允许相像）：');
  Object.entries(branchesOf).forEach(([base, ups]) => console.log(`    ${base} → ${ups.join(' / ')}`));
  process.exit(0);
}

const enemyRows = await measure(enemyIds);
const props = [];
for (const pre of ['blt_', 'wpn_', 'pas_', 'tal_', 'bs_', 'evo_', 'gem', 'field_', 'item_']) {
  for (const f of fs.readdirSync(ASSETS)) {
    if (f.startsWith(pre) && f.endsWith('.webp')) props.push(f.replace('.webp', ''));
  }
}
const propRows = await measure([...new Set(props)]);

const eHits = judgePairs(enemyRows);
const pHits = judgePairs(propRows);

console.log('## A. 敌人之间（同屏共存，靠造型区分）\n');
if (!eHits.length) console.log('  ✅ 无候选');
eHits.forEach((x) => console.log(`  - ${x.a} ~ ${x.b}  hue ${x.hue} rgb ${x.rgb} IoU ${x.iou}${x.sameTree ? '  [同源]' : ''}`));

console.log('\n## B. 道具/子弹/图标之间（小尺寸或网格并排，颜色是主要通道）\n');
if (!pHits.length) console.log('  ✅ 无候选');
pHits.forEach((x) => console.log(`  - ${x.a} ~ ${x.b}  hue ${x.hue} rgb ${x.rgb} IoU ${x.iou}${x.sameTree ? '  [同源: 永不同屏 ⇒ 可忽略]' : ''}`));

// 同屏共存 × 彼此相像：这才是真正值得看的方向
console.log('\n## C. 同屏共存且相像（**最值得人看**的组合）\n');
const eById = {}; enemyRows.forEach((r) => eById[r.id] = r);
let cHits = 0;
chapters.forEach((c) => {
  for (let i = 0; i < c.pool.length; i++) for (let j = i + 1; j < c.pool.length; j++) {
    const A = eById[c.pool[i]], B = eById[c.pool[j]];
    if (!A || !B) continue;
    const H = hueDist(A.hue, B.hue), I = iou(A.mask, B.mask);
    if (H < TH.hue && I > TH.iou) { cHits++; console.log(`  - [${c.id}] ${A.id} ~ ${B.id}  hue ${H.toFixed(3)} IoU ${I.toFixed(3)}`); }
  }
});
if (!cHits) console.log('  ✅ 无候选');

console.log('\n---');
console.log('**本项只报不拦。** 判定"是不是缺陷"必须走三步（缺一不可）：');
console.log('  ① 量数据（本脚本）→ ② 读玩法路径（是否同屏/同源分支/谁能同时拥有）→ ③ 看图（实际观感）');
console.log('  v1.190 实测：本脚本报出的全部候选，经 ②③ 验证后**均为假阳性**（见文件头注释）。');
console.log('  阈值（hue<0.20 且 rgb<0.10 且 IoU>0.78）是"先看再说"的筛子，不是判据。');
process.exit(0);
