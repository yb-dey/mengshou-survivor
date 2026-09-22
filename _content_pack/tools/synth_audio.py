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

if __name__ == '__main__':
    out_dir = 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou/_content_pack/audio'
    import os
    os.makedirs(out_dir, exist_ok=True)
    jobs = [
        ('cp_bgm_forest.wav', synth_bgm),
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
    ]
    for name, fn in jobs:
        d = fn(f'{out_dir}/{name}')
        print('WAV OK: %-22s %.2fs' % (name, d))
