// Scene four's canvas: the environment. Two passes -
//   1  room   the extracted reference plate, staged and re-lit (shaders4.js)
//   2  post   grain + vignette, shared with scene three
//
// The cards and the figure are DOM (buttons and an img over this canvas),
// placed from the same fitCover() mapping the room pass samples with, so the
// photograph and the interactive layer can never drift apart.

import { program, unitQuad, texture, upload, bind, loadImage } from '../gl/renderer.js';
import { V4, F4_ROOM } from '../gl/shaders4.js';
import { F3_POST } from '../gl/shaders3.js';
import { FRAME, FLOOR_OUT, FLOOR_IN, RING, fitCover } from './layout4.js';

export class Gallery {
  constructor(canvas, gl) {
    this.canvas = canvas;
    this.gl = gl;
    this.progs = {
      room: program(gl, V4, F4_ROOM, 'room4'),
      post: program(gl, V4, F3_POST, 'post4'),
    };
    this.quad = unitQuad(gl);
    this.tex = { plate: texture(gl), grain: texture(gl, { wrap: 'repeat' }) };
    this.par = { x: 0, y: 0 };
    this.dolly = 0;
  }

  async load() {
    const [plate, grain] = await Promise.all([
      loadImage('public/projects/plate.jpg'),
      loadImage('public/tex/grain.png'),
    ]);
    upload(this.gl, this.tex.plate, plate);
    upload(this.gl, this.tex.grain, grain);
  }

  resize(w, h, dpr) {
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    this.res = [W, H];
    this.cssW = w;
    this.cssH = h;
    this.fit = fitCover(w, h);
    this.gl.viewport(0, 0, W, H);
    return this.fit;
  }

  /** An ellipse in frame px -> frame fractions for the shader. */
  _ell([cx, cy, rx, ry]) {
    return [cx / FRAME[0], cy / FRAME[1], rx / FRAME[0], ry / FRAME[1]];
  }

  render(t, s) {
    const gl = this.gl;
    const [W, H] = this.res;
    const f = this.fit;

    // viewport uv (0..1 of the canvas) -> frame fraction: the same cover
    // mapping the DOM placement uses, expressed as scale + offset
    const sx = this.cssW / (FRAME[0] * f.s);
    const sy = this.cssH / (FRAME[1] * f.s);
    const ox = -f.ox / (FRAME[0] * f.s);
    const oy = -f.oy / (FRAME[1] * f.s);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(this.quad);

    {
      const pr = this.progs.room;
      gl.useProgram(pr.p);
      gl.uniform1i(pr.u.uPlate, bind(gl, this.tex.plate, 0));
      gl.uniform1i(pr.u.uGrain, bind(gl, this.tex.grain, 1));
      gl.uniform4f(pr.u.uCover, sx, sy, ox, oy);
      gl.uniform1f(pr.u.uTime, t);
      gl.uniform1f(pr.u.uAspect, W / H);
      gl.uniform1f(pr.u.uWake, s.wake);
      gl.uniform1f(pr.u.uRing, s.ring);
      gl.uniform1f(pr.u.uFloorL, s.floor);
      gl.uniform1f(pr.u.uSpark, s.spark);
      gl.uniform1f(pr.u.uPerson, s.person);
      gl.uniform2f(pr.u.uPar, this.par.x, this.par.y);
      gl.uniform1f(pr.u.uDolly, this.dolly);
      gl.uniform4f(pr.u.uEllA, ...this._ell(FLOOR_OUT));
      gl.uniform4f(pr.u.uEllB, ...this._ell(FLOOR_IN));
      gl.uniform4f(pr.u.uRingE, ...this._ell(RING));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    {
      const pr = this.progs.post;
      gl.useProgram(pr.p);
      gl.uniform1i(pr.u.uGrain, bind(gl, this.tex.grain, 0));
      gl.uniform2f(pr.u.uRes, W, H);
      gl.uniform1f(pr.u.uTime, t);
      gl.uniform1f(pr.u.uAmount, s.grain);
      gl.uniform1f(pr.u.uAspect, W / H);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.bindVertexArray(null);
  }
}
