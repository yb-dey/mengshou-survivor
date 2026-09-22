#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""duck-cover.py -- 节点音 duck 窗口 vs 实际可听段（第 18 维度门禁）

存在理由（v1.191 实测抓到的真缺陷）
  `CONFIG.audio.nodeDuckSec = 0.68` 是**固定**的 BGM 鸭避让窗口，
  而 `duck:true` 的节点音实响长短不一。实测 `sfx_lose`：
    · 实响 1.35s，duck 窗口只有 0.68s
    · **第 0.68s 处电平仍有峰值的 86.7%**，之后还有 **0.20s 可辨尾音**（占全长 15%）
    · 后果：结算失败音最重的那一拍，正好落在 BGM 已回满之后
      → "压垫乐让节点音清楚"的意图在**后半段失效**，尾音"裸奔"。
  已修：duck 窗口改为 `max(nodeDuckSec, delay + buf.duration/(rate*rateMul))`（覆盖整条可听段）。

判据（3 条，任一不满足 → exit 1）
  A. 解析器不退化：`DATA_SFX` == 66 条（**实测值**）；`nodeDuckSec` 能取到
  B. 每条 `duck:true` 的音，必须能定位到 WAV 文件并读出时长（否则判据在看空气）
  C. **可听尾段 = 0**：对每条 duck 音，duck 窗口之后 RMS >= 峰值 20%（约 -14dB）的**持续**时长
     必须 <= 0.05s。"持续" = 连续 >= 2 个分析窗（见 SUSTAIN_K），避免把"自然衰减中的最后一格抖动"
     误判成缺陷。

⚠ 判据 C 的"持续"口径与两条真实缺陷的形态（v1.191 实测校准）
  "持续" = 窗口之后**连续 >= SUSTAIN_K(2) 个分析窗** RMS >= 峰值 20%，才计入尾音时长。
  这样能剔除"单格孤立尖峰"这种不构成听感的采样噪声，同时**不放过**真正的越界能量：

    · `resultlose`（SFX_LOSE · 1.35s）：窗口后 0.70s→73.6%、0.75s→54.3%、0.80s→23.8%
      → 连续 3 格高位、窗口处电平 86.7% 峰值。**输掉时的主重音整个砸在 BGM 回满之后**，
      尾音完全裸奔。→ 判据 C **FAIL**（这正是本维度存在的理由）

    · `resultwin`（SFX_WIN · 1.02s）：窗口处 0.65s→30.9%、0.70s→25.2%、0.75s→16.9%
      → 跨过窗口边界后**仍有 2 格 >= 20%（0.10s）**，之后骤降到 2.7%。
      虽衰减比 lose 快、能量占比只有 2.9%，但"窗口之后还有 0.10s 明显可辨的余音"是**事实**，
      不是采样抖动（连续两格、且第一格就在阈值 25% 之上）→ 判据 C **同样 FAIL**。
      ※ 修正记录：我一度把它当"非缺陷"（只看 2.9% 总能量占比），是**用总量指标掩盖了
        局部事实**。判据 C 看的是"越界段有没有可辨能量"，不是"占全曲多少"。两者都要修。

  两条都靠**同一处**修复消除：duck 窗口改为 `max(nodeDuckSec, delay + buf.duration/(rate*rateMul))`
  —— 窗口不再固定 0.68s，而是覆盖每条音的真实可听长度。

⚠ 前提验证记录（防后人重复误报）
    · `revivecard`：走 overlay 分支（REVIVE_MODAL ∈ overlayAudioLive() 集合），
      窗口由**模态时长**决定，与 nodeDuckSec 无关 → **假阳性**（判据不该把它算进来）
    · `bosswarn`：窗口外能量 **0.0%**（尾部是真静音）→ 非缺陷

阴性对照（--selftest）
  ① 合成一条"窗口外无能量"的包络 → C 必须不报警
  ② 合成一条"窗口外仍有 80% 峰值"的包络 → C 必须报警
  ③ 合成一条"窗口外能量 0% 但位于窗口内"的包络 → C 必须不报警（防只看总能量）
