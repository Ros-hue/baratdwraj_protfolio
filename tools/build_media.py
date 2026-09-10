"""Build every runtime media asset from the originals in assets_src/.

Run:  python tools/build_media.py
Out:  public/media/*.mp4  (+ .webm)  packed-alpha clips
      public/media/*.jpg            poster frames
      public/tex/grain.png          animated-grain tile
      public/tex/grunge.png         letter texture lifted from the supplied artwork
      public/media/manifest.json
"""

import json
import os
import subprocess
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from matte import process  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets_src")
MEDIA = os.path.join(ROOT, "public", "media")
TEX = os.path.join(ROOT, "public", "tex")

# name, source file, preset, output size, frame range
# The walking man is the only clip that appears on the site. The other two
# sources stay in assets_src/ and their presets stay in matte.py, so re-enabling
# either is a one-line change plus a rebuild.
CLIPS = [
    ("hero", "v1.mp4", "v1", 720, 1280, 0, 240),
    # ("letter_g", "v2.mp4", "v2", 540, 960, 0, 240),
    # ("letter_h", "v3.mov", "v3", 540, 960, 0, 190),
]


def poster(packed_mp4, out_jpg, w):
    """First frame of the colour half, over black - used as the video poster."""
    cap = cv2.VideoCapture(packed_mp4)
    ok, fr = cap.read()
    cap.release()
    if ok:
        cv2.imwrite(out_jpg, fr[:, :w], [cv2.IMWRITE_JPEG_QUALITY, 82])


def verify(packed_mp4, w):
    """Decode the encode back and confirm the matte survived the round trip."""
    cap = cv2.VideoCapture(packed_mp4)
    cap.set(cv2.CAP_PROP_POS_FRAMES, 30)
    ok, fr = cap.read()
    cap.release()
    if not ok:
        return "could not decode"
    m = fr[:, w:, 0].astype(np.float32) / 255.0
    return ("matte min %.3f max %.3f | opaque %.1f%% clear %.1f%% soft %.1f%%"
            % (m.min(), m.max(), (m > 0.95).mean() * 100,
               (m < 0.05).mean() * 100, ((m >= 0.05) & (m <= 0.95)).mean() * 100))


def build_grunge():
    """Lift the distressed surface out of the supplied B.BHARADWAJ artwork.

    The letters are rendered live as real type so they stay razor sharp at any
    size, but the SURFACE has to be the one from the reference art, so it is
    extracted here rather than invented.

    Two details matter. The source crop is wide and short, so resizing it
    straight to a square smears the horizontal scratches into vertical streaks
    that read as wood grain - aspect is preserved instead. And the area outside
    the letterforms carries no texture at all, so it is inpainted from the
    neighbouring ink rather than left as flat plates.
    """
    img = cv2.imread(os.path.join(SRC, "ref_typo.jpg"))
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    red = ((hsv[:, :, 1] > 90) & (hsv[:, :, 2] > 60)).astype(np.uint8)
    ys, xs = np.nonzero(red)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    crop = img[y0:y1, x0:x1]
    inside = red[y0:y1, x0:x1]
    if inside.sum() < 1000:
        return

    g = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY).astype(np.float32)
    # high-pass: drop the broad shading, keep scratches, speckle and abrasion
    hp = g - cv2.GaussianBlur(g, (0, 0), 26.0) + 128.0
    hp = np.clip(hp, 0, 255).astype(np.uint8)
    hp = cv2.inpaint(hp, (1 - inside).astype(np.uint8), 6, cv2.INPAINT_TELEA)

    t = hp.astype(np.float32) / 255.0
    tile = quilt(t, inside, size=512, patch=64, seed=5)

    # Second high-pass, this time wrap-aware. The reference paint is scratched,
    # not spattered: its detail is hairline and linear. Without this the surviving
    # low frequencies read as dark blobs across the wordmark, which is a different
    # material altogether.
    tile = tile - wrap_blur(tile, 7.0) + 0.5

    # normalise to a calm mid-grey: this multiplies the ink, so a wide histogram
    # here turns the wordmark into stripes rather than worn paint. A robust
    # spread is used so a few extreme scratches cannot flatten everything else.
    lo, hi = np.percentile(tile, [16, 84])
    tile = (tile - np.median(tile)) / max((hi - lo) * 0.5, 1e-6)
    tile = np.clip(0.5 + tile * 0.155, 0.0, 1.0)
    os.makedirs(TEX, exist_ok=True)
    cv2.imwrite(os.path.join(TEX, "grunge.png"), (tile * 255).astype(np.uint8))


def wrap_blur(img, sigma):
    """Gaussian blur that respects tiling, so filtering keeps the tile seamless."""
    k = int(np.ceil(sigma * 3))
    p = np.pad(img, k, mode="wrap")
    return cv2.GaussianBlur(p, (0, 0), sigma)[k:-k, k:-k]


