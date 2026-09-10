"""Lift the tool logos out of the supplied section-2 artwork.

The icons were delivered inside the reference image rather than as separate
files, so they are extracted here instead of redrawn. Only the LOGO artwork is
taken (coloured glyph + white wordmark); the card slab it sits on is rendered
live by the compositor, which lets every card be lit by the scene and freely
oriented in 3D rather than carrying the baked perspective of the poster.

The key is: logo pixels are either saturated (brand glyphs) or bright (white
wordmarks), while the card face is dark and desaturated. Components that touch
the crop border are dropped, which removes the card's own rim highlight.
"""

import json
import os

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "section 2 image.jpg")
OUT = os.path.join(ROOT, "public", "tools")

# Card face boxes in the 1280x783 reference, inset off a measured pass so that
# neither the slab's own lit rim nor the scene's red light rigs fall inside.
# Several cards sit directly in front of a red line and needed a hard trim on
# that side; the insets below were read off a brightened, gridded crop rather
# than guessed.
CARDS = {
    "photoshop":  (324, 15, 492, 158),
    "figma":      (133, 200, 302, 392),
    "aftereffects": (411, 278, 492, 350),
    "premiere":   (352, 364, 429, 442),
    "notion":     (272, 452, 371, 555),
    "lightroom":  (466, 466, 545, 543),
    "claude":     (778, 40, 921, 231),
    "chatgpt":    (822, 324, 935, 412),
    "midjourney": (1017, 249, 1122, 357),
    "spline":     (939, 419, 1062, 482),
    "framer":     (738, 434, 819, 522),
    "webflow":    (829, 509, 927, 602),
}

# A few cards sit so close to a red light rig that its glow bleeds inside even
# the tightest usable crop - tighter and the wordmark loses its first letter.
# These corners are erased outright, as fractions of the finished logo box.
ERASE = {
    "framer":     [(0.00, 0.00, 0.34, 0.28), (0.00, 0.00, 0.86, 0.11)],
    "midjourney": [(0.00, 0.00, 0.20, 0.27)],
    "claude":     [(0.84, 0.00, 1.00, 0.18)],
    "aftereffects": [(0.00, 0.00, 0.16, 0.22)],
}

# Keying happens at 3x because a generous working resolution gives a smoother
# matte, but the SOURCE detail caps out around 85px per logo - storing the
# result at 3x ships upsampled pixels that carry no extra information. The
# output is scaled back to a size that still exceeds its largest on-screen size.
UPSCALE = 3
OUT_SCALE = 0.55


