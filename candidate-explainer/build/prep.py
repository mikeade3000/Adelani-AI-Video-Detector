"""Assemble the render folder: data.js (timing + element boxes + QR location) next to stage.html."""
import json, sys, shutil, os
import numpy as np
from PIL import Image
shots, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
boxes = json.load(open(f"{shots}/boxes.json"))
# locate the QR code on the printed certificate: densest dark block in the lower-middle area
im = np.asarray(Image.open(f"{shots}/cert_print.png").convert("L")).astype(float)
h, w = im.shape
y0, x0 = int(h*.8), int(w*.4)
sub = im[int(h*.84):int(h*.97), x0:int(w*.6)] < 80

ys, xs = np.where(sub)
x1, x2, y1, y2 = np.percentile(xs, 1), np.percentile(xs, 99), np.percentile(ys, 1), np.percentile(ys, 99)
cx, cy, span = x0 + (x1 + x2) / 2, int(h*.84) + (y1 + y2) / 2, max(x2 - x1, y2 - y1)
boxes["qr"] = {"x": round(cx / w, 4), "y": round(cy / h, 4), "w": round(span / w, 4)}
print("qr", boxes["qr"])
timing = json.load(open(f"{out}/timing.json"))
open(f"{out}/data.js", "w").write(f"window.TIMING={json.dumps(timing)};\nwindow.BOXES={json.dumps(boxes)};\n")
shutil.copy("stage.html", f"{out}/stage.html")
if not os.path.exists(f"{out}/shots"): os.symlink(os.path.abspath(shots), f"{out}/shots")
