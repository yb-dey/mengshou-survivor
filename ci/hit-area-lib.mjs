// hit-area-lib.mjs —— ⑲ 命中区的**纯函数**部分（不依赖 playwright / 浏览器）
//
// 为什么单独抽出来：ci/hit-area-fit.mjs 要 import playwright（本机没装 ⇒ 只能云端跑），
//   但"命中区重叠/安全 pad"的算法本身是纯数学，必须能在**本机**先验证 —— 否则每次算错
//   都要花一轮云端（约 6 分钟）才发现。本文件因此不 import 任何浏览器相关依赖。
//
// ⚠ 第 70 轮的一处自我纠错（也是抽这个库的直接原因）：
//   `hitPad` 是**四面对称**扩张的（母版 L27238：x/y 四个边界各减/加同一个 pad）。
//   第 69 轮的静态判据只按"短边所在轴"找邻居 ⇒ 认为 `homeguide`（100×44，右侧 8px 就是
//   `homeabout`）可以 pad 19 —— **错**：对称 pad 同时把宽度也撑开，19px 会让它的命中矩形
//   盖住右边邻居的左边缘（615 > 604），点"关于"左边会打开"怎么玩"。
//   ⇒ 正确规则是**两轴都要算**：`2×pad ≤ min(竖直间距, 水平间距)`（间距只算"另一轴投影相交"的邻居）。

export const SCALE = 390 / 720;   // 逻辑 px → 390pt 手机 CSS px
export const FLOOR = 81;           // 44 CSS px ≈ 81 逻辑px（iOS HIG 44pt / Android 48dp）

