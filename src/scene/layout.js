// Composition geometry.
//
// Every constant here was measured off the supplied hero artwork rather than
// eyeballed, so the live page keeps the reference's proportions exactly:
//   B.BHARADWAJ ink box   x 3.31% .. 96.75%,  cap top 27.00%, baseline 80.22%
//   WELCOME strip     centred, y 20.44%
//   LEGEND chip       x 88.12%, y 26.78%, 10.38% x 4.22%
//   ARTIST chip       x  1.50%, y 68.78%, 15.00% x 3.67%
// The word is then fitted to whatever viewport it lands in without ever
// changing its own width : cap-height ratio.

import { TARGET_RATIO } from './type.js';

export const REF = {
  wordWidth: 0.9344,     // fraction of viewport width
  capHeight: 0.5320,     // fraction of viewport height
  vCentre: 0.5361,       // vertical centre of the cap box
  legend: { x: 0.8812, y: 0.2678, h: 0.0422 },
  artist: { x: 0.0150, y: 0.6878, h: 0.0367 },
  dotsBR: { x: 0.9844, y: 0.9500 },
  arrows: { left: 0.0181, right: 0.9750, top: 0.345, bottom: 0.625, count: 5 },
};

export function computeLayout(w, h) {
  const portrait = h / w > 1.05;
  const narrow = w < 760;

  // fit the word by whichever axis binds first, preserving its proportions
  const byWidth = (REF.wordWidth * w) / TARGET_RATIO;
  const byHeight = REF.capHeight * h;
  let capH = Math.min(byWidth, byHeight);

  // On a phone the word is width-bound and ends up short, leaving a dead band of
  // empty screen. Letting it grow taller there keeps the composition dense
  // instead of stranding the type in the middle of nowhere.
  if (portrait) capH = Math.min(byWidth * 1.0, h * 0.30);

  const wordW = capH * TARGET_RATIO;
  const cx = w * 0.5;
  const vCentre = portrait ? h * 0.50 : h * REF.vCentre;
  const capTop = vCentre - capH * 0.5;
  const baseline = vCentre + capH * 0.5;

  const word = {
    x: cx - wordW * 0.5,
    y: capTop,
    w: wordW,
    h: capH,
    capH,
    baseline,
  };

  // The figure stands BEHIND the wordmark, so he is sized to break out of it at
  // both ends: head and shoulders clear the cap line, legs continue below the
  // baseline, and the rest of him is glimpsed through the counters. Sized only
  // to the cap height he would be swallowed whole by the letters.
  let heroH = capH * 1.35;
  let feet = baseline + capH * 0.22;

  if (portrait) {
    // on a phone the word is width-bound and short, so tying the man to it would
    // shrink him to a bystander; he is scaled to the viewport instead and the
    // wordmark crosses his torso
    heroH = h * 0.54;
    feet = h * 0.885;
  }

  return {
    w,
    h,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
    portrait,
    narrow,
    word,
    hero: { h: heroH, cx, feet },
    // clear of the header band and clear of his head; it renders in front of
    // the typography, so it stays readable wherever it lands
    welcomeY: portrait ? (feet - heroH) - h * 0.075 : h * 0.175,
    legend: portrait
      ? { x: w * 0.955, y: capTop - h * 0.052, h: 20, alignRight: true }
      : { x: w * REF.legend.x, y: h * REF.legend.y,
          h: Math.max(18, h * REF.legend.h) },
    artist: portrait
      ? { x: w * 0.045, y: baseline + h * 0.055, h: 19 }
      : { x: w * REF.artist.x, y: h * REF.artist.y,
          h: Math.max(16, h * REF.artist.h) },
    ember: { x: 0.5, y: vCentre / h },
  };
}

/**
 * Place a clip so the SUBJECT (not the video rectangle) lands where we want.
 * The tracks baked into the manifest give the subject's box per frame, so a
 * figure can be anchored by his feet and held at a chosen height even though he
 * walks toward the camera and grows through the shot.
 */
export function fitSubject(track, frameAspect, opts) {
  const [x0, y0, x1, y1] = track;
  const subH = Math.max(y1 - y0, 1e-3);
  const subCX = (x0 + x1) * 0.5;

  const quadH = opts.height / subH;          // video height needed
  const quadW = quadH * frameAspect;

  const footY = opts.feet !== undefined ? opts.feet : opts.top + opts.height;
  return {
    x: opts.cx - quadW * subCX,
    y: footY - quadH * y1,
    w: quadW,
    h: quadH,
  };
}
