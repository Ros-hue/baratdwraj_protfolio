// The second scene's opening.
//
// The brief's central demand is that the tools do NOT arrive one by one. So
// there is no per-card stagger anywhere in here: `mat` is a single scalar every
// card reads, which is what makes the materialisation land as one event rather
// than as twelve fades. The only per-card variation is in HOW each one travels
// once it already exists, which reads as choreography instead of as a queue.
//
//   0.0  near-dark. a breath of red, a few embers, the ring barely there
//   1.1  energy gathers: embers converge, the ring wakes, the ribbon starts
//   2.5  ALL TWELVE CARDS MATERIALISE AT ONCE, low and blurred
//   3.1  the whole group rises from the bottom toward its positions
//   4.9  it overshoots and corrects — the scene has weight
//   5.5  a held beat, completely still
//   6.0  floating begins; the ribbon and ring come fully alive
//   7.4  interactive

import { clamp, span, lerp, smoothstep, easeOutCubic, easeOutExpo } from '../lib/ease.js';

export const T2 = {
  wake: 0.20,
  gather: 1.10,
  materialise: 2.50,
  matDur: 0.72,
  rise: 3.10,
  riseDur: 1.85,
  settle: 4.90,
  settleDur: 0.60,
  hold: 5.50,
  floatOn: 6.00,
  alive: 7.40,
};

export function sample2(t) {
  // --- atmosphere ---------------------------------------------------------
  const wake = smoothstep(0, 1, span(t, T2.wake, T2.wake + 2.2));
  const gather = smoothstep(0, 1, span(t, T2.gather, T2.gather + 1.5));

  // --- the one shared materialisation value -------------------------------
  const mp = span(t, T2.materialise, T2.materialise + T2.matDur);
  const mat = easeOutCubic(mp);

  // --- group rise ---------------------------------------------------------
  const rise = easeOutExpo(span(t, T2.rise, T2.rise + T2.riseDur));

  // --- settle: one damped correction, not a bounce ------------------------
  const sp = span(t, T2.settle, T2.settle + T2.settleDur);
  const settle = sp > 0 && sp < 1 ? Math.sin(sp * Math.PI) * (1 - sp) : 0;

  // --- float is gated behind the held beat --------------------------------
  const float = smoothstep(0, 1, span(t, T2.floatOn, T2.floatOn + 1.6));

  // --- ribbon draws itself, then keeps flowing ----------------------------
  const ribbonDraw = smoothstep(0, 1, span(t, T2.gather + 0.2, T2.rise + 1.4));
  const ribbonLife = smoothstep(0, 1, span(t, T2.floatOn - 0.6, T2.alive));

  // the ring is the core of the universe: awake early, fully alive at the end
  const ring = lerp(0.10, 1.0, smoothstep(0, 1, span(t, T2.wake, T2.alive)));

  // a single flash of energy at the instant the cards appear
  const burst = mp > 0 && mp < 1 ? Math.sin(mp * Math.PI) ** 2 : 0;

  return {
    wake,
    gather,
    mat,
    rise,
    settle,
    float,
    ribbonDraw,
    ribbonLife,
    ring,
    burst,
    // embers rush inward while energy gathers, then drift freely
    converge: clamp(gather - smoothstep(0, 1, span(t, T2.materialise, T2.rise))),
    grain: lerp(0.085, 0.040, smoothstep(0, 1, span(t, 0.3, T2.floatOn))),
    interactive: t >= T2.alive,
    progress: clamp(t / T2.alive),
  };
}
