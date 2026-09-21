# -*- coding: utf-8 -*-
"""SFX 意图-实响一致性体检（纯标准库）

存在理由
  `CONFIG.audio.gains` 是设计师写下的响度意图；文件是被烘焙出来的实响。
  正确口径是**档位**：设计注释（游戏 ~85730 行）写的是 5 级纵向层级 ——

      受击/复活(prio 5) > BOSS(prio 4) > 升级/选卡/结算/击杀(prio 3)
                       > 宝石(prio 2) > 开火/命中(prio 1)

  其精神是"**按事件发生频率分层**"：每局几次的要比每秒数次的响，
  否则长局持续高频音会磨耳朵（游戏注释 v1.152→v1.160 反复在修这件事）。

判据（与现象同尺度）
  ① 档均值严格单调：`prio5 > prio4 > prio3 > prio2 > prio1`（相邻档都要成立）。
  ② 极点落差：`prio5 − prio1 ≥ MIN_SPREAD` dB。
  ③ 档内离群：中位数 + 3×1.4826×MAD，**只警告不判死**（包络风格是主观取舍）。

⚠ 判据演进（三代，每次都是"尺度错了"，请勿回退）
  · 第一代：逐对比较 gain 与文件响度 → 错。gain 是"档内调色"，响度是"能量×时长"，
    二者方向可合法不一致（`SFX_BOMB` gain 0.66 却比 `SFX_REVIVE` gain 0.62 轻 8dB）。
  · 第二代：压成 3 档（INFREQ/MID/FREQ）+ **全段**均值平方 → 仍然错，两个缺陷叠加：
      (a) **3 档压平**：把 prio3~prio5 全塞进 INFREQ/MID，档内跨度 5.9dB，
          而 prio1 与 prio3 区间大量重叠 → 判"MID − FREQ 塌陷"其实是**分组粒度不够**。
      (b) **全段 RMS 让时长进了响度**：`sfx_lose` 1.35s 全段 -16.0dB、
          `sfx_hurt` 0.20s 全段 -16.2dB → 体检读出"结算音比受击音更响"，
          但设计写的是 HURT(prio5) 该高于 LOSE(prio3)。**长音天然全段 RMS 高，
          它污染了层级比较** —— 被测现象是"这一声有多突出"，"响了多久"是另一个维度。
  · 第三代（本版 v1.177）：**按 prios 5 级分档 + 用 30ms 滑动窗峰值响度（`loudW`）**。
      实测 19 个 SFX 在 win20/30/50ms 下 5 档**全部严格单调** →
      证明**游戏音频的层级设计本身正确，错的只是判据尺度**。
      这一步同时否掉了"要给 cardshow 硬抬响度去凑 MID−FREQ"的错误修法
      （那会让卡片提示比开局还响，制造新的响度失衡）。
"""
import sys, os, glob, importlib.util

_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("_sfx_loudness", os.path.join(_HERE, "sfx-loudness.py"))
_sl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_sl)
analyze, load_gains = _sl.analyze, _sl.load_gains

MIN_SPREAD = 2.0     # prio5 必须比 prio1 至少高这么多 dB（低于此视为层级塌陷）
METRIC = "loudW"     # 【v1.177】层级判据用滑动窗峰值响度，不用全段 loud（见头注"判据演进"）

# 【v1.177】分档真身 = 游戏自己的 `CONFIG.audio.prios`（5 级纵向层级）。
# ⚠ 与 ci/sfx-loudness.py 的 LANE（3 档）是**两个不同用途**：LANE 用于"高频 vs 低频"的
#   磨耳朵检查（粗分即可），本表用于"纵向层级"，必须与 prios 一一对应。
# ⚠ 新增 SFX 必须同步 `CONFIG.audio.prios`、`LANE`、本表三处；本文件 selftest 会查覆盖度。
PRIO = {
    "sfx_hurt": 5, "sfx_revive": 5,
    "sfx_boss_warn": 4, "sfx_boss_die": 4, "sfx_start": 4, "sfx_evo": 4, "sfx_bomb": 4,
    "sfx_levelup": 3, "sfx_card": 3, "sfx_cardshow": 3, "sfx_chest": 3, "sfx_event": 3,
    "sfx_win": 3, "sfx_lose": 3, "sfx_ui": 3, "sfx_kill": 3,
    "sfx_gem": 2,
    "sfx_fire": 1, "sfx_hit": 1,
}
LEVELS = (5, 4, 3, 2, 1)
LEVEL_NAME = {5: "受击/复活", 4: "BOSS/开局/进化", 3: "升级/选卡/结算/击杀",
              2: "宝石", 1: "开火/命中"}