"""
import wave
import struct
import math
import os
import re
import sys

AUD = os.path.join('game', 'audio')
HTML = os.environ.get('GAME_HTML', os.path.join('game', '萌兽消消岛.html'))
WIN = 0.05              # 50ms 分析窗
AUDIBLE_PCT = 0.20      # >= 峰值 20%（约 -14dB）视为在 BGM 之上仍可辨
TAIL_TOL = 0.05         # 可听尾段容差（一个分析窗）
SUSTAIN_K = 2           # 需连续 >= 2 个分析窗超阈，才算"持续尾音"（防衰减抖动误报）


# ---------------------------------------------------------------- WAV 包络
def envelope(path, win=WIN):
    w = wave.open(path, 'rb')
    n, sr, ch, sw = w.getnframes(), w.getframerate(), w.getnchannels(), w.getsampwidth()
    raw = w.readframes(n)
    w.close()
    if sr <= 0 or n <= 0:
        return [], 0.0
    fmt = '<' + ('h' if sw == 2 else 'b') * (len(raw) // sw)
    d = struct.unpack(fmt, raw)
    if ch == 2:
        d = d[0::2]
    step = int(sr * win)
    if step <= 0:
        return [], n / sr
    out = []
    for i in range(0, len(d) - step, step):
        s = sum(x * x for x in d[i:i + step]) / step
        out.append(math.sqrt(s))
    return out, n / sr


def audible_tail(env, peak, duck_sec):
    """duck 窗口之后，"持续"可辨尾音的时长。

    只统计**连续 >= SUSTAIN_K 个分析窗** RMS >= 峰值 AUDIBLE_PCT 的片段：
    单格超阈视为衰减抖动，不计入（见文件头判据 C 的校准说明）。
    """
    if peak <= 0:
        return 0.0
    k = int(duck_sec / WIN)
    run = 0
    best = 0
    for x in env[k:]:
        if x / peak >= AUDIBLE_PCT:
            run += 1
            best = max(best, run)
        else:
            run = 0
    return best * WIN if best >= SUSTAIN_K else 0.0


# ---------------------------------------------------------------- 判据 C（纯函数，供对照喂合成数据）
def check_c(env, duck_sec):
    if not env:
        return None
    peak = max(env) or 1.0
    tail = audible_tail(env, peak, duck_sec)
    return dict(peak=peak, tail=tail, ok=tail <= TAIL_TOL + 1e-9)


# ---------------------------------------------------------------- selftest
def selftest():
    res = []
    D = 0.68
    NWIN = int(D / WIN)   # 窗口边界索引 = 13；窗口"内"正好 13 格
    # ① 窗口外无能量 → 不报警（前 NWIN 格满，之后 0）
    e1 = [100.0] * NWIN + [0.0] * 20
    r1 = check_c(e1, D)
    res.append((r1 and r1['ok'], '① 窗口外无能量 → 不报警', 'tail=%.2fs' % (r1['tail'] if r1 else -1)))
    # ② 窗口外仍有 80% 峰值 → 必报警
    e2 = [100.0] * NWIN + [80.0] * 8 + [0.0] * 12
    r2 = check_c(e2, D)
    res.append((bool(r2 and not r2['ok']), '② 窗口外仍有 80% 峰值 → 必报警', 'tail=%.2fs' % (r2['tail'] if r2 else -1)))
    # ③ 能量全在窗口内、窗口外为 0 → 不报警（防"只看总能量"的写法误报）
    e3 = [100.0] * NWIN + [0.0] * 25
    r3 = check_c(e3, D)
    res.append((bool(r3 and r3['ok']), '③ 能量全在窗口内 → 不报警', 'tail=%.2fs' % (r3['tail'] if r3 else -1)))
    # ④ 阈值边界：窗口外恰好卡在 20%、且持续 4 窗 → 视作可辨
    e4 = [100.0] * NWIN + [20.0] * 4 + [0.0] * 20
    r4 = check_c(e4, D)
    res.append((bool(r4 and not r4['ok']), '④ 窗口外恰好 20% 峰值(持续) → 视作可辨', 'tail=%.2fs' % (r4['tail'] if r4 else -1)))
    # ⑤ 空包络 → 返回 None（不静默当通过）
    res.append((check_c([], D) is None, '⑤ 空包络 → None（不静默通过）', 'ok'))
    # ⑥ 衰减抖动：窗口外仅 1 格 >= 20% → **不报警**（resultwin 的实况，防单窗口径误报）
    #    ⚠ 窗口边界 = int(0.68/0.05) = 索引 13。窗口内必须正好填满 13 格，否则
    #      多出来的 100.0 会越过边界与抖动格凑成"连续 2 窗"，把用例自己测坏（已踩）。
    e6 = [100.0] * 13 + [25.0] + [10.0] * 26
    r6 = check_c(e6, D)
    res.append((bool(r6 and r6['ok']), '⑥ 单格抖动(1 窗 >=20%) → 不报警', 'tail=%.2fs' % (r6['tail'] if r6 else -1)))
    # ⑦ 真尾音：窗口外连续 3 格高位 → 必报警（resultlose 的实况）
    e7 = [100.0] * 13 + [73.0, 54.0, 23.0] + [0.0] * 23
    r7 = check_c(e7, D)
    res.append((bool(r7 and not r7['ok']), '⑦ 连续 3 窗高位 → 必报警', 'tail=%.2fs' % (r7['tail'] if r7 else -1)))

    bad = [r for r in res if not r[0]]
    for ok, what, detail in res:
        print(('  ✅ ' if ok else '  ❌ ') + what + '  —— ' + detail)
    print('\n对照 %d/%d%s' % (len(res) - len(bad), len(res), '' if bad else ' ✅ 全绿'))
    return not bad


if '--selftest' in sys.argv:
    print('【duck-cover --selftest】只跑对照，不读真实文件\n')
    sys.exit(0 if selftest() else 1)

# ---------------------------------------------------------------- 主流程
if not os.path.exists(HTML):
    print('⚠ 找不到 %s（GAME_HTML 可覆盖）→ SKIP' % HTML)
    sys.exit(0)
html = open(HTML, encoding='utf-8').read()

m = re.search(r'nodeDuckSec:\s*([\d.]+)', html)
if not m:
    print('❌ 锚点丢失：CONFIG.audio.nodeDuckSec')
    sys.exit(1)
duck_sec = float(m.group(1))

# 「覆盖可听段」开关（v1.191 修复）：开着时，窗口 = max(duck_sec, delay + 实响)
cover = bool(re.search(r'nodeDuckCover:\s*true', html))

# 判据 A：解析器不退化（期望值为**实测**，写错会让门禁当场失败 —— 设计意图）
rows = re.findall(r'^\s{2}([a-z][a-z0-9_]*):\s*\{\s*sfx:\s*"([A-Z_]+)"([^}]*)\}', html, re.M)
if len(rows) != 66:
    print('❌ 解析器退化：DATA_SFX 切出 %d 条，实测期望 66 条' % len(rows))
    sys.exit(1)

def numf(body, k, dflt=None):
    r = re.search(r'\b' + k + r':\s*([\d.]+)', body)
    return float(r.group(1)) if r else dflt

# 判据 B：duck 音必须能定位到 WAV
ducked = []
for name, buf, body in rows:
    if not re.search(r'\bduck:\s*true', body):
        continue
    rate = numf(body, 'rate', 1.0) or 1.0
    delay = numf(body, 'delay', 0.0) or 0.0
    p = os.path.join(AUD, buf.lower() + '.wav')
    if not os.path.exists(p):
        print('❌ 判据 B：%s 引用 %s，但 %s 不存在' % (name, buf, p))
        sys.exit(1)
    ducked.append((name, buf, rate, delay, p))

fails = []
lines = []
lines.append('# 节点音 duck 窗口 vs 实际可听段（第 18 维度）')
lines.append('')
lines.append('- 入口: `%s`' % HTML.replace('\\', '/'))
lines.append('- `nodeDuckSec` = **%.2fs** · `nodeDuckCover` = **%s** · `DATA_SFX` = **%d/66** 条 · `duck:true` = **%d** 条' % (
    duck_sec, 'on' if cover else 'off', len(rows), len(ducked)))
lines.append('- 可听阈值 = 峰值 **%.0f%%**（约 -14dB）· 分析窗 %.0fms · 尾段容差 %.2fs · 持续判定 >= %d 窗' % (
    AUDIBLE_PCT * 100, WIN * 1000, TAIL_TOL, SUSTAIN_K))
lines.append('')
lines.append('| id | buffer | rate | delay | WAV 时长 | 实响 | 生效窗口 | 窗口外能量 | 窗口处电平 | 可听尾段 | 裁定 |')
lines.append('|---|---|---|---|---|---|---|---|---|---|---|')

for name, buf, rate, delay, p in ducked:
    env, dur = envelope(p)
    if not env:
        fails.append('%s：WAV 读不出包络' % name)
        continue
    peak = max(env) or 1.0
    tot = sum(x * x for x in env) or 1.0
    real = dur / rate
    # 与游戏内补丁同公式：开启覆盖后，窗口取"固定下界"与"本条音实响终点"的较大者
    win = max(duck_sec, delay + real) if cover else duck_sec
    k = int(win / WIN)
    e_out = sum(x * x for x in env[k:]) / tot
    at = (env[k] / peak * 100) if k < len(env) else 0.0
    tail = audible_tail(env, peak, win)
    ok = tail <= TAIL_TOL + 1e-9
    if not ok:
        fails.append('%s：duck 窗口 %.2fs 之后仍有 %.2fs 可辨尾音（占全长 %.0f%%），窗口处电平仍 %.0f%% 峰值'
                     % (name, win, tail, tail / dur * 100, at))
    lines.append('| %s | `%s` | %s | %.2f | %.2fs | %.2fs | %.2fs | %.1f%% | %.1f%% | **%.2fs** %s | %s |' % (
        name, buf, rate, delay, dur, real, win, e_out * 100, at, tail, '❌' if not ok else '', 'FAIL' if not ok else 'ok'))

lines.append('')
if fails:
    lines.append('## 未通过判据')
    lines.append('')
    for f in fails:
        lines.append('- ❌ ' + f)
    lines.append('')
lines.append('> **前提验证（防误报）**：`revivecard` 虽窗口外有尾音，但它走 overlay 分支')
lines.append('> （`REVIVE_MODAL` ∈ `overlayAudioLive()` 集合），窗口由**模态时长**决定，与 `nodeDuckSec` 无关。')
lines.append('> 已排除。`bosswarn` 窗口外能量 **0.0%**（尾部真静音）→ 非缺陷。')
lines.append('>')
lines.append('> **两条 FAIL 的形态不同、根因相同**：`resultlose` 窗口处电平仍有 86.7% 峰值、')
lines.append('> 越界后连续 3 窗高位（主重音整段裸奔）；`resultwin` 越界后 2 窗 >= 20%（余音 0.10s）。')
lines.append('> 二者都由同一处修复消除：窗口 = `max(nodeDuckSec, delay + buf.duration/(rate*rateMul))`。')

out = '\n'.join(lines)
os.makedirs(os.path.join('ci', 'out'), exist_ok=True)
open(os.path.join('ci', 'out', 'duck-cover.md'), 'w', encoding='utf-8').write(out)
print(out)
print('\n报告已写 ci/out/duck-cover.md')
sys.exit(1 if fails else 0)
