"""Mix narration + a synthesized music bed (ducked under the voice) + UI sound effects.
usage: python3 mix.py <render dir>   (expects narration.wav, timing.json, sfx.json; writes mix.wav)"""
import json, sys, subprocess, numpy as np, soundfile as sf
D = sys.argv[1]; SR = 48000
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", f"{D}/narration.wav", "-ar", str(SR), "-ac", "1", f"{D}/narr48.wav"], check=True)
voice, _ = sf.read(f"{D}/narr48.wav", dtype="float32")
T = json.load(open(f"{D}/timing.json")); dur = T["duration"]
N = int(dur * SR) + SR; voice = np.pad(voice, (0, max(0, N - len(voice))))[:N]
t = np.arange(N) / SR
rng = np.random.default_rng(4)

from scipy.signal import lfilter
def lp(x, fc):  # one-pole low-pass
    a = np.exp(-2 * np.pi * fc / SR)
    return lfilter([1 - a], [1, -a], x).astype(np.float32)

hz = lambda m: 440 * 2 ** ((m - 69) / 12)
# ---- music: D – A – Bm – G, 96 bpm, one chord per bar ----
bpm = 96; beat = 60 / bpm; bar = 4 * beat
chords = [[50, 57, 62, 66, 69], [45, 57, 61, 64, 69], [47, 54, 59, 62, 66], [43, 55, 59, 62, 67]]
music = np.zeros(N, np.float32)
nbars = int(dur / bar) + 1
for b in range(nbars):
    ch = chords[b % 4]; s0 = int(b * bar * SR); L = int(bar * SR * 1.25)
    tt = np.arange(L) / SR; env = np.minimum(1, tt / .6) * np.exp(-np.maximum(0, tt - bar) / .25)
    pad = sum(np.sin(2 * np.pi * hz(m) * tt * (1 + d)) * (0.5 if m < 52 else .28) for m in ch for d in (-.003, .003))
    pad += .12 * sum(np.sin(2 * np.pi * 2 * hz(m) * tt) for m in ch[2:])
    seg = (pad * env * .05).astype(np.float32); e = min(N, s0 + L); music[s0:e] += seg[:e - s0]
    # pluck arpeggio, eighth notes
    arp = [ch[2] + 12, ch[3] + 12, ch[4] + 12, ch[3] + 12]
    for k in range(8):
        s = s0 + int(k * beat / 2 * SR); Lp = int(.5 * SR); tp = np.arange(Lp) / SR
        f = hz(arp[k % 4]); pl = (np.sin(2 * np.pi * f * tp) + .3 * np.sin(4 * np.pi * f * tp)) * np.exp(-tp * 7) * .045
        e = min(N, s + Lp)
        if s < N: music[s:e] += pl[:e - s].astype(np.float32)
    # soft kick on beats 1 and 3
    for k in (0, 2):
        s = s0 + int(k * beat * SR); Lk = int(.25 * SR); tk = np.arange(Lk) / SR
        kick = np.sin(2 * np.pi * (50 + 90 * np.exp(-tk * 30)) * tk) * np.exp(-tk * 14) * .12
        e = min(N, s + Lk)
        if s < N: music[s:e] += kick[:e - s].astype(np.float32)
music = lp(music, 5000)
# fade in/out
fade = np.ones(N, np.float32); fi = int(1.5 * SR); fo = int(3.5 * SR); end = int(dur * SR)
fade[:fi] = np.linspace(0, 1, fi); fade[end - fo:end] = np.linspace(1, 0, fo); fade[end:] = 0
music *= fade
# ---- ducking: music drops under the voice ----
envv = lp(np.abs(voice), 6)
duck = 1 - .62 * np.clip(envv / (np.percentile(envv[envv > 1e-4], 60) + 1e-6), 0, 1)
duck = lp(duck.astype(np.float32), 3)
# ---- sound effects ----
fx = np.zeros(N, np.float32)
def add(at, sig):
    s = int(at * SR); e = min(N, s + len(sig))
    if 0 <= s < N: fx[s:e] += sig[:e - s]
def tone(f, d, dec, amp):
    tt = np.arange(int(d * SR)) / SR; return (np.sin(2 * np.pi * f * tt) * np.exp(-tt * dec) * amp).astype(np.float32)
def noise(d, amp): return (rng.standard_normal(int(d * SR)) * amp).astype(np.float32)
tt = lambda d: np.arange(int(d * SR)) / SR
S = {
  "click": lp(noise(.03, .5) * np.exp(-tt(.03) * 160), 3500) + tone(1100, .03, 120, .15),
  "key":   lp(noise(.025, .22) * np.exp(-tt(.025) * 220), 6000),
  "tick":  tone(1760, .06, 60, .18) + tone(2640, .06, 80, .06),
  "pop":   (np.sin(2 * np.pi * (900 * np.exp(-tt(.12) * 18) + 200) * tt(.12)) * np.exp(-tt(.12) * 25) * .25).astype(np.float32),
  "ding":  tone(1318.5, .9, 5, .14) + tone(1975.5, .9, 6, .09) + tone(2637, .9, 9, .04),
}
w = noise(.7, 1.0); sweep = np.concatenate([lp(w[i:i + 2400], 300 + 6000 * (i / len(w))) for i in range(0, len(w), 2400)])[:len(w)]
S["whoosh"] = (sweep * np.sin(np.pi * tt(.7) / .7) ** 2 * .22).astype(np.float32)
for at, kind in json.load(open(f"{D}/sfx.json")):
    add(at, S[kind])
mix = voice * 1.0 + music * duck * 1.15 + fx * .8
mix = np.tanh(mix * 1.1) / np.tanh(1.1)  # gentle limiter
peak = np.max(np.abs(mix)); mix = mix / peak * .93
sf.write(f"{D}/mix.wav", mix.astype(np.float32), SR, subtype="PCM_16")
print("mixed", round(len(mix) / SR, 1), "s; music rms", float(np.sqrt(np.mean((music * duck) ** 2))), "voice rms", float(np.sqrt(np.mean(voice ** 2))))
