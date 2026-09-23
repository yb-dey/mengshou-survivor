// build-minigame.mjs — 从 dist 外包形态生成小游戏代码包（母版始终是唯一真源）
//
// 为什么用 dist 而不是内联母版（这是实测数据，不是选择偏好）：
//   内联母版 game/萌兽消消岛.html = **4.39 MB**，美术以 base64 内嵌 → **单独就超过主包 4MB 硬线**。
//   dist 形态把 178 张美术外置成 assets/*.webp → 只按字节算，脚本 1.79 MB + 美术 1.99 MB。
//
// ── 【第 52 轮】分包：把 assets/ 移出主包 ────────────────────────────────────
// 官方《分包加载》口径（2026-09 抓取，逐条引用）：
//   https://developers.weixin.qq.com/minigame/dev/guide/base-ability/subPackage/useSubPackage.html
//     · 整个小游戏所有主包+分包大小不超过 **30M**
//     · 主包不超过 **4M**
//     · 单个普通分包 **不限制大小**
//     · 单个独立分包不超过 4M
//   配置：game.json 的 `subpackages: [{name, root}]`；「没有配置在 subpackages 中的目录和 js，
//   将会被打包到主包中」⇒ 声明即分出，**不需要**额外的构建步骤。
//   ⚠ 旧资料中的「总包 20M（开通虚拟支付后 30M）」是**过时口径**，官方现文档写 30M，别按 20M 自缚。
//
// 为什么必须分：分包前主包 = 1.79 + 1.99 = **3.76 / 4.00 MB（94%）** —— 平台线是**悬崖**，
//   下一批美术进来就直接传不上去。分包后主包 **1.79 MB（45%）**，余量 2.2 MB。
//   本脚本因此多了一条**政策线**：主包余量必须 ≥ 1.00 MB（平台线 4M 之外的自我约束）。
//
// 它产出什么：
//   game.bundle.js  ← dist HTML 里唯一那个 <script> 块（游戏脚本，一字不改）
//   assets/         ← 178 张 .webp（dist/assets 全量）；已在 game.json 里声明为分包
//
// 判据（硬）：
//   ① game.bundle.js 里**不得残留 data:image**（残留 = 美术还是内嵌的，主包必超线）；
//   ② 主包 ≤ 4M；③ 主包余量 ≥ 1M（政策线）；④ 总包 ≤ 30M；⑤ 声明了的分包目录必须存在且非空。
//
// 用法:
//   node build-minigame.mjs            # 构建 + 体积闸门
//   node build-minigame.mjs --selftest # 阴性对照：6 个构造用例 + 真跑一遍内联母版，全对才退出 0

import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// 【第 55 轮】仓库位置**自动识别**：本工程现在同时存在于两处 ——
//   仓库内 `mengshou-survivor/minigame/`（权威源，云端 CI 跑它）与工作区 `小游戏移植/`（本地副本）。
//   两种布局下 dist/ 与 game/ 的相对位置不同 ⇒ 按"哪个目录里有 dist/萌兽消消岛.html"来选，避免写死路径。
const REPO = [join(HERE, '..'), join(HERE, '..', 'mengshou-survivor')]
  .find((d) => existsSync(join(d, 'dist', '萌兽消消岛.html')) || existsSync(join(d, 'game', '萌兽消消岛.html')))
  || join(HERE, '..', 'mengshou-survivor')
const SELFTEST = process.argv.includes('--selftest')
const MAIN_LIMIT = 4 * 1024 * 1024        // 平台线：主包 ≤ 4M
const TOTAL_LIMIT = 30 * 1024 * 1024      // 平台线：主包+分包 ≤ 30M
const HEADROOM_MIN = 1 * 1024 * 1024      // 政策线：主包余量 ≥ 1M（不是平台要求，是本项目的自我约束）
const mb = (b) => (b / 1048576).toFixed(2) + ' MB'

// ── 判据本体（纯函数，便于逐例对照）─────────────────────────────────────────
export function evaluateSizes(inp) {
  const fails = []
  if (inp.inlineArt > 0) fails.push(`脚本里残留内嵌美术 ${inp.inlineArt} 处 —— 必须用 dist 外包形态，否则主包必超线`)
  if (inp.mainBytes > MAIN_LIMIT) fails.push(`主包 ${mb(inp.mainBytes)} 超过平台硬线 ${mb(MAIN_LIMIT)}`)
  if (inp.totalBytes > TOTAL_LIMIT) fails.push(`总包 ${mb(inp.totalBytes)} 超过平台硬线 ${mb(TOTAL_LIMIT)}`)
  const headroom = MAIN_LIMIT - inp.mainBytes
  if (headroom < HEADROOM_MIN) {
    fails.push(`主包余量 ${mb(headroom)} < 政策线 ${mb(HEADROOM_MIN)}` +
      (inp.subs.length ? '' : '（assets/ 没有声明为分包时，1.99 MB 美术会全部算进主包）'))
  }
  for (const s of inp.subs) {
    if (!s.files) fails.push(`分包 ${s.name}（root=${s.root}）目录不存在或为空 —— 声明了却分不出去`)
  }
  return fails
}

