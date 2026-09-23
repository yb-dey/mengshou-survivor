#!/usr/bin/env node
/**
 * compliance-notice-check.mjs —— 合规标识门禁（备案/上架强制项）
 *
 * 为什么需要：
 *   2026-09-23 实测发现，游戏里 **《健康游戏忠告》出现 0 次**。
 *   而这是**跨平台一致的强制要求**，不是可选项：
 *     · 新闻出版总署 2003《关于在游戏出版物中登载〈健康游戏忠告〉的通知》：
 *       "必须在画面的显著位置全文登载"；地方新闻出版管理部门在**游戏备案**管理时明确要求
 *       "经过备案的游戏上线时，应在游戏开始画面的显著位置全文登载《健康游戏忠告》，
 *        并标明适龄提示及备案编号"。
 *     · 微信小游戏《运营规范》三、小游戏特别规范 · 2. 游戏内容规范 2.6.2 同款要求。
 *     · 抖音开放平台《小游戏自审标准》、支付宝《小游戏行业管理规范》、
 *       快手小程序《内容规范》均逐字列出同一条（含标题与全文）。
 *   → 缺这一条会直接卡审核。用脚本钉住，避免改着改着又没了。
 *
 * 判据：**逐句**核对，而不是"出现过关键词就算"。缺哪句报哪句。
 *   ⚠ 源码里这些文案可能被换行拆开（实测 `"部分内容由 AI 生成 ·\n适龄提示 8+"`），
 *     所以比对前先把空白全部去掉再匹配 —— 否则会漏报。
 *
 * 用法:
 *   node compliance-notice-check.mjs [html路径]      # 默认 game/ 下的母版
 *   node compliance-notice-check.mjs --selftest      # 阴性对照：造齐 → PASS，抽掉一句 → FAIL
 *
 * 【第 59 轮】新增**可读性判据**：光有文字不算数 —— 强制公告要"看得清"。
 *   实测教训：原实现正文 11px + alpha 0.42 压在底栏上，WCAG 对比度只有 **3.8:1**（AA 小字下限 4.5:1），
 *   11px 逻辑在 390pt 手机上 ≈ **6.0pt** 物理 ⇒ 条文"在"，但人眼读不出来。
 *   判据：正文/标题字号 ≥12px 且对比度 ≥4.5:1；并内建 3 条对照（含**旧值必须 FAIL**）。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// 《健康游戏忠告》全文（新闻出版总署标准文本，四个分句）
const ZHONGGao = [
  '抵制不良游戏，拒绝盗版游戏。',
  '注意自我保护，谨防受骗上当。',
  '适度游戏益脑，沉迷游戏伤身。',
  '合理安排时间，享受健康生活。',
]

const CHECKS = [
  { id: '忠告标题', need: ['健康游戏忠告'], level: 'fail' },
  { id: '忠告正文', need: ZHONGGao, level: 'fail' },
  { id: '适龄提示', need: ['适龄提示'], level: 'fail' },
  { id: 'AI生成标识', need: ['AI 生成'], level: 'warn' },
  { id: '备案编号位', need: ['备案号', '备案编号'], anyOf: true, level: 'warn' },
]

const strip = (s) => s.replace(/\s+/g, '')

function check(html) {
  const flat = strip(html)
  return CHECKS.map((c) => {
    const hit = c.anyOf
      ? c.need.some((n) => flat.includes(strip(n)))
      : c.need.every((n) => flat.includes(strip(n)))
    const missing = c.anyOf
      ? (hit ? [] : c.need)
      : c.need.filter((n) => !flat.includes(strip(n)))
    return { ...c, hit, missing }
  })
}

function report(rows, label) {
  console.log(`# 合规标识检查 —— ${label}`)
  console.log('')
  let failN = 0
  let warnN = 0
  for (const r of rows) {
    const mark = r.hit ? '✅' : (r.level === 'fail' ? '❌' : '⚠️ ')
    if (!r.hit && r.level === 'fail') failN++
    if (!r.hit && r.level === 'warn') warnN++
    console.log(`- ${mark} ${r.id}` + (r.hit ? '' : `  ← 缺：${r.missing.join(' / ')}`))
  }
  return { failN, warnN }
}

// ── 阴性对照 ───────────────────────────────────────────────────────────────
if (process.argv.includes('--selftest')) {
  const full = 'ctx.fillText("健康游戏忠告");' +
    ZHONGGao.map((s) => `ctx.fillText("${s}");`).join('') +
    'ctx.fillText("部分内容由 AI 生成 · 适龄提示 8+"); ctx.fillText("备案号：粤ICP备00000000号");'
  const r1 = check(full)
  const { failN: f1 } = report(r1, '合成【完整】样本（应全绿）')
  // 抽掉第三句 —— 必须报出来，且必须精确定位到缺的那一句
  const broken = full.replace(ZHONGGao[2], '')
  const r2 = check(broken)
  const { failN: f2 } = report(r2, '合成【抽掉第 3 句】样本（应报缺该句）')
  const located = r2.find((r) => r.id === '忠告正文')
  const pass = f1 === 0 && f2 === 1 && located && located.missing.length === 1 && located.missing[0] === ZHONGGao[2]
  console.log('')
  console.log(pass
    ? '  ✔ 判据有效（完整样本全绿；抽掉任一句都能定位到具体那一句）'
    : '  ✘ 判据失效 —— 不得上岗')
  process.exit(pass ? 0 : 1)
}

// ── 可读性判据（第 59 轮）────────────────────────────────────────────────────
//   从**渲染代码**里读字号与颜色，算 WCAG 对比度 —— 只验"文字在不在"会放过"看不清"。
//   底栏是 rgba(12,16,12,0.94)：最坏情形（压在最亮的场景上）合成后约 (27,31,27)，本判据按此取保守值。
const BAR = [12 * 0.94 + 255 * 0.06, 16 * 0.94 + 255 * 0.06, 12 * 0.94 + 255 * 0.06]
const srgb = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
const lum = (rgb) => 0.2126 * srgb(rgb[0]) + 0.7152 * srgb(rgb[1]) + 0.0722 * srgb(rgb[2])
function contrastOver(textRGB, alpha, bg) {
  const mixed = [0, 1, 2].map((i) => textRGB[i] * alpha + bg[i] * (1 - alpha))
  const a = lum(mixed), b = lum(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
// 从一段渲染代码里抽出「字号」与「rgba 透明度」
function parseStyle(block) {
  const fonts = [...block.matchAll(/ctx\.font = "(?:bold )?(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]))
  const alphas = [...block.matchAll(/rgba\(255,247,224,([0-9.]+)\)/g)].map((m) => Number(m[1]))
  return { fonts, alphas }
}
// 判据：正文/标题都 ≥12px 且 ≥4.5:1
function legibilityFails(fonts, alphas) {
  const out = []
  if (!fonts.length || !alphas.length) { out.push("抽不到字号/颜色 —— 判据无法成立"); return out }
  const minPx = Math.min(...fonts)
  const minAlpha = Math.min(...alphas)
  const cr = contrastOver([255, 247, 224], minAlpha, BAR)
  if (minPx < 12) out.push(`最小字号 ${minPx}px < 12px`)
  if (cr < 4.5) out.push(`对比度 ${cr.toFixed(2)}:1 < 4.5:1（WCAG AA 小字下限）`)
  return out
}
// 内建对照（每次都跑）：旧值必须 FAIL —— 否则这条判据就是恒绿的假保证
const LEGIBILITY_CASES = [
  { n: "旧值 11px/0.42 + 12px/0.55（修复前）", fonts: [12, 11], alphas: [0.55, 0.42], want: "FAIL" },
  { n: "当前 13px/0.72 + 12px/0.62", fonts: [13, 12], alphas: [0.72, 0.62], want: "PASS" },
  { n: "更小更淡 9px/0.30", fonts: [9], alphas: [0.3], want: "FAIL" },
  { n: "够大但太淡 13px/0.35", fonts: [13], alphas: [0.35], want: "FAIL" },
]
function runLegibilityCase() {
  let bad = 0
  console.log("")
  console.log("## 可读性判据自证（含**旧值必须 FAIL**）")
  for (const k of LEGIBILITY_CASES) {
    const f = legibilityFails(k.fonts, k.alphas)
    const got = f.length ? "FAIL" : "PASS"
    const ok = got === k.want
    if (!ok) bad++
    console.log(`- ${ok ? "✅" : "✘"} ${k.n}：期望 ${k.want} / 实际 ${got}${f.length ? " —— " + f.join("；") : ""}`)
  }
  return bad
}
// ── 主流程 ─────────────────────────────────────────────────────────────────
const arg = process.argv.slice(2).find((a) => !a.startsWith('--'))
let target = arg
if (!target) {
  const gameDir = 'game'
  const html = readdirSync(gameDir).find((f) => f.toLowerCase().endsWith('.html'))
  target = join(gameDir, html)
}
const html = readFileSync(target, 'utf8')
const { failN, warnN } = report(check(html), target)
// 【第 59 轮】可读性：先从真实源码里截出忠告块（`if (CONFIG.complianceNotice !== false) {` … `ctx.font = _pFont`）
const noticeBlock = (() => {
  const i = html.indexOf('CONFIG.complianceNotice !== false')
  if (i < 0) return ''
  const j = html.indexOf('ctx.font = _pFont', i)
  return j > i ? html.slice(i, j) : html.slice(i, i + 1200)
})()
const st = parseStyle(noticeBlock)
const legFails = legibilityFails(st.fonts, st.alphas)
const caseBad = runLegibilityCase()
console.log('')
console.log(`真实源码：字号 [${st.fonts.join(', ')}] · 透明度 [${st.alphas.join(', ')}] · 对比度(最淡那条) ${st.alphas.length ? contrastOver([255, 247, 224], Math.min(...st.alphas), BAR).toFixed(2) : '?'}:1`)
console.log(legFails.length ? `❌ 可读性未过：${legFails.join('；')}` : '✅ 可读性通过（字号 ≥12px 且对比度 ≥4.5:1）')
console.log('')
console.log(`结论：强制项缺 ${failN} 项，提示项缺 ${warnN} 项`)
if (failN > 0) {
  console.log('')
  console.log('⚠ 这些是**备案/上架强制项**，缺失会卡审核。修法见 内容分部审查.md 的 D3 节。')
  process.exit(1)
}
if (caseBad > 0) { console.log(`✘ 可读性判据自证失败 ${caseBad} 例 —— 判据不可信，不得上岗`); process.exit(1) }
if (legFails.length) { console.log('⚠ 强制公告"在但看不清" = 等同于没有；修法见本轮工作日志（v1.202）。'); process.exit(1) }
process.exit(0)
