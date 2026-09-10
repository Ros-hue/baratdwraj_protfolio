# Section 5 asset extraction — the certifications reference cut into living
# layers, the same discipline as section 4 (extract_s4.py): the glass cards
# become sprites, the walking man's zone is filled (the supplied video plays
# him live), the typography zones are blacked (they become DOM), and what
# remains — fog, horizon glow, wet floor, the blurred ghost cards at the
# edges — is the environment plate the shader stages and re-lights.

import json
import os

import cv2
import numpy as np

SRC = os.path.join(os.path.dirname(__file__), "..", "section 5 main refrence.jpg")
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "certs")
os.makedirs(OUT, exist_ok=True)

img = cv2.imread(SRC)
H, W = img.shape[:2]
assert (W, H) == (1600, 900), f"unexpected reference size {W}x{H}"

# clockwise from top-left, reference px; depth 0 = nearest camera
CARDS = [
    ("figma",  [(425, 175), (668, 224), (650, 392), (408, 344)], 0.55),
    ("google", [(345, 410), (610, 456), (592, 622), (348, 570)], 0.30),
    ("adobe",  [(1066, 110), (1350, 86), (1354, 264), (1070, 284)], 0.65),
    ("fcc",    [(1030, 376), (1314, 326), (1318, 512), (1036, 546)], 0.50),
    ("meta",   [(1086, 584), (1374, 548), (1380, 748), (1094, 776)], 0.30),
]

GROW = 14
FEATHER = 9
PAD = 26

# the walking man + his cigarette smoke + his floor reflection: replaced live
# by the matted video, so lifted out of the plate entirely
# narrows at the floor: only his legs' own pixels get filled down there, so
# the wet floor's sparkle survives right up to where he actually stands
MAN = [(618, 92), (1012, 92), (1012, 780), (958, 900), (706, 900), (618, 780)]
SMOKE = [(830, 80), (1065, 80), (1065, 230), (860, 230)]

LABELS = [
    (40, 55, 240, 165),      # PROOF / OF / PROGRESS + dash
    (45, 205, 398, 330),     # CERTIFICATIONS (incl. its bloom)
    (50, 330, 230, 432),     # LEARNING TODAY / FOR A BETTER / TOMORROW + dash
    (40, 730, 230, 820),     # SKILLS / BACKED / BY / CREDIBILITY
    (1465, 40, 1580, 160),   # SAME / PASSION / A BRIGHTER / TOMORROW + dash
    (1470, 725, 1580, 835),  # LEARN / BUILD / IMPROVE / REPEAT + dash
]


def poly_mask(pts, grow, feather):
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.array(pts, np.int32)], 255)
    if grow > 0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (grow * 2 + 1,) * 2)
        m = cv2.dilate(m, k)
    if feather > 0:
        m = cv2.GaussianBlur(m, (feather * 2 + 1,) * 2, 0)
    return m


meta = {"cards": [], "size": [W, H]}

# ---- sprites ---------------------------------------------------------------
for i, (name, quad, depth) in enumerate(CARDS, 1):
    q = np.array(quad, np.int32)
    x0 = max(0, q[:, 0].min() - PAD)
    y0 = max(0, q[:, 1].min() - PAD)
    x1 = min(W, q[:, 0].max() + PAD)
    y1 = min(H, q[:, 1].max() + PAD)
    a = poly_mask(quad, GROW, FEATHER)[y0:y1, x0:x1]
    crop = img[y0:y1, x0:x1]
    # mild pre-sharpen against the cover fit's upscale on large displays
    crop = cv2.addWeighted(crop, 1.42,
                           cv2.GaussianBlur(crop, (0, 0), 1.1), -0.42, 0)
    out = np.dstack([crop, a])
    cv2.imwrite(os.path.join(OUT, f"c{i:02d}_{name}.png"), out)
    meta["cards"].append({
        "name": name, "box": [int(x0), int(y0), int(x1 - x0), int(y1 - y0)],
        "depth": depth,
    })

# ---- the plate -------------------------------------------------------------
# Everything lifted out — the man, his smoke, the five glass cards, the
# typography — sits on smooth volumetric fog. Structure-following inpainting
# drags bright shapes around; what the fog wants is DIFFUSION: pull colour in
# from the unmasked surroundings at several scales, coarse to fine. The glow
# band diffuses straight across the man's column, the fog closes over the
# cards, and nothing invents structure that was never there.
plate = img.copy()

remove = np.maximum(poly_mask(MAN, 8, 17), poly_mask(SMOKE, 8, 17))
for name, quad, depth in CARDS:
    remove = np.maximum(remove, poly_mask(quad, 20, 9))
for lx0, ly0, lx1, ly1 in LABELS:
    remove[ly0:ly1, lx0:lx1] = 255
remove = cv2.dilate(remove, np.ones((7, 7), np.uint8))

m = (remove.astype(np.float32) / 255.0)
out = plate.astype(np.float32)
keep = (1.0 - m)[..., None]


def nconv(sig):
    # normalised convolution: the weighted mean of UNMASKED neighbours — the
    # ratio is scale-free, so even pixels deep inside the mask get the fog's
    # local average rather than dimming toward black
    w = cv2.GaussianBlur(1.0 - m, (0, 0), sig)
    v = cv2.GaussianBlur(out * keep, (0, 0), sig)
    return v / np.maximum(w, 1e-4)[..., None], w


coarse, _wc = nconv(75)
fine, wf = nconv(17)
# near the mask edge the fine estimate is well-supported and keeps local
# texture; deep inside only the coarse one is meaningful
blend = np.clip(wf * 8.0, 0.0, 1.0)[..., None]
diff = fine * blend + coarse * (1.0 - blend)
out = out * keep + diff * m[..., None]
noise = np.random.default_rng(9).normal(0, 2.0, out.shape).astype(np.float32)
plate = np.clip(out + noise * m[..., None], 0, 255).astype(np.uint8)

cv2.imwrite(os.path.join(OUT, "plate.jpg"), plate,
            [cv2.IMWRITE_JPEG_QUALITY, 88])

with open(os.path.join(OUT, "layout5.json"), "w") as f:
    json.dump(meta, f, indent=1)

sizes = {f: os.path.getsize(os.path.join(OUT, f)) // 1024
         for f in sorted(os.listdir(OUT))}
print(json.dumps(sizes, indent=0))
print("total KB:", sum(sizes.values()))
