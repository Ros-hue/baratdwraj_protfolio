// Embers.
//
// All motion happens in the vertex shader from a per-point seed, so the CPU
// never touches these after upload - 900 sparks cost one draw call and no
// per-frame work, which is what keeps the scene smooth alongside twelve lit
// cards and a rebuilt ribbon.

export class Sparks {
  constructor(gl, count = 900) {
    this.gl = gl;
    this.count = count;

    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 3);
    let s = 12345;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };

    for (let i = 0; i < count; i++) {
      // a shell around the core rather than a uniform box, so the room has a
      // centre of gravity instead of an even fog
      const r = 2.5 + Math.pow(rnd(), 0.6) * 12.0;
      const a = rnd() * Math.PI * 2;
      const yb = (rnd() - 0.38) * 9.0;
      pos[i * 3] = Math.cos(a) * r * 1.05;
      pos[i * 3 + 1] = yb;
      pos[i * 3 + 2] = Math.sin(a) * r * 0.75 - 4.0;

      seed[i * 3] = rnd();
      seed[i * 3 + 1] = Math.pow(rnd(), 2.4);   // mostly small, a few large
      seed[i * 3 + 2] = 0.5 + rnd();
    }

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const pb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pb);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    const sb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sb);
    gl.bufferData(gl.ARRAY_BUFFER, seed, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  draw(n = this.count) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, Math.min(n, this.count));
    gl.bindVertexArray(null);
  }
}

/** Small dark cubes that give the room scale. Positions are fixed; the scene
 *  drifts them via their seed the same way the cards drift. */
export function buildDebris(n = 16) {
  let s = 99;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1;
    out.push({
      // kept well outside the card shell, or a cube lands on a wordmark
      home: [side * (7.0 + rnd() * 7.0), (rnd() - 0.5) * 9.0, -16.0 + rnd() * 9.0],
      size: 0.20 + rnd() * 0.40,
      rot: [rnd() * 3, rnd() * 3, rnd() * 3],
      phase: rnd() * 6.28,
      speed: 0.3 + rnd() * 0.5,
    });
  }
  return out;
}
