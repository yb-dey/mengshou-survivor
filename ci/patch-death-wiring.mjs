// 死亡帧接线（4 处插入，全部为**纯增量**，不改任何游戏逻辑）
//
// 设计要点：
//   * 不碰 killEnemy（内含掉落/经济/通关/成就/BOSS 主时钟，40+ 行敏感逻辑）
//   * 改为"死亡标记"通道：只画不参与逻辑 → 不改密度/掉落/碰撞/计数（守 R7G「只动表现层」）
//   * 插入点全部锚定唯一字符串，并逐一断言"恰好命中 1 次"，命中数不对就整体回滚不写
import fs from 'node:fs';

const P = 'game/萌兽消消岛.html';
let html = fs.readFileSync(P, 'utf8');
const before = html.length;
const log = [];

function insertAfter(anchor, payload, label) {
  const n = html.split(anchor).length - 1;
  if (n !== 1) { console.error(`❌ [${label}] 锚点命中 ${n} 次（应为 1）: ${anchor.slice(0, 60)}`); process.exit(2); }
  html = html.replace(anchor, anchor + payload);
  log.push(`  ✅ ${label}`);
}
function insertBefore(anchor, payload, label) {
  const n = html.split(anchor).length - 1;
  if (n !== 1) { console.error(`❌ [${label}] 锚点命中 ${n} 次（应为 1）: ${anchor.slice(0, 60)}`); process.exit(2); }
  html = html.replace(anchor, payload + anchor);
  log.push(`  ✅ ${label}`);
}

// ---------- 1) 数组 + 函数（挂在 coinFxQueue 定义之后）----------
insertAfter(
  'var coinFxQueue = [];',
  `
// 【v1.166】死亡标记：敌人被击杀时在原地留下"倒地"贴图，0.5s 内淡出。
//   为什么不改 killEnemy：该函数集成掉落/经济/通关/成就/BOSS 主时钟，改动风险高。
//   本通道**只画不参与任何逻辑** —— 不改密度/掉落/碰撞/计数，符合 R7G「只动表现层」。
//   贴图键 <id>_dead，与本体同域（按 vis*2 拉伸铺满），尺寸不跳变。
var deathMarks = [];
var deathMarksSpawned = 0;                        // 累计生成数（供 MENGSHOU_DEBUG 读取，作为"确实触发过"的证据）
var deathMarksDrawn = 0;                          // 累计绘制次数（证明真的画出来过）
function spawnDeathMark(e) {
  if (!e || !e.type) return;
  if (!SPRITES[e.type + "_dead"]) return;          // 没有死亡帧的怪直接跳过（零副作用）
  deathMarksSpawned++;
  deathMarks.push({ x: e.x, y: e.y, type: e.type, t: (CONFIG.deathMarkSec || 0.5) });
  if (deathMarks.length > 24) deathMarks.shift();  // 上限防堆积（高密度割草时）
}
function updateAndDrawDeathMarks(ctx) {
  var i, m, spr, a;
  for (i = deathMarks.length - 1; i >= 0; i--) {
    m = deathMarks[i];
    m.t -= 0.0167;                                 // 纯表现层推进，不依赖 gameplay dt
    if (m.t <= 0) { deathMarks.splice(i, 1); continue; }
    spr = SPRITES[m.type + "_dead"];
    if (!spr || !ctx) continue;
    a = m.t / (CONFIG.deathMarkSec || 0.5);
    ctx.globalAlpha = 0.35 + 0.65 * (a > 1 ? 1 : a);
    ctx.drawImage(spr, m.x - spr.half, m.y - spr.half, spr.half * 2, spr.half * 2);
    deathMarksDrawn++;
  }
  if (ctx) ctx.globalAlpha = 1;
}`,
  '1/4 死亡标记通道（数组 + 生成 + 绘制）'
);

// ---------- 2) 击杀前打标记 ----------
insertBefore(
  '    if (e.active) killEnemy(e);',
  '    spawnDeathMark(e);                          // 【v1.166】死亡帧：纯表现层，不参与任何逻辑\n',
  '2/4 击杀前打标记（hitEnemy 内，killEnemy 之前）'
);

// ---------- 3) 渲染（世界层地面之上、实体之下）----------
insertAfter(
  '  drawChapterFarLayer(ctx, camX, camY);',
  '\n  updateAndDrawDeathMarks(ctx);              // 【v1.166】死亡帧画在地面层（尸体压在活怪之下）',
  '3/4 渲染钩子（世界层，带摄像机变换）'
);

// ---------- 4) 开新局清空 ----------
const resetAnchor = 'coinFxQueue.length = 0;                       // 【R4】组1 fx 待喷批次清空(防跨局污染)';
insertAfter(
  resetAnchor,
  '\n  deathMarks.length = 0;                       // 【v1.166】死亡帧清空(防跨局污染)',
  '4/4 开新局清空（防跨局污染）'
);

// ---------- 5) 让 buildSprites 真的去构建 <id>_dead 贴图 ----------
//   关键：AI_ART_TABLE 里有键 ≠ SPRITES 会构建。构建是按 DATA_ENEMY 遍历出来的，
//   漏了这一步就会 deadSprites=0（实测踩过：以为注入了就能用）。
insertAfter(
  '      if (AI_ART_READY[eid + "_hit"]) {\n        SPRITES[eid + "_hit"] = makeEnemySprite(ed.r, ecol, eid + "_hit");\n      }',
  `
      // 【v1.166】死亡帧（可选）：与受击帧同款「有 AI 图才建」，复用同一 r → vis/pad/half 与本体完全一致
      if (AI_ART_READY[eid + "_dead"]) {
        SPRITES[eid + "_dead"] = makeEnemySprite(ed.r, ecol, eid + "_dead");
      }`,
  '5/5 buildSprites 构建 _dead 贴图（关键：不接这步 deadSprites=0）'
);

// ---------- 6) 把计数暴露到官方调试面（该对象确为全局；deathMarks 本体在闭包里探不到）----------
insertAfter(
  '  window.MENGSHOU_DEBUG = {',
  `
    // 【v1.166】死亡帧证据口：闭包内的 deathMarks 从外部探不到（AI_ART_READY 同类坑已踩过），
    //   必须经此接口读取 —— 验证脚本用 spawned>0 证明"确实触发过"，用 drawn>0 证明"确实画出来过"。
    deathMarks: function () {
      return { live: deathMarks.length, spawned: deathMarksSpawned, drawn: deathMarksDrawn,
               sprites: (function () { var n = 0, k; for (k in SPRITES) if (k.slice(-5) === "_dead") n++; return n; })() };
    },`,
  '6/6 暴露调试口 MENGSHOU_DEBUG.deathMarks()'
);

fs.writeFileSync(P, html, 'utf8');
console.log(log.join('\n'));
console.log('');
console.log('deathMarks 出现次数: ' + (html.match(/deathMarks/g) || []).length);
console.log('spawnDeathMark 调用: ' + (html.match(/spawnDeathMark\(e\)/g) || []).length);
console.log('updateAndDrawDeathMarks 出现: ' + (html.match(/updateAndDrawDeathMarks/g) || []).length);
console.log('体积: ' + before + ' → ' + html.length + ' (+' + ((html.length - before) / 1024).toFixed(1) + ' KB)');
