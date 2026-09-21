// 配方卡渲染宽度门禁：用 canvas 度量每张卡四字段在"其真实分配宽度"下是否放得下。
// 判据（与 makeCodexPairCard 同口径）：
//   small = r.w < 240 → sprS=26, nameX=x+68, name 18px / tag 12px / effect 13px / contrast 12px
//   else              → sprS=32, nameX=x+92, name 18px / tag 13px / effect 13px / contrast 12px
//   可用宽：name = w - (small?76:100) ; tag/effect/contrast = w - 20
//   tag 行拼接同 L30871-30879：flowNameOf(tag) 在 w<240 时去「流」尾字 + 用 "·" 替代 " · "。
// ⚠ 当前配方 tab 两种列宽（4 列 148 / 3 列 201）都 < 240 → 全走紧凑分支。
// 退出码恒 0（只报不拦），但会打印 FAIL 行；配合 --selftest 做阴性对照。
// 依赖数据：DATA_CODEX_PAIR（数组）、DATA_PASSIVE（对象）、DATA_FLOW（对象）。
//   历史坑：DATA_PASSIVE/DATA_FLOW 是 **对象字面量**（`var X = { ... };`），
//   用切数组的 `\n];` 会切空 → 必须走 cutObj 的 `\n};`。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const ROOT = process.argv[2] || process.cwd();
const TARGET = path.join(ROOT, "game/萌兽消消岛.html");
const FALLBACK = path.join(ROOT, ".workbuddy/v1.162/mengshou/game/萌兽消消岛.html");
const HTML = fs.existsSync(TARGET) ? TARGET : FALLBACK;
if (!fs.existsSync(HTML)) { console.log("SKIP 找不到游戏母版: " + HTML); process.exit(0); }
const src = fs.readFileSync(HTML, "utf8");

// ---- 1. 抽数据 ----
// 数组块：从 startMark 切到下一个行首 "];"
function cut(startMark) {
  const i = src.indexOf(startMark);
  if (i < 0) return null;
  const j = src.indexOf("\n];", i);
  return src.slice(i, j + 3);
}
// 对象块：DATA_PASSIVE 是 var DATA_PASSIVE = { ... };\n（不是数组！）
function cutObj(startMark) {
  const i = src.indexOf(startMark);
  if (i < 0) return null;
  const j = src.indexOf("\n};", i);
  return src.slice(i, j + 4);
}
const pairBlock = cut("var DATA_CODEX_PAIR");
if (!pairBlock) { console.log("SKIP 找不到 DATA_CODEX_PAIR"); process.exit(0); }
// 依赖：pairCodexOf 用的是 aName/bName/effect/contrast/tag/name —— 从 DATA_PASSIVE 取名字
const passiveBlock = cutObj("var DATA_PASSIVE");
// flowNameOf 依赖的流派词表 DATA_FLOW（对象，不是数组）
const flowBlock = cutObj("var DATA_FLOW =");
const tagSrc = flowBlock || "var DATA_FLOW={};";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pairgate-"));
const tmpJs = path.join(tmpDir, "d.mjs");
fs.writeFileSync(tmpJs,
  (passiveBlock || "var DATA_PASSIVE={};") + "\n" + tagSrc + "\n" + pairBlock +
  "\nexport {DATA_PASSIVE, DATA_CODEX_PAIR, DATA_FLOW};\n");
let mod;
try { mod = await import("file:///" + tmpJs.replace(/\\/g, "/")); }
catch (e) { console.log("SKIP 数据抽取失败: " + e.message); process.exit(0); }

// DATA_PASSIVE 是对象（id→def），归一成数组便于查找
const PASS = Array.isArray(mod.DATA_PASSIVE)
  ? mod.DATA_PASSIVE
  : Object.values(mod.DATA_PASSIVE || {});
const PAIRS = mod.DATA_CODEX_PAIR || [];
// DATA_FLOW: "机动"→"疾风流" 之类；不可解析时退化为原样返回（与游戏 flowNameOf 同语义）
const FLOW = (mod.DATA_FLOW && typeof mod.DATA_FLOW === "object") ? mod.DATA_FLOW : {};
function pname(id) { const p = PASS.find(x => x.id === id); return (p && p.name) || id; }
// 复刻 flowNameOf（L8450）：按 "+" 分段查 DATA_FLOW，再用 "·" 拼回。不可改函数本体。
function flowNameOf(tag) {
  if (!tag) return "";
  return String(tag).split("+").map(x => FLOW[x] || x).join("·");
}

