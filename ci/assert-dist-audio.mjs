#!/usr/bin/env node
/**
 * assert-dist-audio.mjs —— 断言 dist/ 是**自包含**的音频分发单元
 *
 * 为什么需要它（本轮踩的坑）：
 *   `build-dist.js` 早期只外置 AI_ART_TABLE（贴图），完全没管 audio/。
 *   而 HTML 里音频路径是**运行时按表拼接**（`audioAssetFileName()`），
 *   没有任何字面量引用 → 构建脚本"看不到"、lint 也扫不出来 →
 *   dist/ 长期 0 个音频，发布形态静默退回程序化合成，
 *   外采的 25 个素材全部白做。验证只跑 HTML 是**抓不到**这个的。
 *
 * 本断言做三件事：
 *   ① dist/audio/ 存在 且 文件数 == HTML 声明的音频数（0 缺失）
 *   ② 逐个比对字节大小一致（防拷坏/拷到旧版）
 *   ③ dist/audio 总体积与源目录一致
 * 任何一项不满足 → exit 1（CI 红）。
 *
 * 用法: node ci/assert-dist-audio.mjs [srcHtml] [distDir]
 */
import fs from 'fs';
import path from 'path';

const SRC = process.argv[2] || path.join('game',
  fs.readdirSync('game').find((f) => f.toLowerCase().endsWith('.html')));
const DIST = process.argv[3] || 'dist';

const fail = [];
const note = [];

if (!fs.existsSync(SRC)) { console.error('✗ 找不到源 HTML: ' + SRC); process.exit(1); }
const s = fs.readFileSync(SRC, 'utf8');

const block = s.match(/var AUDIO_ASSET = \{[\s\S]*?\n\};/);
if (!block) { console.error('✗ HTML 里找不到 AUDIO_ASSET 定义（无法判定「应该有几个音频」）'); process.exit(1); }

const ab = block[0];
const bgmExt = (ab.match(/bgmExt:\s*"([^"]+)"/) || [])[1] || '.wav';
const sfxExt = (ab.match(/sfxExt:\s*"([^"]+)"/) || [])[1] || '.wav';

function namesOf(section, ext) {
  const sec = ab.match(new RegExp(section + ':\\s*\\{([\\s\\S]*?)\\}'));
  if (!sec) return [];
  const out = [];
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(sec[1]))) out.push(m[2] + ext);
  return out;
}

const bgm = namesOf('bgmFiles', bgmExt);
const sfx = namesOf('sfxFiles', sfxExt);
const declared = [...new Set([...bgm, ...sfx])];

const SRC_AUDIO = path.join(path.dirname(SRC), 'audio');
const DIST_AUDIO = path.join(DIST, 'audio');

// ① 目录存在 + 数量
if (!fs.existsSync(DIST_AUDIO)) {
  fail.push('dist/audio/ 不存在 —— dist 不是自包含分发单元（发布态将无外采音频）');
} else {
  const have = fs.readdirSync(DIST_AUDIO).filter((f) => /\.(wav|mp3|ogg|m4a)$/i.test(f));
  if (have.length !== declared.length) {
    fail.push(`dist/audio/ 有 ${have.length} 个音频，HTML 声明 ${declared.length} 个（差 ${declared.length - have.length}）`);
  }
  // ② 逐个字节比对
  let mismatched = [];
  let missing = [];
  let distBytes = 0, srcBytes = 0;
  for (const f of declared) {
    const a = path.join(SRC_AUDIO, f);
    const b = path.join(DIST_AUDIO, f);
    if (!fs.existsSync(a)) { missing.push(f + '(源缺)'); continue; }
    if (!fs.existsSync(b)) { missing.push(f); continue; }
    const sa = fs.statSync(a).size, sb = fs.statSync(b).size;
    srcBytes += sa; distBytes += sb;
    if (sa !== sb) mismatched.push(`${f} 源${sa}B vs 包${sb}B`);
  }
  if (missing.length) fail.push('dist/audio/ 缺 ' + missing.length + ' 个: ' + missing.join(', '));
  if (mismatched.length) fail.push('dist/audio/ 大小不一致 ' + mismatched.length + ' 个: ' + mismatched.join('; '));

  // ③ 多出未被声明的文件（噪声/误拷）
  const extra = fs.readdirSync(DIST_AUDIO)
    .filter((f) => /\.(wav|mp3|ogg|m4a)$/i.test(f) && !declared.includes(f));
  if (extra.length) note.push('dist/audio/ 多出 ' + extra.length + ' 个未声明文件: ' + extra.slice(0, 6).join(', '));

  note.push(`dist/audio 总量 ${(distBytes / 1024 / 1024).toFixed(2)}MB（源 ${(srcBytes / 1024 / 1024).toFixed(2)}MB）`);
}

console.log('# dist 自包含断言（音频）\n');
console.log('- 源 HTML   : ' + SRC);
console.log('- dist 目录 : ' + DIST);
console.log('- HTML 声明 : BGM ' + bgm.length + ' + SFX ' + sfx.length + ' = ' + declared.length + ' 个');
note.forEach((n) => console.log('- ' + n));

if (fail.length) {
  console.log('\n## 结论: **FAIL**\n');
  fail.forEach((f) => console.log('- ✗ ' + f));
  console.log('\n> 构建脚本必须把 HTML 声明的音频全部外置。' +
    '若是有意不随包（纯 CDN 外链），请显式修改本断言的期望值，而不是让它静默通过。');
  process.exit(1);
}

console.log('\n## 结论: **PASS** — dist 是自包含的音频分发单元 ✅');