def collect(root):
    rows = []
    for f in sorted(glob.glob(os.path.join(root, "game", "audio", "sfx_*.wav"))):
        r = analyze(f)
        if not r:
            continue
        base = os.path.splitext(os.path.basename(f))[0]
        r["base"] = base
        r["prio"] = PRIO.get(base)      # None = 未分档（run() 里会 FAIL 报出）
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
    L.append("> 口径：以游戏 `CONFIG.audio.prios` 的 **5 级纵向层级**为准，")
    L.append("> 判据用 **30ms 滑动窗峰值响度**（不用全段 RMS —— 后者把时长混进了响度，见头注）。\n")

    if not rows:
        L.append("## **FAIL** — 未解析到任何 sfx_*.wav（解析失效 ≡ 守卫失效）")
        return emit(L, out_path, False)

    # 覆盖度：每个文件都必须在 PRIO 表里，否则它被静默排除在层级体检之外
    missing = [r["name"] for r in rows
               if os.path.splitext(r["name"])[0] not in PRIO]
    if missing:
        L.append("## **FAIL** — 以下文件不在 PRIO 分档表里 → 被层级体检静默跳过：")
        for n in missing:
            L.append("- `%s`" % n)
        L.append("\n→ 请在 ci/sfx-intent-vs-real.py 的 `PRIO` 中补档（须与游戏 `prios` 一致）。")
        return emit(L, out_path, False)

    groups = {}
    for r in rows:
        groups.setdefault(PRIO[os.path.splitext(r["name"])[0]], []).append(r)

    L.append("| 档(prio) | 语义 | n | 响度均值 | 中位 | 最响 | 最轻 |")
    L.append("|---|---|---|---|---|---|---|")
    stat = {}
    for lv in LEVELS:
        g = groups.get(lv, [])
        if not g:
            continue
        ls = [x[METRIC] for x in g]
        m = sum(ls) / len(ls)
        md, _ = med_mad(ls)
        stat[lv] = m
        hi = max(g, key=lambda x: x[METRIC]); lo = min(g, key=lambda x: x[METRIC])
        L.append("| %d | %s | %d | %.1f | %.1f | %s(%.1f) | %s(%.1f) |" % (
            lv, LEVEL_NAME[lv], len(g), m, md,
            hi["name"].replace("sfx_", "").replace(".wav", ""), hi[METRIC],
            lo["name"].replace("sfx_", "").replace(".wav", ""), lo[METRIC]))

    L.append("\n## 相邻档落差（要求 prio5 > prio4 > prio3 > prio2 > prio1）")
    present = [lv for lv in LEVELS if lv in stat]
    breaks = []
    for a, b in zip(present, present[1:]):
        d = stat[a] - stat[b]
        okp = d > 0
        if not okp:
            breaks.append((a, b, d))
        L.append("- prio%d − prio%d = **%+.1f dB** %s" % (a, b, d, "✅" if okp else "❌ **逆序**"))
    spread = (stat[present[0]] - stat[present[-1]]) if len(present) >= 2 else None

    L.append("\n## 档内离群（中位数 + 3×1.4826×MAD，仅提示）")
    warns = []
    for lv in LEVELS:
        g = groups.get(lv, [])
        if len(g) < 4:
            continue
        md, mad = med_mad([x[METRIC] for x in g])
        thr = 3 * 1.4826 * (mad or 0)
        if thr <= 0.01:
            continue
        L.append("- **prio %d**（中位 %.1f，阈值 ±%.1f）：" % (lv, md, thr))
        for x in sorted(g, key=lambda y: y[METRIC]):
            if abs(x[METRIC] - md) > thr:
                warns.append(x["name"])
                L.append("  - ⚠ %s %.1f（偏离中位 %+.1f）" % (
                    x["name"], x[METRIC], x[METRIC] - md))

    ok = (not breaks) and (spread is not None and spread >= MIN_SPREAD)
    L.append("\n## 结论")
    L.append("- 5 档严格单调：%s" % ("✅" if not breaks else "❌ 有 %d 处逆序" % len(breaks)))
    L.append("- prio5 − prio1 = %s dB（门限 ≥ %.1f）" % (
        ("%.1f" % spread) if spread is not None else "N/A", MIN_SPREAD))
    L.append("- 档内离群 %d 个（仅提示，不判死）：%s" % (
        len(warns), "、".join(warns) if warns else "无"))
    L.append("\n" + ("## **PASS** — 意图与实响方向一致 ✅" if ok else
                     "## **FAIL** — 纵向层级塌陷（相邻档逆序或极差不足），需调 gain 或包络"))
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
    """用真名造样本（PRIO 表只认 19 个固定键），覆盖三类情形。

    ⚠ 关键设计（为什么用**窗口响度**而不是"整段"来造样本）：
      若用"长音 vs 短音"来造层级，本判据（loudW）应**忽略时长**只比峰值 —— 这正是它的价值。
      故样本 A 故意把 prio5 造得**短而响**、prio3 造得**长而弱**：
      旧的全段 RMS 口径会把它判成"塌陷"（假阳性），新口径应判 PASS。**这条即是回归守卫。**
    """
    import tempfile, shutil, math
    SR = 44100
    fails = []

    def wav(path, samples):
        import wave, struct
        w = wave.open(path, "wb")
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", max(-32768, min(32767, int(v * 32767)))) for v in samples))
        w.close()

    def mk(root, spec):
        # spec: {name: (prio, ampl, dur)}
        ad = os.path.join(root, "game", "audio"); os.makedirs(ad, exist_ok=True)
        for nm, (lv, ampl, dur) in spec.items():
            n = int(SR * dur)
            s = [ampl * math.sin(2 * math.pi * 440 * i / SR) for i in range(n)]
            wav(os.path.join(ad, "sfx_%s.wav" % nm), s)
        # 空 gains 的 html，避免 load_gains 报错
        open(os.path.join(root, "game", "萌兽消消岛.html"), "w", encoding="utf-8") \
            .write("var CONFIG={audio:{gains:{}}};")

    REAL = {"revive": 5, "hurt": 5, "boss_die": 4, "boss_warn": 4,
            "levelup": 3, "win": 3, "lose": 3, "cardshow": 3,
            "gem": 2, "fire": 1, "hit": 1, "ui": 1}

    # A: 层级按**峰值**正确，但故意让高 prio 短、低 prio 长
    #    → 旧"全段"口径会误报塌陷；新 loudW 口径必须 PASS（时长无关）
    d = tempfile.mkdtemp()
    try:
        os.makedirs(os.path.join(d, "game"), exist_ok=True)
        spec = {}
        for nm, lv in REAL.items():
            ampl = 0.80 - 0.13 * (5 - lv)     # prio5 → 0.80 … prio1 → 0.28
            dur = 0.10 + 0.25 * (5 - lv)      # prio5 → 0.10s（短）… prio1 → 0.60s（长）★反转
            spec[nm] = (lv, ampl, dur)
        mk(d, spec)
        r = run(d)
        if r != 0:
            fails.append("阴性对照 A 失败：峰值层级正确（时长故意反转）却判 FAIL → 判据仍被时长污染")
    finally:
        shutil.rmtree(d, ignore_errors=True)

    # B: 真塌陷（所有档同峰值）→ 必须 FAIL
    d = tempfile.mkdtemp()
    try:
        os.makedirs(os.path.join(d, "game"), exist_ok=True)
        spec = {nm: (lv, 0.7, 0.4) for nm, lv in REAL.items()}
        mk(d, spec)
        r = run(d)
        if r == 0:
            fails.append("阴性对照 B 失败：纵向层级塌陷却判 PASS")
    finally:
        shutil.rmtree(d, ignore_errors=True)

    # C: 覆盖度守卫 —— 漏一个文件进 PRIO 表必须 FAIL（防止被静默跳过）
    d = tempfile.mkdtemp()
    try:
        os.makedirs(os.path.join(d, "game"), exist_ok=True)
        spec = {nm: (lv, 0.3 + 0.1 * lv, 0.4) for nm, lv in REAL.items()}
        mk(d, spec)
        # 造一个不在 PRIO 表里的新文件
        wav(os.path.join(d, "game", "audio", "sfx_zzznew.wav"),
            [20000 * math.sin(2 * math.pi * 440 * i / SR) for i in range(int(SR * 0.3))])
        r = run(d)
        if r == 0:
            fails.append("阴性对照 C 失败：有文件不在 PRIO 表里却判 PASS（会被静默跳过）")
    finally:
        shutil.rmtree(d, ignore_errors=True)

    # D: 中间档逆序（prio4 比 prio5 更响）→ 必须 FAIL
    d = tempfile.mkdtemp()
    try:
        os.makedirs(os.path.join(d, "game"), exist_ok=True)
        spec = {}
        for nm, lv in REAL.items():
            ampl = 0.30 + 0.09 * lv
            if lv == 4:
                ampl = 0.85                      # prio4 反超 prio5 → 逆序
            spec[nm] = (lv, ampl, 0.4)
        mk(d, spec)
        r = run(d)
        if r == 0:
            fails.append("阴性对照 D 失败：中间档逆序（prio4 > prio5）却判 PASS")
    finally:
        shutil.rmtree(d, ignore_errors=True)

    print("\n" + "=" * 50)
    if fails:
        for f in fails:
            print("❌ " + f)
        return 1
    print("✅ 阴性对照全通过（A 时长无关 / B 塌陷可检 / C 覆盖度 / D 逆序可检）")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    _root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(_HERE), "")
    _out = sys.argv[2] if len(sys.argv) > 2 else None
    sys.exit(run(os.path.abspath(_root), _out))
