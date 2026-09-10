// Scene three: the time machine.
//
// Draw order, back to front:
//   1  room      warm black, reflective floor, the rotating ring mechanism
//   2  track     the timeline rail, its six nodes, the energy running along it
//   3  figure    silhouette from the artwork, lit by this room
//   4  clock     the dial, its ticks, the hand, and the beam it throws
//   5  post      grain and vignette
//
// The clock is drawn LAST and additively, so its beam falls over the rail
// rather than sitting behind it — the light has to touch the things it is
// pointing at or the connection reads as decoration.
//
// The figure is the exception to the single canvas: on a desktop frame he and
// the near ring arcs render on a SECOND, transparent canvas stacked over the
// DOM card deck, so he stands in front of the timeline — cards behind his
// shoulders — while staying lit by this room's shaders. Portrait (and any
// browser that refuses a second context) keeps him on the main canvas.
//
// The six cards themselves are DOM, not canvas: each carries real text that has
// to stay crisp, selectable and reachable by a screen reader. They are placed
// from the same fitted geometry this file draws with, so the two layers cannot
// drift apart.

import { program, unitQuad, texture, upload, bind, loadImage } from '../gl/renderer.js';
import {
  V3, F3_ROOM, F3_CLOCK, F3_TRACK, V3_QUAD, F3_FIGURE, F3_RINGS_FRONT,
  F3_POST,
} from '../gl/shaders3.js';
import { fitScene, angleAt, YEARS } from './layout3.js';
import { sample3 } from './timeline3.js';
import { damp, clamp, lerp } from '../lib/ease.js';

