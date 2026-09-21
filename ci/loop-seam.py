# -*- coding: utf-8 -*-
"""BGM 循环接缝体检（纯标准库，零依赖，CI 可跑）

存在理由
  程序合成的 BGM 若首尾不接，循环时会有"咔哒"爆音——玩游戏最容易被听出来的廉价感之一。
  判据必须**先证明自己有效**（阴性对照），否则"全绿"毫无意义。

判据（v2）
  seamJump = |x[0] - x[n-1]|                                   # 环上第一差 = 接缝处的人为阶跃
  refLocal = P90(首 128 样本逐样本差 ∪ 末 128 样本逐样本差)     # 该曲**自身局部**的正常波动
  ratio    = seamJump / refLocal                               # < SEAM_MAX 判 PASS

  ⚠ 为什么 v1 的「全曲 P95」是错的（v1 自测暴露）：
     全曲 P95 度量的是**高频含量**，不是接缝失配。
     440Hz 正弦的逐样本差恒为 ~1250 → 任何接缝都被"自己的高频"掩盖（ratio≈1.0）。
     即：曲子越亮，越测不出接缝 → **该口径对高频/打击乐 BGM 完全失效**。
     改用**首尾 128 样本的局部差分**作参考：与接缝本身同尺度，才可比。

阴性对照（`--selftest`，三次构造才立住）：
  ⚠ 教训：正弦波**天然无缝**，无论相位如何都接得上 —— 拿它当"不接"的样本必然失败。
     真正的接缝来自**带包络的曲子被强行截断**（末段淡出到非零值 / 残留直流）。
  A. 包络曲尾淡到 0     → ratio 0.00   ✅ 判 PASS（不误报）
  B. 包络曲尾停在 +9000 → ratio 39.11  ✅ 判 FAIL（真检出）
  C. 末 50 样本残留直流 → ratio 52.17  ✅ 判 FAIL（真检出）

⚠ 只对**循环播放**的 BGM 有意义；win/lose 是一次性收尾曲，不检接缝（标 N/A）。
"""
import sys, os, glob, wave, struct

SEAM_MAX = 4.0        # 接缝阶跃 / 局部正常波动 的上限
NEAR = 128            # 首尾参考窗口（样本数）
ONESHOT = ("bgm_win", "bgm_lose")   # 一次性曲目，不循环


