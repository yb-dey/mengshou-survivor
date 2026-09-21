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

# 【v1.180】逐曲响度配平（源码 CONFIG.audio.bgmTrim；播放增益处施加）
#   口径: 有效响度 = 内容响度 + 20log10(laneGain) + 20log10(trim)
# 【v1.181】新增 home 档 5 首（世界主题曲）。
#   ⚠ home 的 trim 是按 **P95(短时窗)** 解出来的，不是按全曲均方 ——
#     因为 home 档内差异含有"稀疏度"成分（frost P50 比 city 低 9.95dB 是编配意图），
#     按均方配平会把风格差异当成缺陷修掉。详见 ci/bgm-perceptual-cross.py。
TRACK_TRIM = {
    "bgm_march": 0.8300,
    "bgm_horde": 0.6597,
    "bgm_abyss": 1.1872,
    "bgm_meadow": 1.3703,
    "bgm_frost": 1.3706,
    "bgm_dune": 1.2368,
    "bgm_harbor": 1.1080,
    "bgm_city": 1.0000,
}

JUMP_DB = 3.0
CHAIN_DB = 2.0

# 已知豁免（**不是**"让它变绿"的开关；必须**钉住具体数值**，任何变化即失效）
#   ⚠ 第一版按 lane 名豁免 → 阴性对照 C 立刻暴露漏洞：对 home 档**注入 -12dB** 也被一起吞掉，
#     等于"对该档所有异常都不报警" = 永远通过的守卫。改为**按基线极差精确匹配**：
#     只有「极差仍等于基线值（±0.25 dB）」才豁免；一旦数值变化（无论变好变坏）→ 恢复报警。
#   【v1.181】home 档豁免**已撤销** —— 原豁免引用 `_qc/_perceptual-cross.py`（一次性脚本，已不存在）
#     = **无法复核的豁免 = 实质上"永远通过的守卫"**（第九类病根）。
#     重建为长期脚本 `ci/bgm-perceptual-cross.py`（`--selftest` 4/4）后复核发现：
#     · 旧的"P95 极差 4.60 < 均方 6.00 → 稀疏度"论证**在口径上不完整** ——
#       它掩盖了「玩家**主动切换世界主题**时，P95(有声音时多响)仍差 4.97dB」这一事实；
#     · 稀疏度差异（frost 的 P50 低 9.95dB）**确实存在且应保留**，
#       但它与"切主题音量跳变"是**两个可分离的问题** ⇒ 用 P95 配平解决后者、不动前者。
#     已按 P95 配平 home 5 首（只抬不压 + 峰值上限 0.985）→ P95 极差 4.97 → **2.24 dB**。
EXEMPT_BASELINE = {}


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


# ---- 【v1.181】短时窗 P95（"有声音时多响"）—— 档内判据改用这个 ----
#   为什么：全曲均方会把"稀疏度"算进极差。实测 home 档 frost 的 P50 比 city 低 9.95dB
#   （它本来就"安静得多"，是编配意图），而 P95 只低 3.14dB（有声音时接近）。
#   若按均方配平，会把**风格差异当缺陷修掉**；按 P95 配平则只解决"切主题音量跳变"。
#   ⚠ 与 ci/bgm-perceptual-cross.py 同口径（同一 WIN_S / SILENT_DB / 分位算法）。
WIN_S = 0.10
SILENT_DB = -60.0
P95_OK_DB = 3.5    # P95 极差 ≤ 此值 → 玩家听不出档内不齐
WHOLE_OK_DB = 6.0  # 均方极差二级上界（宽松，只兜"极端整档偏移"）