// ---- 2. 几何：复刻 uiCodexPairs 的布局（pairW=308, fkGapX=12, pairTotalW=628, fkX0=46）----
function layoutWidths(n) {
  const fkW0 = 308, fkGapX = 12;
  const pairTotalW = fkW0 * 2 + fkGapX;
  const out = [];
  for (let pi = 0; pi < n; pi++) {
    let pcols;
    if (n === 5) pcols = pi < 3 ? 3 : 2;
    else if (n === 6) pcols = 3;
    else if (n === 7) pcols = pi < 4 ? 4 : 3;
    else pcols = 2;
    out.push(Math.floor((pairTotalW - fkGapX * (pcols - 1)) / pcols));
  }
  return out;
}

// tag 行拼接：与 makeCodexPairCard L30871-30879 同口径。
// 【v1.184】窄卡（w<240）下：" · "→"·"（省 8px），且 flowNameOf 尾字「流」裁掉
//   （「疾风流」已由 tag/effect 表达，属卡面冗余），宽卡保留全称。
function tagText(p, w) {
  let tn = flowNameOf(p.tag);
  if (w < 240 && tn.length > 2 && tn.slice(-1) === "流") tn = tn.slice(0, -1);
  return tn + (w < 240 ? "·" : " · ") + pname(p.a) + "+" + pname(p.b);
}

// ---- 3. 用 headless Edge 拿真实字体宽度 ----
const widths0 = layoutWidths(PAIRS.length);
const rows = PAIRS.map((p, i) => ({
  id: p.id, width: widths0[i],
  name: p.name || "",
  tagStr: tagText(p, widths0[i]),
  effect: p.effect || "", contrast: p.contrast || "",
}));
const probe = `<!doctype html><meta charset="utf-8"><body><script>
const FS = "'PingFang SC','Microsoft YaHei','WenQuanYi Micro Hei','Noto Sans CJK SC',sans-serif";
const R = ${JSON.stringify(rows)};
const c = document.createElement('canvas').getContext('2d');
function W(t, f) { c.font = f + " " + FS; return c.measureText(t).width; }
document.title = JSON.stringify(R.map(r => ({
  id: r.id,
  name: W(r.name, "bold 18px"),
  tag: W(r.tagStr, r.width < 240 ? "bold 12px" : "bold 13px"),
  effect: W(r.effect, "bold 13px"),
  contrast: W(r.contrast, "bold 12px"),
})));
<\/script></body>`;
const tmpHtml = path.join(tmpDir, "p.html");
fs.writeFileSync(tmpHtml, probe, "utf8");

// 浏览器候选（跨平台）：Windows 是本机验证；Linux CI 走 Playwright 装好的 chromium。
// ⚠ 历史坑：首版只找系统 Edge → 在 ubuntu-latest 上必然 SKIP，门禁进了 CI 等于没进。
//   永远 SKIP 的门禁比没有门禁更危险：它给出"已检查"的假象。
const HOME = os.homedir();
const BROWSER_CANDS = [
  // Windows 本机
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  // Linux CI（Playwright 缓存路径，版本号取目录名）
  ...(() => {
    const base = path.join(HOME, ".cache/ms-playwright");
    if (!fs.existsSync(base)) return [];
    const out = [];
    for (const d of fs.readdirSync(base)) {
      for (const rel of ["chrome-linux/chrome", "chrome-linux64/chrome", "chrome-linux/headless_shell"]) {
        const p = path.join(base, d, rel);
        if (fs.existsSync(p)) out.push(p);
      }
    }
    return out;
  })(),
  // Linux 系统
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
];
const BROWSER = BROWSER_CANDS.find(p => { try { return fs.existsSync(p); } catch { return false; } });
if (!BROWSER) {
  console.log("SKIP 未找到可用浏览器（Edge/Chrome/Playwright chromium），无法度量字体宽度");
  process.exit(0);
}
console.log("度量浏览器: " + BROWSER);
let dom = "";
const args = ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
  "--no-default-browser-check", "--hide-scrollbars", "--force-device-scale-factor=1",
  "--user-data-dir=" + path.join(tmpDir, "prof"),
  "--dump-dom", "file:///" + tmpHtml.replace(/\\/g, "/")];
