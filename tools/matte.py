"""
matte.py - offline background removal for the B.BHARADWAJ hero videos.

Studio white-cyclorama footage -> per-pixel alpha matte -> "packed alpha" video
(colour on the left half, matte on the right half of a double-width frame).

The packed layout is decoded by the WebGL compositor at runtime, which gives us
true per-pixel transparency in EVERY browser (plain H.264), instead of relying
on WebM/VP9 alpha, which Safari does not support.

Pipeline per frame
  1  edge-preserving denoise
  2  background plate estimate (quadratic surface fit on the border ring, so the
     cyclorama light falloff is modelled instead of assumed flat)
  3  distance to plate in Lab -> soft alpha
  4  border-seeded flood fill => "background connected to the frame edge".
     This is what saves video 2 WHITE SNEAKERS: they are colour-identical to the
     backdrop, but they are not connected to it, so they survive.
  5  largest-component keep + hole fill
  6  guided-filter refine against the colour frame (recovers hair detail)
  7  temporal EMA to remove matte flicker
  8  spill suppression on the rim
"""

import argparse
import json
import os
import subprocess

import cv2
import numpy as np


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def smoothstep(lo, hi, x):
    t = np.clip((x - lo) / max(hi - lo, 1e-6), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def fit_bg_plate(L, ring, order=2):
    """Least-squares quadratic surface through the border-ring luminance."""
    h, w = L.shape
    ys, xs = np.nonzero(ring)
    if len(ys) < 64:
        return np.full((h, w), float(np.median(L)), np.float32)
    if len(ys) > 20000:
        idx = np.random.default_rng(7).choice(len(ys), 20000, replace=False)
        ys, xs = ys[idx], xs[idx]
    x = xs / w
    y = ys / h
    if order == 2:
        cols = [np.ones_like(x), x, y, x * x, x * y, y * y]
    else:
        cols = [np.ones_like(x), x, y]
    A = np.stack(cols, 1).astype(np.float64)
    z = L[ys, xs].astype(np.float64)
    coef, *_ = np.linalg.lstsq(A, z, rcond=None)

    gy, gx = np.mgrid[0:h, 0:w]
    gx = gx / w
    gy = gy / h
    if order == 2:
        basis = [np.ones_like(gx), gx, gy, gx * gx, gx * gy, gy * gy]
    else:
        basis = [np.ones_like(gx), gx, gy]
    plate = sum(c * b for c, b in zip(coef, basis))
    return plate.astype(np.float32)


def border_ring(shape, px):
    h, w = shape
    m = np.zeros((h, w), np.uint8)
    m[:px, :] = 1
    m[-px:, :] = 1
    m[:, :px] = 1
    m[:, -px:] = 1
    return m


def keep_border_connected(mask_bg, seed_edges="ltrb"):
    """Keep only background blobs that touch a chosen frame edge."""
    n, lab, _stats, _c = cv2.connectedComponentsWithStats(mask_bg, 8)
    if n <= 1:
        return mask_bg
    touching = set()
    if "t" in seed_edges:
        touching |= set(np.unique(lab[0, :]).tolist())
    if "b" in seed_edges:
        touching |= set(np.unique(lab[-1, :]).tolist())
    if "l" in seed_edges:
        touching |= set(np.unique(lab[:, 0]).tolist())
    if "r" in seed_edges:
        touching |= set(np.unique(lab[:, -1]).tolist())
    touching.discard(0)
    if not touching:
        return np.zeros_like(mask_bg)
    return np.isin(lab, list(touching)).astype(np.uint8)


def largest_component(mask_fg, min_frac=0.004):
    n, lab, stats, _c = cv2.connectedComponentsWithStats(mask_fg, 8)
    if n <= 1:
        return mask_fg
    areas = stats[1:, cv2.CC_STAT_AREA]
    keep = 1 + int(np.argmax(areas))
    total = mask_fg.size
    ids = [keep] + [i + 1 for i, a in enumerate(areas)
                    if (i + 1) != keep and a > total * min_frac]
    return np.isin(lab, ids).astype(np.uint8)


def fill_holes(mask, min_area=0):
    """Flood from the border on the inverse; anything unreached is a hole.

    Only holes of at least ``min_area`` are filled. That distinction matters: the
    big enclosed region of a white sneaker must be filled, but the small gaps
    between strands of hair must stay transparent - filling those is what pastes
    backdrop-white flecks through the curls.
    """
    h, w = mask.shape
    inv = (1 - mask).astype(np.uint8)
    ff = inv.copy()
    guard = np.zeros((h + 2, w + 2), np.uint8)
    for sx, sy in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        if ff[sy, sx] == 1:
            cv2.floodFill(ff, guard, (sx, sy), 2)
    holes = ((inv == 1) & (ff != 2)).astype(np.uint8)
    if min_area > 0 and holes.any():
        n, lab, stats, _c = cv2.connectedComponentsWithStats(holes, 8)
        keep = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= min_area]
        holes = np.isin(lab, keep).astype(np.uint8) if keep else np.zeros_like(holes)
    return (mask.astype(bool) | holes.astype(bool)).astype(np.uint8)


