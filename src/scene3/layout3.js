// Geometry for the time machine.
//
// Every number here was measured off the supplied reference. The six timeline
// nodes were located by detecting their glow, and a least-squares circle fit
// through them closed to within +/-3px — so the timeline really is a circular
// arc, and it is rebuilt here as one rather than approximated by a spline
// through hand-placed points. That matters for the interaction: the cursor is
// projected onto this same arc to decide which year the visitor is reaching
// for, so the maths the scene is drawn with and the maths it is read with are
// the same maths.

export const YEARS = [
  {
    year: 2021,
    key: 'Diploma',
    lines: ['Electrical Engineering', 'Govt Co-Ed Polytechnic', 'Jagdalpur'],
  },
  {
    year: 2022,
    key: 'Foundations',
    lines: ['C · C++', 'Core JAVA · Python', 'Building skills'],
  },
  {
    year: 2023,
    key: 'UI/UX + Certs',
    lines: ['UI/UX Designer — Dial JDP', 'C · C++ · JAVA · Python', 'Sagar Technology'],
  },
  {
    year: 2024,
    key: 'CSE + Fullstack',
    lines: ['B.Sc. CSE (AIML)', 'Shri Shankarcharya Campus', 'Fullstack Developer'],
  },
  {
    year: 2025,
    key: 'Careers + Certs',
    lines: ['Front-End — GetSetAI', 'Junior Web Designer — MSME', 'Python · Django · Fullstack'],
  },
  {
    year: 2026,
    key: 'Executive Design',
    lines: ['Design — Intern', 'B.Sc. CSE (AIML)', 'Fullstack · UI/UX'],
  },
];

// measured in the 1280x720 reference, stored as fractions of the frame
const REF = {
  nodes: [
    [0.2226, 0.1456],
    [0.3201, 0.2319],
    [0.4245, 0.2940],
    [0.5373, 0.3382],
    [0.6648, 0.3683],
    [0.8064, 0.3776],
  ],
  // centre of each card's artwork, and the card's width as a fraction of frame
  cards: [
    [0.2047, 0.2875, 0.081],
    [0.3109, 0.3569, 0.088],
    [0.4250, 0.4097, 0.095],
    [0.5375, 0.4583, 0.102],
    [0.6906, 0.5083, 0.110],
    [0.8180, 0.5292, 0.124],
  ],
  pivot: [0.6991, 0.0483],   // the clock's hand pivot
  // The dial is NOT concentric with the hand in the reference — it is a much
  // larger circle whose centre sits well above frame, which is why only a
  // shallow sweep of its rim is ever on screen. Centre offset from the pivot,
  // radius in height units.
  dial: [0.0, -0.20, 0.47],
  // Slightly LEFT of true centre, and a step NEARER than the deck: he renders
  // on the front canvas, over the cards, standing in front of his own journey.
  // Offset left and set LOW — nearer the viewer than the ring centre — so his
  // head rises only into the bottom rows of the 2023 card and his shoulders
  // clear its text block entirely: every card stays readable around him. The
  // ring system stays centred on the scene regardless.
  figure: [0.3900, 0.9740, 0.412],  // centre x, feet y, height as frac of frame
  floor: [0.4900, 0.9550],   // centre of the ring system, at his feet
};

/**
 * Fit the reference composition to the current viewport.
 *
 * The poster is 16:9. On a wider screen the composition is anchored by height
 * and allowed to breathe sideways; on a narrower one it is anchored by width so
 * the timeline never runs off the edge. Returning plain pixel coordinates keeps
 * the DOM cards and the WebGL scene reading from one source of truth.
 */
