// The finale's two canvases, both carrying the reference's own pixels.
//
//   back   the plate (wordmark + red fog + his smoke), staged and breathing
//   front  the man, matted out of the artwork, plus a quiet veil of
//          foreground smoke
//
// Both layers use the same cover mapping, so at rest the reassembly is the
// reference image exactly; the split is what buys the reveal and the few
// pixels of parallax depth between him, the title and the fog.

import { program, unitQuad, texture, upload, bind, loadImage } from '../gl/renderer.js';
import { V6, F6_PLATE, F6_MAN, F6_SMOKE } from '../gl/shaders6.js';

const FRAME = [1600, 900];

export class Finale {
  constructor(back, glB, front, glF) {
    this.back = { canvas: back, gl: glB };
    this.front = { canvas: front, gl: glF };
    this.pB = { plate: program(glB, V6, F6_PLATE, 'plate6') };
    this.pF = {
      man: program(glF, V6, F6_MAN, 'man6'),
      smoke: program(glF, V6, F6_SMOKE, 'smoke6'),
    };
    this.quadB = unitQuad(glB);
    this.quadF = unitQuad(glF);
    this.texB = { plate: texture(glB), grain: texture(glB, { wrap: 'repeat' }) };
    this.texF = { man: texture(glF), grain: texture(glF, { wrap: 'repeat' }) };
    this.par = { x: 0, y: 0 };
    // the man's box in frame px, from fin.json - set by boot6
    this.manBox = [580, 170, 450, 730];
  }

  async load() {
    const [plate, grain] = await Promise.all([
      loadImage('public/fin/plate.png'),
      loadImage('public/tex/grain.png'),
    ]);
    upload(this.back.gl, this.texB.plate, plate);
    upload(this.back.gl, this.texB.grain, grain);
    upload(this.front.gl, this.texF.grain, grain);
    // man.jpeg is optional — if missing, the man layer stays transparent
    try {
      const man = await loadImage('public/fin/man.jpeg');
      upload(this.front.gl, this.texF.man, man);
    } catch { /* man image not available */ }
  }

  resize(w, h, dpr) {
    for (const side of [this.back, this.front]) {
      const W = Math.round(w * dpr);
      const H = Math.round(h * dpr);
      if (side.canvas.width !== W || side.canvas.height !== H) {
        side.canvas.width = W;
        side.canvas.height = H;
      }
      side.gl.viewport(0, 0, W, H);
    }
    this.cssW = w;
    this.cssH = h;
    const s = Math.max(w / FRAME[0], h / FRAME[1]);
    this.fit = { s, ox: (w - FRAME[0] * s) / 2, oy: (h - FRAME[1] * s) / 2 };
  }

  render(t, s) {
    const aspect = this.cssW / this.cssH;
    const f = this.fit;
    const sx = this.cssW / (FRAME[0] * f.s);
    const sy = this.cssH / (FRAME[1] * f.s);
    const ox = -f.ox / (FRAME[0] * f.s);
    const oy = -f.oy / (FRAME[1] * f.s);

    {
      const gl = this.back.gl;
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindVertexArray(this.quadB);
      const pr = this.pB.plate;
      gl.useProgram(pr.p);
      gl.uniform1i(pr.u.uPlate, bind(gl, this.texB.plate, 0));
      gl.uniform1i(pr.u.uGrain, bind(gl, this.texB.grain, 1));
      gl.uniform4f(pr.u.uCover, sx, sy, ox, oy);
      gl.uniform1f(pr.u.uTime, t);
      gl.uniform1f(pr.u.uAspect, aspect);
      gl.uniform1f(pr.u.uGlow, s.glow);
      gl.uniform1f(pr.u.uWord, s.word);
      gl.uniform2f(pr.u.uPar, this.par.x, this.par.y);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
    }

    {
      const gl = this.front.gl;
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindVertexArray(this.quadF);

      if (s.man > 0.001) {
        // his quad: the frame box cover-mapped, drifting a couple of pixels
        // WITH the pointer (nearer than the plate) and rising as he arrives
        const b = this.manBox;
        const rise = (1 - s.man) * 0.03;
        const rect = [
          (b[0] * f.s + f.ox) / this.cssW + this.par.x * 0.004,
          (b[1] * f.s + f.oy) / this.cssH + this.par.y * 0.0025 + rise,
          b[2] * f.s / this.cssW,
          b[3] * f.s / this.cssH,
        ];
        const pr = this.pF.man;
        gl.useProgram(pr.p);
        gl.uniform1i(pr.u.uMan, bind(gl, this.texF.man, 0));
        gl.uniform4f(pr.u.uRect, ...rect);
        gl.uniform1f(pr.u.uOp, s.man);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      gl.blendFunc(gl.ONE, gl.ONE);
      {
        const pr = this.pF.smoke;
        gl.useProgram(pr.p);
        gl.uniform1i(pr.u.uGrain, bind(gl, this.texF.grain, 0));
        gl.uniform1f(pr.u.uTime, t);
        gl.uniform1f(pr.u.uAspect, aspect);
        gl.uniform1f(pr.u.uOp, s.fog);
        gl.uniform2f(pr.u.uPar, this.par.x, this.par.y);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      gl.bindVertexArray(null);
    }
  }
}
