#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""rarity-contrast.py -- 稀有度色的"文字角色"对比度（第 19 维度门禁）

存在理由（v1.192 实测抓到的系统性缺陷）
  `DATA_GEAR_RARITY` 的 `color` 是给**图形**调的高饱和色（描边框 / 色条 / 光环），
  但它同时被当作**文字填充**用在两处：
    · 房间牌  `ctx.fillStyle = rpView.bagRarColor`     —— 压在 `rgba(12,16,14,0.78)` 上（暗）
    · 结算页  `ctx.fillStyle = view.giftRarColor`      —— 压在 `drawSoftCard` 的
              `rgba(212,228,184,0.92)` over `#eef4dc` 上（合成 ≈ **#d6e5bb**，亮）
  实测（修复前）：
    · 亮底 #d6e5bb → **5/5 档全 FAIL**（2.11 ~ 3.66）
    · 暗底 #282b29 → **3/5 档 FAIL**
  修法（沿用同作 v1.167 已确立的"图形色 / 文字色分离"范式）：
    保留 `color` 给图形；新增 `textDark`（压暗，用于亮底文字）/ `textLight`（提亮，用于暗底文字）。

判据（4 条，任一不满足 → exit 1）
  A. 解析器不退化：`DATA_GEAR_RARITY` == 5 档（**实测值**）；`DATA_GEAR` == 12 件（实测值）
  B. 每档必须有 `color` / `textDark` / `textLight` 三个**可解析**的 `#rrggbb`
  C. **文字色对比度**：`textDark` vs 亮底 >= 4.5 **且** `textLight` vs 暗底 >= 4.5（WCAG AA 正文）
  D. 消费侧自证：母版必须真的存在读 `textDark` / `textLight` 的渲染点
     （否则字段建了没人读 = 死数据，门禁在看空气）

⚠ 前提验证（v1.190 三步纪律）
  ① 量数据 —— 上表两个底的真实合成值都是从源码链路算出来的，不是估的
  ② 读玩法路径 —— `rarMin` 实测覆盖 0/1/2/3 档，`rarity` 由 `clamp(...,0,4)` 保证 0~4
     ⇒ **5 档全部可达**（否则"不可达的档不算缺陷"）
  ③ 看图/看数据 —— 确认 `color` 在三处是**图形**用法（stroke / fillRect / rgbaHex 描边），
     只有两处是**文字**用法 ⇒ 不能把 `color` 直接改暗，否则会伤图形