if (SELFTEST) {
  const MB = 1048576
  const subOk = [{ name: 'assets', root: 'assets/', files: 178, bytes: 1.99 * MB }]
  const CASES = [
    { n: '① 内联母版（美术内嵌）', inp: { inlineArt: 3, mainBytes: 4.6 * MB, totalBytes: 4.6 * MB, subs: [] }, want: 'FAIL' },
    { n: '② 未分包：assets 计在主包', inp: { inlineArt: 0, mainBytes: 1.79 * MB + 1.99 * MB, totalBytes: 3.78 * MB, subs: [] }, want: 'FAIL' },
    { n: '③ 已分包（当前形态）', inp: { inlineArt: 0, mainBytes: 1.79 * MB, totalBytes: 3.78 * MB, subs: subOk }, want: 'PASS' },
    { n: '④ 声明了分包但目录是空的', inp: { inlineArt: 0, mainBytes: 1.79 * MB, totalBytes: 1.79 * MB, subs: [{ name: 'assets', root: 'assets/', files: 0, bytes: 0 }] }, want: 'FAIL' },
    { n: '⑤ 主包超 4M 硬线', inp: { inlineArt: 0, mainBytes: 4.2 * MB, totalBytes: 4.2 * MB, subs: [] }, want: 'FAIL' },
    { n: '⑥ 总包超 30M 硬线', inp: { inlineArt: 0, mainBytes: 2 * MB, totalBytes: 31 * MB, subs: subOk }, want: 'FAIL' },
  ]
  let bad = 0
  console.log('【阴性/阳性对照】evaluateSizes 逐例核对：\n')
  for (const c of CASES) {
    const f = evaluateSizes(c.inp)
    const got = f.length ? 'FAIL' : 'PASS'
    const hit = got === c.want
    if (!hit) bad++
    console.log(`  ${hit ? '✅' : '✘'} ${c.n}：期望 ${c.want} / 实际 ${got}${f.length ? ' —— ' + f[0] : ''}`)
  }
  console.log(`\n  判据自测：${CASES.length - bad}/${CASES.length} 例符合预期`)
  if (bad) { console.log('✘ 判据失效 —— 它给的是假保证'); process.exit(1) }
  console.log('\n（下面再用**真实输入**跑一遍：内联母版必须被拦下）\n')
}

// 阴性对照时故意换成内联母版（含 base64）—— 判据必须能把它拦下
const SRC = SELFTEST
  ? join(REPO, 'game', '萌兽消消岛.html')
  : join(REPO, 'dist', '萌兽消消岛.html')
const ASSET_SRC = join(REPO, 'dist', 'assets')

const html = readFileSync(SRC, 'utf8')
const m = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(html)
if (!m) { console.error(`❌ ${SRC} 里找不到 <script> 块`); process.exit(1) }
const script = m[1]

