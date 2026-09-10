// The opening sequence.
//
// One clock drives everything, and the beats deliberately OVERLAP: the letters
// are still resolving when the welcome strip drops, the chips are still sliding
// when the people inside the letterforms begin to surface. That overlap is the
// difference between a title sequence and a queue of fades.
//
//   0.0  black
//   0.3  the figure condenses out of the dark and walks in
//   2.1  B.BHARADWAJ materialises, centre letters first, so the type grows around him
//   2.9  WELCOME TO MY WORLD drops from above and overshoots
//   3.2  the chips arrive from the left and the right
//   3.5  arrows and the corner dot grid tick into place
//   4.0  the header draws itself in
//   5.7  settled - ambient life and pointer parallax take over

import {
  clamp, span, lerp, easeOutCubic, easeOutExpo, easeOutQuint, smoothstep,
} from '../lib/ease.js';

export const T = {
  heroIn: 0.30,
  heroInDur: 2.05,
  letters: 2.10,
  letterStagger: 0.145,
  letterDur: 1.65,
  ember: 2.45,
  welcome: 2.90,
  artist: 3.18,
  legend: 3.32,
  arrows: 3.46,
  dots: 3.62,
  header: 4.45,
  settled: 6.25,
};

/** Reveal order: centre outward, so the wordmark grows around the figure. */
export function letterOrder(letters) {
  return letters
    .map((l, i) => ({ i, d: Math.abs((l.u0 + l.u1) / 2 - 0.5) }))
    .sort((a, b) => a.d - b.d)
    .map((x, rank) => ({ i: x.i, rank }))
    .reduce((acc, x) => { acc[x.i] = x.rank; return acc; }, []);
}

export function sample(t, nLetters, order) {
  // ---- hero figure ------------------------------------------------------
  const hp = span(t, T.heroIn, T.heroIn + T.heroInDur);
  const heroEase = easeOutQuint(hp);
  const hero = {
    reveal: hp,                                   // 0..1 dissolve out of black
    opacity: smoothstep(0, 0.35, hp),
    // he arrives from slightly further away and settles into final scale
    scale: lerp(0.885, 1, heroEase),
    dy: lerp(0.045, 0, heroEase),                 // fraction of his height
    shadow: smoothstep(0.25, 0.9, hp),
  };

  // ---- letters ----------------------------------------------------------
  const letters = [];
  for (let i = 0; i < nLetters; i++) {
    const t0 = T.letters + order[i] * T.letterStagger;
    const p = span(t, t0, t0 + T.letterDur);
    const e = easeOutExpo(p);
    letters.push({
      // dissolve resolves slightly ahead of the transform settling
      reveal: span(t, t0, t0 + T.letterDur * 0.82),
      opacity: smoothstep(0, 0.18, p),
      dy: lerp(0.34, 0, e),                       // rises into place
      soften: lerp(1, 0, easeOutCubic(clamp(p * 1.15))),
      edge: smoothstep(0.35, 1, p),
    });
  }

  // ---- atmosphere -------------------------------------------------------
  const ember = smoothstep(0, 1, span(t, T.ember, T.ember + 2.2));
  // a single soft pulse as the wordmark lands: light, not a strobe
  const flash = Math.max(
    0.17 * bell(span(t, T.letters + 0.25, T.letters + 1.25)),
    0.10 * bell(span(t, T.welcome, T.welcome + 0.5)),
  );
  const grain = lerp(0.075, 0.034, smoothstep(0, 1, span(t, 0.2, 3.2)));

  return {
    hero, letters, ember, flash, grain,
    settled: t >= T.settled,
    progress: clamp(t / T.settled),
  };
}

function bell(p) {
  if (p <= 0 || p >= 1) return 0;
  return Math.sin(p * Math.PI) ** 2;
}

/** DOM cues: [time, name]. main.js flips a class on each. */
export const CUES = [
  [T.welcome, 'welcome'],
  [T.artist, 'artist'],
  [T.legend, 'legend'],
  [T.arrows, 'arrows'],
  [T.dots, 'dots'],
  [T.header, 'header'],
  [T.settled, 'settled'],
];
