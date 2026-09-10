// Every beat of the project-universe sequence, in seconds from the moment
// the section is first seen. One clock, sampled — the same discipline as the
// other three scenes, so a beat can be retimed without hunting through code.
//
//   darkness -> the room exhales (plate at ember level)
//   -> the overhead structure flickers alive
//   -> the floor circle ignites and sweeps round
//   -> the cards surface from below, far row first, near flanks last
//   -> the creator rises into the middle of it
//   -> the corner captions type themselves in
//   -> everything breathes, and the pointer owns the depth

const T = {
  wake: [0.0, 0.85],     // black -> faint room
  ring: [0.5, 1.55],     // overhead rim lights, with a strike of flicker
  floor: [0.85, 1.95],   // circle ignition + travelling spark
  deck: [1.25, 3.4],     // the whole card system assembles inside this window
  person: [2.75, 3.85],  // he arrives once his gallery is mostly up
  labels: [3.3, 4.35],   // captions
  live: 4.1,             // floats + pointer authority from here
};

export const T4 = T;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const span = ([a, b], t) => clamp01((t - a) / (b - a));
const ease = (v) => v * v * (3 - 2 * v);

/** Sample the sequence at t seconds. */
export function sample4(t) {
  const wake = ease(span(T.wake, t));
  const ringIn = span(T.ring, t);
  // the rim catches like a struck tube: two dropouts on the way up
  const flicker = ringIn >= 1 ? 1
    : ringIn * (0.55 + 0.45 * Math.abs(Math.sin(ringIn * 21.0)));
  const floor = ease(span(T.floor, t));
  const deck = span(T.deck, t);
  const person = ease(span(T.person, t));
  const labels = span(T.labels, t);
  return {
    wake: 0.30 * wake + 0.70 * ease(deck),   // full brightness rides the deck
    ring: ease(ringIn) * 0.4 + flicker * 0.6,
    floor,
    spark: floor,                             // ignition sweep position 0..1
    deck,
    person,
    labels,
    live: t >= T.live,
    grain: 0.05 + 0.03 * wake,
  };
}

/**
 * Per-card entrance progress. The deck assembles far row first — the small
 * screens surface at the back, then the upper arc, then the near flanks —
 * with a left/right alternation inside each rank so it reads as one
 * installation building itself, not a queue.
 * @param {number} deck   0..1 deck-window progress
 * @param {number} order  the card's position 0..N-1 in far->near order
 * @param {number} n      card count
 */
export function cardIn(deck, order, n) {
  const spread = 0.55;                    // how much of the window the stagger uses
  const start = (order / Math.max(1, n - 1)) * spread;
  const dur = 1 - spread;
  return clamp01((deck - start) / dur);
}

/** Back-out ease with a small overshoot — the pop, then the settle. */
export function popEase(v) {
  const s = 1.35;
  const u = v - 1;
  return 1 + u * u * ((s + 1) * u + s);
}
