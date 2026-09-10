# One-clip encoder for the section-5 walking man - the full build_media run
# re-mattes the hero for minutes, so the cert clip gets its own entry point.
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from matte import process           # noqa: E402
from build_media import MEDIA, poster, verify   # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = os.path.join(ROOT, "Man_walking_and_smoking_cigarette_202609051235.mp4")

info = process(SRC, "v5", 1280, 720, MEDIA, "cert",
               trim=(0, 240), qa=[0, 60, 120, 200], crf=21)
mp4 = os.path.join(MEDIA, "cert.mp4")
poster(mp4, os.path.join(MEDIA, "cert.jpg"), 1280)
info["poster"] = "cert.jpg"
info["packed"] = "side-by-side: colour | matte"

mf = os.path.join(MEDIA, "manifest.json")
manifest = json.load(open(mf, encoding="utf-8"))
manifest["clips"]["cert"] = info
with open(mf, "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2)
print("cert staged: %d frames, mp4 %.2f MB, webm %.2f MB" % (
    info["frames"], os.path.getsize(mp4) / 1e6,
    os.path.getsize(os.path.join(MEDIA, "cert.webm")) / 1e6))
print("verify:", verify(mp4, 1280))