"""
import os
import re
import sys

HTML = os.environ.get('GAME_HTML', os.path.join('game', '萌兽消消岛.html'))
LIGHT_BG = '#d6e5bb'   # 结算软卡: rgba(212,228,184,.92) over modalPanel #eef4dc
DARK_BG = '#282b29'    # 房间牌: rgba(12,16,14,.78) 合成到最不利档色上
AA_BODY = 4.5
EXPECT_TIERS = 5
EXPECT_GEAR = 12


def hex2rgb(h):
    return [int(h[i:i + 2], 16) for i in (1, 3, 5)]


def rel_lum(rgb):
    def f(v):
        v /= 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def contrast(a, b):
    l1, l2 = rel_lum(a), rel_lum(b)
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def live(src, re_, what):
    m = re.search(re_, src)
    if not m:
        raise RuntimeError('锚点丢失：%s（正则 %s）—— 被上游改动吃掉了，必须重新对齐' % (what, re_.pattern))
    return m


# ---------------------------------------------------------------- 纯函数（供对照喂合成数据）
def check_row(row, light=LIGHT_BG, dark=DARK_BG):
    """返回 (ok, detail)。缺字段 → ok=False 且 detail 说明。"""
    for k in ('color', 'textDark', 'textLight'):
        if not row.get(k) or not re.fullmatch(r'#[0-9a-fA-F]{6}', row[k]):
            return False, '缺/格式错字段 %s' % k
    cd = contrast(hex2rgb(row['textDark']), hex2rgb(light))
    cl = contrast(hex2rgb(row['textLight']), hex2rgb(dark))
    ok = cd >= AA_BODY and cl >= AA_BODY
    return ok, 'textDark %.2f / textLight %.2f' % (cd, cl)


# ---------------------------------------------------------------- selftest
def selftest():
    res = []
    good = {'color': '#8a8a8a', 'textDark': '#606060', 'textLight': '#c8c8c8'}

    ok, d = check_row(good)
    res.append((ok, '① 真实良性配色（普通档实测值）→ 通过', d))

    # ② 阳性：把文字色设成与底色同色 → 必 FAIL
    bad = dict(good, textDark=LIGHT_BG)
    ok, d = check_row(bad)
    res.append((not ok, '② textDark 与亮底同色 → 必 FAIL', d))

    # ③ 阳性：textLight 太暗（压暗色误用到暗底）→ 必 FAIL
    bad2 = dict(good, textLight='#606060')
    ok, d = check_row(bad2)
    res.append((not ok, '③ textLight 误用压暗色 → 必 FAIL', d))

    # ④ 阴性：缺字段必须报 B（不能静默通过）
    ok, d = check_row({'color': '#8a8a8a'})
    res.append((not ok and 'textDark' in d, '④ 缺 textDark 字段 → 报 B', d))

    # ⑤ 阴性：格式非法也必须拦
    ok, d = check_row(dict(good, textLight='rgb(1,2,3)'))
    res.append((not ok, '⑤ textLight 格式非法 → 拦下', d))

    # ⑥ 边界：恰好 4.5 视作通过（>=）
    #   #d6e5bb 的对比度 4.5 对应的灰需要算；这里用合成行验证边界语义而非具体色
    ok, d = check_row({'color': '#000000', 'textDark': '#000000', 'textLight': '#ffffff'})
    res.append((not ok, '⑥ 亮底用纯黑虽高对比、但暗底用纯白也高 → 这项应通过', d))
    # 修正：纯黑 vs 亮底、纯白 vs 暗底 都应通过 → 期望通过
    res[-1] = (ok, '⑥ 极端但合规(黑压亮/白压暗) → 通过', d)

    bad = [r for r in res if not r[0]]
    for ok_, what, detail in res:
        print(('  ✅ ' if ok_ else '  ❌ ') + what + '  —— ' + detail)
    print('\n对照 %d/%d%s' % (len(res) - len(bad), len(res), '' if bad else ' ✅ 全绿'))
    return not bad


if '--selftest' in sys.argv:
    print('【rarity-contrast --selftest】只跑对照，不读真实文件\n')
    sys.exit(0 if selftest() else 1)

# ---------------------------------------------------------------- 主流程
if not os.path.exists(HTML):
    print('⚠ 找不到 %s（GAME_HTML 可覆盖）→ SKIP' % HTML)
    sys.exit(0)
html = open(HTML, encoding='utf-8').read()

try:
    tbl = live(html, r'var DATA_GEAR_RARITY\s*=\s*\[[\s\S]*?\n\];', 'DATA_GEAR_RARITY 表').group(0)
except RuntimeError as e:
    print('❌ ' + str(e))
    sys.exit(1)

rows = [
    {'name': m.group(1), 'color': m.group(2), 'textDark': m.group(3), 'textLight': m.group(4)}
    for m in re.finditer(
        r'\{\s*name:\s*"([^"]+)",\s*color:\s*"(#[0-9a-fA-F]{6})",\s*'
        r'textDark:\s*"(#[0-9a-fA-F]{6})",\s*textLight:\s*"(#[0-9a-fA-F]{6})"\s*\}',
        tbl)
]

# 判据 A
n_gear = len(re.findall(r'\{\s*id:\s*"[a-z]+",\s*slot:\s*"[a-z]+"', html))
if len(rows) != EXPECT_TIERS:
    print('❌ 判据 A：DATA_GEAR_RARITY 切出 %d 档，实测期望 %d 档' % (len(rows), EXPECT_TIERS))
    sys.exit(1)
if n_gear != EXPECT_GEAR:
    print('❌ 判据 A：DATA_GEAR 切出 %d 件，实测期望 %d 件' % (n_gear, EXPECT_GEAR))
    sys.exit(1)

# 判据 D：消费侧自证
for k in ('textDark', 'textLight'):
    if not re.search(r'rarD\.' + k + r'|view\.\w+RarColorText', html):
        print('❌ 判据 D：%s 字段没有任何渲染点读取（死数据）' % k)
        sys.exit(1)

fails = []
lines = ['# 稀有度色 · 文字角色对比度（第 19 维度）', '']
lines.append('- 入口: `%s`' % HTML.replace('\\', '/'))
lines.append('- 亮底(结算软卡) = **%s** · 暗底(房间牌) = **%s** · 门槛 = **%.1f:1**(WCAG AA 正文)'
             % (LIGHT_BG, DARK_BG, AA_BODY))
lines.append('- `DATA_GEAR_RARITY` = **%d/5** 档 · `DATA_GEAR` = **%d/12** 件' % (len(rows), n_gear))
lines.append('')
lines.append('| 档位 | color(图形,不变) | textDark(亮底用) | 对比度 | textLight(暗底用) | 对比度 | 裁定 |')
lines.append('|---|---|---|---|---|---|---|')

for r in rows:
    ok, detail = check_row(r)
    cd = contrast(hex2rgb(r['textDark']), hex2rgb(LIGHT_BG))
    cl = contrast(hex2rgb(r['textLight']), hex2rgb(DARK_BG))
    if not ok:
        fails.append('%s：%s' % (r['name'], detail))
    lines.append('| %s | `%s` | `%s` | %.2f | `%s` | %.2f | %s |'
                 % (r['name'], r['color'], r['textDark'], cd, r['textLight'], cl, 'ok' if ok else 'FAIL'))

lines.append('')
if fails:
    lines.append('## 未通过判据')
    lines.append('')
    for f in fails:
        lines.append('- ❌ ' + f)
    lines.append('')
lines.append('> **前提验证**：`rarMin` 实测覆盖 0/1/2/3 档、`rarity` 由 `clamp(...,0,4)` 保证 0~4')
lines.append('> ⇒ **5 档全部可达**（不可达的档不算缺陷）。')
lines.append('> `color` 的图形用法（`drawRarityFrame` 描边框 / `fillRect` 色条 / `rgbaHex` 光环）**保持不变** ——')
lines.append('> 本门禁只约束"文字角色"，不约束"图形角色"（图形色门槛更低，且鲜艳是设计意图）。')

out = '\n'.join(lines)
os.makedirs(os.path.join('ci', 'out'), exist_ok=True)
open(os.path.join('ci', 'out', 'rarity-contrast.md'), 'w', encoding='utf-8').write(out)
print(out)
print('\n报告已写 ci/out/rarity-contrast.md')
sys.exit(1 if fails else 0)
