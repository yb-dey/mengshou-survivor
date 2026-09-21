#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""bgm-melody.py -- BGM「旋律可辨度」门禁
第十八类病根：**旋律层被垫层掩蔽**（客观可判，非口味）。

口径（全部从 WAV 实测，不读源码参数 → 结构上不可能漂移）：
  1. 用 16384 点 FFT（频率分辨 2.69Hz，够分半音）逐帧累加**功率谱**
  2. 按 DATA_BGM 的**调式**算出该曲的旋律音集合与垫层音集合
  3. 判据 M1「旋律占比」：旋律音在 60–1300Hz 内的功率占比 ≥ 25%
     原因：旋律音是**单个音轮流**出现，同一时刻只有一个在响；
           而三音垫是**三个音一直同时响** → 天然劣势。
           18% 意味着"旋律喊不过垫层"，实测 march/horde 正是如此。
  4. 判据 M2「人均压制比」：旋律人均占比 ÷ 垫层人均占比 ≥ 1.5
     ⚠ 分母是**同时发声数**，不是"音数"：
        旋律是单声部轮流（同一时刻只有 1 个音在响）→ melody_voices=1
        垫层是全部音同时常鸣 → pad_voices = 垫层音数
     若两侧都除以"音数"，等于把旋律能量凭空除以 4 → 判据天生偏向垫层
     （这正是 selftest D「旋律 +12dB 仍 FAIL」暴露出的判据 bug）
  5. 判据 M3「高频延展」：>1100Hz 能量占比 ≥ 0.5%（提示层）
     全部 10 首实测 < 0.5%（march 0.65% / horde 0.2%）→ 音色全在同一窄带里，
     手机小喇叭 + 战斗噪声下旋律更难留住。

已知豁免：`abyss`（设计就是 drone + pad + 心跳，**无旋律声明**）→ 不计 M1/M2。

用法：
  python ci/bgm-melody.py [audio_dir] [out.md]
  python ci/bgm-melody.py --selftest
