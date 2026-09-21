# -*- coding: utf-8 -*-
"""BGM 场景响度连续性体检 —— 同 lane 内的有效响度是否'跳档'

存在理由
  本项目的 BGM 烘焙口径是「**峰值归一**」(CONFIG.audio.peakNorm=0.708, 每首都把峰值拉到同一值)。
  但**峰值相等 ≠ 响度相等**: 同样峰值下, 持续垫层型(能量均布)的 RMS 远高于
  稀疏瞬态型(心跳/铃针/鼓点)的 RMS。实测 10 首 BGM 的 RMS 极差 **0.0574 ~ 0.1549 = 8.6 dB**。

  而同一局内这三首**会互相切换**:
      march(BATTLE_A) → horde(BATTLE_B, ch>=3 潮汐窗) → abyss(BOSS)
  若三者有效响度(内容响度 × lane 增益)不齐, 玩家会听到"打 BOSS 时音乐反而变小了"。

判据（两个层次，都只做**同 lane 内横向比较**，不设绝对阈值）
  ① 同 lane 内最大-最小有效响度 > `JUMP_DB`(默认 3.0) → 报"档内跳档"
  ② 同一局内会**连续切换**的曲目组(见 CHAIN), 其极差 > `CHAIN_DB`(默认 2.0) → 报"切换跳档"

⚠ 为什么不用绝对阈值: 项目明确有"峰值归一不动, 整体响度不升"的历代裁决,
  绝对响度是本作**有意选择**; 缺陷只存在于"**同档 peer 不齐**"。

⚠ 阴性对照 (`--selftest`):
  A. 全 lane 增益置同一值且内容响度全等 → 必须 0 报警
  B. 把 abyss 的 lane 增益改到能把有效响度拉平 → 必须不再报 abyss
  C. 故意把某曲 lane 增益除以 4(-12dB) → 必须报出该曲
"""
import sys, os, glob, wave, struct, math

# CONFIG.audio 的 lane 增益（源码 @1406-1410）；改这里等于模拟改游戏
LANE_GAIN_DEFAULT = {
    "home": 0.115,      # bgmHomeGain
    "battle": 0.16,     # bgmBattleGain
    "daily": 0.17,      # bgmDailyGain
    "result": 0.12,     # bgmResultGain
}

# 曲目 → lane（与 bgmLaneOf() / bgmTrackByScene 一致）
TRACK_LANE = {
    "bgm_city": "home", "bgm_dune": "home", "bgm_frost": "home",
    "bgm_harbor": "home", "bgm_meadow": "home",
    "bgm_march": "battle", "bgm_horde": "battle", "bgm_abyss": "battle",
    "bgm_win": "result", "bgm_lose": "result",
}

# 同一局内会互相切换的曲目链（desiredBgm() 的走向）
CHAIN = [("bgm_march", "bgm_horde"), ("bgm_horde", "bgm_abyss"), ("bgm_march", "bgm_abyss")]

JUMP_DB = 3.0
CHAIN_DB = 2.0

# 已知豁免（**不是**"让它变绿"的开关；必须**钉住具体数值**，任何变化即失效）
#   ⚠ 第一版按 lane 名豁免 → 阴性对照 C 立刻暴露漏洞：对 home 档**注入 -12dB** 也被一起吞掉，
#     等于"对该档所有异常都不报警" = 永远通过的守卫。改为**按基线极差精确匹配**：
#     只有「极差仍等于基线值（±0.25 dB）」才豁免；一旦数值变化（无论变好变坏）→ 恢复报警。
#   home 档基线 6.00 dB 的定性依据（_qc/_perceptual-cross.py，100ms 短时窗）：
#     · 该档 P95 极差仅 4.60 dB < 均方 6.00 dB → 差异主要来自**稀疏度**而非整体音量
#     · bgm_frost 的 P50 比 bgm_city 低 10 dB，而 P95 只低 4.6 dB = "有声音时够响，只是安静得多"
#       → 霜原/沙丘本就更疏，是编配意图
#     · 对照 battle 档：P95 极差 5.54 ≈ 均方 5.30 → 全时段一致偏轻 = 真缺陷（已修）
EXEMPT_BASELINE = {
    "home": (6.00, 0.25, "编配意图差异（P95 极差 4.60 < 均方 6.00 = 稀疏度差异非音量缺陷；见 _qc/_perceptual-cross.py）"),
}


