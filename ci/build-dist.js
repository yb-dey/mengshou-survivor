#!/usr/bin/env node
/**
 * build-dist.js —— 把内联 base64 的美术资源外置为独立文件, 产出"可分发"版本
 *
 * 动机: 单文件 base64 内联虽可双击直玩, 但主包体积大且无法走 CDN。
 * 本脚本产出 dist/ : 主包 HTML(不含贴图) + assets/*.webp ,
 * 资源路径用相对路径 —— 本地双击可用, 上传 CDN 后只需把路径换成 CDN 域名即可,
 * 主包体积降到 ~1.6MB(微信小游戏主包上限 4MB, 余量充裕)。
 */
const fs = require('fs');
const path = require('path');

// ⚠ 原来 SRC/OUT 写死了本机绝对路径 → **只能在本地跑，进 CI 必挂**
//   （实测：云端报 ENOENT: .../D:/新建文件夹/.../萌兽消消岛.html）。
//   改成"相对当前工作目录"，本地与 CI 通用；需要时可用 argv 或 GAME_DIR 覆盖。
const _gameDir = path.resolve(process.env.GAME_DIR || 'game');
const SRC = process.argv[2] ||
  path.join(_gameDir, fs.readdirSync(_gameDir).find((f) => f.toLowerCase().endsWith('.html')));
const OUT = process.argv[3] || 'dist';
const ASSETS = path.join(OUT, 'assets');

fs.mkdirSync(ASSETS, { recursive: true });
let s = fs.readFileSync(SRC, 'utf8');

const re = /var AI_ART_TABLE = (\{[^}]*\});\s*\/\* AI_ART_INJECT \*\//;
const m = s.match(re);
if (!m) { console.log('未找到 AI_ART_INJECT 注入点'); process.exit(1); }

let table = {};
try { table = JSON.parse(m[1]); } catch (e) { console.log('表解析失败'); process.exit(1); }

const keys = Object.keys(table);
const pathMap = {};
let totalBytes = 0;

keys.forEach(function (k) {
  const dataUrl = table[k];
  const comma = dataUrl.indexOf(',');
  const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
  const ext = mime.indexOf('webp') >= 0 ? '.webp' : '.png';
  const b64 = dataUrl.slice(comma + 1);
  const buf = Buffer.from(b64, 'base64');
  const file = k + ext;
  fs.writeFileSync(path.join(ASSETS, file), buf);
  pathMap[k] = 'assets/' + file;        // 相对路径: 本地 file:// 与 CDN 均适用
  totalBytes += buf.length;
});

s = s.replace(re, 'var AI_ART_TABLE = ' + JSON.stringify(pathMap) + ';   /* AI_ART_INJECT */');

const outHtml = path.join(OUT, '萌兽消消岛.html');
fs.writeFileSync(outHtml, s);

// ── 音频外置（v1.168 补）──────────────────────────────────────────────
// 动机：dist/ 必须是**自包含分发单元**。HTML 里 `AUDIO_ASSET.baseDir = "audio/"`，
//   文件名是**运行时按表拼接**的（`audioAssetFileName()`），不是字面量 →
//   构建脚本读不到字面引用 → 此前 dist/ 一直没有音频，
//   发布形态只能退回程序化合成（音频内容 = 兜底质量，外采素材全部白做）。
// 做法：解析 HTML 里的 AUDIO_ASSET 表 → 推导出**本游戏真正会加载的**文件名
//   → 只拷这些（未引用的素材不拷，省体积）；缺失则报 exit 2（不许静默降级）。
// 幂等：已存在且大小相同即跳过。
const AUDIO_SRC = path.join(path.dirname(SRC), 'audio');
const AUDIO_DST = path.join(OUT, 'audio');

const audioBlock = s.match(/var AUDIO_ASSET = \{[\s\S]*?\n\};/);
let audioDeclared = 0, audioCopied = 0, audioBytes = 0;
const audioMissing = [];

