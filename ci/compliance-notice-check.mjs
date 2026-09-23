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
console.log('')
console.log(`结论：强制项缺 ${failN} 项，提示项缺 ${warnN} 项`)
if (failN > 0) {
  console.log('')
  console.log('⚠ 这些是**备案/上架强制项**，缺失会卡审核。修法见 内容分部审查.md 的 D3 节。')
  process.exit(1)
}
process.exit(0)
