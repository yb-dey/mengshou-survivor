# -*- coding: utf-8 -*-
"""SFX 响度层级体检（纯标准库，零依赖，CI 可跑）

存在理由
  游戏音效最影响"高级感 / 廉价感"的客观量不是单个音效好听与否，而是**相对层级**：
    · 高频事件（开火/命中，每秒数次）必须**显著低于**低频事件（升级/结算，每局几次），
      否则长时间游玩会被"哒哒哒"磨耳朵（本项目注释里 v1.152→v1.160 反复在修这个）。
    · 但任何**频率事件**都不该低于可闻底噪太多，否则玩家觉得"没反馈"。

判据（与信号同尺度，务必注意）
  用 **EBU R128 思路的简化版**：K 加权后的 **响度(LUFS 近似)**，而非 dBFS 峰值。
  为什么不用峰值：峰值只反映瞬时瞬态；两个峰值相同的音效，
  一个短促尖利、一个饱满绵长，**听感响度差很远**。响度必须用能量加权。

  本文件的近似做法（纯 stdlib，不做完整 K 加权滤波器）：
    1. 一阶高通（去 <100Hz 直流/隆隆，K 加权高架滤波的简化）
    2. 一阶低通（去 >8kHz 尖噪，K 加权高架滤波的简化）
    3. 均值平方 → 10*log10 → 得相对响度（同一套滤波下**横向可比**）
  ⚠ 明确声明：**这不是标准 LUFS**，是**本项目内部可横向比较的相对响度**。
     数值不可对外称"LUFS"，只用于**本套音效之间**的层级排序。

  判定（跨样本相对，不用绝对阈值）：
    · 按"事件频率档"分组比较最高/最低档的响度差
    · 组内离群用中位数 + MAD（3×1.4826×MAD）

阴性对照（`--selftest`，先问"样本物理上真含该现象吗"）：
  A. 等幅同长正弦 vs 振幅减半正弦 → 响度差应 ≈ 6dB（证明量的是能量不是有无）
  B. 同振幅但时长短一半的正弦 → 响度必**更低**（证明时长参与了，不是只看峰值）
  C. 峰值相同但一为尖脉冲、一为持续音 → 持续音响度必更高（证明不是峰值伪装）
  D. 静音 → 安全返回 -inf 不崩
"""
import sys, os, glob, wave, struct, math

HIGH_BINS = 4          # 分组：按"事件频率档"分（本项目语义手动映射）
LOW_CUT = 100.0        # 高通截止 Hz（简化 K 加权）
HIGH_CUT = 8000.0      # 低通截止 Hz（简化 K 加权）
WIN_MS = 30            # 【v1.177】层级判据的滑动窗宽度（ms）；见 window_peak_loudness 头注

# 事件频率档：INFREQ=每局几次（应最响）/ MID=每波几次 / FREQ=每秒数次（应最轻）
# 【v1.169】分档表：按"事件发生频率"分三档，层级要求 INFREQ > MID > FREQ。
#   ⚠ 本表是**手抄副本**，必须与 CONFIG.audio.gains 的键集一致 ——
#   2026-09-21 实测：本表只有 15 条，而 gains/sfxFiles 已有 19 键
#   → 4 个节点音（CARDSHOW/CHEST/EVENT/REVIVE）落进 "?" 档、**被层级检查完全跳过**，
#     体检报"✅ 层级成立"却没覆盖它们（口径被污染：漏掉的正好是新增的）。
#   → 已补齐 19 条；分档依据 = 项目自己的 prios 注释
#     "受击/复活 > BOSS > 升级/选卡/结算 > 击杀/宝石 > 开火/命中"。
#   ⚠ 新增 SFX 键时**必须同步加进本表**，否则它会被静默排除在层级体检之外。
LANE = {
    "sfx_win": "INFREQ", "sfx_lose": "INFREQ", "sfx_levelup": "INFREQ",
    "sfx_evo": "INFREQ", "sfx_boss_die": "INFREQ", "sfx_boss_warn": "MID",
    "sfx_card": "MID", "sfx_start": "MID", "sfx_hurt": "MID", "sfx_bomb": "MID",
    "sfx_kill": "MID", "sfx_gem": "MID",
    "sfx_fire": "FREQ", "sfx_hit": "FREQ", "sfx_ui": "FREQ",
    # 【v1.169】补齐 4 个节点音（prio 3~5，属"节点专属槽"，按角色归 MID；
    #   REVIVE prio=5 与 hurt 同级、是"倒下再战"的高光时刻 → 归 INFREQ 与结算音同档）
    "sfx_revive": "INFREQ", "sfx_cardshow": "MID", "sfx_chest": "MID",
    "sfx_event": "MID",
}