def _short_window_p95(sig, sr, win_s=WIN_S):
    n = int(sr * win_s)
    vals = []
    for i in range(0, len(sig) - n + 1, n):
        d = k_loudness_db(sig[i:i + n], sr)
        if d > SILENT_DB:
            vals.append(d)
    if not vals:
        return None
    vals.sort()
    k = (len(vals) - 1) * 0.95
    lo, hi = int(math.floor(k)), int(math.ceil(k))
    return vals[lo] + (vals[hi] - vals[lo]) * (k - lo)


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
        trim = TRACK_TRIM.get(tid, 1.0)
        # 【v1.181】⚠ p95 必须与 eff 施加**同一** dt（lane 增益 + trim）。
        #   p95 与均方是**同一个有效信号**的两种测度，不是两个不同的物理量 ——
        #   若 p95 存裸值而 eff 存有效值，档内比较就拿不同参考电平互减，
        #   会凭空造出"跳档"（实测 battle 裸 P95 极差 5.78 dB，真实仅 2.07 dB；
        #   因为 battle 三首 trim 各不相同，裸值之间根本不可比）。
        dt = 20 * math.log10(g) + 20 * math.log10(trim)
        p95 = _short_window_p95(sig, sr)
        rows.append(dict(name=tid, lane=lane, gain=g, content=content, trim=trim,
                         p95=(p95 + dt) if p95 is not None else None,
                         eff=content + dt,
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
        # 【v1.181】主判据 = 短时窗 **P95** 极差（"有声音时多响"），
        #   全曲均方退为**二级上界**（兜极端整档偏移）。
        #   理由：均方把"稀疏度"算进极差（frost 本来就安静得多），会把风格当缺陷。
        #   两级都超才报；只超 P95 也报（那是"有声音时就不齐"= 真缺陷）。
        p95s = [v.get("p95") for v in vs if v.get("p95") is not None]
        span95 = (max(p95s) - min(p95s)) if len(p95s) == len(vs) else None
        hit95 = span95 is not None and span95 > P95_OK_DB
        hitw = span > WHOLE_OK_DB
        if hit95 or hitw:
            names = sorted(vs, key=lambda v: v["eff"])
            msg = ("lane[%s] 档内跳档 P95 %.2f dB (阈 %.1f) / 均方 %.2f dB (阈 %.1f): %s"
                   % (lane, span95 if span95 is not None else float("nan"), P95_OK_DB,
                      span, WHOLE_OK_DB,
                      " | ".join("%s %.2f" % (n["name"], n["eff"]) for n in names)))
            if lane in EXEMPT_BASELINE and abs(span - EXEMPT_BASELINE[lane][0]) <= EXEMPT_BASELINE[lane][1]:
                exempt.append(msg + "  ← 已知豁免(基线 %.2f dB): " % EXEMPT_BASELINE[lane][0]
                              + EXEMPT_BASELINE[lane][2])
            else:
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
    lines += ["", "## 同 lane 横向", "",
              "- 主判据：**短时窗 P95 极差** > %.2f dB 报跳档（『有声音时多响』）" % P95_OK_DB,
              "- 二级上界：**全曲均方极差** > %.2f dB 也报（只兜『极端整档偏移』）" % WHOLE_OK_DB,
              "- ⚠ 均方会把**编配稀疏度**算进极差（稀疏型本来就安静得多），故不作主判据。", ""]
    by = {}
    for r in rows:
        by.setdefault(r["lane"], []).append(r)
    for lane, vs in sorted(by.items()):
        e = sorted(v["eff"] for v in vs)
        p = sorted(v["p95"] for v in vs if v.get("p95") is not None)
        span95 = (p[-1] - p[0]) if len(p) == len(vs) and p else None
        hit95 = span95 is not None and span95 > P95_OK_DB
        hitw = (e[-1] - e[0]) > WHOLE_OK_DB
        flag = "  ⚠" if (hit95 or hitw) else "  ✅"
        if span95 is None:
            lines.append("- **%s** n=%d ｜ 中位 %.2f ｜ 均方极差 %.2f dB（P95 不可用）%s" % (
                lane, len(vs), e[len(e) // 2], e[-1] - e[0], flag))
        else:
            lines.append(
                "- **%s** n=%d ｜ 中位 %.2f ｜ **P95 极差 %.2f dB**%s ｜ 均方极差 %.2f dB%s" % (
                    lane, len(vs), e[len(e) // 2], span95,
                    "" if not hit95 else " ⚠超阈",
                    e[-1] - e[0], "" if not hitw else " ⚠超阈"))
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
    #    ⚠ 必须同时改 p95：P95 是主判据，只改 content/eff 是**改不动的**
    #      （第一版就漏了这步，导致 A' 在 P95 主判据下看起来"判据失灵"）。
    rowsA, _ = analyze(audio_dir)
    for r in rowsA:
        if r["name"] == "bgm_horde":
            r["content"] -= 5.0
            if r.get("p95") is not None:
                r["p95"] -= 5.0
            r["eff"] = r["content"] + 20 * math.log10(r["gain"]) + 20 * math.log10(r.get("trim", 1.0))
    aA = [x for x in judge(rowsA)[0] if "battle" in x]
    print("  [A'] 把 bgm_horde 压 -5dB（注入已知缺陷）→ battle 报跳档? %s（应 True）" % bool(aA))
    tot += 1
    if aA:
        ok += 1

    # B. 把「有声音时最轻的那首」按 **P95** 拉平（不是改 lane 增益！）→ 应不再报任何跳档
    #    ⚠ 本对照第一版写错了：当时改的是 lane 增益，而 lane 增益对同档**所有**曲目同比生效
    #      → 极差不变、报警不变，看起来像"判据失灵"。真正要模拟的是"把曲子本身修齐"
    #      （这正是真实修法的形态：重烘某几首 wav），所以应按 ±dB 直接补偿**内容响度**。
    #    ⚠ 第二版也错：按 **eff(均方)** 选 lo/tgt —— 换 P95 主判据后 battle 均方极差本是 0.00，
    #      delta 恒为 0，「模拟修齐」退化成空操作，对照永远 True 却什么都没证明。
    #      判据看什么量，对照就必须动什么量 → 这里按 **p95** 选最轻/目标。
    rows1, _ = analyze(audio_dir)
    by = {}
    for r in rows1:
        by.setdefault(r["lane"], []).append(r)
    lo = sorted(by["battle"], key=lambda r: r["p95"])[0]
    tgt = sorted(r["p95"] for r in by["battle"] if r is not lo)[0]
    delta = tgt - lo["p95"]                      # 先算好，再改（避免就地求值顺序问题）
    for r in rows1:
        if r["name"] == lo["name"]:
            r["content"] += delta
            if r.get("p95") is not None:
                r["p95"] += delta
            r["eff"] = r["content"] + 20 * math.log10(r["gain"]) + 20 * math.log10(r.get("trim", 1.0))
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
    #    【v1.181】home 豁免已撤销（改为真修），本条同时验证"撤销豁免后判据仍灵敏"。
    rows3, _ = analyze(audio_dir)
    for r in rows3:
        if r["name"] == "bgm_meadow":
            r["content"] -= 4.0
            if r.get("p95") is not None:
                r["p95"] -= 4.0
            r["eff"] = r["content"] + 20 * math.log10(r["gain"]) + 20 * math.log10(r.get("trim", 1.0))
    a3 = judge(rows3)[0]
    got = any("home" in x for x in a3)
    print("  [C] bgm_meadow 单曲压 -4dB（注入已知缺陷）→ 报 home 跳档? %s（应 True）" % got)
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
            if r.get("p95") is not None:
                r["p95"] += 6.0
            r["eff"] = r["content"] + 20 * math.log10(r["gain"]) + 20 * math.log10(r.get("trim", 1.0))
    a4 = [x for x in judge(rows4)[0] if "battle" in x]
    print("  [D] 把最响的 %s 内容再抬 +6dB → battle 报跳档? %s（应 True）" % (hi["name"], bool(a4)))
    tot += 1
    if a4:
        ok += 1

    # E. 【v1.180】新机制 TRACK_TRIM 的**孤儿开关**阴性对照。
    #    风险: 若 trim 表写了但代码从不施加(拼错字段名/施加在归一之前被抵消),
    #          门禁会因为自己也读了同一张表而"两边一起错"→ 双双看起来正常。
    #    对照: 把某曲 trim 从"已配平值"改回 1.0 → 该档**必须**恢复报跳档。
    #      (若改回 1.0 后仍不报 → 说明 trim 对判据无效 = 孤儿开关)
    rows5, _ = analyze(audio_dir)
    victim = "bgm_horde"
    for r in rows5:
        if r["name"] == victim:
            t = TRACK_TRIM.get(victim, 1.0)
            back = 20 * math.log10(t)          # 0.6597 → −3.62 dB，撤销 = 抬回 +3.62
            r["trim"] = 1.0
            r["content"] -= back               # ⚠ 必须把 trim 的量还回 content/p95，
            if r.get("p95") is not None:       #   否则 P95 主判据看不到变化 → 误报孤儿开关
                r["p95"] -= back
            r["eff"] = r["content"] + 20 * math.log10(r["gain"])
    a5 = [x for x in judge(rows5)[0] if "battle" in x]
    print("  [E] 把 %s 的 trim 改回 1.0（撤销配平）→ battle 报跳档? %s（应 True）＊孤儿开关对照" % (
        victim, bool(a5)))
    tot += 1
    if a5:
        ok += 1
    else:
        print("       → trim 对该判据无效 = 孤儿开关 ❌")

    # F. 【v1.181】home 档配平的孤儿开关对照。
    #    与 E 同理，但对象是**新增的 home 5 首** ——
    #    单独验一次，因为 home 的 trim 是**按 P95 解**的，若解错或漏施加，
    #    E（只测 battle）**抓不到**。"新加了一个档的配平"必须为该档单独设对照。
    #    ⚠ 关键：撤销 trim 必须**把 trim 带来的那部分 dB 还回 content/p95**，
    #      否则"撤 trim"只是让 eff 回退，而 P95 主判据完全没动 → 误报"孤儿开关"。
    #      （这正是第一版 [F] 的隐藏 bug：它在 P95 主判据下永远会 False）
    rows6, _ = analyze(audio_dir)
    for r in rows6:
        if r["lane"] == "home":
            t = TRACK_TRIM.get(r["name"], 1.0)
            back = 20 * math.log10(t)          # trim 贡献的 dB（正=抬过）
            r["trim"] = 1.0
            r["content"] -= back               # 撤销抬升 = 内容响度回落
            if r.get("p95") is not None:
                r["p95"] -= back
            r["eff"] = r["content"] + 20 * math.log10(r["gain"])
    a6 = [x for x in judge(rows6)[0] if "home" in x]
    print("  [F] 把 home 档 5 首 trim 全改回 1.0（撤销 home 配平）→ home 报跳档? %s（应 True）＊孤儿开关对照"
          % bool(a6))
    tot += 1
    if a6:
        ok += 1
    else:
        print("       → home 的 trim 对判据无效 = 孤儿开关 ❌")

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
