"""Lift the section-3 artwork out of the supplied reference.

Two things come out of the poster:

  * the six card photographs, one per year. They are small in the source
    (~90-140px wide) and are graded warm; they are lifted at native detail and
    given a light clean-up rather than an upscale that invents nothing.

  * the central figure's silhouette, found with grabCut for the same reason as
    in scene two: he is nearly black against a nearly black floor, so no
    luminance threshold can separate them. Only his SHAPE is kept - the scene
    lights him at runtime.

Nothing here is redrawn or replaced.
"""

import json
import os

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "section 3 image.jpg")
OUT = os.path.join(ROOT, "public", "years")

# photo box per year, measured off the reference by detecting the bright
# rectangles inside each card
PHOTOS = {
    2021: (219, 174, 305, 240),
    2022: (353, 228, 443, 286),
    2023: (488, 260, 600, 330),
    2024: (641, 302, 736, 358),
    2025: (839, 335, 930, 398),
    2026: (977, 342, 1118, 420),
}

FIGURE_REGION = (505, 350, 675, 700)
FIGURE_SEED = (0.14, 0.02, 0.88, 0.99)

# every photo is emitted at this width; the tallest source is 141px wide, so
# this is a modest upscale that keeps them crisp on a 2x display without
# shipping pixels the source never had
OUT_W = 264


def photo(year, box):
    img = cv2.imread(SRC)
    x0, y0, x1, y1 = box
    c = img[y0:y1, x0:x1].astype(np.float32)

    # The poster grades these warm and dark. Held at source levels they read as
    # muddy brown smears once they are card-sized, so the range is opened up
    # while the warm cast that ties them to the scene is kept.
    lo, hi = np.percentile(c, [2, 99])
    c = np.clip((c - lo) / max(hi - lo, 1e-6), 0, 1)
    c = np.power(c, 0.86) * 255.0

    h = int(round(OUT_W * (y1 - y0) / (x1 - x0)))
    c = cv2.resize(c, (OUT_W, h), interpolation=cv2.INTER_LANCZOS4)
    c = cv2.bilateralFilter(np.clip(c, 0, 255).astype(np.uint8), 5, 30, 6)
    # a touch of local contrast back, since the resize softens it
    blur = cv2.GaussianBlur(c, (0, 0), 1.6)
    c = np.clip(c.astype(np.float32) * 1.35 - blur.astype(np.float32) * 0.35, 0, 255)

    path = os.path.join(OUT, "%d.jpg" % year)
    cv2.imwrite(path, c.astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 88])
    return OUT_W, h


def figure():
    img = cv2.imread(SRC)
    x0, y0, x1, y1 = FIGURE_REGION
    crop = img[y0:y1, x0:x1]
    h, w = crop.shape[:2]

    lifted = np.clip(crop.astype(np.float32) * 3.0, 0, 255).astype(np.uint8)
    lifted = cv2.bilateralFilter(lifted, 7, 40, 12)

    mask = np.zeros((h, w), np.uint8)
    rect = (int(FIGURE_SEED[0] * w), int(FIGURE_SEED[1] * h),
            int((FIGURE_SEED[2] - FIGURE_SEED[0]) * w),
            int((FIGURE_SEED[3] - FIGURE_SEED[1]) * h))
    cv2.grabCut(lifted, mask, rect, np.zeros((1, 65), np.float64),
                np.zeros((1, 65), np.float64), 6, cv2.GC_INIT_WITH_RECT)
    m = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 1, 0).astype(np.uint8)

    n, lab, st, cen = cv2.connectedComponentsWithStats(m, 8)
    best, score = 0, -1e18
    for i in range(1, n):
        area = st[i, cv2.CC_STAT_AREA]
        if area < 0.02 * w * h:
            continue
        s = area * (1.0 - abs(cen[i][0] / w - 0.5))
        if s > score:
            best, score = i, s
    if best:
        m = (lab == best).astype(np.uint8)

    # He is a true silhouette - his torso sits at luma ~1 while the lit floor
    # between his legs runs 68-104. grabCut happily claims that floor because it
    # falls inside the seed rectangle, so darkness is applied as a hard
    # constraint; without it a wedge of glowing floor ends up inside him.
    dark = (cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) < 46).astype(np.uint8)
    dark = cv2.morphologyEx(dark, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    m = (m & dark).astype(np.uint8)

    n2, lab2, st2, _c2 = cv2.connectedComponentsWithStats(m, 8)
    if n2 > 1:
        keep = 1 + int(np.argmax(st2[1:, cv2.CC_STAT_AREA]))
        m = (lab2 == keep).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))

    # small holes only: the gap between his legs is enclosed by his shoes and
    # filling it would paste a slab of lit floor into the silhouette
    guard = np.zeros((h + 2, w + 2), np.uint8)
    inv = (1 - m).astype(np.uint8)
    cv2.floodFill(inv, guard, (0, 0), 2)
    holes = ((inv == 1) & (m == 0)).astype(np.uint8)
    if holes.any():
        hn, hlab, hst, _c = cv2.connectedComponentsWithStats(holes, 8)
        lim = 0.02 * float(m.sum())
        keep = [i for i in range(1, hn) if hst[i, cv2.CC_STAT_AREA] < lim]
        holes = np.isin(hlab, keep).astype(np.uint8) if keep else np.zeros_like(holes)
    m = ((m == 1) | (holes == 1)).astype(np.uint8)

    a = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 1.2)
    a = np.clip((a - 0.35) / 0.42, 0, 1)
    # he stands on a mirror floor; the reflection under his shoes is not him
    fade = np.clip(np.linspace(0, 1, a.shape[0]) * 12.0 - 10.4, 0, 1)[:, None]
    a *= (1.0 - fade)

    ys, xs = np.nonzero(a > 0.15)
    pad = 5
    cy0, cy1 = max(0, ys.min() - pad), min(h, ys.max() + pad)
    cx0, cx1 = max(0, xs.min() - pad), min(w, xs.max() + pad)
    a = a[cy0:cy1, cx0:cx1]
    body = crop[cy0:cy1, cx0:cx1]

    rgba = np.dstack([np.clip(body.astype(np.float32) * 1.4, 0, 255),
                      a * 255]).astype(np.uint8)
    cv2.imwrite(os.path.join(OUT, "figure.png"), rgba)
    return rgba.shape[1], rgba.shape[0], float((a > 0.5).mean())


def main():
    os.makedirs(OUT, exist_ok=True)
    meta = {}
    for year, box in PHOTOS.items():
        w, h = photo(year, box)
        meta[str(year)] = {"w": w, "h": h}
        print("  photo %d  %dx%d" % (year, w, h))
    fw, fh, cov = figure()
    meta["figure"] = {"w": fw, "h": fh}
    print("  figure   %dx%d  coverage %.1f%%" % (fw, fh, cov * 100))
    with open(os.path.join(OUT, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=1)
    print("wrote ->", OUT)


if __name__ == "__main__":
    main()
