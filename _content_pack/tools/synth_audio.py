# -*- coding: utf-8 -*-
"""
synth_audio.py — 森灵内容包专属音频合成（纯 Python 标准库，零依赖，不消耗生成额度）

产出（落在 _content_pack/audio/）：
  cp_bgm_forest.wav   森林主题 BGM 循环（柔 pad + 三角波 lead + 轻贝斯 + 铃 + 软底鼓，无缝循环）
  cp_sfx_summon.wav   召唤音效（上行魔法琶音 + 微光）
  cp_sfx_heal.wav     治疗音效（暖色上行和弦 swell）

全部为原创参数化合成，无第三方权利，可自由商用。
"""
import math, struct, wave, random

SR = 44100

def midi_freq(m):
    return 440.0 * 2.0 ** ((m - 69) / 12.0)

def env_adsr(t, dur, a=0.01, d=0.05, s=0.7, r=0.08):
    if t < a:
        return t / a
    if t < a + d:
        return 1.0 - (1.0 - s) * (t - a) / d
    if t < dur - r:
        return s
    if t < dur:
        return s * (dur - t) / r
    return 0.0

def tone(t, freq, wave='sine', duty=0.5):
    ph = (t * freq) % 1.0
    if wave == 'sine':
        return math.sin(2 * math.pi * t * freq)
    if wave == 'triangle':
        return 4.0 * abs(ph - 0.5) - 1.0
    if wave == 'square':
        return 1.0 if ph < duty else -1.0
    if wave == 'sawtooth':
        return 2.0 * ph - 1.0
    return 0.0

def write_wav(path, buf, peak_target=0.85):
    peak = max(abs(s) for s in buf) or 1.0
    f = peak_target / peak
    frames = bytearray()
    for s in buf:
        frames += struct.pack('<h', int(max(-1, min(1, s * f)) * 32767))
    with wave.open(path, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(bytes(frames))

# ---------------- 森林 BGM ----------------
def synth_bgm(path, bars=16, bpm=108, fade=0.08):
    beat = 60.0 / bpm
    bar_dur = beat * 4
    total = bars * bar_dur
    N = int(total * SR)
    buf = [0.0] * N
    rng = random.Random(20260922)
    # I–vi–IV–V 进行（C Am F G），每 4 小节一轮
    prog = [(60, [60,64,67]), (57, [57,60,64]), (53, [53,57,60]), (55, [55,59,62])]
    # 五声音阶（C D E G A）用于 lead
    penta = [72,74,76,79,81,84,86,88]

    def add(start, dur, freq, amp, wave, a=0.01, d=0.05, s=0.7, r=0.08):
        i0 = int(start * SR)
        cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)

    def kick(start):
        cnt = int(0.10 * SR)
        i0 = int(start * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            prog = i / float(cnt)
            buf[idx] += 0.22 * (1 - prog) ** 2 * math.sin(2 * math.pi * 60.0 * prog * 0.10)

    deg = 3
    for bar in range(bars):
        root_midi, chord = prog[(bar // 4) % 4]
        s0 = bar * bar_dur
        # pad：整小节持续和弦（柔 sine）
        for c in chord:
            add(s0, bar_dur * 0.98, midi_freq(c), 0.10, 'sine', a=0.25, d=0.1, s=0.8, r=0.4)
        # 贝斯：1、3 拍根音
        add(s0, beat * 0.9, midi_freq(root_midi - 24), 0.20, 'sine', a=0.01, d=0.05, s=0.7, r=0.1)
        add(s0 + 2 * beat, beat * 0.9, midi_freq(root_midi - 24), 0.18, 'sine', a=0.01, d=0.05, s=0.7, r=0.1)
        # 铃：小节头轻 ping
        add(s0, 0.5, midi_freq(chord[2] + 12), 0.06, 'sine', a=0.005, d=0.2, s=0.0, r=0.3)
        # lead：八分音符游走五声
        step = 8
        for e in range(step):
            if rng.random() < 0.30:  # 留白
                continue
            t = s0 + e * (beat / 2)
            deg = max(0, min(len(penta) - 1, deg + rng.choice([0,1,1,2,-1,-2])))
            add(t, beat * 0.45, midi_freq(penta[deg]), 0.16, 'triangle', a=0.01, d=0.03, s=0.6, r=0.06)
        # 软底鼓：1、3 拍
        kick(s0)
        kick(s0 + 2 * beat)

    # 无缝循环：末尾 fade 段与开头交叉淡入
    fc = int(fade * SR)
    head = buf[:fc]
    for i in range(fc):
        w = i / float(fc)
        buf[i] = buf[i] * w + head[i] * (1 - w)        # 开头淡入
        buf[N - fc + i] = buf[N - fc + i] * (1 - w) + head[i] * w  # 末尾淡出接回开头
    write_wav(path, buf)
    return total

# ---------------- 召唤音效 ----------------
def synth_summon(path):
    notes = [72, 76, 79, 84, 88, 91]  # C5 E5 G5 C6 E6 G6 上行魔法琶音
    dur = 0.11
    gap = 0.07
    tail = 0.5
    total = len(notes) * gap + tail
    N = int(total * SR)
    buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.005, d=0.06, s=0.5, r=0.15):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    for k, m in enumerate(notes):
        add(k * gap, dur, midi_freq(m), 0.22, 'triangle', a=0.004, d=0.04, s=0.6, r=0.2)
        add(k * gap, dur * 0.6, midi_freq(m + 12), 0.08, 'sine', a=0.002, d=0.03, s=0.3, r=0.1)  # 微光泛音
    # 尾部 shimmer 长音
    add(len(notes) * gap, tail, midi_freq(96), 0.10, 'sine', a=0.02, d=0.1, s=0.7, r=0.4)
    write_wav(path, buf)
    return total

# ---------------- 治疗音效 ----------------
def synth_heal(path):
    chord = [60, 64, 67, 72]  # C E G C 暖色上行和弦 swell
    step = 0.12
    tail = 0.9
    total = len(chord) * step + tail
    N = int(total * SR)
    buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.02, d=0.1, s=0.7, r=0.4):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    for k, m in enumerate(chord):
        add(k * step, total - k * step, midi_freq(m), 0.16, 'sine', a=0.03, d=0.15, s=0.8, r=0.5)
    # 高频暖泛音
    add(len(chord) * step, tail, midi_freq(79), 0.05, 'sine', a=0.05, d=0.2, s=0.5, r=0.5)
    write_wav(path, buf)
    return total

# ---------------- 9 个游戏事件音效 ----------------
# hit / kill / levelup / pickup / hurt / evolve / win / lose / ui
# 全部沿用 midi_freq/env_adsr/tone/write_wav，纯标准库、零额度、不卡机。

def _noise_rng():
    return random.Random(20261001)

def synth_hit(path):
    """受击/命中：低频 thump + 噪声瞬态 + 高频 click。短促有力。"""
    total = 0.16
    N = int(total * SR); buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.002, d=0.04, s=0.4, r=0.06):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    add(0, 0.10, midi_freq(48), 0.5, 'sine', a=0.001, d=0.05, s=0.2, r=0.05)
    r = _noise_rng(); nb = int(0.06 * SR)
    for i in range(nb):
        if i < N: buf[i] += (r.random() * 2 - 1) * 0.3 * (1 - i / nb)
    add(0, 0.02, midi_freq(84), 0.18, 'square', a=0.001, d=0.01, s=0, r=0.01)
    write_wav(path, buf); return total

def synth_kill(path):
    """击杀：下行 whoosh（锯齿扫频）+ 明亮 ding。爽快收尾。"""
    total = 0.34
    N = int(total * SR); buf = [0.0] * N
    def sweep(start, dur, m0, m1, amp, wave, a=0.005, d=0.05, s=0.5, r=0.08):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR; prog = i / cnt
            freq = midi_freq(m0 + (m1 - m0) * prog)
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    def add(start, dur, freq, amp, wave, a=0.005, d=0.06, s=0.5, r=0.15):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    sweep(0, 0.18, 76, 52, 0.40, 'sawtooth', a=0.002, d=0.10, s=0.3, r=0.05)
    add(0.16, 0.18, midi_freq(88), 0.22, 'triangle', a=0.003, d=0.05, s=0.4, r=0.12)
    add(0.16, 0.12, midi_freq(92), 0.08, 'sine', a=0.002, d=0.03, s=0.3, r=0.10)
    write_wav(path, buf); return total

def synth_levelup(path):
    """升级：明亮上行大三和弦琶音（C-E-G-C）。轻快短促。"""
    notes = [72, 76, 79, 84]
    step = 0.09; tail = 0.25; total = len(notes) * step + tail
    N = int(total * SR); buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.004, d=0.05, s=0.6, r=0.20):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    for k, m in enumerate(notes):
        add(k * step, 0.18, midi_freq(m), 0.24, 'triangle', a=0.003, d=0.04, s=0.6, r=0.12)
        add(k * step, 0.12, midi_freq(m + 12), 0.07, 'sine', a=0.002, d=0.03, s=0.3, r=0.10)
    add(len(notes) * step, tail, midi_freq(84), 0.12, 'sine', a=0.02, d=0.10, s=0.7, r=0.20)
    write_wav(path, buf); return total

