# -*- coding: utf-8 -*-
"""SFX 意图-实响一致性体检（纯标准库）

存在理由
  `CONFIG.audio.gains` 是设计师写下的响度意图；文件是被烘焙出来的实响。
  但**两者不是同一个尺度** —— 这一点我第一版判据搞错了（见文末"判据演进"）。
  正确口径是**档位**：设计注释（游戏 1420 行）写的是

      受击/复活 > BOSS > 升级/选卡/结算 > 击杀/宝石 > 开火/命中

  其精神是"**按事件发生频率分层**"：每局几次的（INFREQ）要比每秒数次的（FREQ）响，
  否则长局持续高频音会磨耳朵（游戏注释 v1.152→v1.160 反复在修这件事）。

判据（与现象同尺度）
  ① 档均值单调：`INFREQ > MID > FREQ`，且 `INFREQ − FREQ` 必须 ≥ 本文件 `MIN_SPREAD` dB。
  ② 档内离群：中位数 + 3×1.4826×MAD，**只警告不判死**（包络风格是主观取舍）。

⚠ 为什么**不**逐对比较 gain 与文件响度（第一版的错）
    gain 是"档内调色"，响度是"能量 × 时长"。二者方向可以合法地不一致：
    `SFX_BOMB`(gain 0.66) 实测比 `SFX_REVIVE`(gain 0.62) 轻 8dB —— 因为 BOMB 是
    **短促闷响**、REVIVE 是**绵长上扬**，峰值同为 0.7 时能量差就是很大。
    逐对比较会把这种**合法设计**报成 21 组"反向对"，掩盖唯一真问题。
    本项目铁律："参考量必须与被测现象同尺度"—— 档位对档位才是。
"""
import sys, os, glob, importlib.util

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("_sfx_loudness", os.path.join(_HERE, "sfx-loudness.py"))
_sl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_sl)
analyze, LANE, load_gains = _sl.analyze, _sl.LANE, _sl.load_gains

MIN_SPREAD = 2.0     # INFREQ 必须比 FREQ 至少高这么多 dB（低于此视为层级塌陷）
LANES = ("INFREQ", "MID", "FREQ")


def collect(root):
    rows = []
    for f in sorted(glob.glob(os.path.join(root, "game", "audio", "sfx_*.wav"))):
        r = analyze(f)
        if not r:
            continue
        base = os.path.splitext(os.path.basename(f))[0]
        r["lane"] = LANE.get(base, "?")
        rows.append(r)
    return rows