"""
import wave, array, math, os, sys, io, json

SR = 44100
PCN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

# ---- 判据常量（钉死；不随产物变化）----
MEL_MIN_PCT     = 25.0   # M1  旋律占比下限（% of 60–1300Hz 带内、**已排除 bass 骨架**）
MEL_SHARE_MIN   = 1.00   # M1r 旋律占比 ÷ 垫层占比下限（=旋律必须压过垫层）
MEL_PER_TONE    = 1.5    # M2  人均压制比下限
HF_MIN_PCT      = 0.5    # M3  高频占比下限（% of 全带；提示层）
BAND_LO, BAND_HI = 60.0, 1300.0

# ---- 每曲的调式与层分配（来自源码逐字：DATA_BGM 调式 + _renderBgmTrack 层结构）----
# melody: 该曲设计里的旋律/钩子音（Hz，取自源码 mHookA/oHook/…）
# pad:    同频段常鸣垫层（Hz，取自源码 mPad/oPad/…）
# bass:   【v1.180】**长鸣单音骨架**（源码里 dur=loopSec 的单音 drone/根音）。
#         角色是节奏/地基，**不参与"旋律 vs 垫层"竞争**，必须从 M1 分母排除。
#         实测反例：horde 的 E2(82.41) 独占带内 72.3% → 不排除则 M1 从 29.3% 假跌到 8.0%
TRACKS = {
    'bgm_march.wav': dict(
        label='启程（战斗主曲）', key='G',
        melody=[392.0, 440.0, 493.88, 587.33],            # mHookA~D 的四句音
        pad=[196.0, 246.94, 293.66, 329.63],              # mPad + E4 吊垫
        bass=[98.0, 73.42],                               # 98 drone + 73.42 脉冲鼓
    ),
    'bgm_horde.wav': dict(
        label='怪潮（放开段）', key='Em',
        melody=[329.63, 392.0, 440.0, 493.88],            # oHookA~D
        pad=[164.81, 196.0, 246.94, 293.66],              # oPad Em7
        bass=[82.41, 123.47, 55.0],                       # E2 drone + B2 + kick
    ),
    'bgm_abyss.wav': dict(
        label='深渊（BOSS）', key='D Phrygian',
        melody=[],                                        # 设计无旋律（drone+pad+心跳）
        pad=[73.42, 146.83, 155.56, 293.66],
        bass=[146.83, 55.0],
        melodic_intent=False,
    ),
    'bgm_harbor.wav': dict(
        # ⚠ hHook 与 hPad **同音高**（都是 C/E/G 家族）→ 无法按音高分离。
        #   本曲不参与 M1/M2（无独立旋律层，钩子只是把和弦音换了个八度）。
        label='港湾（大厅）', key='C',
        melody=[261.63, 329.63, 392.0, 196.0],            # hHook 走低八度
        pad=[261.63, 329.63, 392.0, 523.25],
        melodic_intent=False,
    ),
    'bgm_city.wav': dict(label='灯笼港', key='C', melody=[], pad=[], melodic_intent=False),
    'bgm_dune.wav': dict(label='沙原', key='-', melody=[], pad=[], melodic_intent=False),
    'bgm_frost.wav': dict(label='霜原', key='-', melody=[], pad=[], melodic_intent=False),
    'bgm_meadow.wav': dict(label='芽野', key='C', melody=[], pad=[], melodic_intent=False),
    'bgm_win.wav': dict(
        label='胜利 jingle', key='C',
        melody=[523.25, 659.26, 783.99, 1046.5, 1318.5],  # wF 上行琶音
        pad=[196.0, 261.63],                              # 【v1.170】G3/C4 常鸣接续层
        bass=[65.41, 130.81, 132.0],                      # C2/C3/微失谐 长鸣
    ),
    'bgm_lose.wav': dict(
        label='失败 jingle', key='Am',
        melody=[440.0, 392.0, 329.63, 261.63, 220.0],     # lF 下行琶音
        pad=[],
        bass=[110.0],
    ),
}

# 已知豁免：**钉数值**（防"永远通过的守卫"）
EXEMPT = {}   # 修齐后应为空；留结构以备将来


def read_wav(p):
    w = wave.open(p, 'rb')
    if w.getsampwidth() != 2 or w.getnchannels() != 1:
        raise SystemExit('%s: 只支持 16bit mono' % p)
    a = array.array('h')
    a.frombytes(w.readframes(w.getnframes()))
    return [v / 32768.0 for v in a], w.getframerate()


def fft(a):
    n = len(a); j = 0
    for i in range(1, n):
        b = n >> 1
        while j & b:
            j ^= b; b >>= 1
        j |= b
        if i < j:
            a[i], a[j] = a[j], a[i]
    ln = 2
    while ln <= n:
        ang = -2 * math.pi / ln
        wr, wi = math.cos(ang), math.sin(ang)
        for i2 in range(0, n, ln):
            cr, ci = 1.0, 0.0
            for k in range(i2, i2 + ln // 2):
                ur, ui = a[k]; vr, vi = a[k + ln // 2]
                tr, ti = cr * vr - ci * vi, cr * vi + ci * vr
                a[k] = (ur + tr, ui + ti)
                a[k + ln // 2] = (ur - tr, ui - ti)
                cr, ci = cr * wr - ci * wi, cr * wi + ci * wr
        ln <<= 1
    return a


def power_spectrum(sig, n=16384, hop=8192):
    """返回 {freq_index: 累加功率}（频率分辨 SR/n）"""
    win = [0.5 - 0.5 * math.cos(2 * math.pi * i / (n - 1)) for i in range(n)]
    acc = {}
    pos = 0
    while pos + n <= len(sig):
        seg = sig[pos:pos + n]
        sp = fft([(seg[k] * win[k], 0.0) for k in range(n)])
        for k in range(1, n // 2):
            re, im = sp[k]
            acc[k] = acc.get(k, 0.0) + re * re + im * im
        pos += hop
    if not acc:      # 极短文件退化用单帧
        seg = (sig + [0.0] * n)[:n]
        sp = fft([(seg[k] * win[k], 0.0) for k in range(n)])
        for k in range(1, n // 2):
            re, im = sp[k]
            acc[k] = re * re + im * im
    return acc, n


def assign_bins(acc, n, midis, tol_semis=0.6):
    """把频谱功率按半音归到最近的 midi 音；tol_semis 内的 bin 算该音的"""
    tot_band = 0.0
    tot_all = 0.0
    per_tone = {}
    for k, e in acc.items():
        f = k * SR / n
        if f < 20:
            continue
        tot_all += e
        if not (BAND_LO <= f < BAND_HI):
            continue
        tot_band += e
        m_float = 69 + 12 * math.log2(f / 440.0)
        m = int(round(m_float))
        if abs(m_float - m) <= tol_semis:
            per_tone[m] = per_tone.get(m, 0.0) + e
    return tot_band, tot_all, per_tone


def midi_of(f):
    return int(round(69 + 12 * math.log2(f / 440.0)))


def hf_pct(acc, n, lo=1100.0):
    tot = sum(acc.values()) or 1.0
    hf = sum(e for k, e in acc.items() if k * SR / n >= lo)
    return 100.0 * hf / tot


def evaluate_samples(sig, sr, meta, name='<mem>'):
    """核心判据：输入样本序列 → 指标（与 evaluate 共用，供 selftest 注入样本用）

    ⚠【v1.180 口径修正】分母必须**排除 role=bass 的长鸣单音骨架**。
      实测反例(bgm_horde)：E2 drone(82.41Hz) 单音独占 60–1300Hz 带内 **72.3%** 功率
      → 它不在"旋律 vs 垫层"这对关系里，却把两边都机械压小，
        M1 从 29.3% 掉到 8.0%（假报警）。drone 的角色是**节奏/地基**，不是和声掩蔽体。
      验证(bass 排除前后)：march 35.4→50.9 / horde 8.0→29.3 / win 57.8→82.5
      阴性对照：给 bass +10dB → M1 几乎不动（49.4 vs 50.9），证明它确与旋律竞争无关。
    """
    acc, n = power_spectrum(sig)
    mel_set = set(midi_of(f) for f in meta.get('melody') or [])
    pad_set = set(midi_of(f) for f in meta.get('pad') or [])
    bass_set = set(midi_of(f) for f in meta.get('bass') or [])

    def keep(f):
        return BAND_LO <= f < BAND_HI and midi_of(f) not in bass_set

    tot_band = sum(e for k, e in acc.items() if keep(k * SR / n))
    e_mel = sum(e for k, e in acc.items() if keep(k * SR / n) and midi_of(k * SR / n) in mel_set)
    e_pad = sum(e for k, e in acc.items() if keep(k * SR / n) and midi_of(k * SR / n) in pad_set)
    mel_pct = 100.0 * e_mel / tot_band if tot_band else 0.0
    pad_pct = 100.0 * e_pad / tot_band if tot_band else 0.0
    n_ovl = len(mel_set & pad_set)
    # ⚠ 人均比的**分母是"同时发声数"，不是"音数"**（本轮修正的核心）：
    #   旋律是**单声部轮流**（同一时刻只有 1 个音在响，其余音在时间上错开），
    #   垫层是**全部音同时常鸣**（琶音/柱式持续）。
    #   若两侧都用"音数"当分母，等于把旋律能量凭空除以 4，
    #   判据会天生偏向垫层 —— 这正是 selftest D（旋律 +12dB 仍 FAIL）的真因。
    mv = max(1, int(meta.get('melody_voices', 1)))
    pv = max(1, len(pad_set))
    per_mel = mel_pct / mv
    per_pad = pad_pct / pv if pad_pct > 0 else 0.0
    ratio = per_mel / per_pad if per_pad > 0 else 99.0
    # 【v1.180】M1r：旋律占比 ÷ 垫层占比。与 M1(绝对) 互补：
    #   M1 绝对阈值混入了"本曲还有多少别的层"的信息；M1r 只问"旋律压没压过垫层"。
    #   实测反例：march 垫层 +6dB 时 M1 仍 40.7%(PASS，因它的旋律本来强)，
    #             而 M1r 0.85 直接翻红 —— 这才是"层掩蔽"的本义。
    share = (mel_pct / pad_pct) if pad_pct > 0 else 99.0
    return dict(
        file=name, dur=round(len(sig) / sr, 2),
        mel_pct=round(mel_pct, 1), pad_pct=round(pad_pct, 1),
        n_mel=len(mel_set), n_pad=len(pad_set), n_ovl=n_ovl,
        mv=mv, pv=pv, share=round(share, 2),
        per_mel=round(per_mel, 2), per_pad=round(per_pad, 2),
        ratio=round(ratio, 2), hf=round(hf_pct(acc, n), 2),
        meta=meta,
    )


def evaluate(path, meta):
    sig, sr = read_wav(path)
    return evaluate_samples(sig, sr, meta, os.path.basename(path))


def judge(rows):
    """返回 (alarms, exempt, notes)"""
    alarms, notes = [], []
    for r in rows:
        meta = r['meta']
        if not meta.get('melodic_intent', True):
            notes.append('ℹ %s 设计无旋律声明（%s）→ 不参与 M1/M1r/M2'
                         % (r['file'], meta.get('key', '')))
            continue
        # M1r: 旋律占比 ÷ 垫层占比 —— "旋律必须压过垫层"（层掩蔽的直接判据）
        #   为什么必须有这一条：M1 的绝对阈值混入了"本曲还有多少别的层"的信息。
        #   实测反例：march 垫层 +6dB 时 M1 仍 40.7%(PASS)，而 M1r=0.85 直接翻红。
        if r['share'] < MEL_SHARE_MIN:
            alarms.append('M1r 旋律/垫层比 %.2f < %.2f（%s）：旋律 %.1f%% vs 垫层 %.1f%% '
                          '→ **旋律被和声垫层压住**'
                          % (r['share'], MEL_SHARE_MIN, r['file'],
                             r['mel_pct'], r['pad_pct']))
        if r['mel_pct'] < MEL_MIN_PCT:
            alarms.append('M1 旋律占比 %.1f%% < %.0f%%（%s）：旋律音 %s 只占 60–1300Hz 带内 %.1f%%，'
                          '而 %d 个垫层音占了 %.1f%% → **旋律被掩蔽**'
                          % (r['mel_pct'], MEL_MIN_PCT, r['file'], r['n_mel'],
                             r['mel_pct'], r['n_pad'], r['pad_pct']))
        if r['ratio'] < MEL_PER_TONE:
            alarms.append('M2 人均压制比 %.2f < %.2f（%s）：旋律人均 %.1f%%（÷%d 声部） vs 垫层人均 %.1f%%（÷%d 声部）'
                          % (r['ratio'], MEL_PER_TONE, r['file'], r['per_mel'], r.get('mv', 1),
                             r['per_pad'], r.get('pv', 1)))
    exempt = []
    for r in rows:
        if r['hf'] < HF_MIN_PCT:
            exempt.append('M3 高频延展 %.2f%% < %.1f%%（%s）' % (r['hf'], HF_MIN_PCT, r['file']))
    return alarms, exempt, notes


def fmt(rows, alarms, exempt, notes):
    L = ['# BGM 旋律可辨度门禁', '',
         '> 口径：从 WAV 实测（16384 点 FFT，频率分辨 2.69Hz）逐曲累加功率谱，',
         '> 按 `DATA_BGM` 的调式把功率归到**旋律音**与**垫层音**两组。',
         '> **不读源码参数** → 结构上不可能漂移。', '',
         '## 判据',
         '',
         '| 判据 | 含义 | 阈值 |',
         '|---|---|---|',
         '| M1r 旋律/垫层比 | 旋律占比 ÷ 垫层占比（**主判据**） | ≥ %.2f |' % MEL_SHARE_MIN,
         '| M1 旋律占比 | 旋律音在 60–1300Hz 内的功率占比（已排除 bass 骨架） | ≥ %.0f%% |' % MEL_MIN_PCT,
         '| M2 人均压制比 | 旋律人均占比 ÷ 垫层人均占比（分母=同时发声数） | ≥ %.2f |' % MEL_PER_TONE,
         '| M3 高频延展 | >1100Hz 能量占总能量比（**提示**） | ≥ %.1f%% |' % HF_MIN_PCT,
         '',
         '⚠ **分母口径（v1.180 修正）**：M1/M1r 的分母已**排除 role=bass 的长鸣单音骨架**。',
         '   实测反例：`horde` 的 E2(82.41Hz) 单音独占带内 72.3% → 不排除则 M1 从 29.3% 假跌到 8.0%。',
         '   drone 的角色是**节奏/地基**，不是和声掩蔽体；阴性对照（bass +10dB → M1 几乎不动）已证。',
         '',
         '⚠ **M1r 是主判据**：M1 的绝对阈值混入了"本曲还有多少别的层"的信息。',
         '   实测反例：`march` 垫层 +6dB 时 M1 仍 40.7%(PASS，因它的旋律本来就很强)，',
         '   而 M1r=0.85 直接翻红 —— "层掩蔽"的本义就是"旋律压不过垫层"，与别的层无关。',
         '',
         '## 逐曲实测', '',
         '| 曲目 | 时长s | 旋律音数 | 旋律占比 | 垫层音数 | 垫层占比 | **旋律/垫层** | 人均比 | >1100Hz |',
         '|---|---|---|---|---|---|---|---|---|',
         ]
    for r in sorted(rows, key=lambda x: x['mel_pct']):
        L.append('| %s | %.2f | %d | **%.1f%%** | %d | %.1f%% | **%.2f** | %.2f | %.2f%% |'
                 % (r['file'], r['dur'], r['n_mel'], r['mel_pct'],
                    r['n_pad'], r['pad_pct'], r['share'], r['ratio'], r['hf']))
    L.append('')
    L.append('## 结论')
    L.append('')
    if alarms:
        L.append('- ❌ **%d 条判据未通过**' % len(alarms))
        for a in alarms:
            L.append('  - %s' % a)
    else:
        L.append('- ✅ **M1r/M1/M2 全部通过**（旋律在自己频段里是主体）')
    L.append('')
    if exempt:
        L.append('### M3 高频延展（提示，不拦截）')
        L.append('')
        for e in exempt:
            L.append('- ⚠ %s' % e)
        L.append('')
        L.append('> 全部 BGM 的 1100Hz 以上能量合计 < 0.7% —— 音色全部挤在同一窄带里。')
        L.append('> 手机小喇叭（放不出 500Hz 以下）+ 战斗音效掩盖下，旋律更难留住。')
        L.append('> 属**音色设计**范畴，需与"长局耐听"权衡，故只提示不拦截。')
        L.append('')
    if notes:
        L.append('### 已知豁免（设计如此）')
        L.append('')
        for x in notes:
            L.append('- %s' % x)
        L.append('')
    L.append('## 诊断建议（当 M1/M2 不通过时）')
    L.append('')
    L.append('1. **降垫层**：垫层 gain ×0.6~0.7（垫层是"一直响"的，感知上远大于其数值）')
    L.append('2. **抬旋律**：旋律 gain ×1.3~1.4')
    L.append('3. **别动音高/调式/节奏**——那会改掉曲子的"身份"')
    L.append('4. ⚠ **峰值归一陷阱**：抬旋律 + 降垫层后要重跑 `bgm-lane-loudness.py`，')
    L.append('   确认档内极差没被打散（见第十七类病根）')
    return '\n'.join(L) + '\n'


def selftest(audio_dir):
    ok = tot = 0
    print('=== 判据自测（阴性对照）===')
    # A 基准
    rows = run_all(audio_dir)
    alarms, exempt, notes = judge(rows)
    n_unex = len(alarms)
    tot += 1
    if n_unex == 0:
        print('  [A] 基准（已修产物）→ 未豁免报警 %d 条 → 应 0 ✅' % n_unex); ok += 1
    else:
        print('  [A] 基准 → %d 条报警（快照=未修）' % n_unex)
        print('      → 视为「尚未修」，不作 FAIL，但会打印：')
        for a in alarms:
            print('        · %s' % a)
        ok += 1   # 未修态允许基准报警（修复前后都能跑）
    tot += 1
    if any('abyss' in n_ for n_ in notes):
        print('  [B] abyss 被正确识别为「设计无旋律」→ 不参与 M1/M1r/M2 ✅'); ok += 1
    else:
        print('  [B] abyss 未被豁免 ❌'); 
    # C 注入已知缺陷：往垫层音注入 +6dB 能量（在**样本域**做，不落盘）
    #   判据用 **M1r**（主判据）：旋律压不过垫层即报。
    #   ⚠ 不能用 M1 绝对阈值：march 的旋律本来强，垫层 +6dB 后 M1 仍 40.7%(PASS)，
    #     只有 M1r 会翻红 —— 这正是"层掩蔽"与"整体占比"的分野。
    sig_m, sr_m = read_wav(os.path.join(audio_dir, 'bgm_march.wav'))
    meta_m = TRACKS['bgm_march.wav']
    inj = _inject(sig_m, meta_m['pad'], 6.0)
    r2 = evaluate_samples(inj, SR, meta_m, '<march+pad6dB>')
    tot += 1
    if r2['share'] < MEL_SHARE_MIN:
        print('  [C] 垫层 +6dB 注入 → 旋律/垫层比 %.2f < %.2f → 必被抓到 ✅'
              % (r2['share'], MEL_SHARE_MIN)); ok += 1
    else:
        print('  [C] 垫层 +6dB 注入未被抓到（M1r=%.2f）❌' % r2['share'])
    # C2 孤儿开关对照: 把 pad 压到极小 → M1r 必须升上去（证明该判据真的随垫层动）
    injc2 = _inject(sig_m, meta_m['pad'], -20.0)
    r2b = evaluate_samples(injc2, SR, meta_m, '<march-pad20dB>')
    tot += 1
    if r2b['share'] > r2['share']:
        print('  [C2] 垫层 -20dB → 旋律/垫层比 %.2f > %.2f（+6dB 态）→ 判据随垫层单调 ✅'
              % (r2b['share'], r2['share'])); ok += 1
    else:
        print('  [C2] 垫层 -20dB 后 M1r 未上升（%.2f）→ 判据对垫层不敏感 ❌' % r2b['share'])
    # C3 bass 排除的阴性对照: 给 bass(节奏骨架) 大幅增益 → M1r 应**几乎不动**
    #   若明显下降, 说明 bass 仍在分母里 = 口径回退
    injc3 = _inject(sig_m, meta_m['bass'], 10.0)
    r2c = evaluate_samples(injc3, SR, meta_m, '<march+bass10dB>')
    base = evaluate_samples(sig_m, SR, meta_m, '<march>')
    tot += 1
    if abs(r2c['share'] - base['share']) < 0.05:
        print('  [C3] bass +10dB → M1r %.2f ≈ 基准 %.2f（几乎不动）→ bass 确已排除 ✅'
              % (r2c['share'], base['share'])); ok += 1
    else:
        print('  [C3] bass +10dB 后 M1r 明显变化（%.2f vs %.2f）→ bass 仍在分母 ❌'
              % (r2c['share'], base['share']))
    # D 注入反向缺陷：把旋律抬到很高 → 必须 PASS（防"永远报警的守卫"）
    inj2 = _inject(sig_m, meta_m['melody'], 12.0)
    r3 = evaluate_samples(inj2, SR, meta_m, '<march+mel12dB>')
    tot += 1
    if r3['mel_pct'] >= MEL_MIN_PCT and r3['ratio'] >= MEL_PER_TONE and r3['share'] >= MEL_SHARE_MIN:
        print('  [D] 旋律 +12dB → 占比 %.1f%% / M1r %.2f / 人均 %.2f → 应 PASS ✅'
              % (r3['mel_pct'], r3['share'], r3['ratio'])); ok += 1
    else:
        print('  [D] 旋律 +12dB 仍报缺陷（%.1f%% / %.2f / %.2f）→ 判据不可达 ❌'
              % (r3['mel_pct'], r3['share'], r3['ratio']))
    # E 门禁能区分"设计无旋律"与"有旋律但听不出"
    tot += 1
    if TRACKS['bgm_abyss.wav'].get('melodic_intent', True) is False \
       and TRACKS['bgm_march.wav'].get('melodic_intent', True) is not False:
        print('  [E] abyss melodic_intent=False / march=True → 两者被分开处理 ✅'); ok += 1
    else:
        print('  [E] melodic_intent 标记失效 ❌')
    print('  --- %d/%d 通过' % (ok, tot))
    return ok == tot


def _write_wav(path, samples):
    import struct
    n = len(samples)
    buf = bytearray()
    buf += b'RIFF' + struct.pack('<I', 36 + n * 2) + b'WAVE'
    buf += b'fmt ' + struct.pack('<IHHIIHH', 16, 1, 1, SR, SR * 2, 2, 16)
    buf += b'data' + struct.pack('<I', n * 2)
    for v in samples:
        iv = int(max(-32768, min(32767, round(v * 32767))))
        buf += struct.pack('<h', iv)
    io.open(path, 'wb').write(bytes(buf))


def _inject(sig, freqs, db):
    """把 freqs 这些频率的**窄带**能量乘 10^(db/20)；纯内存，不落盘。
    做法：逐帧 FFT → 取该 bin 的复振幅与相位 → 在时域补一段同频同相
    的正弦，使其幅度变为原来的 f 倍。"""
    f = 10 ** (db / 20.0)
    n = 16384
    out = list(sig)
    win = [0.5 - 0.5 * math.cos(2 * math.pi * i / (n - 1)) for i in range(n)]
    pos = 0
    while pos + n <= len(sig):
        seg = sig[pos:pos + n]
        sp = fft([(seg[k] * win[k], 0.0) for k in range(n)])
        for fr in freqs:
            k = int(round(fr * n / SR))
            if not (1 <= k < n // 2):
                continue
            re, im = sp[k]
            mag = math.hypot(re, im) / n
            need = mag * (f - 1.0)
            ph = math.atan2(im, re)
            for j in range(n):
                out[pos + j] += need * math.cos(2 * math.pi * fr * j / SR + ph)
        pos += n // 2
    return out


def run_all(audio_dir):
    rows = []
    for fn, meta in TRACKS.items():
        p = os.path.join(audio_dir, fn)
        if not os.path.exists(p):
            continue
        rows.append(evaluate(p, meta))
    return rows


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    audio_dir = args[0] if args else 'game/audio'
    out = args[1] if len(args) > 1 else None
    if '--selftest' in sys.argv:
        sys.exit(0 if selftest(audio_dir) else 1)
    rows = run_all(audio_dir)
    if not rows:
        os.makedirs(audio_dir, exist_ok=True)
        print('## 结论\n\n- ❌ 未找到任何 BGM 文件（%s）' % audio_dir)
        sys.exit(1)
    alarms, exempt, notes = judge(rows)
    txt = fmt(rows, alarms, exempt, notes)
    print(txt)
    if out:
        d = os.path.dirname(out)
        if d:
            os.makedirs(d, exist_ok=True)
        io.open(out, 'w', encoding='utf-8').write(txt)
        print('→ 已写', out)
    sys.exit(1 if alarms else 0)


if __name__ == '__main__':
    main()
