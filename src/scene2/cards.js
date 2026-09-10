// The twelve tool cards.
//
// Nothing here is invented: each card's centre, apparent width and aspect were
// measured off the supplied reference artwork. Depth is then INFERRED from
// apparent size — a card drawn large in the poster is a card near the camera —
// and the world position is solved so that the perspective projection puts it
// back exactly where the poster had it.
//
// Solving it rather than eyeballing world coordinates matters for two reasons:
// the reconstruction is faithful at ANY viewport aspect (the composition
// re-fits instead of cropping), and the depths are physically consistent, so
// pointer parallax and the camera dolly come out right for free.

// name, centre x/y (fraction of the reference frame), apparent width, aspect
const REF = [
  ['photoshop', 0.320, 0.107, 0.180, 1.37],
  ['figma', 0.170, 0.377, 0.142, 0.89],
  ['aftereffects', 0.352, 0.397, 0.081, 1.14],
  ['premiere', 0.305, 0.513, 0.069, 0.99],
  ['notion', 0.251, 0.641, 0.091, 0.98],
  ['lightroom', 0.395, 0.644, 0.070, 1.02],
  ['claude', 0.666, 0.169, 0.140, 0.82],
  ['chatgpt', 0.686, 0.469, 0.097, 1.25],
  ['midjourney', 0.832, 0.386, 0.097, 1.04],
  ['spline', 0.781, 0.575, 0.105, 1.81],
  ['framer', 0.604, 0.609, 0.079, 1.02],
  ['webflow', 0.685, 0.709, 0.085, 1.05],
];

// the largest card in the poster is taken as the near plane
const NEAREST = 0.185;

let seedState = 1;
function rnd() {
  seedState = (seedState * 1664525 + 1013904223) % 4294967296;
  return seedState / 4294967296;
}

export function buildCards() {
  seedState = 7;
  return REF.map(([name, rx, ry, rw, aspect], i) => ({
    name,
    i,
    ref: { rx, ry, rw, aspect },
    // filled in by layoutCards() once the viewport is known
    home: [0, 0, 0],
    size: [1, 1],
    // a card facing dead-on reads as a sticker; each turns slightly toward the
    // centre of the room, as they do in the reference
    rest: [
      (0.5 - ry) * 0.34 + (rnd() - 0.5) * 0.07,
      (0.5 - rx) * 0.58 + (rnd() - 0.5) * 0.07,
      (rnd() - 0.5) * 0.10,
    ],
    // every card floats to its own rhythm, or they pulse as one organism
    phase: rnd() * Math.PI * 2,
    speed: 0.55 + rnd() * 0.45,
    bobY: 0.05 + rnd() * 0.05,
    bobX: 0.018 + rnd() * 0.026,
    swing: 0.026 + rnd() * 0.028,
    launch: 0.85 + rnd() * 0.5,     // multiplier on the group's rise distance
    spin: (rnd() - 0.5) * 0.5,
    hover: 0,
    screen: null,
  }));
}

/**
 * Solve world position and size so the perspective projection reproduces the
 * reference composition.
 *
 * With the camera on +z looking toward the origin, a point at distance d
 * projects to ndc = p / (d * tan(fov/2) * aspect). Choosing d so that
 * camZ / d equals the card's apparent-size ratio makes the depths agree with
 * the poster; x and y then follow directly from the measured centre.
 */
export function layoutCards(cards, aspect, fovY, camZ, opts = {}) {
  const tanH = Math.tan(fovY / 2);
  const spread = opts.spread ?? 1;
  const lift = opts.lift ?? 1;
  const sizeMul = opts.sizeMul ?? 1;

  for (const c of cards) {
    const { rx, ry, rw } = c.ref;
    const f = rw / NEAREST;              // 1 = nearest card, smaller = further
    const dist = camZ / f;
    const z = camZ - dist;

    const ndcX = (rx - 0.5) * 2 * spread;
    const ndcY = -(ry - 0.5) * 2 * lift;

    c.home = [
      ndcX * tanH * aspect * dist,
      ndcY * tanH * dist,
      z,
    ];
    // world size chosen so the projected width matches the measured one
    const halfW = rw * sizeMul * tanH * aspect * dist;
    c.size = [halfW * 2, (halfW * 2) / c.ref.aspect];
    c.dist = dist;
  }
  return cards;
}

/** Where the figure stands, solved the same way. */
export function layoutFigure(aspect, fovY, camZ, refH = 0.60, refY = 0.60,
  apparent = 0.62) {
  const tanH = Math.tan(fovY / 2);
  const dist = camZ / apparent;
  return {
    z: camZ - dist,
    y: -(refY - 0.5) * 2 * tanH * dist,
    halfH: refH * tanH * dist,
    dist,
  };
}

/**
 * Pose a card for the current frame.
 *
 * `mat` is materialisation (0..1 — every card reads the SAME value, which is
 * what makes them arrive as one event), `rise` is the group's bottom-to-top
 * travel, `settle` drives the overshoot-and-correct, and `float` gates the idle
 * drift so nothing breathes until the whole group has come to rest.
 */
export function poseCard(c, t, s, pointer) {
  const [hx, hy, hz] = c.home;

  // --- rise: one shared journey, with small per-card variation -------------
  const lag = 1 - s.rise;
  // Scaled by distance so the SCREEN travel is the same for near and far cards
  // - the group has to read as one move. Kept short enough that they are still
  // on stage when they materialise; drop them further and the moment the brief
  // cares about most happens below the bottom edge.
  const drop = c.dist * 0.28 * c.launch;
  const y = hy - drop * lag * lag;

  // --- settle: a single damped correction, not a bounce --------------------
  const over = s.settle * c.dist * 0.030 * c.launch;

  // --- idle float, only once the group has settled -------------------------
  const p = t * c.speed + c.phase;
  const scale = c.dist * 0.09;
  const fy = Math.sin(p) * c.bobY * scale * s.float;
  const fx = Math.cos(p * 0.78 + 1.1) * c.bobX * scale * s.float;
  const fz = Math.sin(p * 0.51 + 2.2) * 0.10 * s.float;

  // --- pointer parallax: nearer cards react more, as they would in life ----
  const near = camNear(c.dist);
  const px = pointer.x * 0.55 * near * s.float;
  const py = -pointer.y * 0.34 * near * s.float;

  const pos = [
    hx + fx + px,
    y + fy + over + py,
    hz + fz + c.hover * 0.18,
  ];

  const rot = [
    c.rest[0] + Math.sin(p * 0.63) * c.swing * s.float
      - pointer.y * 0.07 * near + c.hover * 0.06,
    c.rest[1] + Math.cos(p * 0.55 + 0.7) * c.swing * s.float
      + pointer.x * 0.10 * near - c.hover * 0.07,
    c.rest[2] + c.spin * lag,
  ];

  // materialising cards arrive slightly small, so the group lands with a push
  const grow = (0.88 + 0.12 * s.mat) * (1 + c.hover * 0.04);
  return { pos, rot, scale: [c.size[0] * grow, c.size[1] * grow] };
}

function camNear(dist) {
  return Math.min(1.6, 8.2 / Math.max(dist, 1));
}