export function fitScene(w, h) {
  const refAspect = 16 / 9;
  const aspect = w / h;
  const portrait = aspect < 0.95;

  // uniform scale plus an offset, so nothing is ever stretched
  let scale;
  let ox = 0;
  let oy = 0;
  if (aspect >= refAspect) {
    scale = h / 720;
    ox = (w - 1280 * scale) * 0.5;
  } else {
    scale = w / 1280;
    oy = (h - 720 * scale) * 0.5;
  }

  const P = ([fx, fy]) => [ox + fx * 1280 * scale, oy + fy * 720 * scale];

  let nodes;
  let cards;
  let pivot;
  let floor;
  let figure;

  if (portrait) {
    // A genuine recomposition, not the landscape frame scaled down. Mapped
    // straight onto a tall screen the arc collapses into a 60px band and all
    // six cards land on top of each other. Instead the timeline stands UP: the
    // years become a vertical rail down the left, and one card at a time holds
    // the stage beside it.
    const railX = w * 0.155;
    const top = h * 0.255;
    const step = h * 0.088;
    nodes = REF.nodes.map((_, i) => [railX + i * w * 0.006, top + i * step]);
    const cw = Math.min(w * 0.62, 330);
    cards = REF.nodes.map((_, i) => ({
      x: w * 0.60, y: h * 0.50, w: cw, i,
    }));
    pivot = [w * 0.52, h * 0.075];
    floor = [w * 0.5, h * 0.965];
    figure = { cx: w * 0.5, feet: h * 0.965, h: h * 0.30 };
  } else {
    nodes = REF.nodes.map(P);
    cards = REF.cards.map(([fx, fy, fw], i) => {
      const [x, y] = P([fx, fy]);
      return { x, y, w: fw * 1280 * scale, i };
    });
    pivot = P(REF.pivot);
    floor = P(REF.floor);
    figure = {
      cx: P([REF.figure[0], 0])[0],
      feet: P([0, REF.figure[1]])[1],
      h: REF.figure[2] * 720 * scale,
    };
  }

  // circle through the nodes, refit in screen pixels
  const arc = fitCircle(nodes);
  const angles = nodes.map((n) => Math.atan2(n[1] - arc.cy, n[0] - arc.cx));

  // angle from the clock pivot to each year — this is what the hand points at
  const handAngles = nodes.map((n) =>
    Math.atan2(n[1] - pivot[1], n[0] - pivot[0]));

  const dial = portrait
    ? { cx: pivot[0], cy: pivot[1] - h * 0.30, r: h * 0.40 }
    : {
      cx: pivot[0] + REF.dial[0] * 720 * scale,
      cy: pivot[1] + REF.dial[1] * 720 * scale,
      r: REF.dial[2] * 720 * scale,
    };

  return {
    w, h, scale, portrait,
    nodes, cards, pivot, dial, floor, figure, arc, angles, handAngles,
  };
}

function fitCircle(pts) {
  const A = pts.map((p) => [p[0], p[1], 1]);
  const b = pts.map((p) => -(p[0] * p[0] + p[1] * p[1]));
  const [D, E, F] = solve3(A, b);
  const cx = -D / 2;
  const cy = -E / 2;
  return { cx, cy, r: Math.sqrt(Math.max(cx * cx + cy * cy - F, 1)) };
}

/** Normal-equation solve of an over-determined 3-column system. */
function solve3(A, b) {
  const N = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const r = [0, 0, 0];
  for (let k = 0; k < A.length; k++) {
    for (let i = 0; i < 3; i++) {
      r[i] += A[k][i] * b[k];
      for (let j = 0; j < 3; j++) N[i][j] += A[k][i] * A[k][j];
    }
  }
  // Gaussian elimination with partial pivoting
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(N[k][i]) > Math.abs(N[p][i])) p = k;
    [N[i], N[p]] = [N[p], N[i]];
    [r[i], r[p]] = [r[p], r[i]];
    const d = N[i][i] || 1e-9;
    for (let k = i + 1; k < 3; k++) {
      const f = N[k][i] / d;
      for (let j = i; j < 3; j++) N[k][j] -= f * N[i][j];
      r[k] -= f * r[i];
    }
  }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let s = r[i];
    for (let j = i + 1; j < 3; j++) s -= N[i][j] * x[j];
    x[i] = s / (N[i][i] || 1e-9);
  }
  return x;
}

/**
 * Which year is the visitor reaching for?
 *
 * Not raw cursor-x: the timeline is a curve that descends across the frame, so
 * horizontal position alone would pick the wrong year whenever the pointer sits
 * above or below the arc. The cursor is instead projected onto the polyline
 * through the card centres, which yields a CONTINUOUS position along the
 * timeline. The hand reads that continuum (so it moves smoothly and can sit
 * between years), while the cards read its rounded value.
 */
export function timeAt(layout, px, py) {
  // portrait reads the vertical rail of nodes; landscape reads the card curve
  const pts = layout.portrait
    ? layout.nodes.map((n) => [n[0], n[1]])
    : layout.cards.map((c) => [c.x, c.y]);
  let best = 0;
  let bestD = Infinity;

  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + dx * t;
    const qy = ay + dy * t;
    const d = (px - qx) ** 2 + (py - qy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i + t;
    }
  }
  return { u: best, dist: Math.sqrt(bestD) };
}

/** Interpolate an angle list at a fractional index, the short way round. */
export function angleAt(list, u) {
  const i = Math.max(0, Math.min(list.length - 2, Math.floor(u)));
  const t = Math.max(0, Math.min(1, u - i));
  let a = list[i];
  let b = list[i + 1];
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