def read_mono(path):
    with wave.open(path, "rb") as w:
        ch = w.getnchannels()
        sw = w.getsampwidth()
        fr = w.getframerate()
        n = w.getnframes()
        raw = w.readframes(n)
    if sw != 2:
        return None, None, None
    vals = list(struct.unpack("<%dh" % (len(raw) // 2), raw))
    if ch == 2:
        vals = [(vals[i] + vals[i + 1]) // 2 for i in range(0, len(vals) - 1, 2)]
    return vals, fr, ch


def analyze(path):
    vals, fr, ch = read_mono(path)
    if vals is None or len(vals) < 2 * NEAR + 10:
        return None
    n = len(vals)
    name = os.path.basename(path)
    loop = not any(name.startswith(p) for p in ONESHOT)
    seam = abs(vals[0] - vals[n - 1])
    head = [abs(vals[i + 1] - vals[i]) for i in range(NEAR)]
    tail = [abs(vals[n - 1 - i] - vals[n - 2 - i]) for i in range(NEAR)]
    loc = sorted(head + tail)
    ref = loc[min(len(loc) - 1, int(len(loc) * 0.90))]
    ratio = (seam / ref) if ref > 0 else (0.0 if seam == 0 else float("inf"))
    return dict(name=name, dur=n / float(fr), sr=fr, ch=ch, loop=loop,
                seam=seam, ref=ref, ratio=ratio,
                peak=max(abs(v) for v in vals) / 32768.0,
                dc=sum(vals) / float(n))


def _write_wav(path, vals, sr=44100):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(struct.pack("<%dh" % len(vals), *vals))


def _envelope_track(n, sr, end_val):
    """带包络的曲型：末 2000 样本线性拉到 end_val（模拟淡出/截断）"""
    import math
    v = [int((0.5 + 0.5 * math.sin(2 * math.pi * i / n * 3)) * 15000 *
             math.sin(2 * math.pi * 220 * i / sr)) for i in range(n)]
    for k in range(2000):
        v[n - 2000 + k] = int(v[n - 2000 + k] * (1 - k / 2000.0) + end_val * (k / 2000.0))
    return v


def selftest():
    import tempfile
    sr, n = 44100, 88200
    d = tempfile.mkdtemp()
    ok = True
    print("=== 判据自测（阴性对照）===")
    print("  前提：正弦波天然无缝 → 阴性样本必须用「带包络的曲被截断」构造")

    # A. 应判 PASS：尾淡到 0
    pa = os.path.join(d, "pos.wav")
    _write_wav(pa, _envelope_track(n, sr, 0))
    ra = analyze(pa)
    a_ok = ra["ratio"] < SEAM_MAX
    print("  [A] 包络曲尾淡到0      ratio=%6.2f → %s" % (ra["ratio"], "✅ 不误报" if a_ok else "❌ 误报"))
    ok = ok and a_ok

    # B. 应判 FAIL：尾停在非零
    pb = os.path.join(d, "neg1.wav")
    _write_wav(pb, _envelope_track(n, sr, 9000))
    rb = analyze(pb)
    b_ok = rb["ratio"] >= SEAM_MAX
    print("  [B] 包络曲尾停在+9000  ratio=%6.2f → %s" % (rb["ratio"], "✅ 判据检出接缝" if b_ok else "❌ 判据漏检"))
    ok = ok and b_ok

    # C. 应判 FAIL：末段残留直流
    vc = _envelope_track(n, sr, 0)
    for k in range(50):
        vc[n - 50 + k] = 12000
    pc = os.path.join(d, "neg2.wav")
    _write_wav(pc, vc)
    rc = analyze(pc)
    c_ok = rc["ratio"] >= SEAM_MAX
    print("  [C] 末50样本残留直流    ratio=%6.2f → %s" % (rc["ratio"], "✅ 判据检出接缝" if c_ok else "❌ 判据漏检"))
    ok = ok and c_ok

    for f in (pa, pb, pc):
        try: os.remove(f)
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
    files = sorted(glob.glob(os.path.join(d, "*.wav")))
    lines = ["# BGM 循环接缝体检（纯标准库，CI 端）", "",
             "判据：`ratio = |首 - 末| ÷ P90(首尾各 %d 样本的逐样本差)`，阈值 < %.1f" % (NEAR, SEAM_MAX),
             "> 参考量取**接缝邻域**的局部波形斜率（与接缝同尺度），",
             "> 而非全曲 P95 —— 后者只反映高频含量，越亮的曲子越测不出接缝。", "",
             "| 文件 | 时长 s | 采样率 | 声道 | 接缝阶跃 | 局部P90 | ratio | 峰值 | 直流 | 判定 |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    bad = 0
    checked = 0
    for f in files:
        r = analyze(f)
        if r is None:
            lines.append("| %s | - | - | - | - | - | - | - | - | SKIP(非16bit/过短) |" % os.path.basename(f))
            continue
        if not r["loop"]:
            verdict = "N/A(一次性曲)"
        else:
            checked += 1
            if r["ratio"] < SEAM_MAX:
                verdict = "PASS"
            else:
                verdict = "**FAIL**"; bad += 1
        lines.append("| %s | %.1f | %d | %d | %d | %d | %.2f | %.2f | %+.0f | %s |" % (
            r["name"], r["dur"], r["sr"], r["ch"], r["seam"], r["ref"], r["ratio"],
            r["peak"], r["dc"], verdict))
    lines += ["", "## 结论", "",
              ("- 受检循环曲 %d 个，接缝全部 PASS（阈值 %.1f）" % (checked, SEAM_MAX)) if bad == 0
              else ("- ⚠ %d / %d 个循环曲接缝超标（阈值 %.1f）" % (bad, checked, SEAM_MAX))]
    txt = "\n".join(lines)
    print(txt)
    if out:
        with open(out, "w", encoding="utf-8") as fh:
            fh.write(txt)
        print("\n→ 已写 " + out)
    return 1 if (bad and os.environ.get("GATE") == "1") else 0


if __name__ == "__main__":
    sys.exit(main())