if (!audioBlock) {
  console.log('  ⚠ 未找到 AUDIO_ASSET 定义 → 跳过音频外置（发布形态将走程序化合成）');
} else {
  const ab = audioBlock[0];
  const baseDir = (ab.match(/baseDir:\s*"([^"]+)"/) || [])[1] || 'audio/';
  const bgmExt = (ab.match(/bgmExt:\s*"([^"]+)"/) || [])[1] || '.wav';
  const sfxExt = (ab.match(/sfxExt:\s*"([^"]+)"/) || [])[1] || '.wav';

  function namesOf(section, ext) {
    const sec = ab.match(new RegExp(section + ':\\s*\\{([\\s\\S]*?)\\}'));
    if (!sec) return [];
    const out = [];
    const re2 = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*"([^"]+)"/g;
    let mm;
    while ((mm = re2.exec(sec[1]))) out.push(mm[2] + ext);
    return out;
  }

  const bgmNames = namesOf('bgmFiles', bgmExt);
  const sfxNames = namesOf('sfxFiles', sfxExt);
  const wantedAudio = [...new Set([...bgmNames, ...sfxNames])];
  audioDeclared = wantedAudio.length;

  fs.mkdirSync(AUDIO_DST, { recursive: true });
  for (const f of wantedAudio) {
    const src2 = path.join(AUDIO_SRC, f);
    const dst2 = path.join(AUDIO_DST, f);
    if (!fs.existsSync(src2)) { audioMissing.push(f); continue; }
    const sz = fs.statSync(src2).size;
    // 【v1.170】**不能用"文件大小相同"判定已同步** —— 这是本轮抓到的"陈旧检测看不见内容变化"坑：
    //   重渲 SFX 后时长/格式不变 → **字节数完全一样**，于是 size 判等成立 → 拷贝被静默跳过，
    //   dist/audio 永远留着旧内容，而构建打印"新拷 0 个"看起来一切正常。
    //   → 改为**逐字节比较**（音频总量 ~7MB，一次比较的开销可忽略）。
    //   铁证：本次 19 个 SFX 全部同尺寸重渲，size 判等 18 个被误判为"已最新"。
    if (fs.existsSync(dst2) && fs.readFileSync(dst2).equals(fs.readFileSync(src2))) {
      audioBytes += sz; continue;
    }
    fs.copyFileSync(src2, dst2);
    audioCopied++;
    audioBytes += sz;
  }
}

console.log('=== 分发版构建完成 ===');
console.log('  主包 HTML : ' + (fs.statSync(outHtml).size / 1024 / 1024).toFixed(2) + 'MB  (原内联版 ' +
  (fs.statSync(SRC).size / 1024 / 1024).toFixed(2) + 'MB)');
console.log('  assets/   : ' + keys.length + ' 个文件, ' + (totalBytes / 1024).toFixed(0) + 'KB');
if (audioDeclared) {
  console.log('  audio/    : ' + audioDeclared + ' 个声明, 新拷 ' + audioCopied +
    ' 个, ' + (audioBytes / 1024 / 1024).toFixed(2) + 'MB（外采音频随包分发）');
  if (audioMissing.length) {
    console.log('  ⚠ 音频缺失 ' + audioMissing.length + ' 个（运行时回退程序化）: ' + audioMissing.join(', '));
  }
}
console.log('  部署方式  : 把 assets/ 与 audio/ 整个上传到 CDN(或微信云存储), 主包 HTML 单文件上线');
console.log('             若走 CDN, 把 HTML 里 "assets/" 前缀替换为 CDN 域名即可');

const outTotal = fs.readdirSync(OUT).reduce(function (a, f) {
  const p = path.join(OUT, f);
  return a + (fs.statSync(p).isDirectory() ? 0 : fs.statSync(p).size);
}, 0) + audioBytes;
console.log('  分发总积   : ' + (outTotal / 1024 / 1024).toFixed(2) + 'MB');

if (audioMissing.length) process.exit(2);
