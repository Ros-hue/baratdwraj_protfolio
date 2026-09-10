// The red energy ribbon — a light-painting stroke, not a shape.
//
// In the supplied motion reference the line is drawn by a moving point: a hot
// white head travels through the room, the trail it leaves holds for a few
// seconds, cools from white through red, and fades — while the head goes on to
// sweep low across the frame, climb, loop around the figure and settle into an
// orbit. So this is modelled literally: a parametric HEAD position, and a strip
// built every frame from where the head has been over the last few seconds.
//
// The head's journey is a slow orbit around the figure with two much slower
// large-amplitude drift terms layered on top. The frequencies are
// incommensurate, so the path keeps evolving and never visibly repeats — the
// loops it draws cross themselves and reshape exactly the way a long-exposure
// light-painting does.
//
// Because the trail wanders in depth, "behind the figure" and "in front of the
// cards" are not contiguous stretches of the strip. The strip therefore carries
// its world-space depth per vertex and is drawn in z-BANDS: the same geometry
// is submitted at several points in the paint order with a depth gate, and the
// fragment shader discards outside the band.

const SEGMENTS = 340;
// Long enough that the stroke's history spans more than a full lap of its
// orbit: that is what lets the line close loops and cross itself the way the
// reference's does. A short trail reads as a comet, not a light-painting.
const TRAIL_SECONDS = 7.5;

export class Ribbon {
  constructor(gl, figureZ = 1.6) {
    this.gl = gl;
    this.figureZ = figureZ;
    this.count = SEGMENTS;

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, SEGMENTS * 2 * 3 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    // x: -1..1 across the strip, y: age along the trail (0 = the hot head)
    this.sideBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sideBuf);
    const side = new Float32Array(SEGMENTS * 2 * 2);
    for (let i = 0; i < SEGMENTS; i++) {
      const a = i / (SEGMENTS - 1);
      side[i * 4 + 0] = -1; side[i * 4 + 1] = a;
      side[i * 4 + 2] = 1; side[i * 4 + 3] = a;
    }
    gl.bufferData(gl.ARRAY_BUFFER, side, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.verts = new Float32Array(SEGMENTS * 2 * 3);
    this.headPos = [0, 0, 0];
  }

  /** Where the light is at scene-time t. */
  head(t) {
    // base orbit around the figure — quick enough that a trail-length of
    // history wraps more than one lap
    const th = t * 0.72;
    const R = 2.9 + 1.5 * Math.sin(t * 0.21 + 1.2);
    const Rz = 2.4 + 1.1 * Math.sin(t * 0.166 + 0.4);
    let x = Math.cos(th) * R;
    let z = this.figureZ + Math.sin(th) * Rz;
    // ranges LOW: the reference's stroke sweeps across the bottom of the room
    // as often as it rides at shoulder height
    let y = -1.15 + 2.0 * Math.sin(t * 0.131 + 0.9) + 0.5 * Math.sin(th * 2.0 + 0.5);

    // slow large drifts: these are what turn a tidy ellipse into a stroke that
    // dives to a corner, climbs over the tall cards and re-loops
    x += 1.9 * Math.sin(t * 0.093 + 2.0);
    y += 0.8 * Math.sin(t * 0.117 + 0.7);
    z += 0.9 * Math.sin(t * 0.071 + 3.1);
    return [x, y, z];
  }

  /**
   * Rebuild the trail for this frame.
   * @param {number} t     scene seconds
   * @param {number} width half-width of the stroke in world units
   * @param {number} draw  0..1 — how much trail exists yet (the line "draws
   *                       itself" by growing its own history)
   * @param {number} entry 0..1 — early on the head is blended in from off
   *                       frame left, so the stroke ENTERS the scene the way
   *                       it does in the reference rather than popping up
   *                       mid-room
   */
  update(t, width, draw, entry) {
    const v = this.verts;
    const span = TRAIL_SECONDS * Math.max(draw, 0.001);

    for (let i = 0; i < SEGMENTS; i++) {
      const age = i / (SEGMENTS - 1);
      const ts = t - age * span;
      let p = this.head(ts);
      if (entry < 1) {
        const k = 1 - entry;
        p = [p[0] * (1 - k) + (-8.5) * k,
          p[1] * (1 - k) + (-1.9) * k,
          p[2] * (1 - k) + (2.4) * k];
      }
      const q = this.head(ts - 0.05);

      // camera-facing offset from the screen-space tangent
      let tx = p[0] - q[0];
      let ty = p[1] - q[1];
      const len = Math.hypot(tx, ty) || 1;
      tx /= len; ty /= len;

      // the stroke is broad at the head and thins as it cools; a slow ripple
      // along the length keeps it organic
      const taper = (1.15 - age * 0.55) * (0.85 + 0.15 * Math.sin(ts * 3.1));
      const w = width * taper * Math.min(1, (1 - age) * 14) // no blunt tail end
        * Math.min(1, age * 60 + 0.25);                     // fine right at the head
      const nx = -ty * w;
      const ny = tx * w;

      v[i * 6 + 0] = p[0] + nx; v[i * 6 + 1] = p[1] + ny; v[i * 6 + 2] = p[2];
      v[i * 6 + 3] = p[0] - nx; v[i * 6 + 4] = p[1] - ny; v[i * 6 + 5] = p[2];

      if (i === 0) this.headPos = p;
    }

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, v);
  }

  /** Submit the whole strip once; the shader's z-band gate does the sorting. */
  draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, SEGMENTS * 2);
    gl.bindVertexArray(null);
  }
}
