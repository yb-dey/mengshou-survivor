# -*- coding: utf-8 -*-
"""BGM 频谱重心与编排平衡体检（纯标准库 DFT，零依赖，CI 可跑）

存在理由
  游戏 BGM 听感"糊成一团 / 单薄 / 所有曲子听起来一样"，根因常在**编排**上：
  垫层与旋律的音区挤在一起（频谱重心全都落在同一处），或某曲异常偏重低频。
  这些都是**客观可测**的，且在 10 首曲子的横向比较里才看得出来。

⚠⚠ 本判据的 v1 是错的，错误类型与本项目 `text-legibility.py` 完全相同
   ——「参考量与实际信号不同尺度」。记录在此以免重犯：

   v1 用「高频(2k-6k)+空气(6k-20k) 占总能量 > 4%」判"不闷"。
   实测发现：本项目音频合成**只用 sine / triangle / saw** 三种波形，
   而 sine 与 triangle 的**高频是物理 0**：
       sine  220Hz → low 100.0% ｜ high 0.0% ｜ air 0.0%
       tri   220Hz → low  98.5% ｜ high 0.0% ｜ air 0.0%
       saw   220Hz → low  60.8% ｜ high 4.3% ｜ air 1.9%
   → 对 sine/triangle 垫乐，"air < 4%" **恒成立**。25 条 wav 里 24 条被判"闷"，
     这个阈值测的是**有没有用带谐波的波形**，根本不是"配平好不好"。
     **恒真的阈值 = 在报定义，不是在测画面。**（与 lowct% 常年 70-91% 同源）

   v2（本文件）改用两个**与信号同尺度**的口径：

   1. `centroid` —— 频谱重心（能量加权平均频率，Hz）
      对 sine/triangle/saw 都成立，因为它是**相对量**：单音时它就等于基音频率，
      多音叠加时它落在编排重心上。**能真实反映"音区挤不挤"。**

   2. `lowShare = (20-500Hz 能量占比)` —— **只做跨曲横向比较**，找离群，
      **不使用绝对阈值**（绝对阈值来自带谐波的流行乐经验，对纯音垫乐不适用）。

   判定：用**中位数 + MAD**（稳健离群法，抗单曲极值污染），
        |x - median| > 3 × 1.4826 × MAD 记 OUTLIER。

阴性对照（`--selftest`，设计时先问"样本物理上真含该现象吗"）：
  A. 单音 220Hz sine   → centroid 应 ≈ 220Hz（证明重心真是基音，不是常数）
  B. 单音 880Hz sine   → centroid 应 ≈ 880Hz（证明重心随音高单调变化）
  C. 220Hz sine 与 saw 同基音 → saw 的 centroid 必须**显著更高**
     （证明判据能区分波形，即"高频含量"确实被量到了）
  D. 平坦静音 → 无定义，必须安全返回而不崩
"""
import sys, os, glob, wave, struct, math

BANDS = [(20, 60, "sub"), (60, 250, "low"), (250, 500, "lowmid"),
         (500, 2000, "mid"), (2000, 6000, "high"), (6000, 20000, "air")]
NFFT = 4096
HOP = 8192
MAX_FRAMES = 24


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


