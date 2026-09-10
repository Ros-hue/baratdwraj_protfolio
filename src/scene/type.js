// Renders B.BHARADWAJ into a single coverage texture and reports the ink rectangle
// of every individual letter.
//
// Why a texture and not DOM text: the two people who live inside the letterforms
// have to be clipped by the real type. Sharing one atlas means the clip
// mask and the visible letter are the same pixels, so they can never drift apart
// by even a subpixel, at any size or device pixel ratio.
//
// The reference artwork is set in a compressed heavy grotesque. Anton is the
// closest widely available face but is naturally wider, so a single horizontal
// scale is solved for at runtime to hit the reference's measured
// word-width : cap-height ratio. One uniform scale keeps the letterforms
// consistent with each other; per-letter fitting would distort the I into a slab
// while squeezing the E, which is what makes lettering look counterfeit.

const TEXT = 'B.BHARADWAJ';

// measured from the supplied hero artwork: ink width / cap height
export const TARGET_RATIO = 3.121;

function ctx2d(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c.getContext('2d', { willReadFrequently: false });
}

function metricsFor(ctx, ch) {
  const m = ctx.measureText(ch);
  return {
    advance: m.width,
    left: m.actualBoundingBoxLeft,
    right: m.actualBoundingBoxRight,
    ascent: m.actualBoundingBoxAscent,
    descent: m.actualBoundingBoxDescent,
  };
}

/**
 * @param {number} capHeightPx desired cap height in device pixels
 * @param {number} maxTexture  gl.MAX_TEXTURE_SIZE
 */
export function buildWord(capHeightPx, maxTexture = 4096) {
  const probe = 400;
  let c = ctx2d(8, 8);
  c.font = `${probe}px Anton, "Arial Narrow", Impact, sans-serif`;
  c.textBaseline = 'alphabetic';

  // solve font size so the cap height lands exactly where we want it
  const capAt = metricsFor(c, 'H').ascent || probe * 0.72;
  let size = (capHeightPx / capAt) * probe;

  // Natural ink extent at that size, with a touch of negative tracking to match
  // the tightly packed reference setting. Ink extent is NOT the sum of advances:
  // side bearings and overhangs mean the painted edges sit inside (or outside)
  // the advance box, so the pen is walked and the real painted extremes taken.
  c.font = `${size}px Anton, "Arial Narrow", Impact, sans-serif`;
  const tracking = -0.012 * capHeightPx;
  const per = [...TEXT].map((ch) => metricsFor(c, ch));

  let pen = 0;
  let natL = Infinity;
  let natR = -Infinity;
  const walk = per.map((m, i) => {
    const at = pen;
    natL = Math.min(natL, at - m.left);
    natR = Math.max(natR, at + m.right);
    pen += m.advance + tracking;
    return { char: TEXT[i], pen: at, m };
  });
  const naturalInk = natR - natL;

  const scaleX = (TARGET_RATIO * capHeightPx) / naturalInk;

  // lay the letters out in scaled space
  const pad = Math.ceil(capHeightPx * 0.06);
  const raw = walk.map((r) => ({
    char: r.char,
    penX: r.pen * scaleX,
    x0: (r.pen - r.m.left) * scaleX,
    x1: (r.pen + r.m.right) * scaleX,
    m: r.m,
  }));
  const inkL = natL * scaleX;
  const inkR = natR * scaleX;
  const descent = Math.max(0, ...per.map((m) => m.descent));

  let W = Math.ceil(inkR - inkL) + pad * 2;
  let H = Math.ceil(capHeightPx + descent) + pad * 2;

  // stay inside the GPU limit; the whole composition scales down together
  let fit = 1;
  if (W > maxTexture) fit = maxTexture / W;
  if (H * fit > maxTexture) fit = maxTexture / H;
  if (fit < 1) {
    size *= fit;
    W = Math.floor(W * fit);
    H = Math.floor(H * fit);
  }

  const g = ctx2d(W, H);
  g.font = `${size}px Anton, "Arial Narrow", Impact, sans-serif`;
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff';
  g.setTransform(scaleX * fit, 0, 0, fit, (-inkL * fit) + pad, capHeightPx * fit + pad);

  const letters = raw.map((r) => {
    g.fillText(r.char, r.penX / scaleX, 0);
    const x = (r.x0 - inkL) * fit + pad;
    const w = (r.x1 - r.x0) * fit;
    return {
      char: r.char,
      x,
      y: pad + (capHeightPx - r.m.ascent) * fit,
      w,
      h: r.m.ascent * fit,
    };
  });
  g.setTransform(1, 0, 0, 1, 0, 0);

  return {
    canvas: g.canvas,
    width: W,
    height: H,
    pad,
    fit,
    // ink box of the whole word inside the canvas
    ink: { x: pad, y: pad, w: (inkR - inkL) * fit, h: capHeightPx * fit },
    letters: letters.map((l) => ({
      ...l,
      u0: l.x / W,
      v0: l.y / H,
      u1: (l.x + l.w) / W,
      v1: (l.y + l.h) / H,
    })),
  };
}

export async function fontsReady() {
  if (!document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load('400 200px Anton'),
      document.fonts.load('700 40px Oswald'),
      document.fonts.load('400 40px Oswald'),
    ]);
    await document.fonts.ready;
  } catch { /* fall back to the stack in the font shorthand */ }
}