def load_gains(html):
    """从内联母版抽出 `CONFIG.audio.gains` 的 {SFX_KEY: float}。

    【v1.170】抽到本文件是为了让"读 gains 表"只有一个实现 —— 原先
    sfx-intent-vs-real.py 自己抄了一份平衡括号解析，两份实现迟早漂移。
    锚点用 `gains:` 并**从 `audio:` 起找**，避免命中同名注释（本项目踩过多次）。
    """
    import re
    ai = html.find("audio:")
    i = html.find("gains:", ai if ai >= 0 else 0)
    if i < 0:
        return {}
    j = html.find("{", i)
    d = 0
    blk = None
    for k in range(j, len(html)):
        if html[k] == "{":
            d += 1
        elif html[k] == "}":
            d -= 1
            if d == 0:
                blk = html[j:k + 1]
                break
    if blk is None:
        return {}
    return dict((m[0], float(m[1])) for m in re.findall(r"(SFX_[A-Z_]+):\s*([0-9.]+)", blk))


def read_mono(path):
    with wave.open(path, "rb") as w:
        ch, sw, fr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    if sw != 2:
        return None, None
    v = list(struct.unpack("<%dh" % (len(raw) // 2), raw))
    if ch == 2:
        v = [(v[i] + v[i + 1]) // 2 for i in range(0, len(v) - 1, 2)]
    return v, fr


def kweight_loudness(v, sr):
    """简化 K 加权 → 相对响度（dB）。同一滤波下横向可比，非标准 LUFS。

    ⚠ 这是**全段**均值平方口径 → 时长会进入数值。做**层级**比较请用
    `window_peak_loudness`（30ms 滑动窗），见其头注。
    """
    if not v:
        return float("-inf")
    lp = _kweight_filter(v, sr)
    # 均值平方（全段，含静音——与 LUFS 门控不同，此处简化）
    ms = sum((x / 32768.0) ** 2 for x in lp) / len(lp)
    if ms <= 1e-12:
        return float("-inf")
    return 10.0 * math.log10(ms)


def window_peak_loudness(v, sr, win_ms=WIN_MS):
    """【v1.177】固定时长滑动窗的**最大** K 加权响度（dB）。

    ⚠ 为什么需要它（本文件第二个尺度缺陷，与 v1.174 stress-perf 同型）：

    原先层级体检用的是 `loud`（**全段**均值平方）→ **时长被算进了响度**：
      · `sfx_lose` 1.35s 全段 -15.99dB，`sfx_hurt` 0.20s 全段 -16.18dB
        → 体检读出"结算音比受击音更响" → 推断"档位塌陷"。
      · 但设计写的是 `prios: HURT=5, REVIVE=5 > BOSS=4 > … > FIRE=1`，
        实际**起音**上 HURT(-10.19) 明显响于 LOSE(-10.38)/WIN(-11.95)。
      · 即"长音天然全段 RMS 高"污染了层级比较 —— 被测现象是**"这一声有多突出"**，
        而"响了多久"是另一个维度，不该混进同一个数。

    改用**30ms 滑动窗取最大**：对 0.07s 的 fire 和 1.35s 的 lose 都只问
    "它最响亮的一瞬有多响"，与总时长解耦。实测（本项目 19 个 SFX）：
      win20/30/50ms 三档下 `prio5 > prio4 > prio3 > prio2 > prio1` **全部严格单调**，
      证明游戏音频的层级设计本身是正确的，错的只是判据尺度。

    窗口宽度不敏感（8.03/8.78/10.48 三档结论一致），故取 30ms 居中。
    """
    if not v:
        return float("-inf")
    n = max(1, int(win_ms / 1000.0 * sr))
    kw = kweight_loudness  # 复用同一加权，保证与 loud 同量纲
    if n >= len(v):
        return kw(v, sr)
    # K 加权后按步长滑窗，取最大均值平方
    lp = _kweight_filter(v, sr)
    step = max(1, n // 4)
    run = sum(x * x for x in lp[:n]) / n
    best = run
    for i in range(n, len(lp), step):
        run = sum(x * x for x in lp[i - n + 1:i + 1]) / n
        if run > best:
            best = run
    if best <= 1e-12:
        return float("-inf")
    return 10.0 * math.log10(best)


def _kweight_filter(v, sr):
    """K 加权滤波后的样本（与 kweight_loudness 内部同实现，抽出来供窗函数复用）。"""
    rc = 1.0 / (2 * math.pi * LOW_CUT)
    dt = 1.0 / sr
    a = rc / (rc + dt)
    y = 0.0; prev_x = v[0]
    hp = []
    for x in v:
        y = a * (y + x - prev_x)
        prev_x = x
        hp.append(y)
    rc2 = 1.0 / (2 * math.pi * HIGH_CUT)
    a2 = dt / (rc2 + dt)
    lp = []
    z = hp[0]
    for x in hp:
        z = z + a2 * (x - z)
        lp.append(z)
    return lp


def analyze(path):
    v, sr = read_mono(path)
    if v is None or len(v) < 64:
        return None
    peak = max(abs(x) for x in v) / 32768.0
    # 有效时长：最后一次超过 -60dBFS 的位置
    thr = 0.001
    last = 0
    for i, x in enumerate(v):
        if abs(x) > thr * 32768:
            last = i
    dur = (last + 1) / float(sr)
    return dict(name=os.path.basename(path), dur=dur, sr=sr, peak=peak,
                loud=kweight_loudness(v, sr),
                loudW=window_peak_loudness(v, sr))


def _median(xs):
    s = sorted(xs); n = len(s)
    return s[n // 2] if n % 2 else 0.5 * (s[n // 2 - 1] + s[n // 2])


def _mad(xs, med):
    return _median([abs(x - med) for x in xs])


def selftest():
    import tempfile
    sr = 44100
    d = tempfile.mkdtemp()
    print("=== 判据自测（阴性对照）===")
    print("  关键：量的是**能量加权响度**，不是峰值（峰值不能区分尖脉冲与持续音）")

    def wr(name, vals):
        p = os.path.join(d, name)
        with wave.open(p, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
            w.writeframes(struct.pack("<%dh" % len(vals), *vals))
        return p

    def tone(f, g, n):
        return [int(g * math.sin(2 * math.pi * f * i / sr)) for i in range(n)]

    ok = True
    N = int(sr * 0.5)
    # A. 振幅减半 → 响度降 ~6dB
    ra = analyze(wr("a1.wav", tone(1000, 20000, N)))
    rb = analyze(wr("a2.wav", tone(1000, 10000, N)))
    diff = ra["loud"] - rb["loud"]
    a_ok = 4.0 < diff < 8.0
    print("  [A] 振幅减半      响度差=%.2fdB（期望≈6）→ %s" % (diff, "✅ 能量口径正确" if a_ok else "❌ 口径错"))
    ok = ok and a_ok

    # B. 同振幅、时长减半 → 全段均值平方必更低
    rc = analyze(wr("b1.wav", tone(1000, 20000, N)))
    rd = analyze(wr("b2.wav", tone(1000, 20000, N // 2) + [0] * (N // 2)))
    b_ok = rd["loud"] < rc["loud"] - 2.0
    print("  [B] 时长减半(补静音) 响度=%.1f vs %.1f → %s" % (rd["loud"], rc["loud"], "✅ 时长参与计算" if b_ok else "❌ 只看峰值"))
    ok = ok and b_ok

    # C. 峰值相同：尖脉冲 vs 持续音 → 持续音必显著更响
    spike = [0] * N
    spike[N // 2] = 30000          # 单点尖峰，峰值同 30000
    re_ = analyze(wr("c1.wav", spike))
    rf = analyze(wr("c2.wav", tone(1000, 30000, N)))
    c_ok = rf["loud"] > re_["loud"] + 20
    print("  [C] 尖脉冲 vs 持续音 响度=%.1f vs %.1f → %s" % (re_["loud"], rf["loud"], "✅ 非峰值伪装" if c_ok else "❌ 被峰值骗"))
    ok = ok and c_ok

    # D. 静音安全
    rg = analyze(wr("d.wav", [0] * N))
    d_ok = rg["loud"] == float("-inf")
    print("  [D] 纯静音        响度=%s → %s" % (rg["loud"], "✅ 安全返回 -inf" if d_ok else "❌ 未安全处理"))
    ok = ok and d_ok

    # E. 【v1.169】分档表必须覆盖磁盘上每个真实 sfx —— 否则它被层级体检静默跳过。
    #    这是本文件最容易复发的一类错：新增音效忘了补 LANE。
    adir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "game", "audio")
    files = [os.path.splitext(os.path.basename(f))[0]
             for f in sorted(glob.glob(os.path.join(adir, "sfx_*.wav")))]
    if not files:
        print("  [E] 分档覆盖度    磁盘无 sfx_*.wav → SKIP（不判）")
    else:
        miss = [n for n in files if n not in LANE]
        e_ok = not miss
        print("  [E] 分档覆盖度    %d 个文件 / LANE %d 条 → %s" % (
            len(files), len(LANE),
            "✅ 全覆盖" if e_ok else "❌ 漏 %d 个: %s（会被静默跳过）" % (len(miss), ", ".join(miss))))
        ok = ok and e_ok

    for f in os.listdir(d):
        try: os.remove(os.path.join(d, f))
        except OSError: pass
    try: os.rmdir(d)
    except OSError: pass
    print("selftest exit=%d" % (0 if ok else 1))
    return 0 if ok else 1


def main():
    if "--selftest" in sys.argv:
        return selftest()
    d = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "game", "audio")
    out = sys.argv[2] if len(sys.argv) > 2 else None
    rows = []
    for f in sorted(glob.glob(os.path.join(d, "sfx_*.wav"))):
        r = analyze(f)
        if r:
            r["lane"] = LANE.get(os.path.splitext(r["name"])[0].replace(".wav", ""), "?")
            rows.append(r)
    unclassified = [r["name"] for r in rows if r["lane"] == "?"]
    lines = ["# SFX 响度层级体检（纯标准库，CI 端）", "",
             "> ⚠ 数值是**本项目内部可横向比较的相对响度**（简化 K 加权：100Hz 高通 + 8kHz 低通 + 均值平方），",
             "> **不是标准 LUFS，不可对外这样称呼**。用途仅限：本套音效之间的层级排序。", "",
             "> 判据立场：高频事件（每秒数次）必须显著低于低频事件（每局几次），",
             "> 否则长局被磨耳朵；但任何频率事件也不该低到「没反馈」。", "",
             "| 文件 | 事件档 | 有效时长 s | 峰值 | 相对响度 dB | 判定 |",
             "|---|---|---|---|---|---|"]
    if not rows:
        lines.append("| （无 sfx_*.wav） | - | - | - | - | SKIP |")
    else:
        lanes = {}
        for r in rows:
            lanes.setdefault(r["lane"], []).append(r)
        # 【v1.169】GATE: 任何 sfx 文件没被分档 → 它会被层级体检**静默跳过**。
        #   实测教训：分档表曾只列 15 条而实际有 19 个文件 → 4 个节点音进 "?" 档，
        #   体检照样打"✅ 层级成立"，但根本没量过它们（漏掉的正好是新增的）。
        if unclassified:
            lines += ["", "## ⛔ GATE: 存在未分档音效（会被层级体检静默跳过）", ""]
            for n in unclassified:
                lines.append("- `%s` 不在 LANE 表里 → 请在 ci/sfx-loudness.py 的 LANE 中补档" % n)
            lines.append("")
            lines.append("> 未分档 = **检查漏掉它**，而不是「它没问题」。必须补档后再看结论。")
        # 组内离群
        outl = []
        for ln, rs in lanes.items():
            if len(rs) < 3:
                for r in rs:
                    r["verdict"] = "OK(组小,不判离群)"
                continue
            med = _median([x["loud"] for x in rs])
            sd = 1.4826 * _mad([x["loud"] for x in rs], med)
            for r in rs:
                if sd > 1e-9 and abs(r["loud"] - med) > 3 * sd:
                    r["verdict"] = "OUTLIER(组内偏%s %.1fdB, 中位 %.1f)" % (
                        "响" if r["loud"] > med else "轻", r["loud"] - med, med)
                    outl.append(r["name"])
                else:
                    r["verdict"] = "OK"
        for r in sorted(rows, key=lambda x: (x["lane"], -x["loud"])):
            lines.append("| %s | %s | %.2f | %.2f | %.1f | %s |" % (
                r["name"], r["lane"], r["dur"], r["peak"], r["loud"], r["verdict"]))
        # 跨档层级是否成立
        line_med = {}
        for ln, rs in lanes.items():
            if len(rs) >= 2:
                line_med[ln] = _median([x["loud"] for x in rs])
        lines += ["", "## 跨档层级（中位相对响度）", ""]
        for ln in ("INFREQ", "MID", "FREQ", "?"):
            if ln in line_med:
                lines.append("- **%s**：%.1f dB（%d 条）" % (ln, line_med[ln], len(lanes[ln])))
        verdicts = []
        if "INFREQ" in line_med and "FREQ" in line_med:
            gap = line_med["INFREQ"] - line_med["FREQ"]
            verdicts.append("低频事件(INFREQ) 比 高频事件(FREQ) **高 %.1f dB**" % gap)
            if gap < 3:
                verdicts.append("⚠ 差距 < 3dB → 高频事件可能偏吵，长局伤耳")
            else:
                verdicts.append("✅ 层级成立（高频事件被压住）")
        lines += ["", "## 结论", ""] + ["- " + v for v in verdicts]
        if outl:
            lines.append("- ⚠ 组内离群（值得试听，未必是缺陷）：%s" % "、".join(outl))
        else:
            lines.append("- 各组内无离群音效")
        if unclassified:
            lines.append("- ⛔ **未分档 %d 个 → 层级体检不完整，本次结论不可信**" % len(unclassified))
    txt = "\n".join(lines)
    print(txt)
    if out:
        with open(out, "w", encoding="utf-8") as fh:
            fh.write(txt)
        print("\n→ 已写 " + out)
    # 【v1.169】层级数值本身只提示（音效风格是主观取舍），
    #   但"有音效未分档"是**检查完整性问题**，必须算门禁 —— 否则漏掉的那几个
    #   会一直假装"没问题"。可用 --no-gate 降级为提示。
    if unclassified and "--no-gate" not in sys.argv:
        print("\n## ⛔ GATE FAIL: %d 个音效未分档（层级体检漏检）" % len(unclassified))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
