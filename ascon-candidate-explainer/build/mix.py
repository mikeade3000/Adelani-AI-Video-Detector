"""Build the soundtrack: narration + synthesized music bed (ducked under the voice) + sound effects.

Usage: python3 build/mix.py            (after tts.py and render.cjs have run)
Reads build/out/seg/*.wav, build/out/cues.json, timing.js. Writes build/out/mix.wav.
"""
import json
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "build" / "out"
SR = 44100
rng = np.random.default_rng(42)


def load_timing():
    txt = (ROOT / "timing.js").read_text()
    return json.loads(txt.split("=", 1)[1].strip().rstrip(";"))


def read_wav(path):
    with wave.open(str(path), "rb") as w:
        sr, n = w.getframerate(), w.getnframes()
        x = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float64) / 32768.0
    if sr != SR:
        t_old = np.arange(len(x)) / sr
        t_new = np.arange(int(len(x) * SR / sr)) / SR
        x = np.interp(t_new, t_old, x)
    return x


def t(d):
    return np.arange(int(d * SR)) / SR


def env(n, a, r):
    e = np.ones(n)
    na, nr = min(n, int(a * SR)), min(n, int(r * SR))
    if na:
        e[:na] = np.linspace(0, 1, na)
    if nr:
        e[-nr:] *= np.linspace(1, 0, nr)
    return e


def place(buf, x, at, gain=1.0):
    i = int(at * SR)
    if i >= len(buf) or i + len(x) <= 0:
        return
    j = min(len(buf), i + len(x))
    buf[max(i, 0):j] += gain * x[max(0, -i):j - i]


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


# ---------------- sound effects ----------------
def sfx_click():
    x = t(0.05)
    return (np.sin(2 * np.pi * 2400 * x) * np.exp(-x * 140) + 0.4 * rng.standard_normal(len(x)) * np.exp(-x * 400)) * 0.5


def sfx_key():
    x = t(0.035)
    f = 1800 + rng.uniform(-300, 300)
    return (0.6 * rng.standard_normal(len(x)) * np.exp(-x * 260) + 0.4 * np.sin(2 * np.pi * f * x) * np.exp(-x * 180)) * 0.22


def sfx_pop():
    x = t(0.12)
    f = 500 + 900 * x / 0.12
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * 30) * 0.5


def sfx_ding():
    out = np.zeros(int(0.9 * SR))
    for k, (m, d) in enumerate([(88, 0.0), (95, 0.09)]):
        x = t(0.8)
        tone = (np.sin(2 * np.pi * hz(m) * x) + 0.3 * np.sin(4 * np.pi * hz(m) * x)) * np.exp(-x * 6)
        place(out, tone, d, 0.28)
    return out


def sfx_chime():
    out = np.zeros(int(1.4 * SR))
    for k, m in enumerate([74, 78, 81, 86]):
        x = t(1.0)
        place(out, np.sin(2 * np.pi * hz(m) * x) * np.exp(-x * 4.5), k * 0.08, 0.2)
    return out


def sfx_whoosh():
    x = t(0.6)
    n = rng.standard_normal(len(x))
    # crude band sweep: mix of smoothed noise with rising cutoff
    out = np.zeros_like(n)
    a = 0.0
    for i in range(len(n)):
        c = 0.02 + 0.25 * (i / len(n))
        a += c * (n[i] - a)
        out[i] = a
    e = np.sin(np.pi * x / 0.6) ** 2
    return out * e * 0.9


def sfx_alert():
    out = np.zeros(int(0.5 * SR))
    for k, f in enumerate([880, 660]):
        x = t(0.18)
        tone = np.sign(np.sin(2 * np.pi * f * x)) * 0.25 + np.sin(2 * np.pi * f * x) * 0.5
        place(out, tone * env(len(x), 0.005, 0.05), k * 0.2, 0.32)
    return out


def sfx_buzz():
    x = t(0.32)
    tone = np.sign(np.sin(2 * np.pi * 140 * x)) * 0.5 + np.sin(2 * np.pi * 280 * x) * 0.3
    return tone * env(len(x), 0.005, 0.08) * (0.8 + 0.2 * np.sin(2 * np.pi * 30 * x)) * 0.22


def sfx_stamp():
    x = t(0.35)
    thump = np.sin(2 * np.pi * np.cumsum(140 - 90 * x / 0.35) / SR) * np.exp(-x * 14)
    noise = rng.standard_normal(len(x)) * np.exp(-x * 60) * 0.5
    return (thump + noise) * 0.6


def sfx_tick():
    x = t(0.06)
    return np.sin(2 * np.pi * 1300 * x) * np.exp(-x * 90) * 0.45


def sfx_correct():
    out = np.zeros(int(1.0 * SR))
    for k, m in enumerate([79, 84, 88]):
        x = t(0.7)
        place(out, (np.sin(2 * np.pi * hz(m) * x) + 0.2 * np.sin(4 * np.pi * hz(m) * x)) * np.exp(-x * 5), k * 0.07, 0.25)
    return out


def sfx_wrong():
    out = np.zeros(int(0.7 * SR))
    for k, f in enumerate([220, 165]):
        x = t(0.25)
        tone = np.sign(np.sin(2 * np.pi * f * x)) * 0.4 + np.sin(2 * np.pi * f * x) * 0.4
        place(out, tone * env(len(x), 0.005, 0.06), k * 0.22, 0.28)
    return out


def sfx_shutter():
    x = t(0.14)
    n = rng.standard_normal(len(x))
    e = np.exp(-x * 70) + 0.6 * np.exp(-np.maximum(0, x - 0.06) * 90) * (x > 0.06)
    return n * e * 0.35