def quilt(src, mask, size=512, patch=64, seed=0, placements=420):
    """Seamless tile synthesised from patches taken INSIDE the letterforms.

    Cropping the artwork directly bakes the letter silhouettes into the texture,
    which then ghosts across the live wordmark as faint E and S shapes. Only
    material from well inside the strokes is sampled, and patches are dropped
    with wrap-around indexing under a Hann window, so the result carries the
    real scratches and speckle but none of the structure - and tiles perfectly
    because every write wraps.
    """
    # The strokes are only 60-160px wide, so the sampling window has to be small
    # enough to fit inside one. Erode by less than the narrowest stem or nothing
    # qualifies and the whole synthesis silently degrades.
    rng = np.random.default_rng(seed)
    safe = cv2.erode(mask.astype(np.uint8),
                     np.ones((9, 9), np.uint8)).astype(bool)
    # integral image -> O(1) test for "is this whole window inside a stroke"
    ii = cv2.integral(safe.astype(np.float32))
    h, w = src.shape
    spots = []
    for _ in range(6000):
        y = int(rng.integers(0, max(1, h - patch)))
        x = int(rng.integers(0, max(1, w - patch)))
        total = (ii[y + patch, x + patch] - ii[y, x + patch]
                 - ii[y + patch, x] + ii[y, x])
        if total >= patch * patch * 0.995:
            spots.append((y, x))
        if len(spots) >= placements * 3:
            break
    if len(spots) < 12:
        # refusing quietly here would ship a stretched, non-tiling crop that
        # looks like wood grain across the wordmark
        raise RuntimeError(
            "grunge synthesis: only %d clean %dpx patches inside the letterforms;"
            " reduce `patch` or the erosion" % (len(spots), patch))

    # a flat-topped taper: a pure Hann leaves the weight sum near zero wherever
    # only patch edges land, and dividing by that blows those pixels out
    win = np.hanning(patch) ** 0.4
    win = np.outer(win, win).astype(np.float32) + 0.04

    acc = np.zeros((size, size), np.float32)
    wsum = np.zeros((size, size), np.float32)
    ys, xs = np.mgrid[0:patch, 0:patch]
    for k in range(placements):
        py, px = spots[int(rng.integers(0, len(spots)))]
        p = src[py:py + patch, px:px + patch]
        if rng.random() < 0.5:
            p = p[:, ::-1]
        if rng.random() < 0.5:
            p = p[::-1, :]
        oy = int(rng.integers(0, size))
        ox = int(rng.integers(0, size))
        ty = (ys + oy) % size
        tx = (xs + ox) % size
        np.add.at(acc, (ty, tx), p * win)
        np.add.at(wsum, (ty, tx), win)
    return acc / np.maximum(wsum, wsum.mean() * 0.25)


def build_grain():
    """Monochrome blue-noise-ish tile, scrolled per frame for film grain."""
    rng = np.random.default_rng(11)
    n = rng.normal(0.5, 0.16, (512, 512)).astype(np.float32)
    n = cv2.GaussianBlur(n, (0, 0), 0.6)
    n = np.clip((n - n.min()) / (n.max() - n.min()), 0, 1)
    os.makedirs(TEX, exist_ok=True)
    cv2.imwrite(os.path.join(TEX, "grain.png"), (n * 255).astype(np.uint8))


def stage_universe_film():
    """Scene two plays the supplied reference film directly. The video stream
    is copied untouched - only the audio track is dropped and the moov atom
    moved to the front so playback can start before the file finishes."""
    src = os.path.join(ROOT, "section 2 refrence video.mp4")
    dst = os.path.join(MEDIA, "universe.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src,
                    "-c:v", "copy", "-an", "-movflags", "+faststart", dst],
                   check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", dst,
                    "-frames:v", "1", "-q:v", "4",
                    os.path.join(MEDIA, "universe.jpg")], check=True)
    print("  universe film staged (%d KB)" % (os.path.getsize(dst) // 1024))


def main():
    os.makedirs(MEDIA, exist_ok=True)
    build_grunge()
    build_grain()
    stage_universe_film()
    print("textures written")

    manifest = {"clips": {}}
    for name, srcfile, preset, w, h, f0, f1 in CLIPS:
        src = os.path.join(SRC, srcfile)
        print("encoding %s from %s ..." % (name, srcfile), flush=True)
        info = process(src, preset, w, h, MEDIA, name, trim=(f0, f1))
        mp4 = os.path.join(MEDIA, name + ".mp4")
        poster(mp4, os.path.join(MEDIA, name + ".jpg"), w)
        info["poster"] = name + ".jpg"
        info["packed"] = "side-by-side: colour | matte"
        manifest["clips"][name] = info
        size = os.path.getsize(mp4) / 1e6
        wsize = os.path.getsize(os.path.join(MEDIA, name + ".webm")) / 1e6
        print("  %s: %d frames  mp4 %.2f MB  webm %.2f MB" %
              (name, info["frames"], size, wsize))
        print("  verify: %s" % verify(mp4, w), flush=True)

    with open(os.path.join(MEDIA, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print("done")


if __name__ == "__main__":
    main()
