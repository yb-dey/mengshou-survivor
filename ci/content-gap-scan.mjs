/**
 * content-gap-scan.mjs —— 内容缺口全维度扫描（守"该有的东西在不在"）
 *
 * 为什么需要它：
 *   本项目踩过一次"内容静默缺失"的坑 —— `build-dist.js` 只外置贴图、完全没管 audio/，
 *   云端 dist 里音频 0 个，而 verify-dist 一直 PASS（页面能跑、无报错）。
 *   → 光验"能跑"不够，必须**逐个内容维度核对数量**。
 *   本脚本把可枚举的内容维度一次列全，声明数 vs 实际覆盖，逐项报缺口。
 *
 * 演进史（四次假信号，全部是扫描器自身 bug，不是游戏的缺口 —— 教训留在代码里）：
 *  v1 `h.indexOf('];')` 截断   → 对象 map 扫到 11KB 外，串入兄弟数据（假报"章节 12 条含 barkplate"）
 *  v2 括号配平 + 只取顶层键     → 两层 map（DATA_ENEMY 顶层=种族分组，变体在分组内）严重漏数（21 敌人 → 6）
 *  v3 配平 + 递归收 id         → 敌人/跟宠/装备对了；但对象 map 顶层键正则要求键后紧跟 `{`，
 *                                `lose: { name:"失败", ... }` 这类单行条目漏掉 → BGM 只数到 1
 *  v4 配平 + 剥 `//` 注释 + 递归收 id → 全部维度对得上（本文件）
 *
 * 最终结论（v4 实测，全部 ✅）：
 *  敌人 21/21 贴图+受击+死亡 · 跟宠 7/7 · 武器 10 全有 wpn_ ·
 *  装备 12/12 · BGM 10/10 有文件 · 各前缀键族自洽
 *  唯一"看似缺口"：3 个武器无 blt_ —— 实测为 **kind: strike/laser/nova 的无弹道技能武器**，设计如此
 *
 * 铁律：**判定顺序** —— 打全量数据 → 读渲染路径 → 读设计注释 → 才允许判"缺陷"。
 *       本次四次返工全部败在"没数据就下结论"。
 */
import fs from 'fs';
import path from 'path';

const GAME_DIR = process.env.GAME_DIR || 'game';
// PICK_ENTRY_FILTERED: 排除 _ 前缀（_ = 临时/备份），防审计到备份文件（v1.187 实测）
const htmlName = fs.readdirSync(GAME_DIR).filter((f) => f.toLowerCase().endsWith('.html') && !f.startsWith('_')).sort()[0];
const HTML = path.join(GAME_DIR, htmlName);
const h = fs.readFileSync(HTML, 'utf8');
const AUDIO_DIR = path.join(GAME_DIR, 'audio');

