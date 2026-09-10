"""Quick matte QA: composite sample frames over a checkerboard, no encoding."""
import argparse
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from matte import PRESETS, frame_alpha, despill  # noqa: E402


def run(src, preset, frames, out, overrides=None, crop=None, tile=(300, 533)):
    cfg = dict(PRESETS[preset])
    cfg.update(overrides or {})
    cap = cv2.VideoCapture(src)
    want = sorted(frames)
    tiles = []
    i = 0
    while want:
        ok, fr = cap.read()
        if not ok:
            break
        if i == want[0]:
            want.pop(0)
            a, bg_bgr = frame_alpha(fr, cfg)
            col = despill(fr, a, bg_bgr, cfg)
            h, w = a.shape
            yy, xx = np.mgrid[0:h, 0:w]
            ck = (((yy // 20 + xx // 20) % 2) * 60 + 18).astype(np.float32)
            comp = col * a[..., None] + (1 - a[..., None]) * ck[..., None]
            if crop:
                x0, y0, x1, y1 = crop
                comp = comp[y0:y1, x0:x1]
            tiles.append(cv2.resize(np.clip(comp, 0, 255), tile))
        i += 1
    cap.release()
    cv2.imwrite(out, np.concatenate(tiles, 1).astype(np.uint8))
    print(out, len(tiles), "tiles")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--preset", required=True)
    ap.add_argument("--frames", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--set", default="")
    ap.add_argument("--crop", default="")
    a = ap.parse_args()
    ov = {}
    for kv in filter(None, a.set.split(",")):
        k, v = kv.split("=")
        ov[k.strip()] = float(v) if ("." in v or "e" in v.lower()) else int(v)
    crop = tuple(int(x) for x in a.crop.split(",")) if a.crop else None
    run(a.src, a.preset, [int(x) for x in a.frames.split(",")], a.out, ov, crop)