def drop_small(mask, min_area):
    """Remove connected components below ``min_area``."""
    if min_area <= 0 or not mask.any():
        return mask
    n, lab, stats, _c = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    keep = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= min_area]
    return (np.isin(lab, keep).astype(np.uint8) if keep
            else np.zeros_like(mask, np.uint8))


# --------------------------------------------------------------------------- #
# core
# --------------------------------------------------------------------------- #

def frame_alpha(bgr, cfg):
    h, w = bgr.shape[:2]
    sm = cv2.bilateralFilter(bgr, 5, 28, 7)
    lab = cv2.cvtColor(sm, cv2.COLOR_BGR2LAB).astype(np.float32)
    L = lab[:, :, 0]
    A = lab[:, :, 1] - 128.0
    B = lab[:, :, 2] - 128.0

    ring = border_ring((h, w), cfg["ring"])
    ring_ok = ring.copy()
    ring_ok[L < cfg["ring_min_L"]] = 0          # subject may touch the frame edge
    plate = fit_bg_plate(L, ring_ok)
    has_ring = ring_ok.any()
    aR = float(np.median(A[ring_ok > 0])) if has_ring else 0.0
    bR = float(np.median(B[ring_ok > 0])) if has_ring else 0.0

    # lum_sign +1: subject darker than backdrop (cyclorama); -1: brighter
    # (a black studio void, where the suit and the smoke are the light)
    if cfg.get("lum_sign", 1) >= 0:
        dL = np.maximum(plate - L, 0.0)
    else:
        dL = np.maximum(L - plate, 0.0)
    dC = np.sqrt((A - aR) ** 2 + (B - bR) ** 2)        # tinted vs neutral backdrop
    dist = dL * cfg["w_lum"] + dC * cfg["w_chroma"]

    soft = smoothstep(cfg["lo"], cfg["hi"], dist).astype(np.float32)
    bg_bgr = cv2.cvtColor(
        cv2.merge([np.clip(plate, 0, 255),
                   np.full_like(plate, aR + 128.0),
                   np.full_like(plate, bR + 128.0)]).astype(np.uint8),
        cv2.COLOR_LAB2BGR).astype(np.float32)

    # --- connectivity ------------------------------------------------------ #
    bg_bin = (dist < cfg["bg_thr"]).astype(np.uint8)
    if cfg["edge_barrier"] > 0:
        gx = cv2.Sobel(L, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(L, cv2.CV_32F, 0, 1, ksize=3)
        grad = cv2.magnitude(gx, gy)
        bg_bin[grad > cfg["edge_barrier"]] = 0
    bg_bin = cv2.morphologyEx(bg_bin, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    reachable = keep_border_connected(bg_bin, cfg["seed_edges"])
    reachable = cv2.morphologyEx(reachable, cv2.MORPH_CLOSE,
                                 np.ones((3, 3), np.uint8)).astype(bool)

    # NB: no morphological CLOSE here. Closing bridges the few-pixel gaps between
    # strands of hair, which promotes backdrop pixels to "definitely subject" and
    # welds bright flecks into the curls. Only speckle noise is removed.
    fg_bin = (dist > cfg["fg_thr"]).astype(np.uint8)
    fg_bin = cv2.morphologyEx(fg_bin, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    fg_bin = largest_component(fg_bin, cfg.get("min_frac", 0.004))

    # Recover light-coloured objects that colour alone cannot separate (video 2
    # wears WHITE sneakers on a white backdrop). They are found as large regions
    # fully ENCLOSED by subject pixels. The closed copy is used only to seal the
    # silhouette for that search; "not classified as background" is deliberately
    # NOT treated as enclosure, otherwise the soft contact shadow on the studio
    # floor gets promoted to solid and renders as a white puddle at the feet.
    if cfg["hole_min"] > 0:
        sealed = cv2.morphologyEx(fg_bin, cv2.MORPH_CLOSE,
                                  np.ones((cfg["seal"], cfg["seal"]), np.uint8))
        holes = (fill_holes(sealed, cfg["hole_min"]).astype(bool)
                 & ~sealed.astype(bool))
        solid = fg_bin.astype(bool) | holes
    else:
        # hole_min = 0 disables recovery entirely. Only turn it on for a subject
        # wearing something the backdrop colour cannot be told apart from. On an
        # all-dark subject it does pure harm: the gap between a bent arm and the
        # torso is enclosed background, and "recovering" it paints a white patch
        # across his hip.
        solid = fg_bin.astype(bool)

    # --- fractional coverage on the silhouette ----------------------------- #
    # A pixel that is half hair and half backdrop must get alpha ~0.5 and keep the
    # HAIR colour. Thresholding it to alpha=1 is what leaves bright backdrop
    # flecks glowing between the curls. Coverage is therefore estimated as how
    # far the pixel travelled from the backdrop towards the nearest subject tone.
    k = np.ones((cfg["est_win"], cfg["est_win"]), np.uint8)
    if cfg.get("lum_sign", 1) >= 0:
        L_fg = cv2.erode(L, k)                   # darkest tone nearby = subject
        a_lum = np.clip((plate - L) / np.maximum(plate - L_fg, 12.0), 0.0, 1.0)
    else:
        L_fg = cv2.dilate(L, k)                  # brightest tone nearby = subject
        a_lum = np.clip((L - plate) / np.maximum(L_fg - plate, 12.0), 0.0, 1.0)
    C_fg = cv2.dilate(dC, k)                     # most saturated tone nearby
    a_chr = np.clip(dC / np.maximum(C_fg, 6.0), 0.0, 1.0)
    ratio = np.maximum(a_lum, a_chr).astype(np.float32)

    # Trimap. The coverage ratio is only meaningful next to an actual subject:
    # evaluated on bare floor it happily reports 0.8 for a scuff mark and paints
    # white puddles around the feet. So it is applied ONLY inside a narrow band
    # around the confident silhouette; everything beyond the band is background.
    r = cfg["band"]
    grown = cv2.dilate(solid.astype(np.uint8),
                       cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                                 (2 * r + 1, 2 * r + 1)))
    unknown = grown.astype(bool) & ~solid
    a = np.zeros_like(ratio)
    a[solid] = 1.0
    a[unknown] = ratio[unknown]
    a[unknown & (dist < cfg["bg_thr"])] = 0.0
    a[reachable & ~solid] = np.minimum(a[reachable & ~solid], ratio[reachable & ~solid])

    # --- edge refine ------------------------------------------------------- #
    # the guide must be normalised to 0..1: with a uint8 guide the local variance
    # is in 0..255^2 units and a small eps makes guidedFilter divide 0/0 across
    # the large flat backdrop, which comes back as NaN.
    guide = (cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0)
    a = cv2.ximgproc.guidedFilter(guide, a.astype(np.float32),
                                  cfg["gf_radius"], cfg["gf_eps"])
    a = np.nan_to_num(a, nan=0.0, posinf=1.0, neginf=0.0)
    a = np.clip(a, 0.0, 1.0)
    a = np.clip((a - cfg["choke"]) / max(1e-6, 1.0 - cfg["choke"]), 0.0, 1.0)
    a = smoothstep(cfg["out_lo"], cfg["out_hi"], a).astype(np.float32)

    # Floor guard. The bottom band of a cyclorama shot holds the glossy-floor
    # reflections and specular smears around the shoes; keyed softly they read
    # as white ghosts under his feet on the site. In that band, faint alpha is
    # crushed while anything solid (the shoes themselves) is left alone.
    fg = cfg.get("floor_guard", 0.0)
    if fg > 0:
        y0 = int(h * (1.0 - fg))
        band = a[y0:, :]
        gate = smoothstep(0.30, 0.72, band)
        depth = np.linspace(0.0, 1.0, band.shape[0], dtype=np.float32)[:, None]
        a[y0:, :] = band * (1.0 - depth * (1.0 - gate))

    # Silhouette solidify (black-void footage). Against true black the suit's
    # deepest folds carry no signal at all, but the OUTLINE always does: close
    # it, fill everything it encloses, and union that solid under the soft
    # alpha. The solid is eroded first so the original soft edge - hair,
    # smoke, rim - always wins at the boundary.
    if cfg.get("solidify", 0) > 0:
        sil = (a > 0.06).astype(np.uint8)
        k = cfg["solidify"]
        sil = cv2.morphologyEx(
            sil, cv2.MORPH_CLOSE,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
        # ONLY the body. The detached smoke plumes must keep their soft,
        # translucent alpha - solidified, thin smoke renders as opaque black
        # shards, because its premultiplied colour is dim by nature.
        n_c, lab_c, stats_c, _cc = cv2.connectedComponentsWithStats(sil, 8)
        if n_c > 1:
            big = 1 + int(np.argmax(stats_c[1:, cv2.CC_STAT_AREA]))
            sil = (lab_c == big).astype(np.uint8)
        # ...and only near the body itself. The corridor is TRACKED (his
        # centre measured from the torso and leg rows, which are never smoke)
        # and SOFT-EDGED: a fixed hard window pops the mask the moment an
        # elbow or a curl of smoke crosses it, which reads as frame-to-frame
        # edge flicker on the site.
        torso = a[int(h * 0.42) : int(h * 0.88), :]
        cols = (torso > 0.5).sum(0).astype(np.float32)
        cx = float((cols * np.arange(w)).sum() / max(cols.sum(), 1.0))
        xs = np.arange(w, dtype=np.float32)[None, :]
        ys = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None]
        halfw = w * (0.085 + 0.085 * np.clip((ys - 0.24) / 0.12, 0.0, 1.0))
        corridor = np.clip(1.0 - (np.abs(xs - cx) - halfw) / (w * 0.05),
                           0.0, 1.0)
        sil = fill_holes(sil)
        # the guard the smoke rescale respects: HIS silhouette grown outward,
        # so the rescale can never eat into his own edge band (the suit's
        # edge pixels are as dark as dark smoke, and biting them leaves wavy
        # holes that play back as a crawling dark outline)
        guard = cv2.GaussianBlur(
            cv2.dilate(sil, cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE, (15, 15))).astype(np.float32),
            (13, 13), 0)
        sil = cv2.erode(sil, cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (5, 5)))
        soft_sil = cv2.GaussianBlur(sil.astype(np.float32), (7, 7), 0)
        body = soft_sil * corridor
        a = np.maximum(a, body * 0.985)

        # Smoke translucency follows its brightness. Thin dark smoke IS
        # mostly transparent; shipped half-opaque it paints grey-black smears
        # over whatever the site composites behind him. Well clear of his
        # body, alpha is rescaled by source luminance: bright wisps keep
        # their presence, the cloud's dark core fades to a breath.
        lum_keep = smoothstep(18.0, 110.0, L) ** 0.9
        outside = np.clip(1.0 - np.maximum(body, guard), 0.0, 1.0)
        a = a * (1.0 - outside + outside * lum_keep)
    return a, bg_bgr


