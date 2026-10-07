"""Synthesize narration per segment and write the shared timeline.

Usage: python3 build/tts.py <path/to/en-us-ryan-high.onnx>

Outputs:
  build/out/seg/<segment>.wav   one narration clip per segment
  timing.js                     window.TIMING used by explainer.html (scene/segment start+end)
"""
import json
import re
import sys
import wave
from pathlib import Path

from piper import PiperVoice, SynthesisConfig

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "build" / "out" / "seg"

# Spoken forms: captions keep the proper spelling, the voice gets these.
SPOKEN = [
    (r"ascon\.gov\.ng", "Askon dot gov dot N G"),
    (r"\bASCON\b", "Askon"),
    (r"\bCBT\b", "C B T"),
]


def spoken(text):
    for pat, rep in SPOKEN:
        text = re.sub(pat, rep, text)
    return text


def main(model_path):
    script = json.loads((ROOT / "script.json").read_text())
    voice = PiperVoice.load(model_path)
    cfg = SynthesisConfig(length_scale=script["voice"]["length_scale"], noise_scale=0.6, noise_w_scale=0.8)
    OUT.mkdir(parents=True, exist_ok=True)

    t = 0.0
    scenes, segs = [], {}
    for sc in script["scenes"]:
        start = t
        t += sc["lead"]
        for sg in sc["segs"]:
            path = OUT / f"{sg['id']}.wav"
            with wave.open(str(path), "wb") as w:
                voice.synthesize_wav(spoken(sg["text"]), w, syn_config=cfg)
            with wave.open(str(path), "rb") as w:
                dur = w.getnframes() / w.getframerate()
            entry = {"start": round(t, 3), "end": round(t + dur, 3), "text": sg["text"]}
            t += dur
            if "pause" in sg:
                entry["pause_start"] = round(t, 3)
                t += sg["pause"]
                entry["pause_end"] = round(t, 3)
            if "quiz" in sg:
                entry["quiz"] = sg["quiz"]
            segs[sg["id"]] = entry
            t += script["gap"]
            print(f"{sg['id']:10s} {dur:5.2f}s")
        t += sc["tail"]
        scenes.append({"id": sc["id"], "chapter": sc["chapter"], "start": round(start, 3), "end": round(t, 3)})

    timing = {"scenes": scenes, "segs": segs, "total": round(t, 3)}
    (ROOT / "timing.js").write_text("window.TIMING = " + json.dumps(timing, indent=1) + ";\n")
    print(f"total {t:.1f}s")


if __name__ == "__main__":
    main(sys.argv[1])
