# PSE 2026 certificate: candidate video guide

An explainer video for 2026 Public Service Examination candidates. It shows how to find, check, print and verify an ASCON certificate on the certificate portal. A young male voice narrates it, and it has on-screen captions, a music bed and sound effects.

| File | What it is |
| --- | --- |
| `pse-certificate-guide.mp4` | The video: 1080p, about 5 minutes, narrated, with captions burned into the picture (30 MB) |
| `pse-certificate-guide-720p.mp4` | The same video at 720p (15 MB), for sharing on WhatsApp and phones |
| `index.html` | Interactive player with chapters, a clickable transcript, pause-and-answer checkpoints, an "Am I ready?" checklist and links to the site and portal |
| `pse-certificate-guide.vtt` / `.srt` | Caption files, for the player, YouTube, Facebook or WhatsApp uploads |
| `poster.jpg`, `seal.png` | Assets used by the player |
| `build/` | Everything needed to regenerate the video (see below) |

To share it, upload the MP4 anywhere, or host this folder as is (for example on GitHub Pages) and send people `index.html`.

## What the video covers (chapters)

1. **Welcome:** congratulations, and what the guide covers
2. **What you need:** examination number (CODE/2026/NUMBER), surname, a device with internet, and an A4 printer or Save as PDF
3. **Step 1, visit ascon.gov.ng:** find the PSE certificate portal link
4. **The portal at a glance:** the Print, Verify and Help tabs
5. **Step 2, find your result:** typing the number and surname, then Find my result
6. **Step 3, check the preview:** details, the PREVIEW watermark, what to do if something is wrong, and the 3-print allowance
7. **Step 4, print smartly:** the confirm dialog, the print being counted, A4, landscape, no margins, background graphics, and Save as PDF
8. **Step 5, verify:** scanning the QR code with a phone, or the Verify tab
9. **Quick troubleshooting:** number not found, surname mismatch, missing colours, all prints used, and the Help tab
10. **Pop quiz,** then **recap**

## Notes before publishing

- **ascon.gov.ng homepage scene:** the build machine could not reach ascon.gov.ng, so the homepage in Step 1 is an illustration labelled "Illustration · the live ascon.gov.ng layout may differ". Once the real link is live, swap in a real screenshot by replacing the `#home` block in `build/stage.html` with an `<img>`, then re-render.
- **Fictional candidate:** the portal screens are real captures of the portal page running in demonstration mode with one made-up candidate, *Okafor Temitope Aisha, ANCSC/2026/001*. No live records were used.
- **Voice:** an offline neural text-to-speech voice (Kokoro, `bm_george`) at a relaxed pace of about 123 words per minute, with generous pauses between lines. Its pronunciation is reshaped toward Nigerian English by `build/accent.py`: no TH sounds ("di", "dat"), *-shon* endings, flat vowels (*satifikat*, *konfam*), non-rhotic, and "ASCON" said as *AS-con*. "Three" is kept clear because it is the print limit. This is an approximation, not a native Nigerian voice. For a fully authentic sound, have a Nigerian voice artist read `build/script.json` line by line and re-run the build from the mix step. To change the pace, edit `SPEED` and the pauses at the top of `build/tts.py`.

## Rebuilding

Requirements: Python 3 (`kokoro-onnx`, `soundfile`, `numpy`, `scipy`, `Pillow`), Node with Playwright and Chromium, and ffmpeg. The Kokoro model files (`kokoro-v1.0.onnx`, `voices-v1.0.bin`) come from the kokoro-onnx GitHub releases.

```bash
cd build
python3 tts.py <model dir> <render dir> bm_george          # narration.wav + timing.json
node capture.js <portal index.html> <shots dir>            # real portal screens (set QR_LIB if cdnjs is blocked)
python3 prep.py <shots dir> <render dir>                    # data.js + stage.html into the render dir
node render.js <render dir> <frames dir> 25 <i> <n>        # frames (run n workers, i = 0..n-1)
python3 mix.py <render dir>                                # music + sfx + narration -> mix.wav
python3 finish.py <render dir> <frames dir> 25 ..          # mp4, captions, interactive player
```

To edit the wording, change `build/script.json`. Each entry is `[on-screen caption, spoken text or null]`, and the spoken text can spell words out for the voice. Then re-run everything from `tts.py`, because all animation timings follow the narration. To preview the animation in a browser with sound, open `<render dir>/stage.html?play` and click once.