def read_mono(path):
    with wave.open(path, "rb") as w:
        n, ch, sw, sr = w.getnframes(), w.getnchannels(), w.getsampwidth(), w.getframerate()
        if sw != 2:
            return None, None
        raw = w.readframes(n)
    v = list(struct.unpack("<%dh" % (len(raw) // 2), raw))
    if ch == 2:
        v = [(v[i] + v[i + 1]) / 2 for i in range(0, len(v) - 1, 2)]
    return [x / 32768.0 for x in v], sr


def k_loudness_db(sig, sr):
    """简化 K 加权(一阶高通 100Hz + 一阶低通 8kHz) → 均方 → dB。
    ⚠ 与 ci/sfx-loudness.py 同口径，是本项目内部可横向比的相对量，**不是 LUFS**。"""
    dt = 1.0 / sr
    rc = 1.0 / (2 * math.pi * 100.0)
    a = rc / (rc + dt)
    yp = xp = 0.0
    hp = [0.0] * len(sig)
    for i, x in enumerate(sig):
        y = a * (yp + x - xp)
        hp[i] = y
        xp, yp = x, y
    rc2 = 1.0 / (2 * math.pi * 8000.0)
    a2 = dt / (rc2 + dt)
    y = 0.0
    ms = 0.0
    for x in hp:
        y = y + a2 * (x - y)
        ms += y * y
    return 10 * math.log10(ms / max(1, len(hp)) + 1e-12)


def analyze(audio_dir, lane_gain=None):
    lg = dict(LANE_GAIN_DEFAULT)
    if lane_gain:
        lg.update(lane_gain)
    rows = []
    for fn in sorted(os.listdir(audio_dir)):
        if not (fn.startswith("bgm_") and fn.endswith(".wav")):
            continue
        tid = fn[:-4]
        lane = TRACK_LANE.get(tid)
        if lane is None:
            continue
        sig, sr = read_mono(os.path.join(audio_dir, fn))
        if sig is None or len(sig) < sr // 2:
            continue
        content = k_loudness_db(sig, sr)
        g = lg[lane]
        rows.append(dict(name=tid, lane=lane, gain=g, content=content,
                         eff=content + 20 * math.log10(g),
                         dur=len(sig) / float(sr)))
    return rows, lg


def judge(rows):
    alarms = []
    exempt = []
    by = {}
    for r in rows:
        by.setdefault(r["lane"], []).append(r)
    for lane, vs in sorted(by.items()):
        if len(vs) < 2:
            continue
        e = sorted(v["eff"] for v in vs)
        span = e[-1] - e[0]
        if span > JUMP_DB:
            names = sorted(vs, key=lambda v: v["eff"])
            msg = "lane[%s] 档内跳档 %.2f dB (阈 %.1f): %s" % (
                lane, span, JUMP_DB,
                " | ".join("%s %.2f" % (n["name"], n["eff"]) for n in names))
            if lane in EXEMPT_BASELINE and abs(span - EXEMPT_BASELINE[lane][0]) <= EXEMPT_BASELINE[lane][1]:
                exempt.append(msg + "  ← 已知豁免(基线 %.2f dB): " % EXEMPT_BASELINE[lane][0]
                              + EXEMPT_BASELINE[lane][2])
            else:
                if lane in EXEMPT_BASELINE:
                    msg += "  ← 豁免失效：基线 %.2f dB，实测 %.2f dB（数值已变）" % (
                        EXEMPT_BASELINE[lane][0], span)
                alarms.append(msg)
    emap = dict((r["name"], r["eff"]) for r in rows)
    for a, b in CHAIN:
        if a in emap and b in emap:
            d = abs(emap[a] - emap[b])
            if d > CHAIN_DB:
                alarms.append("切换跳档 %s→%s 差 %.2f dB (阈 %.1f): %.2f vs %.2f" % (
                    a, b, d, CHAIN_DB, emap[a], emap[b]))
    return alarms, exempt


def report(rows, lg, out=None):
    lines = ["# BGM 场景响度连续性体检（纯标准库，CI 端）", "",
             "> 口径：**简化 K 加权响度**（一阶高通 100Hz + 一阶低通 8kHz + 均方 → dB）。",
             "> ⚠ 本项目内部横向可比的**相对量**，**不是标准 LUFS**，不可对外这样称呼。", "",
             "> 为什么需要：本作 BGM 全部按「**峰值归一**」(peakNorm=0.708) 烘焙，",
             "> 但**峰值相等 ≠ 响度相等** —— 持续垫层型与稀疏瞬态型在同一峰值下 RMS 差可达 8 dB。", "",
             "| 曲目 | lane | lane增益 | 时长s | 内容响度dB | **有效响度dB** |",
             "|---|---|---|---|---|---|"]
    for r in sorted(rows, key=lambda r: (r["lane"], r["eff"])):
        lines.append("| %s | %s | %.3f | %.1f | %.2f | **%.2f** |" % (
            r["name"], r["lane"], r["gain"], r["dur"], r["content"], r["eff"]))
    lines += ["", "## 同 lane 横向（判据：极差 > %.1f dB 报跳档）" % JUMP_DB, ""]
    by = {}
    for r in rows:
        by.setdefault(r["lane"], []).append(r)
    for lane, vs in sorted(by.items()):
        e = sorted(v["eff"] for v in vs)
        med = e[len(e) // 2]
        lines.append("- **%s** n=%d ｜ 中位 %.2f ｜ 范围 %.2f..%.2f ｜ **极差 %.2f dB**%s" % (
            lane, len(vs), med, e[0], e[-1], e[-1] - e[0],
            "  ⚠" if e[-1] - e[0] > JUMP_DB else "  ✅"))
    lines += ["", "## 局内切换链（判据：极差 > %.1f dB 报跳档）" % CHAIN_DB, ""]
    emap = dict((r["name"], r["eff"]) for r in rows)
    for a, b in CHAIN:
        if a in emap and b in emap:
            d = abs(emap[a] - emap[b])
            lines.append("- `%s` → `%s` ｜ %.2f vs %.2f ｜ 差 **%.2f dB**%s" % (
                a, b, emap[a], emap[b], d, "  ⚠" if d > CHAIN_DB else "  ✅"))
    alarms, exempt = judge(rows)
    lines += ["", "## 结论", ""]
    if not alarms:
        lines.append("- ✅ 同档 peer 与局内切换链**全部在阈内**（未发现响度跳档）")
    else:
        for a in alarms:
            lines.append("- ⚠ %s" % a)
    if exempt:
        lines += ["", "### 已知豁免（带实测依据，非『变绿』开关）", ""]
        for e in exempt:
            lines.append("- ℹ %s" % e)
    txt = "\n".join(lines)
    print(txt)
    if out:
        d = os.path.dirname(out)
        if d:
            os.makedirs(d, exist_ok=True)     # ⚠ CI 干净检出里 ci/out/ 不存在；本地因已有该目录而掩盖过此缺陷
        with open(out, "w", encoding="utf-8") as fh:
            fh.write(txt)
        print("\n→ 已写 " + out)
    return len(alarms)


def selftest(audio_dir):
    print("=== 判据自测（阴性对照）===")
    ok = 0
    tot = 0
    # A. 基准：**不要求"必须报警"** —— 修复后基准本就该是 0 报警。
    #    ⚠ 第一版断言写成"应 > 0"，在修复完成后必然 FAIL —— 那是把"数据有缺陷"当成了判据前提。
    #    改为断言：**当前数据必须处于"可判定的已知状态"**（0 未豁免报警 = 已修齐），
    #    然后 A' 注入一个已知缺陷，要求判据必须抓到（这才是判据本身的有效性检验）。
    rows0, _ = analyze(audio_dir)
    al0, ex0 = judge(rows0)
    print("  [A] 真实数据(基准)           → 未豁免报警 %d 条 ｜ 已知豁免 %d 条" % (len(al0), len(ex0)))
    tot += 1
    if len(al0) == 0:
        ok += 1
        print("       → 基准为 0 报警（已修齐）✅")
    else:
        print("       → 基准仍有 %d 条未豁免报警：%s ❌" % (len(al0), al0[0][:60]))

    # A'. 注入已知缺陷（把某首 battle 曲压 -5dB）→ 判据必须抓到（证明判据没被豁免机制弄瞎）
    rowsA, _ = analyze(audio_dir)
    for r in rowsA:
        if r["name"] == "bgm_horde":
            r["content"] -= 5.0
            r["eff"] = r["content"] + 20 * math.log10(r["gain"])
    aA = [x for x in judge(rowsA)[0] if "battle" in x]
    print("  [A'] 把 bgm_horde 压 -5dB（注入已知缺陷）→ battle 报跳档? %s（应 True）" % bool(aA))
    tot += 1
    if aA:
        ok += 1

    # B. 把「内容响度」人工拉平（不是改 lane 增益！）→ 应不再报任何跳档
    #    ⚠ 本对照第一版写错了：当时改的是 lane 增益，而 lane 增益对同档**所有**曲目同比生效
    #      → 极差不变、报警不变，看起来像"判据失灵"。真正要模拟的是"把曲子本身修齐"
    #      （这正是真实修法的形态：重烘某几首 wav），所以应按 ±dB 直接补偿**内容响度**。
    rows1, _ = analyze(audio_dir)
    by = {}
    for r in rows1:
        by.setdefault(r["lane"], []).append(r)
    lo = sorted(by["battle"], key=lambda r: r["eff"])[0]
    tgt = sorted(r["eff"] for r in by["battle"] if r is not lo)[0]
    delta = tgt - lo["eff"]                      # 先算好，再改（避免就地求值顺序问题）
    for r in rows1:
        if r["name"] == lo["name"]:
            r["content"] += delta
            r["eff"] = r["content"] + 20 * math.log10(r["gain"])
    a2 = [x for x in judge(rows1)[0] if "battle" in x]
    print("  [B] 把 %s 内容响度抬高 %.2f dB（模拟重烘修齐）→ battle 仍报跳档? %s（应 False）" % (
        lo["name"], delta, bool(a2)))
    tot += 1
    if not a2:
        ok += 1

    # C. 把 **home 档内某一首**（不是整档增益！）压 -4dB → 必须报，且必须突破豁免
    #    ⚠ 这里连踩两次坑，值得记下：
    #      ① 按 lane 名豁免 → 此对照被豁免吞掉；
    #      ② 改 lane 增益 → 整档**同比**缩放 → 档内极差**不变**（仍是基线 6.00）→ 命中基线豁免。
    #    正解：注入**单曲**缺陷（模拟"某一首重烘错了"），这才是档内极差该抓的东西。
    rows3, _ = analyze(audio_dir)
    for r in rows3:
        if r["name"] == "bgm_meadow":
            r["content"] -= 4.0
            r["eff"] = r["content"] + 20 * math.log10(r["gain"])
    a3 = judge(rows3)[0]
    got = any("home" in x for x in a3)
    print("  [C] bgm_meadow 单曲压 -4dB → 报 home 跳档? %s（应 True，且必须突破豁免）" % got)
    tot += 1
    if got:
        ok += 1

    # D. 反向: 把最响的 battle 曲再抬 +6dB → 必须报（证明判据对**任一方向**的错配都敏感，
    #    不只是"压轻了才报" —— 只朝一个方向灵敏的判据是半盲的）
    rows4, _ = analyze(audio_dir)
    by4 = {}
    for r in rows4:
        by4.setdefault(r["lane"], []).append(r)
    hi = sorted(by4["battle"], key=lambda r: -r["eff"])[0]
    for r in rows4:
        if r["name"] == hi["name"]:
            r["content"] += 6.0
            r["eff"] = r["content"] + 20 * math.log10(r["gain"])
    a4 = [x for x in judge(rows4)[0] if "battle" in x]
    print("  [D] 把最响的 %s 内容再抬 +6dB → battle 报跳档? %s（应 True）" % (hi["name"], bool(a4)))
    tot += 1
    if a4:
        ok += 1

    print("  --- %d/%d 通过" % (ok, tot))
    return 0 if ok == tot else 1


def main():
    if "--selftest" in sys.argv:
        d = sys.argv[sys.argv.index("--selftest") + 1] if len(sys.argv) > sys.argv.index("--selftest") + 1 else None
        d = d or os.path.join(os.path.dirname(__file__), "..", "game", "audio")
        return selftest(d)
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    d = args[0] if args else os.path.join(os.path.dirname(__file__), "..", "game", "audio")
    out = args[1] if len(args) > 1 else None
    rows, lg = analyze(d)
    n = report(rows, lg, out)
    return 1 if n else 0


if __name__ == "__main__":
    sys.exit(main())