SFX = {"click": sfx_click, "key": sfx_key, "pop": sfx_pop, "ding": sfx_ding, "chime": sfx_chime, "whoosh": sfx_whoosh,
       "alert": sfx_alert, "buzz": sfx_buzz, "stamp": sfx_stamp, "tick": sfx_tick, "correct": sfx_correct,
       "wrong": sfx_wrong, "shutter": sfx_shutter}
SFX_GAIN = {"key": 0.8, "whoosh": 0.35, "pop": 0.55, "click": 0.7}


# ---------------- music bed ----------------
BPM = 100
BEAT = 60 / BPM
PROG = {  # chord roots/qualities as MIDI note lists
    "bright": [[62, 66, 69], [57, 61, 64], [59, 62, 66], [55, 59, 62]],  # D A Bm G
    "tense": [[59, 62, 66], [55, 59, 62], [52, 55, 59], [54, 58, 61]],   # Bm G Em F#
}


def music(total, timing):
    out = np.zeros(int((total + 4) * SR))
    mood_at = []
    for sc in timing["scenes"]:
        mood_at.append((sc["start"], "tense" if sc["id"] == "rules" else "bright"))

    def mood(tt):
        m = "bright"
        for s, v in mood_at:
            if tt >= s:
                m = v
        return m

    bar = 4 * BEAT
    nbars = int(total / bar) + 2
    for b in range(nbars):
        t0 = b * bar
        m = mood(t0 + 0.01)
        chord = PROG[m][b % 4]
        # pad
        x = t(bar + 0.6)
        pad = np.zeros(len(x))
        for note in chord:
            f = hz(note - 12)
            for det in (-0.12, 0.12):
                pad += np.sin(2 * np.pi * (f + det) * x) + 0.25 * np.sin(2 * np.pi * 2 * (f + det) * x)
        place(out, pad * env(len(x), 0.5, 0.7) * 0.035, t0)
        # bass
        root = chord[0] - 24
        hits = [0, 2] if m == "bright" else [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]
        for h in hits:
            x = t(BEAT * (1.6 if m == "bright" else 0.45))
            bass = (np.sin(2 * np.pi * hz(root) * x) + 0.3 * np.sin(4 * np.pi * hz(root) * x)) * env(len(x), 0.01, 0.15)
            place(out, bass * 0.11, t0 + h * BEAT)
        # kick + hats
        for h in range(4):
            if h in (0, 2):
                x = t(0.25)
                kick = np.sin(2 * np.pi * np.cumsum(45 + 90 * np.exp(-x * 30)) / SR) * np.exp(-x * 12)
                place(out, kick * 0.16, t0 + h * BEAT)
            x = t(0.04)
            hat = np.diff(rng.standard_normal(len(x) + 1)) * np.exp(-x * 120)
            place(out, hat * (0.02 if m == "bright" else 0.035), t0 + h * BEAT + BEAT / 2)
        # pluck arpeggio (bright only)
        if m == "bright":
            seq = [chord[0], chord[1], chord[2], chord[1] + 12, chord[2], chord[1], chord[0] + 12, chord[2]]
            for k, note in enumerate(seq):
                x = t(0.45)
                f = hz(note + 12)
                pl = (np.sin(2 * np.pi * f * x) + 0.4 * np.sin(4 * np.pi * f * x) * np.exp(-x * 10)) * np.exp(-x * 9)
                place(out, pl * 0.035, t0 + k * BEAT / 2)
    # final ring-out chord
    x = t(3.5)
    fin = sum(np.sin(2 * np.pi * hz(n - 12) * x) for n in [62, 66, 69, 74]) * np.exp(-x * 1.1)
    place(out, fin * 0.05, total - 2.4)
    fade = int(2.0 * SR)
    end = int(total * SR)
    out[end - fade:end] *= np.linspace(1, 0.0, fade)
    out[end:] = 0
    return out[:end]


def main():
    timing = load_timing()
    total = timing["total"]
    n = int(total * SR)
    voice = np.zeros(n)
    for sid, seg in timing["segs"].items():
        place(voice, read_wav(OUT / "seg" / f"{sid}.wav"), seg["start"])
    voice *= 0.89 / max(1e-9, np.abs(voice).max())

    # duck envelope from narration activity
    act = np.zeros(n)
    for seg in timing["segs"].values():
        act[int(seg["start"] * SR):int(seg["end"] * SR)] = 1
    k = int(0.25 * SR)
    cs = np.concatenate([[0], np.cumsum(act)])  # moving average, O(n)
    idx = np.arange(n)
    act = (cs[np.clip(idx + k // 2, 0, n)] - cs[np.clip(idx - k // 2, 0, n)]) / k
    duck = 1.0 - 0.55 * np.clip(act, 0, 1)

    mus = music(total, timing)[:n] * duck * 0.75
    fx = np.zeros(n)
    cues = json.loads((OUT / "cues.json").read_text())["cues"]
    cache = {}
    for c in cues:
        typ = c["type"]
        if typ == "key":
            snd = sfx_key()
        else:
            if typ not in cache:
                cache[typ] = SFX[typ]()
            snd = cache[typ]
        place(fx, snd, c["t"], SFX_GAIN.get(typ, 1.0) * 0.7)

    mix = voice + mus + fx
    mix *= 0.95 / max(1e-9, np.abs(mix).max())
    stereo = np.repeat((mix * 32767).astype(np.int16)[:, None], 2, axis=1)
    with wave.open(str(OUT / "mix.wav"), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(stereo.tobytes())
    print(f"mix.wav {total:.1f}s, {len(cues)} cues")


if __name__ == "__main__":
    main()