def synth_pickup(path):
    """拾取：双段上行 bloop（松鼠吃坚果感）。极短清脆。"""
    total = 0.18
    N = int(total * SR); buf = [0.0] * N
    def sweep(start, dur, m0, m1, amp, wave, a=0.002, d=0.05, s=0.5, r=0.08):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR; prog = i / cnt
            freq = midi_freq(m0 + (m1 - m0) * prog)
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    sweep(0, 0.10, 76, 88, 0.22, 'sine', a=0.002, d=0.04, s=0.4, r=0.05)
    sweep(0.09, 0.07, 88, 95, 0.12, 'sine', a=0.002, d=0.03, s=0.3, r=0.04)
    write_wav(path, buf); return total

def synth_hurt(path):
    """受伤：下行锯齿 harsh sweep + 噪声毛刺。刺痛感。"""
    total = 0.26
    N = int(total * SR); buf = [0.0] * N
    def sweep(start, dur, m0, m1, amp, wave, a=0.002, d=0.05, s=0.5, r=0.08):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR; prog = i / cnt
            freq = midi_freq(m0 + (m1 - m0) * prog)
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    sweep(0, 0.20, 67, 55, 0.35, 'sawtooth', a=0.002, d=0.08, s=0.4, r=0.06)
    r = _noise_rng(); nb = int(0.10 * SR)
    for i in range(nb):
        if i < N: buf[i] += (r.random() * 2 - 1) * 0.12 * (1 - i / nb)
    write_wav(path, buf); return total

def synth_evolve(path):
    """进化：宏大上行琶音 + 收尾和弦 swell。比升级更隆重。"""
    notes = [60, 64, 67, 72, 76, 79]
    step = 0.10; tail = 0.45; total = len(notes) * step + tail
    N = int(total * SR); buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.01, d=0.08, s=0.7, r=0.30):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    for k, m in enumerate(notes):
        add(k * step, 0.30, midi_freq(m), 0.20, 'triangle', a=0.006, d=0.05, s=0.6, r=0.20)
        add(k * step, 0.20, midi_freq(m + 12), 0.06, 'sine', a=0.003, d=0.03, s=0.3, r=0.15)
    for c in [60, 64, 67, 72]:
        add(len(notes) * step, tail, midi_freq(c), 0.14, 'sine', a=0.04, d=0.20, s=0.8, r=0.40)
    write_wav(path, buf); return total

def synth_win(path):
    """胜利：号角式上行琶音 + 尾部和弦。凯旋。"""
    notes = [72, 76, 79, 84, 88]
    step = 0.12; tail = 0.50; total = len(notes) * step + tail
    N = int(total * SR); buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.005, d=0.06, s=0.7, r=0.30):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    for k, m in enumerate(notes):
        add(k * step, 0.22, midi_freq(m), 0.24, 'triangle', a=0.004, d=0.05, s=0.6, r=0.15)
        add(k * step, 0.15, midi_freq(m - 12), 0.08, 'sine', a=0.003, d=0.04, s=0.4, r=0.10)
    for c in [60, 64, 67, 72]:
        add(len(notes) * step, tail, midi_freq(c), 0.13, 'sine', a=0.03, d=0.15, s=0.8, r=0.40)
    write_wav(path, buf); return total

def synth_lose(path):
    """失败：下行小调叹息（G-E-C-G）+ 低沉余音。失落。"""
    notes = [67, 63, 60, 55]
    step = 0.16; tail = 0.35; total = len(notes) * step + tail
    N = int(total * SR); buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.01, d=0.10, s=0.6, r=0.30):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    for k, m in enumerate(notes):
        add(k * step, 0.30, midi_freq(m), 0.22, 'triangle', a=0.01, d=0.08, s=0.6, r=0.20)
        add(k * step, 0.20, midi_freq(m - 12), 0.07, 'sine', a=0.008, d=0.06, s=0.4, r=0.15)
    add(len(notes) * step, tail, midi_freq(48), 0.10, 'sine', a=0.05, d=0.20, s=0.7, r=0.30)
    write_wav(path, buf); return total

def synth_ui(path):
    """UI 点击：极短柔 tick。克制不抢戏。"""
    total = 0.06
    N = int(total * SR); buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.001, d=0.02, s=0.3, r=0.02):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    add(0, total, midi_freq(84), 0.16, 'sine', a=0.001, d=0.015, s=0.2, r=0.015)
    write_wav(path, buf); return total

# ---------------- 5 个「音画配对」事件音效（round-10 · 与 VFX 配套） ----------------
def synth_explosion(path):
    """爆炸 / 范围冲击（配套 fx_explosion / fx_shockwave）：低频 boom + 噪声爆破 + 碎片脆响。"""
    total = 0.40
    N = int(total * SR); buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.002, d=0.05, s=0.4, r=0.10):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    add(0, 0.22, midi_freq(40), 0.55, 'sine', a=0.001, d=0.10, s=0.3, r=0.10)
    add(0, 0.14, midi_freq(33), 0.40, 'triangle', a=0.001, d=0.08, s=0.2, r=0.06)
    r = _noise_rng(); nb = int(0.18 * SR)
    for i in range(nb):
        if i < N: buf[i] += (r.random() * 2 - 1) * 0.45 * (1 - i / nb) ** 1.3
    for k in range(6):
        s = 0.12 + k * 0.03
        add(s, 0.05, midi_freq(84 + k * 2), 0.12, 'square', a=0.001, d=0.02, s=0.2, r=0.03)
    write_wav(path, buf); return total

def synth_dash(path):
    """位移 / 闪避 whoosh（配套 fx_dash_trail）：快速上行扫频 + 风噪。"""
    total = 0.22
    N = int(total * SR); buf = [0.0] * N
    def sweep(start, dur, m0, m1, amp, wave, a=0.002, d=0.05, s=0.4, r=0.08):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR; prog = i / cnt
            freq = midi_freq(m0 + (m1 - m0) * prog)
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    sweep(0, 0.18, 50, 78, 0.30, 'sawtooth', a=0.002, d=0.10, s=0.2, r=0.06)
    r = _noise_rng(); nb = int(0.16 * SR)
    for i in range(nb):
        if i < N:
            p = i / nb
            buf[i] += (r.random() * 2 - 1) * 0.18 * (1 - p) * (0.5 + 0.5 * math.sin(2 * math.pi * 30 * p))
    write_wav(path, buf); return total

def synth_portal(path):
    """召唤 / 传送（配套 fx_portal）：失谐正弦琶音 + 缓慢调制的漩涡感。"""
    total = 0.70
    N = int(total * SR); buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.01, d=0.10, s=0.6, r=0.30):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    notes = [60, 63, 67, 70, 74]
    step = 0.07
    for k, m in enumerate(notes):
        add(k * step, 0.30, midi_freq(m), 0.16, 'sine', a=0.01, d=0.08, s=0.5, r=0.20)
        add(k * step, 0.24, midi_freq(m + 0.5), 0.08, 'triangle', a=0.01, d=0.06, s=0.4, r=0.15)
    tail0 = len(notes) * step
    for i in range(N):
        t = i / SR
        if t > tail0:
            f = 1 - (t - tail0) / 0.30
            if f > 0:
                buf[i] += 0.06 * math.sin(2 * math.pi * midi_freq(72) * t) * f
                buf[i] += 0.04 * math.sin(2 * math.pi * midi_freq(72.5) * t) * f
    write_wav(path, buf); return total

def synth_coin(path):
    """金币 / 得分拾取（配套 fx_coin_burst）：经典双音叮（B5→E6）。"""
    total = 0.18
    N = int(total * SR); buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.001, d=0.02, s=0.3, r=0.06):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    add(0, 0.06, midi_freq(83), 0.26, 'square', a=0.001, d=0.01, s=0.2, r=0.02)
    add(0.05, 0.12, midi_freq(88), 0.26, 'square', a=0.001, d=0.03, s=0.3, r=0.06)
    add(0.05, 0.10, midi_freq(100), 0.08, 'sine', a=0.001, d=0.02, s=0.2, r=0.04)
    write_wav(path, buf); return total

def synth_warning(path):
    """预警 / 地面警示（配套 fx_telegraph）：紧张双音警报（小二度叠置，急促）。"""
    total = 0.44
    N = int(total * SR); buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.002, d=0.03, s=0.5, r=0.05):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    for k in range(2):
        s = k * 0.20
        add(s, 0.16, midi_freq(69), 0.24, 'square', a=0.002, d=0.02, s=0.6, r=0.04)
        add(s, 0.16, midi_freq(70), 0.24, 'square', a=0.002, d=0.02, s=0.6, r=0.04)
    write_wav(path, buf); return total

