// Scene four's measured geometry — every number read off the supplied
// reference (section 4 image.jpg, 1600x900), which is the source of truth.
// The card sprites and the environment plate are cut from that image by
// tools/extract_s4.py; this module records where each piece goes back.
//
// Coordinates are reference-frame pixels. fitCover() maps the frame onto the
// viewport the way the plate shader does (cover: fill, centre-anchored), so
// the DOM cards and the canvas can never drift apart.

export const FRAME = [1600, 900];

export const CARDS = [
  { id: 'p01_timeless', title: 'Charlie — Web-Based Virtual Assistant', box: [213, 72, 384, 273], depth: 0.45, tint: [0.309, 0.334, 0.382] },
  { id: 'p02_game', title: 'Astrosite AI — Full-Stack Web Application', box: [63, 251, 428, 269], depth: 0.25, tint: [0.249, 0.267, 0.295] },
  { id: 'p03_build', title: 'Fullstack Developer — 2024–2025', box: [566, 41, 471, 288], depth: 0.6, tint: [0.414, 0.291, 0.291] },
  { id: 'p04_driven', title: 'UI/UX Designer — 2023', box: [998, 95, 460, 377], depth: 0.45, tint: [0.322, 0.278, 0.261] },
  { id: 'p05_ideas', title: 'Front-End Developer — GetSetAI Innovation', box: [394, 358, 232, 198], depth: 0.8, tint: [0.39, 0.303, 0.234] },
  { id: 'p06_sound', title: 'Junior Web Designer — MSME Technology Centre', box: [568, 364, 173, 203], depth: 0.9, tint: [0.336, 0.324, 0.333] },
  { id: 'p07_food', title: 'Python and Django — 2025', box: [698, 366, 211, 204], depth: 1.0, tint: [0.336, 0.243, 0.217] },
  { id: 'p08_travel', title: 'Full Stack Development — 2025', box: [844, 370, 195, 206], depth: 0.9, tint: [0.26, 0.32, 0.366] },
  { id: 'p09_space', title: 'C, C++, Core JAVA, Python — 2023', box: [988, 364, 231, 208], depth: 0.8, tint: [0.336, 0.283, 0.269] },
  { id: 'p10_play', title: 'B.Sc. CSE in AIML — 2024–2027', box: [1181, 251, 355, 242], depth: 0.3, tint: [0.448, 0.305, 0.235] },
  { id: 'p11_cleaner', title: 'Diploma in Electrical Engineering — 2020–2024', box: [118, 467, 345, 243], depth: 0.1, tint: [0.311, 0.339, 0.263] },
  { id: 'p12_steps', title: 'Dial JDP — UI/UX Design', box: [1139, 478, 325, 234], depth: 0.1, tint: [0.31, 0.317, 0.302] },
];

// the central figure: crop box in frame px (his lighting is baked in)
export const PERSON = { x: 693, y: 483, w: 210, h: 335 };

// the floor's lit ellipses (centre x, centre y, rx, ry) and the overhead ring,
// used by the live glints the canvas draws over the baked plate
export const FLOOR_OUT = [798, 735, 372, 80];
export const FLOOR_IN = [798, 741, 240, 57];
export const RING = [802, 34, 392, 148];

/** Cover-fit the reference frame onto a viewport. */
export function fitCover(w, h) {
  const s = Math.max(w / FRAME[0], h / FRAME[1]);
  return { s, ox: (w - FRAME[0] * s) / 2, oy: (h - FRAME[1] * s) / 2 };
}

// --------------------------------------------------------------------------
// Portrait is a recomposition, not a crop: cover-fitting a 16:9 amphitheatre
// to a phone leaves only the centre quarter on screen. The plate still cover-
// fits (floor, circle and haze survive centred), and a curated set of cards
// restacks into a column that keeps the reference hierarchy: hero screen up
// top, the small row over the figure, the two green closers at his feet.
// Entries: card index -> centre x/y (viewport fractions), width (vw fraction).
// --------------------------------------------------------------------------
export const PORTRAIT = new Map([
  [2, { cx: 0.50, cy: 0.235, w: 0.80 }],   // build
  [0, { cx: 0.235, cy: 0.385, w: 0.50 }],  // timeless
  [3, { cx: 0.77, cy: 0.39, w: 0.48 }],    // driven
  [6, { cx: 0.325, cy: 0.53, w: 0.29 }],   // food
  [7, { cx: 0.675, cy: 0.53, w: 0.29 }],   // travel
  [10, { cx: 0.20, cy: 0.815, w: 0.48 }],  // cleaner
  [11, { cx: 0.80, cy: 0.815, w: 0.48 }],  // steps
]);