def despill(bgr, a, bg_bgr, cfg):
    """Un-premultiply the backdrop out of partially covered pixels.

    Observed = a*F + (1-a)*B, so the true subject colour is (Observed-(1-a)B)/a.
    Without this the hair edge keeps its milky backdrop tint.
    """
    out = bgr.astype(np.float32)
    if cfg["despill"] <= 0:
        return out
    a3 = a[..., None]
    est = (out - (1.0 - a3) * bg_bgr) / np.maximum(a3, cfg["unmul_floor"])
    est = np.clip(est, 0, 255)
    w = (a < 0.995).astype(np.float32)[..., None] * cfg["despill"]
    return out * (1.0 - w) + est * w


# --------------------------------------------------------------------------- #
# presets
# --------------------------------------------------------------------------- #

PRESETS = {
    # dark suit on bright cyclorama, subject walks toward camera
    "v1": dict(ring=14, ring_min_L=150, w_lum=1.0, w_chroma=1.6, lo=12, hi=46,
               bg_thr=10, fg_thr=52, edge_barrier=0, seed_edges="ltrb",
               band=26, seal=9, hole_min=0, gf_radius=4, gf_eps=1e-4, choke=0.06,
               out_lo=0.14, out_hi=0.96, despill=1.0, unmul_floor=0.22,
               est_win=17, ema=0.55, floor_guard=0.14),
    # black top + CREAM trousers + WHITE sneakers on pure white
    "v2": dict(ring=10, ring_min_L=200, w_lum=1.0, w_chroma=2.6, lo=15, hi=32,
               bg_thr=13, fg_thr=34, edge_barrier=26, seed_edges="ltr",
               band=26, seal=9, hole_min=2500, gf_radius=4, gf_eps=1e-4, choke=0.06,
               out_lo=0.14, out_hi=0.96, despill=1.0, unmul_floor=0.22,
               est_win=17, ema=0.55),
    # dark suit + drifting cigarette smoke on a TRUE BLACK studio void
    # (section 5). The subject is BRIGHTER than the backdrop, and detached
    # smoke plumes must survive as separate soft components (min_frac).
    # hole_min is ON here, unlike the other dark subjects: on a black void
    # the suit's deepest folds fall BELOW every threshold, but they are fully
    # enclosed by his rim-lit outline, and recovered holes fill with his own
    # dark pixels (on white they filled with backdrop, hence the old warning)
    "v5": dict(ring=12, ring_min_L=0, lum_sign=-1, w_lum=1.0, w_chroma=1.4,
               lo=2.5, hi=10, bg_thr=3, fg_thr=6, edge_barrier=0,
               seed_edges="ltrb", band=22, seal=13, hole_min=900,
               min_frac=0.0006, gf_radius=4, gf_eps=1e-4, choke=0.035,
               out_lo=0.10, out_hi=0.97, despill=0.0, unmul_floor=0.22,
               est_win=17, ema=0.55, floor_guard=0.12, solidify=25),
    # all-dark subject, camera pulls back
    "v3": dict(ring=14, ring_min_L=150, w_lum=1.0, w_chroma=1.6, lo=11, hi=42,
               bg_thr=9, fg_thr=48, edge_barrier=0, seed_edges="ltrb",
               band=26, seal=9, hole_min=0, gf_radius=4, gf_eps=1e-4, choke=0.06,
               out_lo=0.14, out_hi=0.96, despill=1.0, unmul_floor=0.22,
               est_win=17, ema=0.55),
}


