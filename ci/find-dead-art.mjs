/**
 * find-dead-art.mjs —— 找出 AI_ART_TABLE 里**永不渲染**的死键（体积浪费）
 *
 * 背景：v1.96 决定"单位/跟宠统一墨线+填色+剪影"，`skipActorPng()` 硬编码 true
 *   → 跟宠/敌人的插画 PNG 一律被跳过 → 表里那些键是**死数据**：
 *   占着内联 base64 体积，运行时永远不画。
 *   本项目已删过一批死数据（记忆里"死数据镜像变体"），本脚本把判据固化下来。
 *
 * 判据（保守，只报"有明确跳过证据"的）：
 *   - `skipActorPng()` 返回 true 时，被它拦掉的键 = DATA_TEX 里 kind==='single' 或 tid==='TEX-12' 的 target
 *   - 但 AI_ART_READY[key] 会被 makeEnemySprite/makePetSprite 直接读（不经 applyTexture）
 *     → 所以"被 applyTexture 跳过" ≠ "死"：还要看有没有**直接读 AI_ART_READY[key]** 的路径
 *
 * 因此本脚本输出**两类清单**，不直接判死：
 *   A. 有直接读取路径（makePetSprite: AI_ART_READY[id]）→ **活的**，即使 skipActorPng 为 true
 *   B. 只能在 applyTexture 里落位、且被 skipActorPng 拦掉 → **可疑死数据**（需人工确认）
 */
import fs from 'fs';
import path from 'path';

const GAME_DIR = process.env.GAME_DIR || 'game';
const HTML = path.join(GAME_DIR,
  fs.readdirSync(GAME_DIR).filter((f) => f.toLowerCase().endsWith('.html') && !f.startsWith('_')).sort()[0]);
const h = fs.readFileSync(HTML, 'utf8');

const m = h.match(/var AI_ART_TABLE = (\{[^}]*\});\s*\/\* AI_ART_INJECT \*\//);
if (!m) { console.error('找不到 AI_ART_TABLE'); process.exit(1); }
const table = JSON.parse(m[1]);
const keys = Object.keys(table);

const sizeOf = (k) => (typeof table[k] === 'string' ? table[k].length : 0);
const totalB64 = keys.reduce((a, k) => a + sizeOf(k), 0);

// DATA_BEAST 的 id（跟宠）—— ⚠ 必须**限定在数组内**，只扫到第一个 `];`
//   （上一版扫了固定 9000 字符，把后面的 DATA_ENEMY / 武器名全抓进来 → 输出 59 条噪声）
const bi = h.indexOf('var DATA_BEAST');
const arrEnd = h.indexOf('];', bi);
const seg = h.slice(bi, arrEnd > bi ? arrEnd : bi + 9000);
const beastIds = [];
const reB = /id:\s*"([a-zA-Z_]+)"/g;
let x;
while ((x = reB.exec(seg))) beastIds.push(x[1]);

// skipActorPng 是否 true
const skipTrue = /function skipActorPng\(\)\s*\{\s*return true/.test(h);
console.log('# AI 表死数据扫描\n');
console.log('- HTML: ' + HTML);
console.log('- AI_ART_TABLE 键数: ' + keys.length + '，内联总量 ' + (totalB64 / 1024 / 1024).toFixed(2) + 'MB(base64)');
console.log('- skipActorPng() 硬编码 true: ' + (skipTrue ? '**是** → applyTexture 会跳过单位/跟宠插画' : '否'));

// 跟宠：makePetSprite 有直接读 AI_ART_READY[id] 的路径吗？
const petDirectRead = /if \(id && AI_ART_READY\[id\]\)/.test(h);
console.log('- makePetSprite 直接读 AI_ART_READY[id]: ' + (petDirectRead ? '**有** → 跟宠键是**活的**' : '无'));

console.log('\n## 跟宠键（' + beastIds.length + ' 只）');
let beastBytes = 0;
beastIds.forEach((id) => {
  const has = keys.indexOf(id) >= 0;
  const sz = has ? sizeOf(id) : 0;
  beastBytes += sz;
  console.log(`- ${id}: 表内${has ? '有' : '无'}${has ? '（' + (sz / 1024).toFixed(0) + 'KB）' : ''}`);
});
console.log(`- 跟宠键合计 ${(beastBytes / 1024).toFixed(0)}KB base64`);

if (skipTrue && petDirectRead) {
  console.log('\n> ⚠ **关键判定**：这两个条件同时成立时，跟宠键**仍然是活的** ——');
  console.log('>   `applyTexture` 被 `skipActorPng` 跳过，只是"不走贴图落位"这条路径；');
  console.log('>   但 `makePetSprite` 有 `if (id && AI_ART_READY[id])` 直接读缓存的分支 →');
  console.log('>   只要 AI 图解码进 `AI_ART_READY`，跟宠照样用 AI 图。');
  console.log('>   **不能因为 skipActorPng=true 就删这些键**（那是把活数据当死数据删）。');
}

console.log('\n## 建议');
console.log('- 本脚本**不自动删任何东西**（删错 = 把活数据删掉，比留着更糟）。');
console.log('- 要判"某键是否真死"，须核对：该键在 `AI_ART_READY` 的所有读取点里是否可达。');