def keyed(bgr):
    """RGBA: keep saturated or bright pixels, drop the dark card face."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    sat = hsv[:, :, 1] / 255.0
    val = hsv[:, :, 2] / 255.0
    # brand glyphs are saturated even when dim; wordmarks are white and bright
    score = np.maximum(sat * np.clip(val * 2.2, 0, 1), np.clip((val - 0.30) / 0.42, 0, 1))
    a = np.clip((score - 0.16) / 0.34, 0, 1)
    return a.astype(np.float32)


def clean(a, min_frac=0.003, tiny_frac=0.00035):
    """Drop specks, the slab's lit edge, and stray ribbon light.

    Anything reaching the outer margin of the crop is slab or scene, not
    artwork. Size alone cannot judge the rest: the dot and stem of the "i" in
    Figma or Midjourney are as small as a speck of stray red line. What
    separates them is company - a speck sits alone, a letter sits inline with
    its word - so small parts are kept only when they neighbour a large one.
    """
    m = (a > 0.35).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    n, lab, st, _c = cv2.connectedComponentsWithStats(m, 8)
    h, w = a.shape

    def inside(i):
        """Reject the slab's rim highlight without rejecting letters.

        A wordmark can legitimately run to the very edge of the card face - the
        F of Figma and the tail of Midjourney both do - so mere proximity to the
        border cannot be the test. What the rim actually looks like is a THIN
        line hugging an edge, so thinness plus edge contact is the rule.
        """
        x, y, cw, ch, area = st[i]
        touches = (x <= 2 or y <= 2 or x + cw >= w - 2 or y + ch >= h - 2)
        if not touches:
            return True
        # A rim stroke barely fills its bounding box (a diagonal one has a
        # square box but almost no ink in it); a letter fills a third of its
        # own. Fill ratio separates them where thinness and aspect do not.
        fill = area / float(max(cw * ch, 1))
        aspect = max(cw, ch) / float(max(min(cw, ch), 1))
        return not (fill < 0.14 or aspect > 6.0)

    keep = np.zeros_like(m)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] >= min_frac * w * h and inside(i):
            keep[lab == i] = 1

    if keep.any():
        # NB a k*k kernel grows the mask by k/2, not k. The gap between the F
        # and the i of "Figma" is 28px, so a radius is specified directly
        # rather than a kernel width that quietly halves it.
        radius = max(8, int(min(w, h) * 0.065))
        near = cv2.dilate(keep, np.ones((radius * 2 + 1, radius * 2 + 1), np.uint8))
        for i in range(1, n):
            area = st[i, cv2.CC_STAT_AREA]
            if area < tiny_frac * w * h or not inside(i):
                continue
            part = (lab == i)
            if near[part].any():
                keep[part] = 1

    # Final prune: a surviving speck of red rig light sits off in a corner,
    # while every real part of a logo clusters around the artwork's centre of
    # mass. Small AND far is the signature of scene light, so drop that.
    n2, lab2, st2, cen2 = cv2.connectedComponentsWithStats(keep, 8)
    if n2 > 2:
        total = float(st2[1:, cv2.CC_STAT_AREA].sum())
        ys, xs = np.nonzero(keep)
        cy, cx = ys.mean(), xs.mean()
        diag = float(np.hypot(w, h))
        for i in range(1, n2):
            area = st2[i, cv2.CC_STAT_AREA]
            dist = np.hypot(cen2[i][0] - cx, cen2[i][1] - cy)
            if area < 0.02 * total and dist > 0.42 * diag:
                keep[lab2 == i] = 0

    # Let the soft matte survive only immediately around kept ink. A generous
    # grow also preserves the faint tail of a red rig line passing close to a
    # letter, which is what was still tinting the corners; the floor then drops
    # any remaining haze that is too weak to be artwork.
    grown = cv2.dilate(keep, np.ones((3, 3), np.uint8)).astype(np.float32)
    out = a * np.clip(grown, 0, 1)
    out[out < 0.10] = 0.0
    return out


def process(name, box):
    img = cv2.imread(SRC)
    x0, y0, x1, y1 = box
    crop = img[y0:y1, x0:x1]
    crop = cv2.resize(crop, None, fx=UPSCALE, fy=UPSCALE,
                      interpolation=cv2.INTER_LANCZOS4)

    a = clean(keyed(crop))
    ys, xs = np.nonzero(a > 0.08)
    if len(ys) == 0:
        print("  !! nothing keyed for", name)
        return None
    pad = 8
    y0c, y1c = max(0, ys.min() - pad), min(a.shape[0], ys.max() + pad)
    x0c, x1c = max(0, xs.min() - pad), min(a.shape[1], xs.max() + pad)
    crop = crop[y0c:y1c, x0c:x1c]
    a = a[y0c:y1c, x0c:x1c]

    for (ex0, ey0, ex1, ey1) in ERASE.get(name, []):
        hh, ww = a.shape
        a[int(ey0 * hh):int(ey1 * hh), int(ex0 * ww):int(ex1 * ww)] = 0.0

    # The card face these sit on is near-black and so is the slab we render,
    # so the source pixels composite correctly as-is. Unpremultiplying or
    # sharpening here turns the white wordmarks into embossed outlines.
    rgba = np.dstack([crop.astype(np.float32), a * 255]).astype(np.uint8)
    if OUT_SCALE != 1.0:
        rgba = cv2.resize(rgba, None, fx=OUT_SCALE, fy=OUT_SCALE,
                          interpolation=cv2.INTER_AREA)
    os.makedirs(OUT, exist_ok=True)
    cv2.imwrite(os.path.join(OUT, name + ".png"), rgba)
    return dict(w=int(rgba.shape[1]), h=int(rgba.shape[0]),
                cover=round(float((a > 0.5).mean()), 3))


def main():
    meta = {}
    for name, box in CARDS.items():
        info = process(name, box)
        if info:
            meta[name] = info
            print("  %-14s %4dx%-4d  ink %.1f%%" %
                  (name, info["w"], info["h"], info["cover"] * 100))
    with open(os.path.join(OUT, "logos.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=1)
    print("wrote", len(meta), "logos ->", OUT)


if __name__ == "__main__":
    main()
