// sfx-literal-wiring.mjs —— 「每一条 Audio.play 字面量都必须能在音效表里找到」（GATE · 第 78 轮）
//
// 为什么需要它（第 78 轮实测）：
//   `ci/assert-audio-map.mjs` 已经锁住了**表与表之间**的一致（gains ↔ sfxFiles ↔ game/audio 文件 ↔ DATA_SFX 引用），
//   但母版里还有一类调用是**直接传字符串**的：`Audio.play("sortiepreview")`、`Audio.play("crit")` …
//   （实测 161 处调用、57 个去重 id）。这类字面量若拼错或改名，运行时会**静默无声** ——
//   与"dist 音频 0 个却全绿"同族：没有任何东西会报错，只是玩家听不到。
//
// 本轮实测结论：57 个 id **全部**能在音效表里找到（0 个未知）⇒ 当前没有这种缺陷；本判据的作用是**锁住它**。
//   ⚠ 顺带记一个自伤：我的探针第一版把 gains 块里的注释 `R3: FIRE 0.50→0.32` 当成了键（报"R3 从未被引用"），
//     ⇒ 本判据先**剥掉注释**再取键。
//
// 判据：
//   A. 每个 `Audio.play("X")` 的 X 都必须命中：① gains/sfxFiles 的键，或 ② DATA_SFX 的曲线名。
//   B. 至少解析出 100 处调用（防"正则失效 ⇒ 0 处 ⇒ 假绿"）。
//   C. 去重 id ≥ 30（同上，防口径塌缩）。
// 阴性对照（--selftest）：① 真实母版 PASS；② 把某个字面量改成不存在的 id ⇒ FAIL；③ 把正则打瘸（改掉 Audio.play 写法）⇒ FAIL。
import { readFileSync } from 'node:fs';
const F_MASTER = process.env.MASTER || 'game/萌兽消消岛.html';
const strip = (s) => s.replace(/\/\/[^\n]*/g, '');   // 剥行注释（R3 假键就是这么来的）
export function analyze(srcRaw) {
  const src = strip(srcRaw);
  const keys = new Set();
  for (const re of [/gains\s*:\s*\{([\s\S]*?)\n\s{2,6}\}/, /sfxFiles\s*:\s*\{([\s\S]*?)\n\s{2,6}\}/]) {
    const m = re.exec(src);
    if (m) for (const x of m[1].matchAll(/([A-Za-z_]\w*)\s*:/g)) keys.add(x[1]);
  }
  const dsfx = /var DATA_SFX\s*=\s*\{([\s\S]*?)\n\};/.exec(src);
  const curves = new Set();
  if (dsfx) for (const x of dsfx[1].matchAll(/^\s{2}([A-Za-z_]\w*)\s*:/gm)) curves.add(x[1]);
  const calls = [...src.matchAll(/Audio\.play\(\s*"([^"]+)"/g)].map((m) => m[1]);
  const uniq = [...new Set(calls)];
  const unknown = uniq.filter((id) => !keys.has(id) && !curves.has(id));
  const fails = [];
  if (unknown.length) fails.push('这些 Audio.play 字面量不在音效表里（会静默无声）：' + unknown.join(' '));
  if (calls.length < 100) fails.push(`只解析到 ${calls.length} 处 Audio.play（<100）⇒ 可能正则失效，判据形同虚设`);
  if (uniq.length < 30) fails.push(`只解析到 ${uniq.length} 个去重 id（<30）⇒ 口径塌缩`);
  return { fails, calls: calls.length, uniq: uniq.length, keys: keys.size, curves: curves.size };
}
const isMain = process.argv[1] && /sfx-literal-wiring\.mjs$/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain && process.argv.includes('--selftest')) {
  const real = readFileSync(F_MASTER, 'utf8');
  const a = analyze(real);
  const b = analyze(real.replace('Audio.play("crit")', 'Audio.play("crit_typo")'));
  const c = analyze(real.split('Audio.play(').join('Audio.plays('));
  const cases = [
    ['阳性A：真实母版（字面量全部命中）', a.fails.length === 0],
    ['阴性B：把一个字面量改成不存在的 id（必须 FAIL）', b.fails.length > 0],
    ['阴性C：把 Audio.play 写法改瘸（必须 FAIL，防假绿）', c.fails.length > 0],
  ];
  let bad = 0;
  for (const [n, ok] of cases) { console.log((ok ? '✅' : '❌') + ' ' + n + ' ⇒ ' + ok); if (!ok) bad++; }
  for (const r of [b, c]) if (r.fails.length) console.log('      · ' + r.fails[0].slice(0, 100));
  console.log(bad ? '\n✗ 自测失败' : `\n✅ 音效字面量接线自测通过（3 组）· 调用 ${a.calls} 处 / 去重 ${a.uniq} 个 / 表键 ${a.keys} + 曲线 ${a.curves}`);
  process.exit(bad ? 1 : 0);
}
if (isMain) {
  const r = analyze(readFileSync(F_MASTER, 'utf8'));
  console.log(`  Audio.play 调用 ${r.calls} 处 · 去重 id ${r.uniq} 个 · 音效表键 ${r.keys} 个 + DATA_SFX 曲线 ${r.curves} 个`);
  if (r.fails.length) { for (const f of r.fails) console.log('❌ ' + f); console.log('\n结论：FAIL'); process.exit(1); }
  console.log('\n结论：PASS —— 每条 Audio.play 字面量都能在音效表里找到（无静默无声的调用点）');
}