// 分轴命中区（v1.207 起母版支持 hitPadX/hitPadY；缺省回落到 hitPad）——
//   ⚠ 第 72 轮实测教训：母版加了分轴 pad，探针却只读 hitPad ⇒ 云端把补好的控件又判成"偏小"。
//   凡"游戏侧新增语义"，探针必须同步，否则量的是旧口径。
export const padOf = (n) => ({ x: n.padX != null ? n.padX : (n.pad || 0), y: n.padY != null ? n.padY : (n.pad || 0) });
export const effSize = (n) => { const p = padOf(n); return { w: n.w + 2 * p.x, h: n.h + 2 * p.y }; };
export const hitRect = (n) => { const p = padOf(n); return { x: n.x - p.x, y: n.y - p.y, w: n.w + 2 * p.x, h: n.h + 2 * p.y }; };
export function intersect(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return { w, h, area: w > 0 && h > 0 ? w * h : 0 };
}
// 同屏最近邻居间距：**两轴取小**（对称 pad 会同时撑开宽高）
export function nearestGap(n, nodes) {
  const r = hitRect(n);
  let vg = Infinity, hg = Infinity;
  for (const o of nodes) {
    if (o === n) continue;
    const ro = hitRect(o);
    const xOver = Math.min(r.x + r.w, ro.x + ro.w) - Math.max(r.x, ro.x);
    const yOver = Math.min(r.y + r.h, ro.y + ro.h) - Math.max(r.y, ro.y);
    if (xOver > 0) { const g = Math.max(ro.y - (r.y + r.h), r.y - (ro.y + ro.h)); if (g >= 0) vg = Math.min(vg, g); }
    if (yOver > 0) { const g = Math.max(ro.x - (r.x + r.w), r.x - (ro.x + ro.w)); if (g >= 0) hg = Math.min(hg, g); }
  }
  const near = Math.min(vg, hg);
  return { vg, hg, near, safe: isFinite(near) ? Math.floor(near / 2) : Infinity };
}
// 同屏命中区重叠（硬门禁口径）：自定义 hitTest 的节点不按 rect±pad 判，跳过
export function overlapsOf(nodes) {
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (a.custom || b.custom) continue;
      const it = intersect(hitRect(a), hitRect(b));
      if (it.area > 1) out.push({ a: a.id, b: b.id, w: +it.w.toFixed(1), h: +it.h.toFixed(1),
        winner: a.idx > b.idx ? a.id : b.id });   // hit() 从后往前扫 ⇒ 注册更晚者抢到
    }
  }
  return out;
}
export function smallOnes(nodes) {
  // ⚠ 判定用**有效尺寸**（含已有 pad）——补过 hitPadY 的控件不该再算「偏小」；
  //   `need` 指「还要再补多少」（把 padX/padY 加进去后离 44 CSS px 还差多少）。
  return nodes.map((n) => {
    const e = effSize(n), short = Math.min(e.w, e.h);
    if (short >= FLOOR) return null;
    const g = nearestGap(n, nodes), need = Math.ceil((FLOOR - short) / 2);
    return { id: n.id, w: n.w, h: n.h, effW: e.w, effH: e.h, css: +(short * SCALE).toFixed(1),
      need, near: g.near, safe: g.safe, vg: g.vg, hg: g.hg,
      verdict: need <= g.safe ? `可再补 pad ${need}` : '需加大行距/改视觉' };
  }).filter(Boolean).sort((a, b) => a.css - b.css);
}
// ── 纯逻辑阴性/阳性对照（本机可跑，不需要浏览器）──
export function logicSelftest() {
  const out = [];
  const mk = (id, x, y, w, h, pad = 0, idx = 0, custom = false) => ({ id, x, y, w, h, pad, idx, custom });
  // ① 并排两钮（8px 间距）：对称 pad 会吃横向间距 ⇒ 安全 pad = 4
  const A = mk('A', 496, 6, 100, 44, 0, 0), B = mk('B', 604, 6, 100, 44, 0, 1);
  out.push(['并排 8px 间距 ⇒ 安全 pad 必须是 4（两轴取小）', nearestGap(A, [A, B]).safe === 4]);
  // ② 上下两钮（20px 间距，x 投影相交）⇒ 安全 pad = 10
  const C = mk('C', 200, 720, 320, 70, 0, 2), D = mk('D', 200, 810, 320, 70, 0, 3);
  out.push(['上下 20px 间距 ⇒ 安全 pad = 10', nearestGap(C, [C, D]).safe === 10]);
  // ③ 注入 pad=19 造重叠 ⇒ 必须检出（这正是第 69 轮那条错误结论的后果）
  const A2 = mk('A', 496, 6, 100, 44, 19, 0);
  out.push(['A 补 pad 19 ⇒ 与 B 重叠必须被检出', overlapsOf([A2, B]).length === 1]);
  // ④ 补 pad 4（安全上限）⇒ 恰好不重叠（边界条件）
  const A3 = mk('A', 496, 6, 100, 44, 4, 0);
  out.push(['A 补 pad 4（正好 ½ 间距）⇒ 不应判重叠', overlapsOf([A3, B]).length === 0]);
  // ⑤ 自定义 hitTest 的节点不参与 rect 口径
  const E = mk('E', 0, 0, 100, 100, 0, 4, true), F = mk('F', 10, 10, 100, 100, 0, 5);
  out.push(['自定义 hitTest 的节点跳过 rect 口径', overlapsOf([E, F]).length === 0]);
  // ⑥ 分轴 pad：只扩纵向 ⇒ 与并排邻居不重叠，但有效高度应算上 pad
  const G = { id: 'G', x: 0, y: 0, w: 100, h: 64, pad: 0, padY: 9, idx: 0, custom: false };
  const H = { id: 'H', x: 108, y: 0, w: 100, h: 64, pad: 0, idx: 1, custom: false };
  out.push(['padY 只扩纵向 ⇒ 与水平邻居(8px)不重叠', overlapsOf([G, H]).length === 0]);
  out.push(['padY=9 ⇒ 有效高度 64+18=82', effSize(G).h === 82]);
  return out;
}
const isMain = process.argv[1] && /hit-area-lib\.mjs$/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain && process.argv.includes('--selftest')) {
  const res = logicSelftest();
  let bad = 0;
  for (const [n, ok] of res) { console.log((ok ? '✅' : '❌') + ' ' + n); if (!ok) bad++; }
  console.log(bad ? `\n✗ 纯逻辑自测失败 ${bad}/${res.length}` : `\n✅ 命中区纯逻辑自测通过（${res.length} 组）`);
  process.exit(bad ? 1 : 0);
}
