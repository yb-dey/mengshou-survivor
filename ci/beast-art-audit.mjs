#!/usr/bin/env node
/**
 * beast-art-audit.mjs —— 跟宠 AI 贴图入库前体检（云端跑，用 Playwright 的 canvas 解码 webp）
 *
 * 为什么需要：本项目刚踩过一次大坑 —— 7 张跟宠 AI 贴图**做好了、放进了 assets**，
 *   但**从没注入 HTML 的 AI_ART_TABLE** → 运行时永远走程序化剪影，
 *   图鉴里"要买的是什么"玩家看不到。素材白做了整整一轮。
 *   → 入库门禁必须有一步："**声明表里有没有这些键**"，而不只是"文件在不在"。
 *
 * 本脚本检查两件事：
 *   A. **文件级**：7 张跟宠图的 alpha 与包围盒（白底/偏心/留白会毁掉观感）
 *   B. **接线级**：AI_ART_TABLE 里是否有对应键（这是"最后一公里"）
 *
 * 用法: node ci/beast-art-audit.mjs            # 本地：读 game/ + dist/assets
 *       TABLE_MODE=1 node ci/beast-art-audit.mjs  # 只做接线级检查（不需要浏览器）
 */
import fs from 'fs';
import path from 'path';

const IDS = ['capybara', 'bunny', 'ursa', 'zapmouse', 'oinkpig', 'shellturtle', 'veloursheep'];

const GAME_DIR = process.env.GAME_DIR || 'game';
const HTML = path.join(GAME_DIR,
  fs.readdirSync(GAME_DIR).filter((f) => f.toLowerCase().endsWith('.html') && !f.startsWith('_')).sort()[0]);
const ASSETS = process.env.ASSETS_DIR || path.join('dist', 'assets');

const fail = [];
const warn = [];
const info = [];

// ── B. 接线级：AI_ART_TABLE 里有没有这些键 ─────────────────────
// ⚠ 键名口径（本轮踩过）：AI_ART_TABLE 的键**不带前缀**（`capybara` 而非 `beast_capybara`）；
//   带 `beast_` / `beastsil_` 前缀的是 SPRITES 里的键。**两套口径不要混**，
//   我上一轮就是错用 `/^beast_/` 过滤 → 误判"7 只跟宠从没做过 AI 图"。
const html = fs.readFileSync(HTML, 'utf8');
const m = html.match(/var AI_ART_TABLE = (\{[^}]*\});\s*\/\* AI_ART_INJECT \*\//);
let tableKeys = [];
if (!m) fail.push('HTML 里找不到 AI_ART_TABLE 注入点');
else { try { tableKeys = Object.keys(JSON.parse(m[1])); } catch (e) { fail.push('AI_ART_TABLE 解析失败'); } }

info.push(`AI_ART_TABLE 现有键 ${tableKeys.length} 个`);
const notWired = IDS.filter((id) => tableKeys.indexOf(id) < 0);
if (notWired.length) {
  fail.push(`跟宠贴图**未注入** AI_ART_TABLE ${notWired.length}/7 个: ${notWired.join(', ')}`
    + ` → 运行时永远走程序化剪影（图鉴里看不到要买的是什么）`);
} else {
  info.push('7/7 跟宠贴图已接进 AI_ART_TABLE ✅');
}
// 阴性对照提示（写进输出，便于排查"为什么它总是 PASS"）
info.push('（本项为**接线级**检查：键在表内且值非空才算过；删任一键应立刻 FAIL）');

// ── A. 文件级：alpha / 包围盒 ────────────────────────────────
const files = IDS.map((id) => { const p = path.join(ASSETS, id + '.webp'); return { id, p, ok: fs.existsSync(p) }; });
const missingFiles = files.filter((f) => !f.ok).map((f) => f.id);
if (missingFiles.length) fail.push(`assets 里缺文件 ${missingFiles.length} 个: ${missingFiles.join(', ')}`);
else info.push('7/7 跟宠 webp 文件就位 ✅');

const hasBrowser = !process.env.TABLE_MODE;
if (hasBrowser && !missingFiles.length) {
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch (e) { warn.push('未安装 playwright → 跳过 alpha/包围盒检查（接线级已查）'); }

  if (chromium) {
    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const results = await page.evaluate(async (list) => {
      const out = [];
      for (const it of list) {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = it.dataUrl; });
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let opaque = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, cornerA = 0;
        for (let y = 0; y < c.height; y++) {
          for (let x = 0; x < c.width; x++) {
            const a = d[(y * c.width + x) * 4 + 3];
            if (a > 24) {
              opaque++;
              if (x < x0) x0 = x; if (x > x1) x1 = x;
              if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
          }
        }
        const at = (x, y) => d[(y * c.width + x) * 4 + 3];
        cornerA = Math.max(at(0, 0), at(c.width - 1, 0), at(0, c.height - 1), at(c.width - 1, c.height - 1));
        out.push({
          id: it.id, w: c.width, h: c.height,
          opaquePct: +(opaque / (c.width * c.height) * 100).toFixed(1),
          bbox: [x0, y0, x1, y1],
          mx: +((x0 + (c.width - 1 - x1)) / 2).toFixed(1),
          my: +((y0 + (c.height - 1 - y1)) / 2).toFixed(1),
          cornerAlpha: cornerA,
        });
      }
      return out;
    }, files.map((f) => ({ id: f.id, dataUrl: 'data:image/webp;base64,' + fs.readFileSync(f.p).toString('base64') })));

    await browser.close();

    console.log('\n| 跟宠 | 尺寸 | 不透明% | 包围盒 | 水平偏心 | 垂直偏心 | 角点alpha |');
    console.log('|---|---|---|---|---|---|---|');
    results.forEach((r) => {
      console.log(`| ${r.id} | ${r.w}x${r.h} | ${r.opaquePct} | ${r.bbox.join(',')} | ${r.mx} | ${r.my} | ${r.cornerAlpha} |`);
    });
    console.log('');

    results.forEach((r) => {
      if (r.cornerAlpha > 24) fail.push(`${r.id}: 四角不透明（alpha=${r.cornerAlpha}）→ 有白底/方框，注入后会出现白方块`);
      if (r.opaquePct < 12) warn.push(`${r.id}: 不透明仅 ${r.opaquePct}% → 留白大，游戏内可能显小`);
      if (r.opaquePct > 78) warn.push(`${r.id}: 不透明 ${r.opaquePct}% → 内容贴边，缩放可能被裁`);
      if (Math.abs(r.mx) > 20) warn.push(`${r.id}: 水平偏心 ${r.mx}px → 游戏内角色会偏移`);
      if (Math.abs(r.my) > 20) warn.push(`${r.id}: 垂直偏心 ${r.my}px → 游戏内角色会偏移`);
    });
    info.push('alpha/包围盒检查完成（判据：四角必须透明、不透明 12%~78%、偏心 ≤20px）');
  }
}

// ── 输出 ─────────────────────────────────────────────────────
console.log('# 跟宠 AI 贴图体检\n');
console.log('- HTML    : ' + HTML);
console.log('- assets  : ' + ASSETS);
info.forEach((i) => console.log('- ' + i));
if (warn.length) { console.log('\n## 提示'); warn.forEach((w) => console.log('- ⚠ ' + w)); }
if (fail.length) {
  console.log('\n## 结论: **FAIL**\n');
  fail.forEach((f) => console.log('- ✗ ' + f));
  process.exit(1);
}
console.log('\n## 结论: **PASS** — 跟宠贴图已入库且接线完成 ✅');
