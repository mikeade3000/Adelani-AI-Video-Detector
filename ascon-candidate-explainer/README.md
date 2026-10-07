# ASCON CBT — Candidate Explainer

A narrated explainer for candidates sitting the ASCON Public Service Examination (CBT). It covers:

1. **Portal**: visit ascon.gov.ng and find the CBT examination portal link
2. **What to bring**: login details, valid ID, charged device + charger/power bank, data, pens and plain paper
3. **Your device**: laptops, tablets and smartphones are allowed, but **location must be ON** at the venue
4. **Sign in**: username → password → instructions/location/terms → confirm details → countdown → Start
5. **The exam**: timer, Next/Previous, palette, autosave, red timer in the last 5 minutes, auto-submit
6. **Malpractice**: switching tabs/pages, minimizing, other apps, background audio/earpieces, copy & paste are all detected and recorded
7. **Quick quiz**: allowed or malpractice?
8. **Theory (Part B)**: answer sheet, photograph each page, upload before time
9. **After the exam**: confirmation screen, Part A score (where enabled), one attempt only
10. **Golden rules** recap

## Deliverables

| File | What it is |
| --- | --- |
| `ascon-candidate-explainer.mp4` | 1080p / 30 fps video with voice-over, music, sound effects and captions (≈4 min 24 s) |
| `explainer.html` | Interactive version. The quiz pauses and waits for the candidate to tap **Allowed** or **Malpractice**, keeps score, and the chapter bar jumps to any section. Needs `timing.js`, `assets/` and `audio/` next to it. |

## Rebuilding

```bash
# 1. voice-over (Piper neural TTS, "ryan" high-quality US English male voice)
pip install piper-tts
curl -LO https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-en-us-ryan-high.tar.gz && tar xzf voice-en-us-ryan-high.tar.gz
python3 build/tts.py en-us-ryan-high.onnx          # -> build/out/seg/*.wav + timing.js

# 2. frames -> silent video (headless Chromium via Playwright)
NODE_PATH=$(npm root -g) node build/render.cjs video build/out/video-silent.mp4 30 4

# 3. soundtrack + final mux
python3 build/mix.py                                # -> build/out/mix.wav
ffmpeg -i build/out/video-silent.mp4 -i build/out/mix.wav -c:v copy -c:a aac -b:a 160k -shortest -movflags +faststart ascon-candidate-explainer.mp4
ffmpeg -i build/out/mix.wav -c:a aac -b:a 128k audio/narration-mix.m4a
```

To change the wording, edit `script.json` and re-run all three steps. Scene animations are keyed to
narration segments (`data-at="portal_b+0.6"` means 0.6 s after segment `portal_b` starts), so they stay in sync automatically.

**Real website screenshot:** the ASCON homepage in scene 2 is an illustration, because the build machine could not reach
ascon.gov.ng. Save a screenshot of the real homepage as `assets/ascon-home.jpg` and re-render, and it will appear as the hero
background. If the real link has a different label, update the text "CBT Exam Portal" in `explainer.html`.

Preview any moment without rendering everything: `node build/render.cjs stills /tmp/stills 25 90 170`.
