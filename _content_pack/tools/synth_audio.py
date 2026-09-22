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

if __name__ == '__main__':
    out_dir = 'D:/新建文件夹/方向3/.workbuddy/v1.162/mengshou/_content_pack/audio'
    import os
    os.makedirs(out_dir, exist_ok=True)
    d1 = synth_bgm(f'{out_dir}/cp_bgm_forest.wav')
    d2 = synth_summon(f'{out_dir}/cp_sfx_summon.wav')
    d3 = synth_heal(f'{out_dir}/cp_sfx_heal.wav')
    for p, d in [('cp_bgm_forest.wav', d1), ('cp_sfx_summon.wav', d2), ('cp_sfx_heal.wav', d3)]:
        print('WAV OK: %s  %.2fs' % (p, d))
