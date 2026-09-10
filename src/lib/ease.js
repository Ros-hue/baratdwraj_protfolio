export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

export const lerp = (a, b, t) => a + (b - a) * t;

/** Normalised progress of `t` across [a,b]. */
export const span = (t, a, b) => clamp((t - a) / (b - a));

export const easeOutCubic = (t) => 1 - (1 - t) ** 3;
export const easeInCubic = (t) => t * t * t;
export const easeInOutCubic = (t) =>
  (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Strong deceleration - the workhorse for elements settling into place. */
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

export const easeOutQuint = (t) => 1 - (1 - t) ** 5;

/** Overshoots then settles; used for the drop-in of WELCOME TO MY WORLD. */
export function easeOutBack(t, k = 1.42) {
  const c = k + 1;
  return 1 + c * (t - 1) ** 3 + k * (t - 1) ** 2;
}

/** Damped spring, for elements that arrive with weight and bounce once. */
export function easeOutSpring(t, damp = 5.2, freq = 7.2) {
  if (t >= 1) return 1;
  return 1 - Math.exp(-damp * t) * Math.cos(freq * t);
}

export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent approach toward a target. */
export const damp = (cur, target, lambda, dt) =>
  lerp(cur, target, 1 - Math.exp(-lambda * dt));
