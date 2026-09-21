# -*- coding: utf-8 -*-
"""bgm-perceptual-cross.py —— 感知口径交叉验证（短时窗）

为什么需要它（第十七/十八类病根的方法论核心）：
  全曲均方极差大，**不足以判定"响度缺陷"** —— 稀疏型音乐（长留白 + 少量强音）
  的均方天然低，那是**编配意图**；而"有声音时也一直比别人轻"才是缺陷。

  分辨办法（纯标准库）：
    把曲子切成 100ms 短时窗，算每窗的简化 K 加权响度，取
      · P50  = "平常多响"
      · P95  = "有声音时多响"
    再看**极差在两种口径下的比值**：
      · P95 极差 ≪ 均方极差  → 差别来自**稀疏度** = 风格 → 豁免
      · P95 极差 ≈ 均方极差  → **全时段一致偏轻** = 真缺陷 → 报

  ⚠ 本脚本替代 `_qc/_perceptual-cross.py`（一次性脚本，已不存在）。
    **豁免条款必须引用一个长期存在的、可复跑的判据脚本** ——
    引用一个死掉的脚本 = 无法复核的豁免 = 实质上"永远通过的守卫"（第九类病根）。

用法:
  python ci/bgm-perceptual-cross.py                 # 全 lane 交叉报告
  python ci/bgm-perceptual-cross.py --lane home
  python ci/bgm-perceptual-cross.py --selftest      # 阴性对照
"""
import sys, os, math, wave, struct

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIO = os.path.join(HERE, '..', 'game', 'audio')

SAME_AS_LANE = None  # 复用 lane 脚本的 lane 归属，避免第二份真身