# --------------------------------------------------------------------------- #
# driver
# --------------------------------------------------------------------------- #

def qa_sheet(shots, path):
    tiles = []
    for _idx, fr, a in shots:
        h, w = a.shape
        yy, xx = np.mgrid[0:h, 0:w]
        checker = (((yy // 24 + xx // 24) % 2) * 55 + 20).astype(np.float32)
        comp = fr.astype(np.float32) * a[..., None] + \
            (1.0 - a[..., None]) * checker[..., None]
        tiles.append(cv2.resize(comp, (260, 462)))
    if tiles:
        cv2.imwrite(path, np.concatenate(tiles, 1).astype(np.uint8))


def process(src, preset, out_w, out_h, outdir, name, trim=None, qa=None,
            fps=24, crf=18, overrides=None):
    cfg = dict(PRESETS[preset])
    cfg.update(overrides or {})
    cap = cv2.VideoCapture(src)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    start, end = trim or (0, total)
    end = min(end, total)

    pw, ph = out_w * 2, out_h
    mp4 = os.path.join(outdir, name + ".mp4")
    webm = os.path.join(outdir, name + ".webm")
    cmd = [
        "ffmpeg", "-v", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", "%dx%d" % (pw, ph),
        "-r", str(fps), "-i", "-",
        "-an", "-c:v", "libx264", "-preset", "slow", "-crf", str(crf),
        "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
        "-color_range", "pc", "-movflags", "+faststart", mp4,
        "-an", "-c:v", "libvpx-vp9", "-crf", "26", "-b:v", "0",
        "-row-mt", "1", "-cpu-used", "3", "-pix_fmt", "yuv420p", webm,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)

    prev = None
    shots = []
    written = 0
    for i in range(end):
        ok, fr = cap.read()
        if not ok:
            break
        if i < start:
            continue
        a, bg_bgr = frame_alpha(fr, cfg)
        if prev is not None:
            # Temporal smoothing must be MOTION-ADAPTIVE. A fixed EMA holds
            # 45% of the previous matte, so a fast-stepping foot drags a ghost
            # of itself (and of the bright floor behind it) across the frame.
            # Where the matte is changing, the current frame wins outright;
            # where it is static, the average still kills flicker.
            w = np.clip(cfg["ema"] + np.abs(a - prev) * 2.5, 0.0, 1.0)
            a = w * a + (1.0 - w) * prev
        prev = a

        col = despill(fr, a, bg_bgr, cfg) * a[..., None]      # premultiplied: no dark fringe
        col = cv2.resize(col, (out_w, out_h), interpolation=cv2.INTER_AREA)
        m = cv2.resize(a, (out_w, out_h), interpolation=cv2.INTER_AREA)
        mat = np.repeat((m * 255.0)[..., None], 3, axis=2)
        packed = np.concatenate([np.clip(col, 0, 255), np.clip(mat, 0, 255)], 1)
        proc.stdin.write(packed.astype(np.uint8).tobytes())
        written += 1

        if qa and i in qa:
            shots.append((i, fr.copy(), a.copy()))

    proc.stdin.close()
    proc.wait()
    cap.release()
    if shots:
        qa_sheet(shots, os.path.join(outdir, "_qa_" + name + ".png"))
    return dict(name=name, frames=written, w=out_w, h=out_h,
                mp4=os.path.basename(mp4), webm=os.path.basename(webm))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--preset", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--w", type=int, required=True)
    ap.add_argument("--h", type=int, required=True)
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--end", type=int, default=10 ** 9)
    ap.add_argument("--qa", default="")
    ap.add_argument("--set", default="", help="k=v,k=v preset overrides")
    args = ap.parse_args()

    qa = set(int(x) for x in args.qa.split(",") if x.strip()) if args.qa else None
    ov = {}
    for kv in filter(None, args.set.split(",")):
        k, v = kv.split("=")
        ov[k.strip()] = float(v) if "." in v or "e" in v.lower() else int(v)
    os.makedirs(args.out, exist_ok=True)
    print(json.dumps(process(args.src, args.preset, args.w, args.h, args.out,
                             args.name, trim=(args.start, args.end), qa=qa,
                             overrides=ov)))


if __name__ == "__main__":
    main()
