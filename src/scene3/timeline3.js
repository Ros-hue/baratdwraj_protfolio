// The time machine's opening.
//
//   0.0  dark
//   0.3  the room warms — ambient light finds the floor
//   1.0  the timeline rail draws itself, 2021 forward
//   1.9  the clock dial resolves and the hand sweeps in from the far side
//   2.6  the year cards arrive
//   3.5  the figure appears
//   4.0  the floor mechanism engages and begins turning
//   4.5  energy starts running along the rail
//   5.4  settled — the visitor takes control of time
//
// The cards DO stagger here, left to right, unlike scene two where they were
// required to land as one event. A timeline is a sequence by nature, and letting
// 2021 exist a beat before 2026 is the cheapest way to say so.

import { clamp, span, lerp, smoothstep, easeOutCubic, easeOutExpo } from '../lib/ease.js';

export const T3 = {
  warm: 0.25,
  rail: 0.80,
  railDur: 1.30,
  clock: 1.50,
  clockDur: 1.15,
  cards: 2.05,
  cardStagger: 0.11,
  cardDur: 0.75,
  figure: 2.75,
  rings: 3.15,
  energy: 3.50,
  live: 4.20,
};

export function sample3(t, n = 6) {
  const wake = smoothstep(0, 1, span(t, T3.warm, T3.warm + 1.8));
  const rail = easeOutCubic(span(t, T3.rail, T3.rail + T3.railDur));
  const clock = easeOutExpo(span(t, T3.clock, T3.clock + T3.clockDur));

  const cards = [];
  const nodes = [];
  for (let i = 0; i < n; i++) {
    const t0 = T3.cards + i * T3.cardStagger;
    cards.push(easeOutCubic(span(t, t0, t0 + T3.cardDur)));
    // a node lights just before its card lands, so the card feels hung on it
    nodes.push(easeOutCubic(span(t, t0 - 0.22, t0 + 0.35)));
  }

  const figure = smoothstep(0, 1, span(t, T3.figure, T3.figure + 1.3));
  const rings = smoothstep(0, 1, span(t, T3.rings, T3.rings + 1.6));
  const energy = smoothstep(0, 1, span(t, T3.energy, T3.energy + 1.4));

  return {
    wake,
    rail,
    clock,
    cards,
    nodes,
    figure,
    rings,
    energy,
    // during the intro the hand sweeps to 2026 and settles there; afterwards
    // the pointer owns it
    introU: lerp(0, 5, easeOutExpo(span(t, T3.clock + 0.3, T3.clock + 2.4))),
    handAuthority: 1 - smoothstep(0, 1, span(t, T3.live - 0.6, T3.live + 0.4)),
    grain: lerp(0.075, 0.036, smoothstep(0, 1, span(t, 0.4, T3.rings))),
    live: t >= T3.live,
    progress: clamp(t / T3.live),
  };
}