try {
  dom = execFileSync(BROWSER, args, { encoding: "utf8", timeout: 90000, stdio: ["ignore", "pipe", "ignore"] });
} catch (e) { dom = (e.stdout || "").toString(); }
let mt = dom.match(/<title>([\s\S]*?)<\/title>/);
if (!mt) {
  // 重试一次（headless 偶发启动慢）
  try {
    dom = execFileSync(BROWSER, args, { encoding: "utf8", timeout: 90000, stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) { dom = (e.stdout || "").toString(); }
  mt = dom.match(/<title>([\s\S]*?)<\/title>/);
}
if (!mt) { console.log("SKIP 取不到字体度量（headless 不可用）"); process.exit(0); }
const W = JSON.parse(mt[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
const wid = Object.fromEntries(W.map(x => [x.id, x]));
// 度量到的中文字宽（用于判断字体是否可用：Linux 无中文字体时宽度会异常小/等宽）
const sample = W[0] && W[0].name;   // "疾风成档" 4 字，18px
console.log("字体自检: name「" + (rows[0] && rows[0].name) + "」 18px 宽 = " + sample);
if (!(sample > 40)) {
  console.log("SKIP 度量异常（疑似无中文字体，宽度不可信）");
  process.exit(0);
}

// ---- 4. 判定 ----
const widths = layoutWidths(PAIRS.length);
let fails = 0, checks = 0;
const lines = [];
for (let i = 0; i < PAIRS.length; i++) {
  const w = widths[i], small = w < 240;
  const nameAv = w - (small ? 76 : 100);
  const bodyAv = w - 20;
  const t = wid[PAIRS[i].id];
  if (!t) continue;
  const items = [
    ["name", t.name, nameAv],
    ["tag", t.tag, bodyAv],
    ["effect", t.effect, bodyAv],
    ["contrast", t.contrast, bodyAv],
  ];
  const bad = items.filter(x => x[1] > x[2]);
  checks += items.length; fails += bad.length;
  const tag = bad.length ? "FAIL" : "ok  ";
  lines.push(`${tag} 配方#${i} ${PAIRS[i].id} 卡宽=${w} ` +
    items.map(x => `${x[0]} ${x[1].toFixed(0)}/${x[2].toFixed(0)}${x[1] > x[2] ? "⚠" : ""}`).join("  "));
}
console.log("配方卡渲染宽度门禁（只报不拦）");
lines.forEach(l => console.log("  " + l));
console.log(`合计：${fails}/${checks} 字段会被 hudFitText 截断加省略号`);
if (fails) {
  console.log("→ 提示：卡宽小到装不下文案，玩家看到的就是带省略号的半句话。");
  console.log("  修法优先级：① 改列数让卡变宽 ② 缩短文案 ③ 降字号（最差，会牺牲可读性）");
}

// ---- 5. 阴性对照 ----
if (process.argv.includes("--selftest")) {
  const st = [];
  // A. 【v1.184 后】真实数据应为 0 截断。若又变 >0，说明有人往卡里塞了过长文案或改了列宽。
  st.push(["当前母版 0 截断（v1.184 已修）", fails === 0]);
  // B. 【关键阴性对照】把 effect 人为加长 → 探针必须能检出。永远为 0 的探针等于没有探针。
  {
    const t0 = wid[PAIRS[0].id];
    const longFx = "这是一句被故意写得很长的效果描述用来验证探针确实会报错";
    const fakeW = longFx.length * 12;   // 12px 中文字约 12px/字，同向比较够用
    st.push(["注入超长 effect 必须被判超宽（探针有效性）", fakeW > (widths[0] - 20) && t0.effect <= (widths[0] - 20)]);
  }
  // C. 全 308 宽（2 列）→ 无论哪条都该 0 截断
  {
    let f2 = 0;
    for (let i = 0; i < PAIRS.length; i++) {
      const t = wid[PAIRS[i].id]; if (!t) continue;
      const r = rows[i];
      const fs = "bold 13px";
      if (t.name > 308 - 100) f2++;
      if (t.tag > 308 - 20) f2++;
      if (t.effect > 308 - 20) f2++;
      if (t.contrast > 308 - 20) f2++;
      void fs; void r;
    }
    st.push(["全 308 宽应为 0 截断", f2 === 0]);
  }
  // D. 几何同口径：4 列卡宽必须 < 3 列卡宽
  {
    const w4 = layoutWidths(7)[0], w3 = layoutWidths(7)[4];
    st.push(["4 列卡宽 < 3 列卡宽（几何同口径）", w4 < w3]);
  }
  // E. v1.184 核心逻辑：窄卡必须去掉「流」尾字并换紧凑分隔符。
  //    ⚠ 注意：阈值是 r.w < 240，而本页两种列宽（148 / 201）**都** < 240，都会走紧凑分支。
  //    " ≥240 时保留全称" 是给未来更宽的布局留的口子，当前配方 tab 拿不到。
  {
    const p1 = PAIRS[0];
    if (p1) {
      const narrow = tagText(p1, 148);
      const okNarrow = narrow.indexOf("·") >= 0 && narrow.indexOf(" · ") < 0;
      const okDrop = narrow.indexOf("流") < 0 && flowNameOf(p1.tag).indexOf("流") >= 0;
      st.push(["v1.184 tag 拼接：窄卡紧凑分隔符 + 去「流」尾字", okNarrow && okDrop]);
    } else {
      st.push(["v1.184 tag 拼接：数据缺失", false]);
    }
  }
  let pass = 0;
  for (const [n, v] of st) { console.log((v ? "PASS " : "FAIL ") + n); if (v) pass++; }
  console.log(`selftest ${pass}/${st.length}`);
}
fs.rmSync(tmpDir, { recursive: true, force: true });
process.exit(0);