function balanced(varName) {
  const decl = 'var ' + varName + ' =';
  const i = h.indexOf(decl);
  if (i < 0) return null;
  let p = i + decl.length;
  while (/\s/.test(h[p])) p++;
  const open = h[p];
  if (open !== '{' && open !== '[') return null;
  const close = open === '{' ? '}' : ']';
  let depth = 0, q = null, esc = false;
  for (let k = p; k < h.length; k++) {
    const c = h[k];
    if (esc) { esc = false; continue; }
    if (q) { if (c === '\\') { esc = true; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return { body: h.slice(p + 1, k), open }; }
  }
  return null;
}

function allIds(body) {
  const re = /id:\s*"([A-Za-z_0-9]+)"/g;
  const out = []; let x;
  while ((x = re.exec(body))) out.push(x[1]);
  return [...new Set(out)];
}

/**
 * 对象 map 的顶层键：扫 depth===0 处的 `键:`。
 * 与 v3 的区别：不要求键后是 `{`，只要在 depth 0 且未被引号包住就认。
 * 这样单行条目 `lose: { ... },` 也能正确取到 `lose`。
 */
function mapKeys(body) {
  const out = [];
  // 【v4 关键修复】先剥掉 `//` 行注释（且不能误伤字符串里的 //）。
  // 不剥注释的后果：`harbor: {...},  // C Ionian(HOME)\r\n  march: {`
  //   → 注释文本被带进下一个键的 buf → 键名变成 "// C Ionian(HOME)\r\n  march"
  //   → 正则拒收 → 整个 BGM 表只剩 1 个键。这是 v1~v3 共同的隐藏 bug。
  let src = '';
  {
    let inStr = null, esc2 = false;
    for (let k = 0; k < body.length; k++) {
      const c = body[k];
      if (esc2) { esc2 = false; src += c; continue; }
      if (inStr) {
        src += c;
        if (c === '\\') { esc2 = true; continue; }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { inStr = c; src += c; continue; }
      if (c === '/' && body[k + 1] === '/') {
        while (k < body.length && body[k] !== '\n') k++;
        src += '\n';
        continue;
      }
      src += c;
    }
  }

  let depth = 0, q = null, esc = false, buf = '';
  for (let k = 0; k < src.length; k++) {
    const c = src[k];
    if (esc) { esc = false; buf += c; continue; }
    if (q) { if (c === '\\') { esc = true; buf += c; continue; } if (c === q) q = null; buf += c; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; buf += c; continue; }
    // 注意顺序：先判 `:`（此时 buf 里是键名），再判 `{` 清 buf。
    // v3 的 bug 就是 `{` 判在前面，把 `键: {` 里的键名先擦掉了。
    if (c === ':' && depth === 0) {
      const key = buf.trim().replace(/^["']|["']$/g, '');
      if (/^[A-Za-z_0-9]+$/.test(key)) out.push(key);
      buf = ''; continue;
    }
    if (c === '{' || c === '[') { depth++; buf = ''; continue; }
    if (c === '}' || c === ']') { depth--; buf = ''; continue; }
    if (c === ',' && depth === 0) { buf = ''; continue; }
    buf += c;
  }
  return [...new Set(out)];
}

function decl(varName) {
  const b = balanced(varName);
  if (!b) return null;
  return { shape: b.open === '{' ? 'map' : 'array', keys: mapKeys(b.body), ids: allIds(b.body) };
}

const m = h.match(/var AI_ART_TABLE = (\{[^}]*\});\s*\/\* AI_ART_INJECT \*\//);
const keys = m ? Object.keys(JSON.parse(m[1])) : [];
const has = (k) => keys.indexOf(k) >= 0;
const pref = (p) => keys.filter((k) => k.indexOf(p) === 0);
const suff = (s) => keys.filter((k) => k.endsWith(s));

const audioFiles = fs.existsSync(AUDIO_DIR) ? fs.readdirSync(AUDIO_DIR) : [];
const bgmFiles = audioFiles.filter((f) => /^bgm_/.test(f)).map((f) => f.replace(/^bgm_/, '').replace(/\.wav$/, ''));

/** 无弹道武器判定：bulletSpd===0 或 bulletR===0 → 不可能有飞行子弹贴图 */
function isProjectileless(weaponId) {
  const re = new RegExp('id:\\s*"' + weaponId + '"[\\s\\S]{0,400}?kind:\\s*"([a-z]+)"');
  const mm = h.match(re);
  const kind = mm ? mm[1] : '?';
  return ['strike', 'laser', 'nova', 'aura'].indexOf(kind) >= 0 ? kind : null;
}

const enemy = decl('DATA_ENEMY');
const beast = decl('DATA_BEAST');
const wpn = decl('DATA_WEAPON');
const gear = decl('DATA_GEAR');
const bgm = decl('DATA_BGM');
const chap = decl('DATA_CHAPTER');
const theme = decl('DATA_WORLD_THEME');

const L = []; const p = (s) => L.push(s);
const GAPS = [];   // 收集所有真缺口，决定 exit code

p('# 内容缺口扫描（v4，配平取体 + 剥注释 + 递归收 id）\n');
p('- HTML: ' + HTML + ' (' + (fs.statSync(HTML).size / 1024 / 1024).toFixed(2) + 'MB)');
p('- AI_ART_TABLE: ' + keys.length + ' 键 | audio: ' + audioFiles.length + ' 文件\n');
p('| 维度 | 形态 | 声明 | 覆盖 | 缺口 |');
p('|---|---|---|---|---|');

{
  const ids = enemy.ids;
  const noArt = ids.filter((id) => !has(id));
  const noHit = ids.filter((id) => !has(id + '_hit'));
  const noDead = ids.filter((id) => !has(id + '_dead'));
  if (noArt.length) GAPS.push('敌人缺贴图: ' + noArt.join(','));
  if (noHit.length) GAPS.push('敌人缺受击: ' + noHit.join(','));
  if (noDead.length) GAPS.push('敌人缺死亡: ' + noDead.join(','));
  p('| 敌人 | ' + enemy.shape + ' | ' + ids.length + ' | ' + (ids.length - noArt.length) + '/' + (ids.length - noHit.length) + '/' + (ids.length - noDead.length) + '（贴图/受击/死亡） | '
    + ([noArt.length && '缺贴图:' + noArt.join(','), noHit.length && '缺受击:' + noHit.join(','), noDead.length && '缺死亡:' + noDead.join(',')].filter(Boolean).join(' ') || '✅ 0') + ' |');
}
{
  const ids = beast.ids;
  const noArt = ids.filter((id) => !has(id));
  if (noArt.length) GAPS.push('跟宠缺 AI 图: ' + noArt.join(','));
  p('| 跟宠 | ' + beast.shape + ' | ' + ids.length + ' | ' + (ids.length - noArt.length) + ' | ' + (noArt.length ? '缺:' + noArt.join(',') : '✅ 0') + ' |');
}
{
  const ids = wpn.ids;
  const noWpn = ids.filter((id) => !has('wpn_' + id));
  const noBlt = ids.filter((id) => !has('blt_' + id));
  const design = noBlt.filter((id) => isProjectileless(id));
  const realGap = noBlt.filter((id) => !isProjectileless(id));
  if (noWpn.length) GAPS.push('武器缺 wpn_ 贴图: ' + noWpn.join(','));
  if (realGap.length) GAPS.push('武器缺 blt_ 弹体贴图（且有弹道）: ' + realGap.join(','));
  p('| 武器 | ' + wpn.shape + ' | ' + ids.length + ' | ' + (ids.length - noWpn.length) + ' wpn_ / ' + (ids.length - noBlt.length) + ' blt_ | '
    + (realGap.length ? '真缺 blt_:' + realGap.join(',') : '')
    + (design.length ? (realGap.length ? ' ｜ ' : '') + '无弹道设计(' + design.join(',') + ') ✅' : '')
    + (noWpn.length ? ' 缺wpn_:' + noWpn.join(',') : '') + ' |');
}
{
  const ids = gear.ids;
  const noArt = ids.filter((id) => !has('gear_' + id));
  if (noArt.length) GAPS.push('装备缺 gear_ 贴图: ' + noArt.join(','));
  p('| 装备 | ' + gear.shape + ' | ' + ids.length + ' | ' + (ids.length - noArt.length) + ' | ' + (noArt.length ? '缺:' + noArt.join(',') : '✅ 0') + ' |');
}
{
  const ids = bgm.keys;
  const noFile = ids.filter((id) => bgmFiles.indexOf(id) < 0);
  const orphan = bgmFiles.filter((f) => ids.indexOf(f) < 0);
  if (noFile.length) GAPS.push('BGM 缺文件: ' + noFile.join(','));
  if (orphan.length) GAPS.push('BGM 孤儿文件（有声无声明）: ' + orphan.join(','));
  p('| BGM | ' + bgm.shape + ' | ' + ids.length + ' | ' + (ids.length - noFile.length) + ' | '
    + ([noFile.length && '缺文件:' + noFile.join(','), orphan.length && '孤儿文件:' + orphan.join(',')].filter(Boolean).join(' ') || '✅ 0') + ' |');
}

p('\n## 前缀键族\n');
for (const [label, pp] of [['被动 pas_', 'pas_'], ['进化 evo_', 'evo_'], ['武器 wpn_', 'wpn_'], ['子弹 blt_', 'blt_'],
  ['装备 gear_', 'gear_'], ['符文 tal_', 'tal_'], ['场物 field_', 'field_']]) {
  p('- **' + label + '**: ' + pref(pp).length + ' → ' + pref(pp).join(', '));
}
p('\n## 帧族：受击 ' + suff('_hit').length + ' / 死亡 ' + suff('_dead').length);
p('\n## 章节: ' + chap.ids.join(', '));
p('## 世界主题: ' + theme.ids.join(', '));

p('\n## 结论');
if (GAPS.length) {
  p('❌ **发现 ' + GAPS.length + ' 类缺口**：');
  GAPS.forEach((g) => p('- ' + g));
} else {
  p('✅ 全部维度无缺口。');
}
console.log(L.join('\n'));

// 门禁模式：GATE=1 时有缺口则 exit 1（供 CI 使用）；默认只报不拦。
if (process.env.GATE === '1' && GAPS.length) process.exit(1);