# ---------------- 3 个「状态机制」音效（round-15 · 与 VFX 配套） ----------------
def synth_freeze(path):
    """冻结 / 碎冰命中（配套 fx_freeze_shatter）：高频玻璃质碎裂叮 + 冷色下扫 + 霜噪微闪。"""
    total = 0.34
    N = int(total * SR); buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.002, d=0.05, s=0.4, r=0.10):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    def sweep(start, dur, m0, m1, amp, wave, a=0.002, d=0.05, s=0.4, r=0.08):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR; prog = i / cnt
            freq = midi_freq(m0 + (m1 - m0) * prog)
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    for k, m in enumerate([88, 91, 95, 99]):  # 玻璃质碎裂叮（高频三角）
        add(k * 0.03, 0.10, midi_freq(m), 0.18, 'triangle', a=0.001, d=0.04, s=0.3, r=0.06)
    sweep(0.06, 0.16, 84, 60, 0.22, 'sawtooth', a=0.002, d=0.08, s=0.3, r=0.05)  # 冷色下扫
    r = _noise_rng(); nb = int(0.20 * SR)
    for i in range(nb):  # 霜噪微闪
        if i < N:
            p = i / nb
            buf[i] += (r.random() * 2 - 1) * 0.14 * (1 - p) ** 1.5 * (0.6 + 0.4 * math.sin(2 * math.pi * 40 * p))
    write_wav(path, buf); return total

def synth_buff(path):
    """增益 / 强化生效（配套 fx_buff）：明亮上行大三和弦 + 金光泛音，比治疗更「赋能」。"""
    notes = [72, 76, 79, 84]  # C E G C 上行
    step = 0.06; tail = 0.30; total = len(notes) * step + tail
    N = int(total * SR); buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.003, d=0.05, s=0.6, r=0.20):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    for k, m in enumerate(notes):
        add(k * step, 0.20, midi_freq(m), 0.22, 'triangle', a=0.003, d=0.04, s=0.6, r=0.12)
        add(k * step, 0.14, midi_freq(m + 12), 0.07, 'sine', a=0.002, d=0.03, s=0.3, r=0.10)
    for c in [72, 76, 79, 84]:  # 收尾赋能和弦
        add(len(notes) * step, tail, midi_freq(c), 0.12, 'sine', a=0.02, d=0.12, s=0.7, r=0.25)
    write_wav(path, buf); return total

def synth_debuff(path):
    """减益 / 诅咒生效（配套 fx_debuff）：下行阴郁小调 + 低频闷响。"""
    notes = [67, 63, 60, 56]  # G E C G 下行（比失败更暗）
    step = 0.10; tail = 0.30; total = len(notes) * step + tail
    N = int(total * SR); buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.004, d=0.06, s=0.5, r=0.18):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    for k, m in enumerate(notes):
        add(k * step, 0.24, midi_freq(m), 0.20, 'sawtooth', a=0.004, d=0.06, s=0.5, r=0.14)
        add(k * step, 0.16, midi_freq(m - 12), 0.07, 'sine', a=0.003, d=0.05, s=0.4, r=0.12)
    add(0, 0.20, midi_freq(40), 0.30, 'sine', a=0.002, d=0.10, s=0.2, r=0.10)  # 低频闷响
    add(len(notes) * step, tail, midi_freq(47), 0.10, 'sine', a=0.04, d=0.15, s=0.6, r=0.25)
    write_wav(path, buf); return total

