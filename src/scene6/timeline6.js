// The closing shot's beats, in seconds from the footer's first sight.
//
//   black -> the red furnace breathes in -> smoke -> the title card rises,
//   dissolves sharp -> the man appears in front, smoking -> the editorial
//   captions settle -> the functional footer row -> stillness, with a pulse.

const T = {
  glow: [0.25, 1.8],
  fog: [0.8, 2.35],
  word: [1.35, 2.75],
  man: [2.1, 3.15],
  caps: [2.8, 3.95],
  bar: [3.6, 4.55],
  live: 4.2,
};

export const T6 = T;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const span = ([a, b], t) => clamp01((t - a) / (b - a));
const ease = (v) => v * v * (3 - 2 * v);

export function sample6(t) {
  return {
    glow: ease(span(T.glow, t)),
    fog: ease(span(T.fog, t)),
    word: span(T.word, t),
    man: ease(span(T.man, t)),
    caps: span(T.caps, t),
    bar: span(T.bar, t),
    live: t >= T.live,
  };
}