def load_lane_module():
    import importlib.util
    p = os.path.join(HERE, 'bgm-lane-loudness.py')
    spec = importlib.util.spec_from_file_location('ll', p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def read_mono(path):
    with wave.open(path, 'rb') as w:
        n, ch, sw, sr = w.getnframes(), w.getnchannels(), w.getsampwidth(), w.getframerate()
        if sw != 2:
            return None, None
        raw = w.readframes(n)
    v = list(struct.unpack('<%dh' % (len(raw) // 2), raw))
    if ch == 2:
        v = [(v[i] + v[i + 1]) / 2 for i in range(0, len(v) - 1, 2)]
    return [x / 32768.0 for x in v], sr


def k_loudness_db(sig, sr):
    """与 ci/bgm-lane-loudness.py / sfx-loudness.py 同口径（双线性单极点）。"""
    dt = 1.0 / sr
    rc = 1.0 / (2 * math.pi * 100.0); a = rc / (rc + dt)
    yp = xp = 0.0; hp = [0.0] * len(sig)
    for i, x in enumerate(sig):
        y = a * (yp + x - xp); hp[i] = y; xp, yp = x, y
    rc2 = 1.0 / (2 * math.pi * 8000.0); a2 = dt / (rc2 + dt)
    y = 0.0; ms = 0.0
    for x in hp:
        y = y + a2 * (x - y); ms += y * y
    return 10 * math.log10(ms / max(1, len(hp)) + 1e-12)


WIN_S = 0.10          # 100ms 短时窗
SILENT_DB = -60.0     # 低于此视为静音窗，不参与 P50/P95
# 【判据】P95（"有声音时多响"）极差 ≤ 此值 → 玩家**听不出**档内不齐 → 可豁免。
#   依据：3 dB 是公认的"刚好可察觉响度差"量级；本作是**手机小喇叭 + 战斗音效掩盖**场景，
#   再放宽一档取 3.5 dB。
P95_OK_DB = 3.5
# 【判据】档内**至少有一首**的静音窗占比 ≥ 此值 → 均方差不齐可用"编配稀疏度"解释。
#   ⚠ 这里刻意**不用** "span_95 / span_w" 比值：分母 span_w 会被待判缺陷自己撑大，
#     导致真缺陷越明显反而越像"风格"（实测把 frost 压 −6dB 会被误判 SPARSE）。
#     改用"静音占比"——它只看每曲**有没有声音**，与响度偏移完全无关，是干净的分母。
SILENT_FRAC_MIN = 0.25


def short_window_profile(sig, sr, win_s=WIN_S, want_frac=False):
    """返回每窗响度(dB) 列表（已滤掉静音窗）。
    want_frac=True 时返回 (list, 静音窗占比)。"""
    n = int(sr * win_s)
    out = []
    total = 0
    for i in range(0, len(sig) - n + 1, n):
        total += 1
        d = k_loudness_db(sig[i:i + n], sr)
        if d > SILENT_DB:
            out.append(d)
    if want_frac:
        frac = 1.0 - (len(out) / float(total)) if total else 0.0
        return out, frac
    return out


def pct(vals, q):
    if not vals:
        return None
    s = sorted(vals)
    k = (len(s) - 1) * q
    lo, hi = int(math.floor(k)), int(math.ceil(k))
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def analyze(lane_filter=None):
    ll = load_lane_module()
    rows = []
    for fn in sorted(os.listdir(AUDIO)):
        if not (fn.startswith('bgm_') and fn.endswith('.wav')):
            continue
        tid = fn[:-4]
        lane = ll.TRACK_LANE.get(tid)
        if lane is None:
            continue
        if lane_filter and lane != lane_filter:
            continue
        sig, sr = read_mono(os.path.join(AUDIO, fn))
        if sig is None:
            continue
        # ⚠ 必须施加**有效增益**（laneGain × trim），否则会在"未配平"的数值上判缺陷 ——
        #   本轮实测踩过：不施加时 battle 的 P95 极差报 5.78 dB，施加后只有 2.07 dB。
        #   判"实际听感"就必须用实际播放链上的增益，不能用烘焙原始值。
        dt = (20 * math.log10(ll.LANE_GAIN_DEFAULT[lane])
              + 20 * math.log10(ll.TRACK_TRIM.get(tid, 1.0)))
        prof, sfrac = short_window_profile(sig, sr, want_frac=True)
        rows.append(dict(name=tid, lane=lane, dt=dt,
                         whole=k_loudness_db(sig, sr) + dt,
                         silent_frac=sfrac,
                         prof=[x + dt for x in prof]))
    return rows


def lane_report(rows):
    by = {}
    for r in rows:
        by.setdefault(r['lane'], []).append(r)
    out = []
    for lane, vs in sorted(by.items()):
        if len(vs) < 2:
            continue
        whole = [v['whole'] for v in vs]
        p50 = [pct(v['prof'], 0.50) for v in vs]
        p95 = [pct(v['prof'], 0.95) for v in vs]
        span_w = max(whole) - min(whole)
        span_50 = max(p50) - min(p50)
        span_95 = max(p95) - min(p95)
        # 【判定】三级 ——
        #   ① P95 极差 ≤ P95_OK_DB  → OK：玩家听不出档内不齐（无论均方多大）
        #   ② 否则看**静音占比**是否解释了均方差 → SPARSE(风格)
        #   ③ 否则 → OFFSET：全时段偏移，**真缺陷**
        #
        # ⚠⚠ 这里踩过一个真正会漏检的坑，记下来：
        #   第一版 ② 写成 `span_95 < span_w * 0.75`（P95 差/均方差 之比）。
        #   现象：把 frost 真压 −6dB（**真缺陷**）后，span_95=6.40 而 span_w=9.55，
        #         6.40 < 9.55×0.75=7.16 → 被判成 SPARSE(风格)，**漏检**。
        #   病根：**分母 span_w 被分子 span_95 自己撑大了** —— 注入的 −6dB 同时
        #         推高 p95 与 whole 极差，用一个"被待测量污染的分母"做比值，
        #         缺陷越明显比值反而越像风格。**分母必须与待判缺陷无关。**
        #   正解：SPARSE 的依据应是"**静音比例**高到足以解释均方差"，
        #         而这个量只看每曲**有声音窗占比**，与响度偏移无关。
        silent_frac = [v.get('silent_frac') for v in vs]
        if span_95 <= P95_OK_DB:
            verdict = 'OK'
        elif all(s is not None for s in silent_frac) and max(silent_frac) >= SILENT_FRAC_MIN:
            verdict = 'SPARSE(风格)'
        else:
            verdict = 'OFFSET(缺陷)'
        out.append(dict(lane=lane, n=len(vs), span_whole=span_w,
                        span_p50=span_50, span_p95=span_95, verdict=verdict, rows=vs))
    return out


def fmt(rep):
    lines = ['# BGM 感知口径交叉（100ms 短时窗）', '',
             '> 分辨"响度缺陷"与"编配稀疏度"：**P95 极差（有声音时多响）≤ %.1f dB = 可接受**；'
             % P95_OK_DB,
             '> 否则再看**静音窗占比**是否 ≥ %.0f%% 足以解释均方差 → 是则 SPARSE(风格)，否则 OFFSET(缺陷)。'
             % (SILENT_FRAC_MIN * 100), '',
             '| lane | n | 均方极差 | P50 极差 | **P95 极差** | 判定 |',
             '|---|---|---|---|---|---|']
    for r in rep:
        lines.append('| %s | %d | %.2f dB | %.2f dB | **%.2f dB** | %s |' % (
            r['lane'], r['n'], r['span_whole'], r['span_p50'], r['span_p95'], r['verdict']))
    lines += ['', '## 逐曲', '',
              '| 曲目 | lane | 全曲均方 | P50 | P95 |', '|---|---|---|---|---|']
    for r in rep:
        for v in sorted(r['rows'], key=lambda x: -x['whole']):
            lines.append('| %s | %s | %.2f | %.2f | %.2f |' % (
                v['name'], v['lane'], v['whole'], pct(v['prof'], 0.5), pct(v['prof'], 0.95)))
    return '\n'.join(lines)


def selftest():
    print('=== 判据自测（阴性对照）===')
    ok = tot = 0
    rows = analyze()
    rep = lane_report(rows)

    # A. 真实数据：三档都必须 OK（P95 极差 ≤ 阈）——这是"已修齐"的基线断言。
    #    ⚠ 第一版断言的是"home 必须 SPARSE"，那是**修复前**的世界。home 已按 P95 真修齐，
    #      现在正确结论就是 OK；把旧结论写死成断言 = 修复完成后必然 FAIL。
    tot += 1
    bad = [r for r in rep if not r['verdict'].startswith('OK')]
    print('  [A] 三档基线判定 → %s %s' % (
        ' / '.join('%s:%s' % (r['lane'], r['verdict']) for r in rep),
        '✅' if not bad else '❌'))
    if not bad:
        ok += 1

    # B. 阴性对照：把 battle 内**一首**压 −5dB（模拟某曲重烘错）→ 必须转成 OFFSET
    #    ⚠ 第一版断言写的是 "span_p95 <= span_whole + 0.5"（P95 与均方接近），
    #      但 P95 是**短时窗**量、均方是**全曲**量，两者本就不该相等 —— 断言前提错误。
    #      正确做法：注入已知缺陷，看 verdict 是否**变化**（这才是判据有效性）。
    tot += 1
    fakeB = [dict(r) for r in rows]
    for r in fakeB:
        if r['name'] == 'bgm_horde':
            r['whole'] -= 5.0
            r['prof'] = [x - 5.0 for x in r['prof']]
    rb = [x for x in lane_report(fakeB) if x['lane'] == 'battle']
    gotB = rb and rb[0]['verdict'].startswith('OFFSET')
    print('  [B] bgm_horde 压 −5dB（注入已知缺陷）→ battle 判 OFFSET? %s（应 True）'
          % bool(gotB))
    if gotB:
        ok += 1

    # C. 阴性对照：把某曲整体压 -6dB（全时段偏移）→ 必须判 OFFSET
    #    ⚠⚠ 这正是暴露"分母被污染"的对照：旧判据下 6.40 < 9.55×0.75 → 误判 SPARSE（漏检）。
    #      改用静音占比后，响度整体下移**不改变**静音占比（prof 同步平移），
    #      故 SPARSE 分支不会开启 → 必须落 OFFSET。
    tot += 1
    fake = [dict(r) for r in rows]
    for r in fake:
        if r['name'] == 'bgm_frost':
            r['whole'] -= 6.0
            r['prof'] = [x - 6.0 for x in r['prof']]
    rep2 = [x for x in lane_report(fake) if x['lane'] == 'home']
    got = rep2 and rep2[0]['verdict'].startswith('OFFSET')
    print('  [C] 把 bgm_frost 整体压 -6dB（全时段偏移）→ home 判 OFFSET? %s（应 True）' % bool(got))
    if got:
        ok += 1

    # D. 反向：只把某曲的**安静段填满**（提高密度但不整体移响度）→ 不得因此判 OFFSET
    #    真实世界对应"把稀疏曲编配加厚"，那是**风格调整**不是响度缺陷，不应误报。
    tot += 1
    fake2 = [dict(r) for r in rows]
    for r in fake2:
        if r['name'] == 'bgm_frost' and r['prof']:
            p95 = pct(r['prof'], 0.95)
            r['prof'] = [max(x, p95 - 3.0) for x in r['prof']]
    rep3 = [x for x in lane_report(fake2) if x['lane'] == 'home']
    got3 = rep3 and not rep3[0]['verdict'].startswith('OFFSET')
    print('  [D] 把 bgm_frost 安静段填满（变密不整体移响度）→ home 不判 OFFSET? %s（应 True）' % bool(got3))
    if got3:
        ok += 1

    print('  --- %d/%d 通过' % (ok, tot))
    return ok == tot


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(0 if selftest() else 1)
    lf = None
    if '--lane' in sys.argv:
        lf = sys.argv[sys.argv.index('--lane') + 1]
    rep = lane_report(analyze(lf))
    text = fmt(rep)
    print(text)
    outdir = os.path.join(HERE, 'out')
    os.makedirs(outdir, exist_ok=True)
    with open(os.path.join(outdir, 'bgm-perceptual-cross.md'), 'w', encoding='utf-8') as fh:
        fh.write(text + '\n')