def frame_spectrum(seg, sr):
    """返回 [(freq, power)]，汉宁窗 + 朴素 DFT"""
    N = len(seg)
    w = [0.5 - 0.5 * math.cos(2 * math.pi * i / (N - 1)) for i in range(N)]
    x = [seg[i] * w[i] / 32768.0 for i in range(N)]
    kmax = min(int(20000.0 / sr * N), N // 2)
    cos_t = [math.cos(-2 * math.pi * k / N) for k in range(kmax)]
    sin_t = [math.sin(-2 * math.pi * k / N) for k in range(kmax)]
    out = []
    for k in range(1, kmax):
        re = 0.0; im = 0.0
        ck = cos_t[k]; sk = sin_t[k]
        cr = 1.0; ci = 0.0
        for n in range(N):
            re += x[n] * cr
            im += x[n] * ci
            nr = cr * ck - ci * sk
            ci = cr * sk + ci * ck
            cr = nr
        out.append((k * sr / float(N), re * re + im * im))
    return out


def analyze(path):
    v, sr = read_mono(path)
    if v is None or len(v) < NFFT + HOP:
        return None
    tot = dict((b[2], 0.0) for b in BANDS)
    grand = 0.0
    centroid_num = 0.0
    frames = 0
    st = 0
    while st + NFFT <= len(v) and frames < MAX_FRAMES:
        for f, p in frame_spectrum(v[st:st + NFFT], sr):
            grand += p
            centroid_num += f * p
            for lo, hi, nm in BANDS:
                if lo <= f < hi:
                    tot[nm] += p
                    break
        frames += 1
        st += HOP
    if grand <= 0:
        return None
    share = dict((k, 100.0 * tot[k] / grand) for k in tot)
    return dict(name=os.path.basename(path), dur=len(v) / float(sr), sr=sr,
                centroid=centroid_num / grand, low_share=share["sub"] + share["low"] + share["lowmid"],
                share=share,
                peak=max(abs(x) for x in v) / 32768.0)


def _median(xs):
    s = sorted(xs); n = len(s)
    return s[n // 2] if n % 2 else 0.5 * (s[n // 2 - 1] + s[n // 2])


def _mad(xs, med):
    return _median([abs(x - med) for x in xs])


def selftest():
    import tempfile
    sr, N = 44100, 44100
    d = tempfile.mkdtemp()
    print("=== 判据自测（阴性对照）===")
    print("  设计前提：先问「样本物理上真含我要检测的现象吗」")

    def wr(name, vals):
        p = os.path.join(d, name)
        with wave.open(p, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
            w.writeframes(struct.pack("<%dh" % len(vals), *vals))
        return p

    def sine(f, g=18000):
        return [int(g * math.sin(2 * math.pi * f * i / sr)) for i in range(N)]

    def saw(f, g=18000):
        return [int(g * ((2 * ((f * i / sr) % 1.0)) - 1)) for i in range(N)]

    ok = True
    # A. 220Hz sine → centroid ≈ 220
    ra = analyze(wr("a.wav", sine(220)))
    a_ok = abs(ra["centroid"] - 220) < 60
    print("  [A] 220Hz sine  centroid=%7.1fHz → %s" % (ra["centroid"], "✅ 重心=基音" if a_ok else "❌ 重心错"))
    ok = ok and a_ok

    # B. 880Hz sine → centroid ≈ 880（随音高单调变化）
    rb = analyze(wr("b.wav", sine(880)))
    b_ok = abs(rb["centroid"] - 880) < 120
    print("  [B] 880Hz sine  centroid=%7.1fHz → %s" % (rb["centroid"], "✅ 随音高变化" if b_ok else "❌ 不随音高变"))
    ok = ok and b_ok

    # C. 220Hz saw 的 centroid 必须显著高于 220Hz sine（证明能量到高频含量）
    rc = analyze(wr("c.wav", saw(220)))
    c_ok = rc["centroid"] > ra["centroid"] * 2.0
    print("  [C] 220Hz saw   centroid=%7.1fHz vs sine %7.1fHz → %s" % (
        rc["centroid"], ra["centroid"], "✅ 能分辨波形谐波" if c_ok else "❌ 量不到谐波"))
    ok = ok and c_ok

    # D. 静音 → 安全返回 None，不崩
    rd = analyze(wr("d.wav", [0] * N))
    d_ok = rd is None
    print("  [D] 纯静音      → %s" % ("✅ 安全返回 None" if d_ok else "❌ 未安全处理"))
    ok = ok and d_ok

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
    files = sorted(glob.glob(os.path.join(d, "bgm_*.wav")))
    rows = []
    for f in files:
        r = analyze(f)
        if r:
            rows.append(r)
    lines = ["# BGM 频谱重心与编排平衡体检（纯标准库 DFT，CI 端）", "",
             "> 判据只做**跨曲横向比较**（中位数 + MAD 稳健离群），**不使用绝对阈值** ——",
             "> 绝对阈值来自带谐波的流行乐经验，对本项目 sine/triangle 纯音垫乐不适用",
             "> （sine/triangle 高频物理为 0，任何 `air<4%` 类阈值恒真 = 在报波形定义）。", "",
             "| 文件 | 时长 s | 频谱重心 Hz | 低频段占比% | sub | low | lowmid | mid | high | air | 判定 |",
             "|---|---|---|---|---|---|---|---|---|---|---|"]
    if not rows:
        lines.append("| （无 bgm_*.wav） | - | - | - | - | - | - | - | - | - | SKIP |")
    else:
        cents = [r["centroid"] for r in rows]
        lows = [r["low_share"] for r in rows]
        mc, ml = _median(cents), _median(lows)
        sc, sl = 1.4826 * _mad(cents, mc), 1.4826 * _mad(lows, ml)
        outliers = []
        for r in rows:
            flags = []
            if sc > 1e-9 and abs(r["centroid"] - mc) > 3 * sc:
                flags.append("重心离群(中位 %.0fHz)" % mc)
            if sl > 1e-9 and abs(r["low_share"] - ml) > 3 * sl:
                flags.append("低频占比离群(中位 %.0f%%)" % ml)
            verdict = "OK" if not flags else ("OUTLIER: " + "；".join(flags))
            if flags:
                outliers.append(r["name"])
            s = r["share"]
            lines.append("| %s | %.1f | %.0f | %.1f | %.1f | %.1f | %.1f | %.1f | %.1f | %.1f | %s |" % (
                r["name"], r["dur"], r["centroid"], r["low_share"],
                s["sub"], s["low"], s["lowmid"], s["mid"], s["high"], s["air"], verdict))
        lines += ["", "## 统计基线", "",
                  "- 频谱重心：中位 %.0f Hz ｜ 稳健标准差 %.0f Hz" % (mc, sc),
                  "- 低频段占比：中位 %.1f%% ｜ 稳健标准差 %.1f%%" % (ml, sl),
                  "- 离群阈值：|x − 中位| > 3×稳健σ", "",
                  "## 结论", "",
                  ("- %d 首曲目，重心与低频配平**全部在分布内**（无离群）" % len(rows)) if not outliers
                  else ("- ⚠ 离群曲目（值得人工听一遍，未必是缺陷）：%s" % "、".join(outliers))]
    txt = "\n".join(lines)
    print(txt)
    if out:
        with open(out, "w", encoding="utf-8") as fh:
            fh.write(txt)
        print("\n→ 已写 " + out)
    return 0        # 横向离群只提示，不作门禁（风格化配平是合法选择）


if __name__ == "__main__":
    sys.exit(main())
