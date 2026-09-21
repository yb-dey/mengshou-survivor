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

const SRC = process.argv[2] || 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou/game/萌兽消消岛.html';
const OUT = process.argv[3] || 'D:/新建文件夹/方向3/dist';
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

console.log('=== 分发版构建完成 ===');
console.log('  主包 HTML : ' + (fs.statSync(outHtml).size / 1024 / 1024).toFixed(2) + 'MB  (原内联版 ' +
  (fs.statSync(SRC).size / 1024 / 1024).toFixed(2) + 'MB)');
console.log('  assets/   : ' + keys.length + ' 个文件, ' + (totalBytes / 1024).toFixed(0) + 'KB');
console.log('  部署方式  : 把 assets/ 整个上传到 CDN(或微信云存储), 主包 HTML 单文件上线');
console.log('             若走 CDN, 把 HTML 里 "assets/" 前缀替换为 CDN 域名即可');