export class Chrono {
  constructor(canvas, gl, front = null) {
    this.canvas = canvas;
    this.gl = gl;
    this.progs = {
      room: program(gl, V3, F3_ROOM, 'room'),
      track: program(gl, V3, F3_TRACK, 'track'),
      clock: program(gl, V3, F3_CLOCK, 'clock'),
      figure: program(gl, V3_QUAD, F3_FIGURE, 'figure'),
      ringsFront: program(gl, V3, F3_RINGS_FRONT, 'ringsFront'),
      post: program(gl, V3, F3_POST, 'post'),
    };
    this.quad = unitQuad(gl);
    this.tex = { grain: texture(gl, { wrap: 'repeat' }), figure: texture(gl) };
    // the front layer: its own context on the canvas above the card deck,
    // with its own copies of the two programs and textures it draws with
    this.front = front ? {
      canvas: front.canvas,
      gl: front.gl,
      progs: {
        figure: program(front.gl, V3_QUAD, F3_FIGURE, 'figure/front'),
        ringsFront: program(front.gl, V3, F3_RINGS_FRONT, 'ringsFront/front'),
      },
      quad: unitQuad(front.gl),
      tex: {
        grain: texture(front.gl, { wrap: 'repeat' }),
        figure: texture(front.gl),
      },
    } : null;
    this.layout = null;
    this.res = [1, 1];

    // continuous position along the timeline, 0..5. Damped rather than set, so
    // the hand has weight and never snaps between years.
    this.u = 5;
    this.targetU = 5;
    this.heat = 0;
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0, inside: false };
    this.active = 5;
  }

  async load() {
    const [grain, fig] = await Promise.all([
      loadImage('public/tex/grain.png'),
      loadImage('public/years/figure.png'),
    ]);
    upload(this.gl, this.tex.grain, grain);
    upload(this.gl, this.tex.figure, fig);
    if (this.front) {
      upload(this.front.gl, this.front.tex.grain, grain);
      upload(this.front.gl, this.front.tex.figure, fig);
    }
    this.figAspect = fig.width / fig.height;
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
    this.dpr = dpr;
    this.layout = fitScene(w, h);
    this.gl.viewport(0, 0, W, H);
    if (this.front) {
      const fc = this.front.canvas;
      if (fc.width !== W || fc.height !== H) {
        fc.width = W;
        fc.height = H;
      }
      this.front.gl.viewport(0, 0, W, H);
    }
    return this.layout;
  }

  /** Normalised (0..1) screen position, from CSS pixels. */
  _n(x, y) {
    return [x / this.cssW, y / this.cssH];
  }

  render(t, dt) {
    const gl = this.gl;
    const L = this.layout;
    if (!L) return null;
    const [W, H] = this.res;
    const aspect = W / H;
    const s = sample3(t, YEARS.length);

    // ---- time position ----------------------------------------------------
    // During the intro the sequence owns the hand; afterwards the pointer does.
    // Blending on `handAuthority` means control is handed over rather than
    // switched, so the hand never jumps at the moment the scene goes live.
    const wanted = lerp(this.targetU, s.introU, s.handAuthority);
    // clamped as well as damped: u indexes the years, and a stalled tab can
    // hand the loop a wild dt, which would otherwise let the spring overshoot
    // out of range and swing the hand somewhere meaningless
    this.u = clamp(damp(this.u, wanted, 4.2, dt), 0, YEARS.length - 1);
    this.active = Math.max(0, Math.min(YEARS.length - 1, Math.round(this.u)));
    this.heat = damp(this.heat, s.energy, 3.0, dt);

    const p = this.pointer;
    p.x = damp(p.x, p.inside ? p.tx : 0, 2.6, dt);
    p.y = damp(p.y, p.inside ? p.ty : 0, 2.6, dt);
    const par = s.live ? 1 : 0;
    // the camera drifts a hair against the pointer; enough for depth, not
    // enough to notice as an effect
    const camX = -p.x * 0.010 * par;
    const camY = -p.y * 0.006 * par;

    const hand = angleAt(L.handAngles, this.u);
    // index defensively: NaN or an out-of-range u would otherwise dereference
    // undefined here and take the whole scene down mid-frame
    const last = YEARS.length - 1;
    const i0 = Math.max(0, Math.min(last, Math.floor(this.u) || 0));
    const i1 = Math.min(last, i0 + 1);
    const activePos = this._n(
      lerp(L.cards[i0].x, L.cards[i1].x, clamp(this.u - i0, 0, 1)),
      L.cards[this.active].y,
    );
    const fu = clamp(this.u - i0, 0, 1);
    const nodeScr = this._n(
      lerp(L.nodes[i0][0], L.nodes[i1][0], fu),
      lerp(L.nodes[i0][1], L.nodes[i1][1], fu),
    );

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(this.quad);

    const pivotN = this._n(L.pivot[0], L.pivot[1]);
    const floorN = this._n(L.floor[0], L.floor[1]);

    // ---- 1 room -----------------------------------------------------------
    {
      const pr = this.progs.room;
      gl.useProgram(pr.p);
      gl.uniform1i(pr.u.uGrain, bind(gl, this.tex.grain, 0));
      gl.uniform2f(pr.u.uRes, W, H);
      gl.uniform1f(pr.u.uTime, t);
      gl.uniform1f(pr.u.uAspect, aspect);
      gl.uniform1f(pr.u.uWake, s.wake);
      gl.uniform1f(pr.u.uRings, s.rings);
      gl.uniform2f(pr.u.uFloor, floorN[0] + camX, floorN[1] + camY);
      gl.uniform2f(pr.u.uPivot, pivotN[0] + camX, pivotN[1] + camY);
      gl.uniform1f(pr.u.uHeat, this.heat);
      gl.uniform2f(pr.u.uActive, activePos[0], activePos[1]);
      gl.uniform2f(pr.u.uFig, L.figure.cx / this.cssW, L.figure.feet / this.cssH);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // ---- 2 track (additive) ----------------------------------------------
    gl.blendFunc(gl.ONE, gl.ONE);
    {
      const pr = this.progs.track;
      gl.useProgram(pr.p);
      gl.uniform2f(pr.u.uRes, W, H);
      gl.uniform1f(pr.u.uTime, t);
      gl.uniform1f(pr.u.uAspect, aspect);
      const cN = this._n(L.arc.cx, L.arc.cy);
      gl.uniform3f(pr.u.uArc, cN[0] + camX * 0.6, cN[1] + camY * 0.6,
        L.arc.r / this.cssH);
      gl.uniform2f(pr.u.uSpan, L.angles[0], L.angles[L.angles.length - 1]);
      gl.uniform1f(pr.u.uReveal, s.rail);
      gl.uniform1f(pr.u.uActiveU, this.u);
      gl.uniform1f(pr.u.uHeat, this.heat);
      for (let i = 0; i < L.nodes.length; i++) {
        const n = this._n(L.nodes[i][0], L.nodes[i][1]);
        gl.uniform2f(pr.u[`uNodes[${i}]`], n[0] + camX * 0.6, n[1] + camY * 0.6);
        gl.uniform1f(pr.u[`uNodeIn[${i}]`], s.nodes[i]);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // ---- 3 figure + the near floor arcs -----------------------------------
    // Desktop: on the front canvas, over the deck. Portrait or no second
    // context: here on the main canvas, behind the cards, as before.
    this._drawFigure(t, s, W, H, aspect, camX, camY, activePos, floorN);

    // ---- 4 clock (additive, over everything it lights) --------------------
    gl.blendFunc(gl.ONE, gl.ONE);
    {
      const pr = this.progs.clock;
      gl.useProgram(pr.p);
      gl.uniform2f(pr.u.uRes, W, H);
      gl.uniform1f(pr.u.uTime, t);
      gl.uniform1f(pr.u.uAspect, aspect);
      gl.uniform2f(pr.u.uPivot, pivotN[0] + camX, pivotN[1] + camY);
      const dc = this._n(L.dial.cx, L.dial.cy);
      gl.uniform2f(pr.u.uDialC, dc[0] + camX, dc[1] + camY);
      gl.uniform1f(pr.u.uDial, L.dial.r / this.cssH);
      gl.uniform1f(pr.u.uReveal, s.clock);
      gl.uniform1f(pr.u.uHand, hand);
      // the ornate second hand rides 150 degrees round from the pointer,
      // exactly the pairing the reference frame shows
      // the ornate companion hand rides 74deg ahead of the beam, so the pair
      // hangs from the pivot like a set of dividers -- the reference pose
      gl.uniform1f(pr.u.uHand2, hand + 1.29);
      gl.uniform2f(pr.u.uTarget, nodeScr[0], nodeScr[1]);
      gl.uniform1f(pr.u.uBeam, s.energy);
      gl.uniform1f(pr.u.uHeat, this.heat);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // ---- 5 post -----------------------------------------------------------
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    {
      const pr = this.progs.post;
      gl.useProgram(pr.p);
      gl.uniform1i(pr.u.uGrain, bind(gl, this.tex.grain, 0));
      gl.uniform2f(pr.u.uRes, W, H);
      gl.uniform1f(pr.u.uTime, t);
      gl.uniform1f(pr.u.uAmount, s.grain);
      gl.uniform1f(pr.u.uAspect, aspect);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.bindVertexArray(null);

    return s;
  }

  /**
   * The figure and the near ring arcs. On a desktop frame these draw on the
   * front context — the transparent canvas stacked over the card deck — so he
   * stands IN FRONT of the timeline, cards passing behind his shoulders, the
   * mechanism's near side still crossing in front of his shoes. In portrait
   * the single staged card is the content and he belongs behind it, so the
   * passes fall back to the main canvas (as they do when the browser refuses
   * a second context).
   */
  _drawFigure(t, s, W, H, aspect, camX, camY, activePos, floorN) {
    const front = this.front && !this.layout.portrait ? this.front : null;
    const g = front ? front.gl : this.gl;
    const progs = front ? front.progs : this.progs;
    const tex = front ? front.tex : this.tex;
    const L = this.layout;

    if (front) {
      g.clearColor(0, 0, 0, 0);
      g.clear(g.COLOR_BUFFER_BIT);
      g.bindVertexArray(front.quad);
    } else if (this.front) {
      // portrait with a front canvas present: keep it empty, or the last
      // landscape frame would sit frozen over the deck
      const fg = this.front.gl;
      fg.clearColor(0, 0, 0, 0);
      fg.clear(fg.COLOR_BUFFER_BIT);
    }

    g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
    {
      const pr = progs.figure;
      g.useProgram(pr.p);
      const fh = L.figure.h * this.dpr;
      const fw = fh * this.figAspect;
      const fx = L.figure.cx * this.dpr - fw * 0.5 + camX * W * 0.35;
      const fy = L.figure.feet * this.dpr - fh + camY * H * 0.35;
      g.uniform4f(pr.u.uRect, fx, fy, fw, fh);
      g.uniform2f(pr.u.uRes, W, H);
      g.uniform1i(pr.u.uFig, bind(g, tex.figure, 0));
      g.uniform1i(pr.u.uGrain, bind(g, tex.grain, 1));
      g.uniform1f(pr.u.uOpacity, s.figure);
      g.uniform1f(pr.u.uRim, 0.5 + 0.7 * s.rings);
      g.uniform1f(pr.u.uHeat, this.heat);
      // he is lit from wherever the active year currently is
      const lx = activePos[0] - L.figure.cx / this.cssW;
      g.uniform2f(pr.u.uLightDir, lx * aspect, -0.42);
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    }

    // the near arcs of the floor, over his feet — he stands INSIDE the
    // mechanism: far side behind him, near side in front
    g.blendFunc(g.ONE, g.ONE);
    {
      const pr = progs.ringsFront;
      g.useProgram(pr.p);
      g.uniform1f(pr.u.uTime, t);
      g.uniform1f(pr.u.uAspect, aspect);
      g.uniform1f(pr.u.uRings, s.rings);
      g.uniform2f(pr.u.uFloor, floorN[0] + camX, floorN[1] + camY);
      g.uniform1f(pr.u.uCut, L.figure.feet / this.cssH - 0.055);
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    }

    if (front) {
      g.bindVertexArray(null);
    } else {
      // on the main canvas the quad VAO must STAY bound and the blend mode
      // restored — the clock and post passes draw right after this
      g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
    }
  }
}