# ---------------- 战斗 BGM（本轮新增 · 探索/秘境的对立项） ----------------
def synth_bgm_battle(path, bars=16, bpm=128, fade=0.08):
    """战斗主题 BGM：更快的节奏（128 BPM）、驱动贝斯、 energetic 琶音 lead、
    kick/snare/hi-hat 鼓组，i–VI–III–VII（Am–F–C–G）进行，无缝循环。"""
    beat = 60.0 / bpm
    bar_dur = beat * 4
    total = bars * bar_dur
    N = int(total * SR)
    buf = [0.0] * N
    rng = random.Random(20260923)
    # i–VI–III–VII in A minor：Am F C G（root 低八度 + 和弦）
    prog = [(45, [57, 60, 64]), (41, [53, 57, 60]), (48, [60, 64, 67]), (43, [55, 59, 62])]

    def add(start, dur, freq, amp, wave, a=0.01, d=0.05, s=0.7, r=0.08):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)

    def kick(start):
        cnt = int(0.12 * SR); i0 = int(start * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            p = i / float(cnt)
            buf[idx] += 0.30 * (1 - p) ** 2 * math.sin(2 * math.pi * 70.0 * p * 0.12)

    def snare(start):
        cnt = int(0.14 * SR); i0 = int(start * SR)
        r = _noise_rng()
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            p = i / float(cnt)
            buf[idx] += (r.random() * 2 - 1) * 0.22 * (1 - p) ** 1.5

    def hat(start):
        cnt = int(0.04 * SR); i0 = int(start * SR)
        r = _noise_rng()
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            p = i / float(cnt)
            buf[idx] += (r.random() * 2 - 1) * 0.07 * (1 - p)

    for bar in range(bars):
        root, chord = prog[(bar // 4) % 4]
        s0 = bar * bar_dur
        # pad：整小节柔 sine（高八度铺底）
        for c in chord:
            add(s0, bar_dur * 0.98, midi_freq(c + 12), 0.07, 'sine', a=0.20, d=0.1, s=0.8, r=0.4)
        # 驱动贝斯：八分音符根音（三角波，带颗粒）
        for e in range(8):
            add(s0 + e * (beat / 2), beat * 0.42, midi_freq(root), 0.20, 'triangle', a=0.005, d=0.03, s=0.6, r=0.05)
        # 能量琶音 lead：八分音符跑和弦音（方波）
        seq = chord * 2
        for e in range(8):
            add(s0 + e * (beat / 2), beat * 0.40, midi_freq(seq[e % len(seq)] + 12), 0.09, 'square', a=0.003, d=0.03, s=0.4, r=0.05)
        # 鼓组：kick(1,3拍) snare(2,4拍) hat(八分)
        kick(s0); kick(s0 + 2 * beat)
        snare(s0 + beat); snare(s0 + 3 * beat)
        for e in range(8):
            hat(s0 + e * (beat / 2))

    # 无缝循环：末尾 fade 段与开头交叉淡入
    fc = int(fade * SR)
    head = buf[:fc]
    for i in range(fc):
        w = i / float(fc)
        buf[i] = buf[i] * w + head[i] * (1 - w)
        buf[N - fc + i] = buf[N - fc + i] * (1 - w) + head[i] * w
    write_wav(path, buf)
    return total

# ---------------- Boss BGM（本轮新增 · 战斗主题的更沉重对立项） ----------------
def synth_bgm_boss(path, bars=12, bpm=92, fade=0.08):
    """Boss 主题 BGM：更慢（92 BPM）、更沉重的史诗小调，厚低频 + 铜管感锯齿 lead +
    定音鼓式 kick + 不祥钟声动机，i–VI–III–VII（Am–F–C–G），无缝循环。"""
    beat = 60.0 / bpm
    bar_dur = beat * 4
    total = bars * bar_dur
    N = int(total * SR)
    buf = [0.0] * N
    rng = random.Random(20260924)
    prog = [(45, [57, 60, 64]), (41, [53, 57, 60]), (48, [60, 64, 67]), (43, [55, 59, 62])]

    def add(start, dur, freq, amp, wave, a=0.01, d=0.05, s=0.7, r=0.08):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)

    def kick(start):
        cnt = int(0.16 * SR); i0 = int(start * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            p = i / float(cnt)
            buf[idx] += 0.38 * (1 - p) ** 2 * math.sin(2 * math.pi * 58.0 * p * 0.16)

    def bell(start, m):
        cnt = int(0.7 * SR); i0 = int(start * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR; p = i / float(cnt)
            a = 0.10 * (1 - p) ** 1.6
            buf[idx] += a * tone(t, midi_freq(m), 'sine') + a * 0.4 * tone(t, midi_freq(m + 7), 'sine')

    for bar in range(bars):
        root, chord = prog[(bar // 4) % 4]
        s0 = bar * bar_dur
        # 低沉铺底 pad（暗色正弦）
        for c in chord:
            add(s0, bar_dur * 0.98, midi_freq(c), 0.09, 'sine', a=0.30, d=0.10, s=0.8, r=0.5)
        # 厚重贝斯：二分音符根音
        add(s0, beat * 1.8, midi_freq(root), 0.26, 'triangle', a=0.01, d=0.10, s=0.7, r=0.10)
        add(s0 + 2 * beat, beat * 1.8, midi_freq(root), 0.24, 'triangle', a=0.01, d=0.10, s=0.7, r=0.10)
        # 铜管感锯齿 lead：稀疏英雄动机
        motif = [chord[0] + 12, chord[1] + 12, chord[2] + 12]
        lead = [(0, beat * 0.9, motif[0]), (beat, beat * 0.9, motif[1]),
                (2 * beat, beat * 0.9, motif[0]), (3 * beat, beat * 1.5, motif[2])]
        for off, dur, m in lead:
            add(s0 + off, dur, midi_freq(m), 0.12, 'sawtooth', a=0.02, d=0.08, s=0.6, r=0.15)
        # 定音鼓式 kick（每小节头，奇数小节加 3 拍）
        kick(s0)
        if bar % 2 == 1:
            kick(s0 + 2 * beat)
        # 不祥钟声动机（高八度泛音）
        bell(s0, chord[2] + 24)

    # 无缝循环：末尾 fade 段与开头交叉淡入
    fc = int(fade * SR)
    head = buf[:fc]
    for i in range(fc):
        w = i / float(fc)
        buf[i] = buf[i] * w + head[i] * (1 - w)
        buf[N - fc + i] = buf[N - fc + i] * (1 - w) + head[i] * w
    write_wav(path, buf)
    return total

# ---------------- 潮次涌动 BGM（本轮新增 · 森林主题升级层） ----------------
def synth_bgm_tide(path, bars=16, bpm=116, fade=0.08):
    """潮次涌动 BGM：森林主题的升级层 —— 稍快（116 BPM）、滚动八分贝斯 + 十六分水花琶音 +
    4/4 轻底鼓 + 拍手式军鼓 + 八分 hi-hat，叠加「潮涌」幅度 LFO，让常规波次有涌动推进感。
    I–vi–IV–V（C Am F G），无缝循环。"""
    beat = 60.0 / bpm
    bar_dur = beat * 4
    total = bars * bar_dur
    N = int(total * SR)
    buf = [0.0] * N
    rng = random.Random(20260925)
    prog = [(60, [60,64,67]), (57, [57,60,64]), (53, [53,57,60]), (55, [55,59,62])]
    penta = [72,74,76,79,81,84,86,88]

    def add(start, dur, freq, amp, wave, a=0.01, d=0.05, s=0.7, r=0.08):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)

    def kick(start):
        cnt = int(0.11 * SR); i0 = int(start * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            p = i / float(cnt)
            buf[idx] += 0.24 * (1 - p) ** 2 * math.sin(2 * math.pi * 64.0 * p * 0.11)

    def clap(start):
        cnt = int(0.12 * SR); i0 = int(start * SR)
        r = _noise_rng()
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            p = i / float(cnt)
            buf[idx] += (r.random() * 2 - 1) * 0.13 * (1 - p) ** 1.4

    def hat(start):
        cnt = int(0.035 * SR); i0 = int(start * SR)
        r = _noise_rng()
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            p = i / float(cnt)
            buf[idx] += (r.random() * 2 - 1) * 0.05 * (1 - p)

    deg = 3
    for bar in range(bars):
        root_midi, chord = prog[(bar // 4) % 4]
        s0 = bar * bar_dur
        # pad：整小节柔 sine（高八度铺底）
        for c in chord:
            add(s0, bar_dur * 0.98, midi_freq(c + 12), 0.08, 'sine', a=0.20, d=0.1, s=0.8, r=0.4)
        # 滚动八分贝斯（带潮涌 LFO 调制）
        for e in range(8):
            st = s0 + e * (beat / 2)
            lfo = 0.55 + 0.45 * math.sin(2 * math.pi * 0.5 * st)  # 0.5 Hz 潮涌
            add(st, beat * 0.46, midi_freq(root_midi - 24), 0.18 * lfo, 'triangle',
                a=0.005, d=0.03, s=0.6, r=0.06)
        # 十六分水花琶音（soft sine，潮涌起伏）
        for e in range(16):
            st = s0 + e * (beat / 4)
            lfo = 0.5 + 0.5 * math.sin(2 * math.pi * (e / 16.0))  # 每小节潮涌一次
            note = chord[e % 3] + 12
            add(st, beat * 0.22, midi_freq(note), 0.05 * lfo, 'sine', a=0.004, d=0.03, s=0.3, r=0.05)
        # 铃 + 八度跳动机（小节头）
        add(s0, 0.4, midi_freq(chord[2] + 12), 0.06, 'sine', a=0.005, d=0.2, s=0.0, r=0.3)
        add(s0, 0.4, midi_freq(chord[2] + 24), 0.04, 'triangle', a=0.005, d=0.2, s=0.0, r=0.3)
        # lead：八分音符游走五声
        for e in range(8):
            if rng.random() < 0.20:
                continue
            t = s0 + e * (beat / 2)
            deg = max(0, min(len(penta) - 1, deg + rng.choice([0,1,1,2,-1,-2])))
            add(t, beat * 0.45, midi_freq(penta[deg]), 0.14, 'triangle', a=0.01, d=0.03, s=0.6, r=0.06)
        # 鼓组
        kick(s0); kick(s0 + 2 * beat)
        clap(s0 + beat); clap(s0 + 3 * beat)
        for e in range(8):
            hat(s0 + e * (beat / 2))

    # 无缝循环：末尾 fade 段与开头交叉淡入
    fc = int(fade * SR)
    head = buf[:fc]
    for i in range(fc):
        w = i / float(fc)
        buf[i] = buf[i] * w + head[i] * (1 - w)
        buf[N - fc + i] = buf[N - fc + i] * (1 - w) + head[i] * w
    write_wav(path, buf)
    return total

# ---------------- 精英遭遇 BGM（本轮新增 · 战斗主题紧张对立项） ----------------
def synth_bgm_elite(path, bars=16, bpm=124, fade=0.08):
    """精英遭遇 BGM：战斗主题的紧张对立项 —— 124 BPM、持续低音 drone + 小二度摩擦 ostinato +
    16 分 hi-hat 织体 + 每小节警报 ping，制造「精英来袭」的不安张力。
    Am–F–C–G 进行，无缝循环。"""
    beat = 60.0 / bpm
    bar_dur = beat * 4
    total = bars * bar_dur
    N = int(total * SR)
    buf = [0.0] * N
    rng = random.Random(20260926)
    prog = [(45, [57, 60, 64]), (41, [53, 57, 60]), (48, [60, 64, 67]), (43, [55, 59, 62])]

    def add(start, dur, freq, amp, wave, a=0.01, d=0.05, s=0.7, r=0.08):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)

    def kick(start):
        cnt = int(0.11 * SR); i0 = int(start * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            p = i / float(cnt)
            buf[idx] += 0.28 * (1 - p) ** 2 * math.sin(2 * math.pi * 66.0 * p * 0.11)

    def snare(start):
        cnt = int(0.13 * SR); i0 = int(start * SR)
        r = _noise_rng()
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            p = i / float(cnt)
            buf[idx] += (r.random() * 2 - 1) * 0.18 * (1 - p) ** 1.5

    def hat(start):
        cnt = int(0.03 * SR); i0 = int(start * SR)
        r = _noise_rng()
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            p = i / float(cnt)
            buf[idx] += (r.random() * 2 - 1) * 0.06 * (1 - p)

    for bar in range(bars):
        root, chord = prog[(bar // 4) % 4]
        s0 = bar * bar_dur
        # 持续低音 drone（整小节）
        add(s0, bar_dur * 0.98, midi_freq(root - 12), 0.14, 'sine', a=0.10, d=0.10, s=0.8, r=0.30)
        # 暗色 pad（高八度）
        for c in chord:
            add(s0, bar_dur * 0.98, midi_freq(c + 12), 0.05, 'sine', a=0.20, d=0.10, s=0.7, r=0.40)
        # 紧张 ostinato：根音 + 小二度摩擦（八分），制造不安
        for e in range(8):
            st = s0 + e * (beat / 2)
            n = root if e % 2 == 0 else root + 1  # 小二度摩擦
            add(st, beat * 0.40, midi_freq(n), 0.12, 'square', a=0.004, d=0.03, s=0.35, r=0.05)
        # 八分贝斯（颗粒三角）
        for e in range(8):
            add(s0 + e * (beat / 2), beat * 0.42, midi_freq(root), 0.16, 'triangle',
                a=0.005, d=0.03, s=0.5, r=0.05)
        # 每小节警报 ping（方波 staccato，紧张）
        add(s0, 0.10, midi_freq(chord[2] + 24), 0.10, 'square', a=0.002, d=0.02, s=0.2, r=0.05)
        add(s0 + beat, 0.10, midi_freq(chord[2] + 24), 0.10, 'square', a=0.002, d=0.02, s=0.2, r=0.05)
        # 鼓组
        kick(s0); kick(s0 + 2 * beat)
        snare(s0 + beat); snare(s0 + 3 * beat)
        for e in range(16):  # 16 分 hi-hat 织体
            hat(s0 + e * (beat / 4))

    # 无缝循环：末尾 fade 段与开头交叉淡入
    fc = int(fade * SR)
    head = buf[:fc]
    for i in range(fc):
        w = i / float(fc)
        buf[i] = buf[i] * w + head[i] * (1 - w)
        buf[N - fc + i] = buf[N - fc + i] * (1 - w) + head[i] * w
    write_wav(path, buf)
    return total

# ---------------- BOSS 二阶段 BGM（本轮新增 · Boss 主题狂暴对立项） ----------------
def synth_bgm_boss2(path, bars=12, bpm=124, fade=0.08):
    """BOSS 二阶段 BGM：Boss 主题的狂暴对立项 —— 更快（124 BPM）+ 四踩底鼓 + 双倍驱动贝斯 +
    八度叠加锯齿英雄动机（比一阶段高八度更尖锐）+ 切分军鼓 + 整体升半音「狂暴」转调，
    Am–F–C–G（+1 半音）进行，无缝循环。"""
    beat = 60.0 / bpm
    bar_dur = beat * 4
    total = bars * bar_dur
    N = int(total * SR)
    buf = [0.0] * N
    rng = random.Random(20260927)
    # 整体升半音（狂暴转调）：保留相同功能音级
    prog = [(46, [58, 61, 65]), (42, [54, 58, 61]), (49, [61, 65, 68]), (44, [56, 60, 63])]

    def add(start, dur, freq, amp, wave, a=0.01, d=0.05, s=0.7, r=0.08):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)

    def kick(start):
        cnt = int(0.13 * SR); i0 = int(start * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            p = i / float(cnt)
            buf[idx] += 0.34 * (1 - p) ** 2 * math.sin(2 * math.pi * 60.0 * p * 0.13)

    def snare(start):
        cnt = int(0.13 * SR); i0 = int(start * SR)
        r = _noise_rng()
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            p = i / float(cnt)
            buf[idx] += (r.random() * 2 - 1) * 0.20 * (1 - p) ** 1.5

    def bell(start, m):
        cnt = int(0.50 * SR); i0 = int(start * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR; p = i / float(cnt)
            a = 0.08 * (1 - p) ** 1.6
            buf[idx] += a * tone(t, midi_freq(m), 'sine') + a * 0.4 * tone(t, midi_freq(m + 7), 'sine')

    for bar in range(bars):
        root, chord = prog[(bar // 4) % 4]
        s0 = bar * bar_dur
        # 低沉铺底 pad
        for c in chord:
            add(s0, bar_dur * 0.98, midi_freq(c), 0.09, 'sine', a=0.30, d=0.10, s=0.8, r=0.50)
        # 双倍驱动贝斯（八分）
        for e in range(8):
            add(s0 + e * (beat / 2), beat * 0.42, midi_freq(root), 0.22, 'triangle',
                a=0.005, d=0.03, s=0.6, r=0.05)
        # 八度叠加锯齿英雄动机（比一阶段高八度 + octave doubling，更尖锐）
        motif = [chord[0] + 12, chord[1] + 12, chord[2] + 12]
        lead = [(0, beat * 0.8, motif[0]), (beat, beat * 0.8, motif[1]),
                (2 * beat, beat * 0.8, motif[0]), (3 * beat, beat * 1.2, motif[2])]
        for off, dur, m in lead:
            add(s0 + off, dur, midi_freq(m), 0.12, 'sawtooth', a=0.02, d=0.08, s=0.6, r=0.12)
            add(s0 + off, dur, midi_freq(m + 12), 0.06, 'sawtooth', a=0.02, d=0.08, s=0.5, r=0.12)
        # 四踩底鼓（每拍）+ 双踩 ghost
        for e in range(4):
            kick(s0 + e * beat)
        kick(s0 + beat * 1.5)
        kick(s0 + beat * 3.5)
        # 切分军鼓（2、4 拍）
        snare(s0 + beat); snare(s0 + 3 * beat)
        # 不祥钟声动机（更短促）
        bell(s0, chord[2] + 24)

    # 无缝循环：末尾 fade 段与开头交叉淡入
    fc = int(fade * SR)
    head = buf[:fc]
    for i in range(fc):
        w = i / float(fc)
        buf[i] = buf[i] * w + head[i] * (1 - w)
        buf[N - fc + i] = buf[N - fc + i] * (1 - w) + head[i] * w
    write_wav(path, buf)
    return total

# ---------------- 元素命中音效（本轮新增 · 五元素听觉签名） ----------------
def synth_hit_fire(path):
    """火元素命中：噼啪噪声爆发 + 高频爆裂 pop + 下行火苗扫频。"""
    total = 0.30
    N = int(total * SR); buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.002, d=0.04, s=0.4, r=0.08):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    def sweep(start, dur, m0, m1, amp, wave, a=0.002, d=0.05, s=0.4, r=0.08):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR; prog = i / cnt
            freq = midi_freq(m0 + (m1 - m0) * prog)
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    r = _noise_rng(); nb = int(0.18 * SR)
    for i in range(nb):  # 噼啪噪声爆发
        if i < N: buf[i] += (r.random() * 2 - 1) * 0.30 * (1 - i / nb) ** 1.2
    add(0, 0.08, midi_freq(88), 0.25, 'square', a=0.001, d=0.03, s=0.2, r=0.04)  # 高频爆裂 pop
    sweep(0.04, 0.20, 72, 50, 0.30, 'sawtooth', a=0.002, d=0.10, s=0.3, r=0.05)  # 下行火苗扫频
    write_wav(path, buf); return total

def synth_hit_water(path):
    """水元素命中：下滑水音 blip + 气泡噪声 + 清亮叮。"""
    total = 0.26
    N = int(total * SR); buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.002, d=0.05, s=0.4, r=0.08):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    def sweep(start, dur, m0, m1, amp, wave, a=0.002, d=0.05, s=0.4, r=0.08):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR; prog = i / cnt
            freq = midi_freq(m0 + (m1 - m0) * prog)
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    sweep(0, 0.18, 80, 58, 0.32, 'sine', a=0.002, d=0.10, s=0.4, r=0.06)  # 下滑水音
    r = _noise_rng(); nb = int(0.10 * SR)
    for i in range(nb):  # 气泡噪声
        if i < N: buf[i] += (r.random() * 2 - 1) * 0.16 * (1 - i / nb) * (0.6 + 0.4 * math.sin(2 * math.pi * 50 * i / nb))
    add(0, 0.06, midi_freq(91), 0.20, 'sine', a=0.001, d=0.03, s=0.2, r=0.04)  # 清亮叮
    write_wav(path, buf); return total

def synth_hit_earth(path):
    """土元素命中：沉重 thud + 低频隆隆 + 碎石噪声。"""
    total = 0.34
    N = int(total * SR); buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.002, d=0.05, s=0.4, r=0.10):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    add(0, 0.12, midi_freq(40), 0.55, 'sine', a=0.001, d=0.06, s=0.2, r=0.06)  # 沉重 thud
    add(0, 0.10, midi_freq(33), 0.40, 'triangle', a=0.001, d=0.05, s=0.2, r=0.05)
    add(0, total, midi_freq(31), 0.25, 'sine', a=0.01, d=0.20, s=0.6, r=0.10)  # 低频隆隆（持续）
    r = _noise_rng(); nb = int(0.16 * SR)
    for i in range(nb):  # 碎石噪声
        if i < N: buf[i] += (r.random() * 2 - 1) * 0.18 * (1 - i / nb) ** 1.3
    write_wav(path, buf); return total

def synth_hit_light(path):
    """光元素命中：清亮钟铃 + 高频微光泛音 + 闪烁 shimmer。"""
    total = 0.30
    N = int(total * SR); buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.002, d=0.08, s=0.5, r=0.18):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    notes = [84, 88, 91]
    for k, m in enumerate(notes):  # 钟铃三连
        add(k * 0.02, 0.24, midi_freq(m), 0.20, 'sine', a=0.002, d=0.06, s=0.5, r=0.16)
        add(k * 0.02, 0.18, midi_freq(m + 12), 0.06, 'sine', a=0.001, d=0.04, s=0.3, r=0.12)
    add(0.06, total - 0.06, midi_freq(96), 0.05, 'sine', a=0.04, d=0.2, s=0.5, r=0.4)  # shimmer 长音
    write_wav(path, buf); return total

def synth_hit_wood(path):
    """木元素命中：木鱼式 knock + 干裂噪声 + 轻 rustle。"""
    total = 0.22
    N = int(total * SR); buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.001, d=0.03, s=0.3, r=0.05):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    add(0, 0.05, midi_freq(64), 0.30, 'square', a=0.001, d=0.02, s=0.2, r=0.03)  # 木鱼 knock
    add(0, 0.08, midi_freq(58), 0.22, 'triangle', a=0.001, d=0.04, s=0.3, r=0.04)
    r = _noise_rng(); nb = int(0.10 * SR)
    for i in range(nb):  # 干裂噪声（枯枝）
        if i < N: buf[i] += (r.random() * 2 - 1) * 0.14 * (1 - i / nb) ** 1.5
    write_wav(path, buf); return total

# ---------------- 五元素主题动机（Round-22 · 元素身份听觉签名 + 演练场选元素提示） ----------------
# 每个动机为 ~2s 无缝短循环（交叉淡入），音色/音高贴合元素身份色（见 data/element_matrix.json）：
# 火=明亮跃动、水=流动涟漪、土=厚重脉冲、光=闪烁铃音、木=有机叩击。
def _loop_crossfade(buf, fade):
    N = len(buf); fc = int(fade * SR); head = buf[:fc]
    for i in range(fc):
        w = i / float(fc)
        buf[i] = buf[i] * w + head[i] * (1 - w)
        buf[N - fc + i] = buf[N - fc + i] * (1 - w) + head[i] * w

def synth_motif_fire(path, bars=2, bpm=120, fade=0.05):
    """火：明亮上行五声 sparkle（方波 + 高频泛音 + 快速颤音）+ 低频脉冲，跃动炽烈。"""
    beat = 60.0 / bpm; total = bars * beat * 4; N = int(total * SR); buf = [0.0] * N
    rng = random.Random(20260930)
    notes = [72, 75, 79, 82, 86]
    def add(st, dur, m, amp, wave, a=0.003, d=0.03, s=0.5, r=0.06):
        i0 = int(st * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR; buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, midi_freq(m), wave)
    seq = [0, 2, 1, 3, 4, 2]
    for e in range(8):
        m = notes[seq[e % len(seq)]]
        add(e * (beat / 2), beat * 0.45, m, 0.18, 'square', a=0.003, d=0.03, s=0.5, r=0.06)
        add(e * (beat / 2), beat * 0.30, m + 12, 0.06, 'sine', a=0.002, d=0.02, s=0.3, r=0.05)
    for e in range(4):
        add(e * beat, beat * 0.5, 45, 0.14, 'triangle', a=0.01, d=0.10, s=0.6, r=0.10)
    _loop_crossfade(buf, fade); write_wav(path, buf); return total

def synth_motif_water(path, bars=2, bpm=100, fade=0.05):
    """水：柔 sine 涟漪滑音（下行回弹）+ 气泡点缀，流动清润。"""
    beat = 60.0 / bpm; total = bars * beat * 4; N = int(total * SR); buf = [0.0] * N
    rng = random.Random(20260931)
    def sweep(st, dur, m0, m1, amp, wave='sine', a=0.004, d=0.08, s=0.5, r=0.10):
        i0 = int(st * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR; p = i / cnt; buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, midi_freq(m0 + (m1 - m0) * p), wave)
    ripples = [(0, 79, 67), (beat, 74, 62), (2 * beat, 81, 69), (3 * beat, 76, 64)]
    for st, m0, m1 in ripples:
        sweep(st, beat * 0.9, m0, m1, 0.22, 'sine', a=0.01, d=0.12, s=0.6, r=0.18)
    r = _noise_rng(); nb = int(0.5 * SR)
    for i in range(nb):  # 气泡点缀
        if i < N and rng.random() < 0.04:
            p = i / nb; buf[i] += (r.random() * 2 - 1) * 0.10 * (1 - p) * (0.6 + 0.4 * math.sin(2 * math.pi * 40 * p))
    _loop_crossfade(buf, fade); write_wav(path, buf); return total

def synth_motif_earth(path, bars=2, bpm=84, fade=0.05):
    """土：厚重低频脉冲（三角根音 + 正弦 sub）+ 闷响，稳固大地感。"""
    beat = 60.0 / bpm; total = bars * beat * 4; N = int(total * SR); buf = [0.0] * N
    rng = random.Random(20260932)
    def add(st, dur, m, amp, wave, a=0.01, d=0.10, s=0.7, r=0.12):
        i0 = int(st * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR; buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, midi_freq(m), wave)
    for e in range(4):  # 二分音符重拍根音
        add(e * beat, beat * 1.7, 40, 0.26, 'triangle', a=0.01, d=0.12, s=0.7, r=0.14)
        add(e * beat, beat * 1.7, 28, 0.18, 'sine', a=0.02, d=0.15, s=0.7, r=0.14)  # sub
    for e in range(8):  # 八分颗粒
        add(e * (beat / 2), beat * 0.4, 47, 0.10, 'square', a=0.004, d=0.03, s=0.4, r=0.05)
    _loop_crossfade(buf, fade); write_wav(path, buf); return total

def synth_motif_light(path, bars=2, bpm=110, fade=0.05):
    """光：闪亮铃音琶音（高正弦 + 七度泛音）+ 长 shimmer，圣辉清越。"""
    beat = 60.0 / bpm; total = bars * beat * 4; N = int(total * SR); buf = [0.0] * N
    rng = random.Random(20260933)
    notes = [84, 88, 91, 96]
    def add(st, dur, m, amp, wave, a=0.004, d=0.10, s=0.5, r=0.20):
        i0 = int(st * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR; buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, midi_freq(m), wave)
    seq = [0, 2, 1, 3, 2, 1]
    for e in range(8):
        m = notes[seq[e % len(seq)]]
        add(e * (beat / 2), beat * 0.5, m, 0.18, 'sine', a=0.003, d=0.08, s=0.5, r=0.18)
        add(e * (beat / 2), beat * 0.4, m + 7, 0.06, 'sine', a=0.002, d=0.05, s=0.3, r=0.14)  # 泛音
    add(0, total, 100, 0.04, 'sine', a=0.05, d=0.2, s=0.4, r=0.3)  # shimmer 长音
    _loop_crossfade(buf, fade); write_wav(path, buf); return total

def synth_motif_wood(path, bars=2, bpm=104, fade=0.05):
    """木：有机叩击（木鱼式 knock + 干裂噪声 rustle）的切分律动，自然生机。"""
    beat = 60.0 / bpm; total = bars * beat * 4; N = int(total * SR); buf = [0.0] * N
    rng = random.Random(20260934)
    def add(st, dur, m, amp, wave, a=0.001, d=0.03, s=0.3, r=0.04):
        i0 = int(st * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR; buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, midi_freq(m), wave)
    knock = [(0, 64), (beat * 0.5, 67), (beat, 60), (2 * beat, 64), (2 * beat * 0.5, 67), (3 * beat, 60), (3 * beat * 0.5, 62)]
    for st, m in knock:
        add(st, 0.06, m, 0.28, 'square', a=0.001, d=0.02, s=0.2, r=0.03)
        add(st, 0.10, m - 5, 0.16, 'triangle', a=0.001, d=0.04, s=0.3, r=0.04)
    r = _noise_rng(); nb = int(total * SR)
    for i in range(nb):  # 干裂 rustle（稀疏）
        if i < N and rng.random() < 0.015:
            p = i / nb; buf[i] += (r.random() * 2 - 1) * 0.10 * (1 - p) ** 1.5
    _loop_crossfade(buf, fade); write_wav(path, buf); return total

# ---------------- 大厅 / 养成主题 BGM（Round-30 · 局外大厅的专属听觉氛围） ----------------
# 与森林主题同族（C 系五声 + 柔 pad），但更慢更安宁：84 BPM、无底鼓、lead 稀疏长音、
# 进行 I–V–vi–IV（C–G–Am–F，终止感=「回家」），定位局外大厅/养成/成就页氛围。
def synth_bgm_lobby(path, bars=12, bpm=84, fade=0.10):
    beat = 60.0 / bpm
    bar_dur = beat * 4
    total = bars * bar_dur
    N = int(total * SR)
    buf = [0.0] * N
    rng = random.Random(20260923)
    # I–V–vi–IV（C G Am F），每 4 小节一轮；第二轮 lead 上移八度点缀
    prog = [(60, [60, 64, 67]), (55, [55, 59, 62]), (57, [57, 60, 64]), (53, [53, 57, 60])]
    penta = [72, 74, 76, 79, 81, 84, 86]

    def add(start, dur, freq, amp, wave, a=0.01, d=0.05, s=0.7, r=0.08):
        i0 = int(start * SR)
        cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)

    deg = 2
    for bar in range(bars):
        root_midi, chord = prog[(bar // 4) % 4]
        s0 = bar * bar_dur
        round_up = 1 if bar >= 8 else 0  # 第三轮 lead 高八度，避免 3 轮同型
        # pad：整小节和弦 + 低八度根音垫底（长 attack 柔入，暖）
        for c in chord:
            add(s0, bar_dur * 0.99, midi_freq(c), 0.09, 'sine', a=0.40, d=0.10, s=0.85, r=0.50)
        add(s0, bar_dur * 0.99, midi_freq(chord[0] - 12), 0.06, 'triangle', a=0.35, d=0.10, s=0.80, r=0.50)
        # 贝斯：每小节 1 拍长根音（安宁，无切分）
        add(s0, beat * 3.2, midi_freq(root_midi - 24), 0.17, 'sine', a=0.02, d=0.10, s=0.75, r=0.30)
        # 铃：每 2 小节小节头轻 ping
        if bar % 2 == 0:
            add(s0, 0.8, midi_freq(chord[2] + 12), 0.045, 'sine', a=0.004, d=0.25, s=0.0, r=0.45)
        # lead：二分音符为主、稀疏游走（慢而疏=大厅的松弛）
        for e in range(2):
            if rng.random() < 0.45:  # 留白
                continue
            t = s0 + e * (beat * 2)
            deg = max(0, min(len(penta) - 1, deg + rng.choice([0, 1, -1, 2, -2])))
            add(t, beat * 1.7, midi_freq(penta[deg] + 12 * round_up), 0.13, 'triangle',
                a=0.05, d=0.08, s=0.65, r=0.40)

    _loop_crossfade(buf, fade)
    write_wav(path, buf)
    return total


# ---------------- 成就达成 jingle（Round-30 · 隆重仪式感，比 win 更有「荣誉」重量） ----------------
def synth_achievement(path):
    """成就达成：D 大调五音琶音 + 双八度衬底 + 长尾大和弦与 shimmer。隆重但不拖沓。"""
    notes = [74, 78, 81, 86, 90]
    step = 0.11; tail = 0.70; total = len(notes) * step + tail
    N = int(total * SR); buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.004, d=0.05, s=0.6, r=0.20):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    for k, m in enumerate(notes):
        add(k * step, 0.20, midi_freq(m), 0.22, 'triangle', a=0.003, d=0.04, s=0.6, r=0.14)  # 木琴主体
        add(k * step, 0.14, midi_freq(m + 12), 0.06, 'sine', a=0.002, d=0.03, s=0.3, r=0.10)  # 高频 sparkle
        add(k * step, 0.26, midi_freq(m - 12), 0.07, 'sine', a=0.004, d=0.05, s=0.5, r=0.16)  # 低八度衬底（隆重）
    for c in [74, 78, 81, 86]:  # 尾音 D 大调大和弦
        add(len(notes) * step, tail, midi_freq(c), 0.11, 'sine', a=0.03, d=0.15, s=0.8, r=0.45)
    add(len(notes) * step + 0.05, tail - 0.10, midi_freq(98), 0.05, 'sine', a=0.10, d=0.30, s=0.4, r=0.50)  # shimmer 高铃
    write_wav(path, buf); return total


# ---------------- 每日任务完成 jingle（Round-30 · 轻巧木琴双音，与成就 jingle 区分大小奖励） ----------------
def synth_daily(path):
    """每日任务：暖木琴双音上行（E5→A5 纯四度），轻快不打扰。"""
    notes = [76, 81]
    step = 0.14; tail = 0.18; total = len(notes) * step + tail
    N = int(total * SR); buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.003, d=0.04, s=0.55, r=0.14):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    for k, m in enumerate(notes):
        add(k * step, 0.16, midi_freq(m), 0.24, 'triangle', a=0.002, d=0.035, s=0.55, r=0.10)
        add(k * step, 0.10, midi_freq(m + 7), 0.06, 'sine', a=0.002, d=0.03, s=0.3, r=0.08)  # 纯五度泛音=木琴暖感
    add(len(notes) * step - 0.02, tail, midi_freq(88), 0.08, 'sine', a=0.02, d=0.08, s=0.4, r=0.16)
    write_wav(path, buf); return total


# ---------------- 首通 fanfare（Round-30 · 比 win 更庄重的号角三连，只在该关第一次通关时响起） ----------------
def synth_first_clear(path):
    """首通结算：C4→G4→C5 号角三连（saw+square 双层=铜管质感）+ 尾音大和弦与高铃。庄重而明亮。"""
    notes = [60, 67, 72]
    step = 0.16; tail = 0.90; total = len(notes) * step + tail
    N = int(total * SR); buf = [0.0] * N
    def add(start, dur, freq, amp, wave, a=0.004, d=0.05, s=0.65, r=0.20):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    for k, m in enumerate(notes):
        add(k * step, 0.24, midi_freq(m), 0.17, 'sawtooth', a=0.006, d=0.05, s=0.6, r=0.12)   # 号角主体
        add(k * step, 0.20, midi_freq(m), 0.10, 'square', a=0.005, d=0.04, s=0.5, r=0.10)     # 方波增亮
        add(k * step, 0.16, midi_freq(m - 12), 0.07, 'sine', a=0.004, d=0.04, s=0.4, r=0.10)  # 低八度衬底
    for c in [60, 64, 67, 72]:  # 尾音 C 大调大和弦
        add(len(notes) * step, tail, midi_freq(c), 0.10, 'sine', a=0.03, d=0.18, s=0.8, r=0.50)
    add(len(notes) * step + 0.06, tail - 0.12, midi_freq(96), 0.045, 'sine', a=0.10, d=0.35, s=0.3, r=0.55)  # shimmer
    write_wav(path, buf); return total


# ---------------- 大额金币入账（Round-30 · 首通/结算大额奖励的「哗啦」迸发，区别于单枚 coin 双音） ----------------
def synth_coin_big(path):
    """大额金币：固定种子的 9 枚金属 ping 密集迸发（B5–E7 随机音高）+ 低频哗啦衬底。丰收感。"""
    total = 1.10
    N = int(total * SR); buf = [0.0] * N
    rng = random.Random(20260930)
    def add(start, dur, freq, amp, wave, a=0.001, d=0.02, s=0.3, r=0.06):
        i0 = int(start * SR); cnt = int(dur * SR)
        for i in range(cnt):
            idx = i0 + i
            if idx >= N: break
            t = i / SR
            buf[idx] += amp * env_adsr(t, dur, a, d, s, r) * tone(t, freq, wave)
    for k in range(9):  # 9 枚金币：前 0.45s 密集、后半稀疏收尾
        start = 0.02 + k * (0.05 if k < 6 else 0.13) + rng.uniform(0, 0.02)
        m = rng.randint(83, 100)  # B5–E7
        amp = 0.20 if k < 6 else 0.12
        add(start, 0.09, midi_freq(m), amp, 'sine', a=0.001, d=0.015, s=0.15, r=0.05)
        add(start, 0.05, midi_freq(m + 12), amp * 0.35, 'sine', a=0.001, d=0.01, s=0.1, r=0.03)  # 泛音亮片
    add(0.0, 0.30, midi_freq(48), 0.10, 'square', a=0.004, d=0.05, s=0.2, r=0.10)   # 低频哗啦衬底
    add(0.42, 0.22, midi_freq(55), 0.06, 'square', a=0.004, d=0.04, s=0.15, r=0.08)
    add(0.95, 0.13, midi_freq(100), 0.10, 'sine', a=0.002, d=0.03, s=0.2, r=0.06)   # 末枚定音高铃
    write_wav(path, buf); return total


# ---------------- 环境氛围音层（Round-33 · 与 BGM 双通道叠加的 Ambience，无缝循环） ----------------
AMB_SR = SR
AMB_DUR = 24.0


def _amb_base(dur=AMB_DUR, seed=1, wind_gain=0.05, wind_tone=0.015, lfo=0.05):
    """风底：双级低通白噪声 + 慢 LFO 起伏（无缝循环：LFO 取整数周期）"""
    N = int(dur * SR)
    buf = [0.0] * N
    rng = random.Random(seed)
    y1 = y2 = 0.0
    cycles = max(1, round(lfo * dur))          # LFO 整周期 → 循环无缝
    for i in range(N):
        t = i / SR
        x = rng.uniform(-1, 1)
        y1 += wind_tone * (x - y1)
        y2 += wind_tone * 0.6 * (y1 - y2)
        lfo_v = 0.65 + 0.35 * math.sin(2 * math.pi * lfo * t * (dur * lfo / cycles) / (dur * lfo / cycles) * cycles / (lfo * dur) * lfo) if lfo else 1.0
        buf[i] = y2 * wind_gain * (0.7 + 0.3 * math.sin(2 * math.pi * cycles * t / dur))
    return buf, N


def _chirp(buf, start, dur, f0, f1, amp, seed=None):
    """鸟鸣/气泡：频率线性扫描 + hann 窗"""
    i0 = int(start * SR); cnt = int(dur * SR)
    for i in range(cnt):
        idx = i0 + i
        if idx >= len(buf): break
        t = i / cnt
        f = f0 + (f1 - f0) * t
        w = math.sin(math.pi * t) ** 2
        buf[idx] += amp * w * math.sin(2 * math.pi * f * i / SR)


def _decay_ping(buf, start, dur, f0, f1, amp, k=6.0):
    """水滴：频率下滑 + 指数衰减"""
    i0 = int(start * SR); cnt = int(dur * SR)
    for i in range(cnt):
        idx = i0 + i
        if idx >= len(buf): break
        t = i / SR
        f = f0 + (f1 - f0) * (i / cnt)
        buf[idx] += amp * math.exp(-k * i / cnt) * math.sin(2 * math.pi * f * t)


def _loop_amb(buf, fade=0.5):
    """环境音无缝循环交叉淡化"""
    _loop_crossfade(buf, fade)


def synth_amb_forest(path):
    """森林·日间：柔风底 + 随机鸟鸣（上扫/下扫 2–5kHz）+ 叶沙簇。明亮生机。"""
    buf, N = _amb_base(seed=3301, wind_gain=0.055, wind_tone=0.012, lfo=0.05)
    rng = random.Random(3302)
    t = 0.6
    while t < AMB_DUR - 1.2:                                   # 鸟鸣：1.1–2.8s 随机间隔
        f0 = rng.uniform(2000, 3200); f1 = f0 + rng.uniform(400, 1800) * rng.choice([1, -1])
        _chirp(buf, t, rng.uniform(0.06, 0.14), f0, f1, rng.uniform(0.05, 0.10))
        if rng.random() < 0.35:                                # 双音鸟
            _chirp(buf, t + 0.16, 0.09, f1, f0, 0.06)
        t += rng.uniform(1.1, 2.8)
    t = 0.3
    while t < AMB_DUR - 0.6:                                   # 叶沙：短高频噪声簇
        i0 = int(t * SR); cnt = int(0.09 * SR)
        rr = random.Random(int(t * 1000))
        a = rng.uniform(0.012, 0.022)
        for i in range(cnt):
            idx = i0 + i
            if idx < N:
                buf[idx] += a * rr.uniform(-1, 1) * math.sin(math.pi * i / cnt)
        t += rng.uniform(1.6, 3.4)
    _loop_amb(buf)
    write_wav(path, buf); return AMB_DUR


def synth_amb_night(path):
    """森林·夜间：低沉风 + 虫鸣脉冲串（4.5kHz 调幅）+ 偶发低鸣。神秘警觉。"""
    buf, N = _amb_base(seed=3303, wind_gain=0.045, wind_tone=0.008, lfo=0.04)
    rng = random.Random(3304)
    t = 0.8
    while t < AMB_DUR - 1.0:                                   # 虫鸣：0.25s 调幅脉冲串
        i0 = int(t * SR); cnt = int(0.25 * SR)
        f = rng.uniform(4200, 4800)
        a = rng.uniform(0.020, 0.034)
        for i in range(cnt):
            idx = i0 + i
            if idx < N:
                gate = 1.0 if (i / SR * 38) % 1 < 0.5 else 0.0   # 38Hz 通断调幅
                buf[idx] += a * gate * math.sin(2 * math.pi * f * i / SR) * math.sin(math.pi * i / cnt)
        t += rng.uniform(1.3, 2.6)
    _chirp(buf, AMB_DUR * 0.42, 0.5, 520, 380, 0.045)          # 偶发低鸣（夜鸟）
    _loop_amb(buf)
    write_wav(path, buf); return AMB_DUR


def synth_amb_river(path):
    """蛙鸣浅滩溪流：宽带水声（高通白噪+低通层）+ 随机气泡上滑 chirp。清凉流动。"""
    buf, N = _amb_base(seed=3305, wind_gain=0.075, wind_tone=0.22, lfo=0.07)   # 高 wind_tone=更「嘶」的水声
    rng = random.Random(3306)
    t = 0.4
    while t < AMB_DUR - 0.8:                                   # 气泡：短促上滑
        _chirp(buf, t, rng.uniform(0.04, 0.09), rng.uniform(500, 900), rng.uniform(1400, 2600), rng.uniform(0.02, 0.045))
        t += rng.uniform(0.5, 1.6)
    _chirp(buf, AMB_DUR * 0.5, 0.18, 700, 500, 0.03)           # 一声闷蛙
    _chirp(buf, AMB_DUR * 0.5 + 0.3, 0.15, 680, 480, 0.024)
    _loop_amb(buf)
    write_wav(path, buf); return AMB_DUR


def synth_amb_cave(path):
    """古木洞窟：极低 drone（55Hz 正弦 + 次声起伏）+ 稀疏水滴 ping。幽深压迫。"""
    buf, N = _amb_base(seed=3307, wind_gain=0.020, wind_tone=0.005, lfo=0.03)
    rng = random.Random(3308)
    for i in range(N):                                         # 55Hz drone + 慢起伏
        t = i / SR
        buf[i] += 0.030 * math.sin(2 * math.pi * 55 * t) * (0.8 + 0.2 * math.sin(2 * math.pi * 0.05 * t))
        buf[i] += 0.014 * math.sin(2 * math.pi * 82.5 * t)
    t = 1.0
    while t < AMB_DUR - 1.5:                                   # 水滴：下滑 ping + 简易回响
        f0 = rng.uniform(900, 1500)
        _decay_ping(buf, t, 0.16, f0, f0 * 0.5, rng.uniform(0.05, 0.09))
        _decay_ping(buf, t + 0.19, 0.12, f0, f0 * 0.5, rng.uniform(0.015, 0.03), k=8.0)  # 回声
        t += rng.uniform(2.2, 4.5)
    _loop_amb(buf, fade=0.8)
    write_wav(path, buf); return AMB_DUR


if __name__ == '__main__':
    out_dir = 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou/_content_pack/audio'
    import os
    os.makedirs(out_dir, exist_ok=True)
    jobs = [
        ('cp_bgm_forest.wav', synth_bgm),
        ('cp_bgm_battle.wav', synth_bgm_battle),
        ('cp_bgm_boss.wav', synth_bgm_boss),
        ('cp_bgm_tide.wav', synth_bgm_tide),
        ('cp_bgm_elite.wav', synth_bgm_elite),
        ('cp_bgm_boss2.wav', synth_bgm_boss2),
        ('cp_sfx_summon.wav', synth_summon),
        ('cp_sfx_heal.wav', synth_heal),
        ('cp_sfx_hit.wav', synth_hit),
        ('cp_sfx_kill.wav', synth_kill),
        ('cp_sfx_levelup.wav', synth_levelup),
        ('cp_sfx_pickup.wav', synth_pickup),
        ('cp_sfx_hurt.wav', synth_hurt),
        ('cp_sfx_evolve.wav', synth_evolve),
        ('cp_sfx_win.wav', synth_win),
        ('cp_sfx_lose.wav', synth_lose),
        ('cp_sfx_ui.wav', synth_ui),
        ('cp_sfx_explosion.wav', synth_explosion),
        ('cp_sfx_dash.wav', synth_dash),
        ('cp_sfx_portal.wav', synth_portal),
        ('cp_sfx_coin.wav', synth_coin),
        ('cp_sfx_warning.wav', synth_warning),
        ('cp_sfx_freeze.wav', synth_freeze),
        ('cp_sfx_buff.wav', synth_buff),
        ('cp_sfx_debuff.wav', synth_debuff),
        ('cp_sfx_hit_fire.wav', synth_hit_fire),
        ('cp_sfx_hit_water.wav', synth_hit_water),
        ('cp_sfx_hit_earth.wav', synth_hit_earth),
        ('cp_sfx_hit_light.wav', synth_hit_light),
        ('cp_sfx_hit_wood.wav', synth_hit_wood),
        ('cp_sfx_elem_fire.wav', synth_motif_fire),
        ('cp_sfx_elem_water.wav', synth_motif_water),
        ('cp_sfx_elem_earth.wav', synth_motif_earth),
        ('cp_sfx_elem_light.wav', synth_motif_light),
        ('cp_sfx_elem_wood.wav', synth_motif_wood),
        ('cp_bgm_lobby.wav', synth_bgm_lobby),
        ('cp_sfx_achievement.wav', synth_achievement),
        ('cp_sfx_daily.wav', synth_daily),
        ('cp_sfx_first_clear.wav', synth_first_clear),
        ('cp_sfx_coin_big.wav', synth_coin_big),
        ('cp_amb_forest.wav', synth_amb_forest),
        ('cp_amb_night.wav', synth_amb_night),
        ('cp_amb_river.wav', synth_amb_river),
        ('cp_amb_cave.wav', synth_amb_cave),
    ]
    for name, fn in jobs:
        d = fn(f'{out_dir}/{name}')
        print('WAV OK: %-22s %.2fs' % (name, d))
