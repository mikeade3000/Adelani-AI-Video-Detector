"""Encode the MP4 and write captions + the interactive player.
usage: python3 finish.py <render dir> <frames dir> <fps> <dest dir> [--no-video]"""
import json, sys, subprocess, shutil, os
R, FR, FPS, DEST = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
os.makedirs(DEST, exist_ok=True)
T = json.load(open(f"{R}/timing.json"))
name = "pse-certificate-guide"
PORTAL = "https://ascon-pse-certificate.portals.com.ng/"

def ts(s, sep):
    h, m = int(s // 3600), int(s % 3600 // 60); sec = s % 60
    return f"{h:02d}:{m:02d}:{int(sec):02d}{sep}{int(round((sec % 1) * 1000)) % 1000:03d}"
cues = [l for sc in T["scenes"] for l in sc["lines"] if not l.get("pause")]
with open(f"{DEST}/{name}.vtt", "w") as f:
    f.write("WEBVTT\n\n")
    for i, l in enumerate(cues, 1): f.write(f"{i}\n{ts(l['start'], '.')} --> {ts(l['end'] + .25, '.')}\n{l['text']}\n\n")
with open(f"{DEST}/{name}.srt", "w") as f:
    for i, l in enumerate(cues, 1): f.write(f"{i}\n{ts(l['start'], ',')} --> {ts(l['end'] + .25, ',')}\n{l['text']}\n\n")

S = {s["id"]: s for s in T["scenes"]}
data = {
  "chapters": [{"id": s["id"], "title": s["title"], "start": round(s["start"] - (.8 if i else s["start"]), 2), "end": round(s["end"], 2),
                "lines": [{"text": l["text"], "start": round(l["start"], 2), "end": round(l["end"], 2)} for l in s["lines"] if not l.get("pause")]}
               for i, s in enumerate(T["scenes"])],
  "checkpoints": [
    {"at": round(S["find"]["end"] - .4, 2), "q": "Which two details do you enter to find your result?",
     "options": ["Examination number and surname", "Email address and phone number", "Certificate number and date of birth"], "answer": 0,
     "why": "Your examination number (from your admission card) and your surname, or any one of your registered names."},
    {"at": round(S["print"]["end"] - .4, 2), "q": "You click “Print certificate”, confirm, then cancel the print dialog. Did that use one of your 3 prints?",
     "options": ["No, cancelling gives the print back", "Yes, the print is counted once you confirm"], "answer": 1,
     "why": "The print is counted the moment you confirm. Check the preview first, and choose “Save as PDF” if you want a digital copy."},
    {"at": round(S["verify"]["end"] - .4, 2), "q": "How can an employer check that your certificate is genuine?",
     "options": ["Scan the QR code, or enter the certificate number on the Verify tab", "Look at the colour of the paper", "Ask the candidate to sign it again"], "answer": 0,
     "why": "Every printed certificate carries a unique certificate number and QR code that the portal verifies in seconds."}]}
for a, b in zip(data["chapters"], data["chapters"][1:]): a["end"] = b["start"]
html = open("player.template.html").read().replace("__DATA__", json.dumps(data)).replace("__PORTAL__", PORTAL)
open(f"{DEST}/index.html", "w").write(html)
shutil.copy(f"{R}/shots/seal.png", f"{DEST}/seal.png")
if "--no-video" in sys.argv: sys.exit()
poster_frame = int((S["intro"]["lines"][1]["start"] + 2.5) * int(FPS))
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", f"{FR}/f{poster_frame:06d}.jpg", "-vf", "scale=1280:-2", "-q:v", "3", f"{DEST}/poster.jpg"], check=True)

# 1080p for screens/YouTube, 720p for sharing on phones (WhatsApp etc.)
for suffix, vf, crf, ab in (("", [], "27", "128k"), ("-720p", ["-vf", "scale=1280:720:flags=lanczos"], "28", "96k")):
    out = f"{DEST}/{name}{suffix}.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", FPS, "-i", f"{FR}/f%06d.jpg", "-i", f"{R}/mix.wav", *vf,
      "-c:v", "libx264", "-preset", "slow", "-crf", crf, "-pix_fmt", "yuv420p", "-tune", "animation", "-movflags", "+faststart",
      "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", ab, "-ar", "48000", "-shortest", out], check=True)
    print(out, round(os.path.getsize(out) / 1e6, 1), "MB")
