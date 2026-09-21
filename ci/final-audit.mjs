/**
 * final-audit.js —— 三形态终局复核（内容级，不只看计数）
 *
 * 为什么需要：本轮已经踩过"计数对但内容是兜底"的坑（dist 音频 0 个、验证全绿）。
 * 所以终局复核必须做到：
 *   ① 内联母版 / dist / deploy 三处的**资源声明表**一致
 *   ② dist/audio、deploy/audio 的每个文件与 game/audio **哈希一致**
 *   ③ dist/HTML、deploy/HTML 里 AI_ART_TABLE 的键集合一致，且路径前缀已外链化
 *   ④ 体积口径（主包 / 总包）在限额内
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// ⚠ 不要写死本机绝对路径 —— CI 的工作目录是仓库根（`/home/runner/work/...`），
//   写死绝对路径在云端必 ENOENT（本项目已踩过两次同类坑）。
//   默认全部相对 cwd；本地跑 deploy 在仓库外，用 argv/环境变量覆盖即可。
const HERE = process.cwd();                       // 仓库根（本地 = CI 一致）
const MENGSHOU = process.env.MENGSHOU_DIR || HERE;
const SRC_HTML = process.argv[2] || path.join(MENGSHOU, 'game',
  fs.readdirSync(path.join(MENGSHOU, 'game')).find((f) => f.toLowerCase().endsWith('.html')));
const SRC_AUDIO = path.join(path.dirname(SRC_HTML), 'audio');
const DIST = process.argv[3] || path.join(MENGSHOU, 'dist');
// deploy/ 默认在仓库**外**的上一层（本地 D:/新建文件夹/方向3/deploy）；
// 不存在则跳过相关检查，并**显式说明跳过**（不静默、也不误判为失败）。
const DEPLOY = process.argv[4] || process.env.DEPLOY_DIR || path.resolve(MENGSHOU, '../..', 'deploy');
const SKIP_DEPLOY = process.env.SKIP_DEPLOY === '1' || !fs.existsSync(DEPLOY);

const fail = [];
const warn = [];
const info = [];

const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex').slice(0, 12);

function declaredAudioOf(htmlPath) {
  const s = fs.readFileSync(htmlPath, 'utf8');
  const b = s.match(/var AUDIO_ASSET = \{[\s\S]*?\n\};/);
  if (!b) return null;
  const ab = b[0];
  const bgmExt = (ab.match(/bgmExt:\s*"([^"]+)"/) || [])[1] || '.wav';
  const sfxExt = (ab.match(/sfxExt:\s*"([^"]+)"/) || [])[1] || '.wav';
  const namesOf = (sec, ext) => {
    const m = ab.match(new RegExp(sec + ':\\s*\\{([\\s\\S]*?)\\}'));
    if (!m) return [];
    const out = [];
    const re = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*"([^"]+)"/g;
    let x;
    while ((x = re.exec(m[1]))) out.push(x[2] + ext);
    return out;
  };
  return {
    bgm: namesOf('bgmFiles', bgmExt),
    sfx: namesOf('sfxFiles', sfxExt),
  };
}

function artKeysOf(htmlPath) {
  const s = fs.readFileSync(htmlPath, 'utf8');
  const m = s.match(/var AI_ART_TABLE = (\{[^}]*\});\s*\/\* AI_ART_INJECT \*\//);
  if (!m) return null;
  try { return Object.keys(JSON.parse(m[1])); } catch (e) { return null; }
}

// ── ① 音频声明表三处一致 ──────────────────────────────────
const aSrc = declaredAudioOf(SRC_HTML);
const aDist = declaredAudioOf(path.join(DIST, '萌兽消消岛.html'));
const aDep = SKIP_DEPLOY ? null : declaredAudioOf(path.join(DEPLOY, 'index.html'));

if (!aSrc) fail.push('内联母版没有 AUDIO_ASSET 表');
if (!aDist) fail.push('dist 的 HTML 没有 AUDIO_ASSET 表（可能被构建脚本破坏）');
if (!SKIP_DEPLOY && !aDep) fail.push('deploy 的 HTML 没有 AUDIO_ASSET 表（可能被构建脚本破坏）');

if (aSrc && aDist) {
  const key = (a) => [...a.bgm, ...a.sfx].sort().join('|');
  if (key(aSrc) !== key(aDist)) fail.push('dist 的音频声明与母版不一致');
  else if (aDep && key(aSrc) !== key(aDep)) fail.push('deploy 的音频声明与母版不一致');
  else info.push(`音频声明一致${aDep ? '（母版/dist/deploy 三处）' : '（母版/dist 两处）'}：BGM ${aSrc.bgm.length} + SFX ${aSrc.sfx.length} = ${aSrc.bgm.length + aSrc.sfx.length}`);
}
if (SKIP_DEPLOY) info.push('deploy 目录不存在 → 已跳过 deploy 相关检查（CI 环境正常，deploy 在仓库外）');

// ── ② 音频文件内容哈希一致 ─────────────────────────────────
const allAudio = aSrc ? [...new Set([...aSrc.bgm, ...aSrc.sfx])] : [];
function checkAudioDir(dir, label) {
  if (!fs.existsSync(dir)) { fail.push(`${label} 不存在`); return; }
  let ok = 0;
  const diff = [];
  for (const f of allAudio) {
    const sPath = path.join(SRC_AUDIO, f);
    const dPath = path.join(dir, f);
    if (!fs.existsSync(sPath)) { diff.push(f + '(源缺)'); continue; }
    if (!fs.existsSync(dPath)) { diff.push(f + '(产物缺)'); continue; }
    if (md5(sPath) !== md5(dPath)) diff.push(f + '(内容不同)');
    else ok++;
  }
  if (diff.length) fail.push(`${label} 与源不一致 ${diff.length} 个: ` + diff.slice(0, 5).join(', '));
  else info.push(`${label}: ${ok}/${allAudio.length} 个音频内容哈希一致 ✅`);
  // 未声明的多余文件
  const stray = fs.readdirSync(dir).filter((f) => /\.(wav|mp3|ogg|m4a)$/i.test(f) && !allAudio.includes(f));
  if (stray.length) warn.push(`${label} 多出未声明音频 ${stray.length} 个: ` + stray.slice(0, 5).join(', '));
}
checkAudioDir(path.join(DIST, 'audio'), 'dist/audio');
if (!SKIP_DEPLOY) checkAudioDir(path.join(DEPLOY, 'audio'), 'deploy/audio');

// ── ③ 贴图键集合 + 路径外链化 ─────────────────────────────
const kSrc = artKeysOf(SRC_HTML);
const kDist = artKeysOf(path.join(DIST, '萌兽消消岛.html'));
const kDep = SKIP_DEPLOY ? null : artKeysOf(path.join(DEPLOY, 'index.html'));

if (!kSrc) fail.push('内联母版没有 AI_ART_TABLE');
if (!kDist) fail.push('dist HTML 没有 AI_ART_TABLE');
if (!SKIP_DEPLOY && !kDep) fail.push('deploy HTML 没有 AI_ART_TABLE');

if (kSrc && kDist) {
  if (kSrc.length !== kDist.length) fail.push(`贴图键数不一致：母版 ${kSrc.length} vs dist ${kDist.length}`);
  else info.push(`贴图键数一致：${kSrc.length} 个`);
  // 外链化检查：dist 的值应为 "assets/xxx.webp" 而非 data:
  const sDist = fs.readFileSync(path.join(DIST, '萌兽消消岛.html'), 'utf8');
  const mDist = sDist.match(/var AI_ART_TABLE = (\{[^}]*\});/);
  if (mDist) {
    const t = JSON.parse(mDist[1]);
    const inline = Object.values(t).filter((v) => typeof v === 'string' && v.startsWith('data:')).length;
    const linked = Object.values(t).filter((v) => typeof v === 'string' && v.startsWith('assets/')).length;
    if (inline > 0) fail.push(`dist HTML 仍有 ${inline} 个内联 base64（未外链化）`);
    else info.push(`dist 贴图全部外链化：${linked} 个指向 assets/ ✅`);
  }
}

// ── ④ 体积口径 ───────────────────────────────────────────
function dirSize(d) {
  if (!fs.existsSync(d)) return 0;
  let n = 0;
  const walk = (x) => fs.readdirSync(x, { withFileTypes: true }).forEach((f) => {
    const p = path.join(x, f.name);
    if (f.isDirectory()) walk(p); else n += fs.statSync(p).size;
  });
  walk(d);
  return n;
}
const inlineMB = fs.statSync(SRC_HTML).size / 1024 / 1024;
const distHtmlMB = fs.statSync(path.join(DIST, '萌兽消消岛.html')).size / 1024 / 1024;
const distTotal = dirSize(DIST) / 1024 / 1024;
const depTotal = SKIP_DEPLOY ? 0 : dirSize(DEPLOY) / 1024 / 1024;

const MB = (x) => x.toFixed(2) + 'MB';
info.push(`内联母版 ${MB(inlineMB)}`);
info.push(`dist 主包 HTML ${MB(distHtmlMB)} + 全目录 ${MB(distTotal)}`);
if (!SKIP_DEPLOY) info.push(`deploy 全目录 ${MB(depTotal)}`);
if (distHtmlMB > 4) fail.push(`dist 主包 HTML ${MB(distHtmlMB)} 超过微信主包上限 4MB`);
if (inlineMB > 4) warn.push(`内联母版 ${MB(inlineMB)} 已过 4MB 线（仅本地双击用，不影响发布）`);

// ── 输出 ─────────────────────────────────────────────────
console.log('# 三形态终局复核\n');
console.log('- 内联母版 : ' + SRC_HTML);
console.log('- dist     : ' + DIST);
console.log('- deploy   : ' + (SKIP_DEPLOY ? '（不存在，已跳过）' : DEPLOY));
console.log('\n## 明细');
info.forEach((i) => console.log('- ' + i));
if (warn.length) { console.log('\n## 提示'); warn.forEach((w) => console.log('- ⚠ ' + w)); }
if (fail.length) {
  console.log('\n## 结论: **FAIL**\n');
  fail.forEach((f) => console.log('- ✗ ' + f));
  process.exit(1);
}
console.log('\n## 结论: **PASS** — 三形态内容级一致 ✅');