const inlineArt = (script.match(/data:image\//g) || []).length
console.log(`源：${SRC.replace(REPO, 'mengshou-survivor')}`)
console.log(`  脚本 ${script.length} 字符；内嵌 data:image ${inlineArt} 处`)

if (!SELFTEST) {
  writeFileSync(join(HERE, 'game.bundle.js'), script, 'utf8')
  mkdirSync(join(HERE, 'assets'), { recursive: true })
  let n = 0
  for (const f of readdirSync(ASSET_SRC)) {
    copyFileSync(join(ASSET_SRC, f), join(HERE, 'assets', f))
    n++
  }
  console.log(`  已写出 game.bundle.js 与 assets/（${n} 个文件）`)
}

// ── 体积口径：主包 = 目录下所有文件 **减去** 已声明的分包目录 ────────────────
//   口径依据：官方「没有配置在 subpackages 中的目录和 js，将会被打包到主包中」。
//   ⇒ 不猜、不硬编码：直接读 game.json 的 subpackages 决定谁算主包。
const gjsonPath = join(HERE, 'game.json')
const gjson = JSON.parse(readFileSync(gjsonPath, 'utf8'))
const declared = Array.isArray(gjson.subpackages) ? gjson.subpackages : (Array.isArray(gjson.subPackages) ? gjson.subPackages : [])

function walk(absDir) {
  const out = []
  for (const f of readdirSync(absDir)) {
    const abs = join(absDir, f)
    const st = statSync(abs)
    if (st.isDirectory()) out.push(...walk(abs))
    else out.push({ rel: relative(HERE, abs).split(sep).join('/'), size: st.size })
  }
  return out
}
const allFiles = SELFTEST ? [] : walk(HERE)
const subs = declared.map((d) => {
  const root = String(d.root || '').replace(/\/$/, '')
  const dir = join(HERE, root)
  const exist = existsSync(dir) && statSync(dir).isDirectory()
  const files = exist && !SELFTEST ? walk(dir).length : 0
  const bytes = exist && !SELFTEST ? walk(dir).reduce((s, x) => s + x.size, 0) : 0
  return { name: d.name, root: root + '/', files, bytes }
})
const inSub = (rel) => subs.some((s) => rel === s.root.slice(0, -1) || rel.startsWith(s.root))
const mainFiles = allFiles.filter((f) => !inSub(f.rel))
const mainBytes = SELFTEST ? 0 : mainFiles.reduce((s, f) => s + f.size, 0)
const totalBytes = mainBytes + subs.reduce((s, x) => s + x.bytes, 0)

// 杂散文件（既不是代码也不是声明目录）——只报不拦，但要在报告里可见
const CODE = new Set(['game.js', 'adapter.js', 'game.bundle.js', 'game.json', 'project.config.json', 'project.private.config.json'])
const stray = mainFiles.filter((f) => !CODE.has(f.rel))

console.log('\n分包声明（game.json → subpackages）：')
if (!subs.length) console.log('  （无）—— 全部算主包')
for (const s of subs) console.log(`  ${s.name.padEnd(8)} root=${s.root.padEnd(9)} ${s.files} 个文件 / ${mb(s.bytes)}`)
if (stray.length) {
  const strayBytes = stray.reduce((s, f) => s + f.size, 0)
  console.log(`  ⚠ 主包内杂散文件 ${stray.length} 个 / ${mb(strayBytes)}：${stray.map((f) => f.rel).slice(0, 6).join(', ')}${stray.length > 6 ? ' …' : ''}`)
}
// 本脚本按**目录实字节**算主包（保守：宁可多算）；devtools 上传时还会按 project.config.json 的
//   packOptions.ignore 剔掉开发件 ⇒ 再报一个"实际上传"的估算值，避免两个口径打架。
const pcPath = join(HERE, 'project.config.json')
let ignoredBytes = 0
try {
  const pc = JSON.parse(readFileSync(pcPath, 'utf8'))
  const ig = new Set((((pc.packOptions || {}).ignore) || []).filter((x) => x && x.type === 'file').map((x) => String(x.value)))
  ignoredBytes = stray.filter((f) => ig.has(f.rel)).reduce((s, f) => s + f.size, 0)
} catch (e) { console.log('  ⚠ 读不到 project.config.json 的 packOptions.ignore：' + (e && e.message)) }
console.log(`\n主包 ${mb(mainBytes)} / 平台线 ${mb(MAIN_LIMIT)}（余量 ${mb(MAIN_LIMIT - mainBytes)}，政策线 ${mb(HEADROOM_MIN)}）`)
if (ignoredBytes) console.log(`  └ 其中 ${mb(ignoredBytes)} 是 packOptions.ignore 里的开发件 ⇒ devtools 实际上传 ≈ ${mb(mainBytes - ignoredBytes)}`)
console.log(`总包 ${mb(totalBytes)} / 平台线 ${mb(TOTAL_LIMIT)}（余量 ${mb(TOTAL_LIMIT - totalBytes)}）`)

const fails = evaluateSizes({ inlineArt, mainBytes, totalBytes, subs })

if (SELFTEST) {
  const caught = fails.length > 0
  console.log(`\n【真实输入对照】期望被拦下；实际：${caught ? '✅ 已拦下' : '❌ 没拦下'}`)
  for (const f of fails) console.log('   - ' + f)
  console.log(caught ? '✔ 判据有效（内联母版确实会被判超线）' : '✘ 判据失效 —— 它给的是假保证')
  process.exit(caught ? 0 : 1)
}
if (fails.length) {
  console.log('\n❌ 体积闸门未过：')
  for (const f of fails) console.log('   - ' + f)
  process.exit(1)
}
console.log('\n✅ 体积闸门通过（主包只装代码，美术走 assets 分包；无需网络域名）')
