"""Generate per-line narration with Kokoro (offline) and write timing.json + narration.wav.
The voice reads British-English phonemes reshaped toward Nigerian English (see accent.py),
at a relaxed pace with generous pauses so first-time viewers can follow."""
import json, sys, numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
from accent import nigerian
model_dir, out_dir = sys.argv[1], sys.argv[2]
VOICE = sys.argv[3] if len(sys.argv) > 3 else "bm_george"
SPEED = 0.85   # ~125 words per minute
SR = 24000
k = Kokoro(f"{model_dir}/kokoro-v1.0.onnx", f"{model_dir}/voices-v1.0.bin")
script = json.load(open("script.json"))
GAP, SCENE_GAP, LEAD = 0.65, 1.4, 0.9   # seconds of silence between lines / scenes / at start
audio = [np.zeros(int(LEAD * SR), np.float32)]
t = LEAD
timing = []
for si, sc in enumerate(script):
    scene = {"id": sc["id"], "title": sc["title"], "start": t, "lines": []}
    for disp, say in sc["lines"]:
        if disp == "__PAUSE__":
            n = 4.0; audio.append(np.zeros(int(n * SR), np.float32))
            scene["lines"].append({"text": "", "start": t, "end": t + n, "pause": True}); t += n
            continue
        ph = k.tokenizer.phonemize(say or disp, "en-gb")
        ph = ph.replace("ɐskˈɒn", "ˈaskɔn")    # AS-con, not as-KON
        ph = nigerian(ph)
        s, sr = k.create(ph, voice=VOICE, speed=SPEED, is_phonemes=True)
        assert sr == SR
        # trim leading/trailing near-silence for tight pacing
        idx = np.where(np.abs(s) > 0.01)[0]
        s = s[max(0, idx[0] - 1200): idx[-1] + 2400].astype(np.float32)
        d = len(s) / SR
        scene["lines"].append({"text": disp, "start": t, "end": t + d})
        audio.append(s); t += d
        audio.append(np.zeros(int(GAP * SR), np.float32)); t += GAP
    t += SCENE_GAP - GAP
    audio.append(np.zeros(int((SCENE_GAP - GAP) * SR), np.float32))
    scene["end"] = t
    timing.append(scene)
    print(f"{sc['id']:10s} {scene['start']:7.2f} -> {t:7.2f}", flush=True)
tail = 3.0
audio.append(np.zeros(int(tail * SR), np.float32)); timing[-1]["end"] += tail
sf.write(f"{out_dir}/narration.wav", np.concatenate(audio), SR)
json.dump({"duration": timing[-1]["end"], "voice": VOICE, "scenes": timing}, open(f"{out_dir}/timing.json", "w"), indent=1)