def med_mad(vals):
    s = sorted(vals); n = len(s)
    if not n:
        return None, None
    med = s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2
    dev = sorted(abs(v - med) for v in s)
    mad = dev[n // 2] if n % 2 else (dev[n // 2 - 1] + dev[n // 2]) / 2
    return med, mad


def run(root, out_path=None):
    html = ""
    hp = os.path.join(root, "game", "萌兽消消岛.html")
    if os.path.exists(hp):
        html = open(hp, encoding="utf-8", errors="replace").read()
    gains = load_gains(html) if html else {}

    rows = collect(root)
    L = []
    L.append("# SFX 意图-实响一致性体检\n")
    L.append("> 口径：设计意图是**按事件频率分层的档位关系**（游戏 1420 行注释），")
    L.append("> 故本检查比的是**档均值**，不是逐对 gain —— 二者不同尺度（见脚本头注）。\n")

    if not rows:
        L.append("## **FAIL** — 未解析到任何 sfx_*.wav（解析失效 ≡ 守卫失效）")
        return emit(L, out_path, False)

    L.append("| 档位 | n | 响度均值 | 中位 | 最响 | 最轻 |")
    L.append("|---|---|---|---|---|---|")
    stat = {}
    groups = {}
    for r in rows:
        groups.setdefault(r["lane"], []).append(r)
    for lane in LANES:
        g = groups.get(lane, [])
        if not g:
            continue
        ls = [x["loud"] for x in g]
        m = sum(ls) / len(ls)
        md, _ = med_mad(ls)
        stat[lane] = m
        hi = max(g, key=lambda x: x["loud"]); lo = min(g, key=lambda x: x["loud"])
        L.append("| %s | %d | %.1f | %.1f | %s(%.1f) | %s(%.1f) |" % (
            lane, len(g), m, md, hi["name"], hi["loud"], lo["name"], lo["loud"]))

    L.append("\n## 档间落差（要求 INFREQ > MID > FREQ）")
    pairs = [("INFREQ", "MID"), ("MID", "FREQ"), ("INFREQ", "FREQ")]
    spread = None
    for a, b in pairs:
        if a in stat and b in stat:
            d = stat[a] - stat[b]
            if a == "INFREQ" and b == "FREQ":
                spread = d
            L.append("- %s − %s = **%+.1f dB**" % (a, b, d))

    L.append("\n## 档内离群（中位数 + 3×1.4826×MAD，仅提示）")
    warns = []
    for lane in LANES:
        g = groups.get(lane, [])
        if len(g) < 4:
            continue
        md, mad = med_mad([x["loud"] for x in g])
        thr = 3 * 1.4826 * (mad or 0)
        L.append("- **%s**（中位 %.1f，阈值 ±%.1f）：%s" % (
            lane, md, thr,
            "无" if thr <= 0.01 else ""))
        if thr > 0.01:
            for x in sorted(g, key=lambda y: y["loud"]):
                if abs(x["loud"] - md) > thr:
                    warns.append(x["name"])
                    L.append("  - ⚠ %s %.1f（偏离中位 %+.1f）" % (x["name"], x["loud"], x["loud"] - md))

    # 判据①：档位单调 + 落差足够
    mono = (stat.get("INFREQ", -999) > stat.get("MID", 999) > stat.get("FREQ", 999))
    ok = mono and (spread is not None and spread >= MIN_SPREAD)
    L.append("\n## 结论")
    L.append("- 档位单调 INFREQ>MID>FREQ：%s" % ("✅" if mono else "❌"))
    L.append("- INFREQ − FREQ = %s dB（门限 ≥ %.1f）" % (
        ("%.1f" % spread) if spread is not None else "N/A", MIN_SPREAD))
    L.append("- 档内离群 %d 个（仅提示，不判死）：%s" % (
        len(warns), "、".join(warns) if warns else "无"))
    L.append("\n" + ("## **PASS** — 意图与实响方向一致 ✅" if ok else
                     "## **FAIL** — 档位层级塌陷（INFREQ 未显著高于 FREQ），需调 gain 或包络"))
    return emit(L, out_path, ok)


def emit(lines, out_path, ok):
    txt = "\n".join(lines)
    print(txt)
    if out_path:
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as fh:
            fh.write(txt + "\n")
        print("\n→ 已写 %s" % out_path)
    return 0 if ok else 1


# ---- 阴性对照：判据自己坏掉时必须能发现 ----
def selftest():
    import tempfile, shutil
    SR = 44100
    fails = []

    def wav(path, samples):
        import wave, struct
        w = wave.open(path, "wb")
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", max(-32768, min(32767, int(v * 32767)))) for v in samples))
        w.close()

    def mk(root, spec):
        # spec: {name: (lane_name, ampl, dur)}
        ad = os.path.join(root, "game", "audio"); os.makedirs(ad, exist_ok=True)
        for nm, (lane, ampl, dur) in spec.items():
            n = int(SR * dur)
            s = [ampl * __import__("math").sin(2 * 3.14159 * 440 * i / SR) for i in range(n)]
            wav(os.path.join(ad, "sfx_%s.wav" % nm), s)

    # A: 层级正确 → 必须 PASS
    d = tempfile.mkdtemp()
    try:
        os.makedirs(os.path.join(d, "game"), exist_ok=True)
        open(os.path.join(d, "game", "萌兽消消岛.html"), "w", encoding="utf-8").write("var CONFIG={audio:{gains:{}}};")
        spec = {}
        for nm in ("win", "lose", "revive"):
            spec[nm] = ("INFREQ", 0.7, 0.8)      # 长且满 → 响
        for nm in ("bomb", "kill", "chest"):
            spec[nm] = ("MID", 0.5, 0.5)
        for nm in ("fire", "hit", "ui"):
            spec[nm] = ("FREQ", 0.12, 0.1)       # 短且弱 → 轻
        mk(d, spec)
        # 让 LANE 认出（复题：LANE 只认 19 个固定名，这里用真名）
        r = run(d)
        if r != 0:
            fails.append("阴性对照 A 失败：层级正确却判 FAIL")
    finally:
        shutil.rmtree(d, ignore_errors=True)

    # B: 层级塌陷（FREQ 与 INFREQ 同响）→ 必须 FAIL
    d = tempfile.mkdtemp()
    try:
        os.makedirs(os.path.join(d, "game"), exist_ok=True)
        open(os.path.join(d, "game", "萌兽消消岛.html"), "w", encoding="utf-8").write("var CONFIG={audio:{gains:{}}};")
        spec = {}
        for nm in ("win", "lose", "revive"):
            spec[nm] = ("INFREQ", 0.7, 0.8)
        for nm in ("bomb", "kill", "chest"):
            spec[nm] = ("MID", 0.5, 0.5)
        for nm in ("fire", "hit", "ui"):
            spec[nm] = ("FREQ", 0.7, 0.8)        # 与 INFREQ 一样响 → 塌陷
        mk(d, spec)
        r = run(d)
        if r == 0:
            fails.append("阴性对照 B 失败：层级塌陷却判 PASS")
    finally:
        shutil.rmtree(d, ignore_errors=True)

    print("\n" + "=" * 50)
    if fails:
        for f in fails:
            print("❌ " + f)
        return 1
    print("✅ 阴性对照全通过：判据能 PASS 正确样本、能 FAIL 塌陷样本")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    _root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(_HERE), "")
    _out = sys.argv[2] if len(sys.argv) > 2 else None
    sys.exit(run(os.path.abspath(_root), _out))
