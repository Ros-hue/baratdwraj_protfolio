// Scene two: the creative universe.
//
// Draw order, back to front:
//   1  environment   dark room, red bloom behind the core, reflective floor
//   2  core ring     concentric arcs, rotating and pulsing
//   3  ribbon (far)  the segments that pass BEHIND the figure
//   4  figure        silhouette from the artwork, lit by this scene
//   5  ribbon (near) the segments in front of him
//   6  debris + cards, depth sorted back to front
//   7  embers        additive, with depth-of-field
//   8  post          grain and vignette
//
// Cards are drawn painter-style with the depth buffer off, because everything
// here is translucent and additive; sorting by w each frame is cheap for a
// dozen quads and avoids the sorting artefacts blending would otherwise give.

import { program, unitQuad, texture, upload, bind, loadImage } from '../gl/renderer.js';
import {
  V2_FULL, F2_ENV, F2_RING, V2_CARD, F2_CARD, V2_RIBBON, F2_RIBBON,
  V2_SPARK, F2_SPARK, V2_QUAD3D, F2_FIGURE, F2_CUBE, F2_POST,
} from '../gl/shaders2.js';
import { perspective, multiply, compose, projectPoint } from '../lib/mat4.js';
import { buildCards, layoutCards, layoutFigure, poseCard } from './cards.js';
import { Ribbon } from './ribbon.js';
import { Sparks, buildDebris } from './particles.js';
import { sample2 } from './timeline2.js';
import { damp, clamp } from '../lib/ease.js';

const TOOLS = [
  'photoshop', 'figma', 'aftereffects', 'premiere', 'notion', 'lightroom',
  'claude', 'chatgpt', 'midjourney', 'spline', 'framer', 'webflow',
];

const CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
// the nearest card sits at z=0; anything closer than this passes over the shell
const NEAR_CARD_Z = 0.55;
const FIGURE_Z = 1.6;      // he stands behind the card shell
const CAM_Z = 8.2;
const FOV = 0.85;

export class Universe {
  constructor(canvas, gl) {
    this.canvas = canvas;
    this.gl = gl;
    this.cards = buildCards();
    this.debris = buildDebris(16);
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0, inside: false };
    this.hovered = -1;
    this.quality = 1;
    this.time = 0;
    this.dolly = 0;

    this.progs = {
      env: program(gl, V2_FULL, F2_ENV, 'env'),
      ring: program(gl, V2_FULL, F2_RING, 'ring'),
      card: program(gl, V2_CARD, F2_CARD, 'card'),
      cube: program(gl, V2_QUAD3D, F2_CUBE, 'cube'),
      figure: program(gl, V2_QUAD3D, F2_FIGURE, 'figure'),
      ribbon: program(gl, V2_RIBBON, F2_RIBBON, 'ribbon'),
      spark: program(gl, V2_SPARK, F2_SPARK, 'spark'),
      post: program(gl, V2_FULL, F2_POST, 'post'),
    };
    this.quad = unitQuad(gl);
    this.ribbon = new Ribbon(gl, FIGURE_Z);
    this.sparks = new Sparks(gl, 900);

    this.tex = { grain: texture(gl, { wrap: 'repeat' }), figure: texture(gl) };
    this.logos = {};
    this.proj = new Float32Array(16);
    this.mvp = new Float32Array(16);
    this.model = new Float32Array(16);
    this.mvpTmp = new Float32Array(16);
    this.figMvp = new Float32Array(16);
    this.res = [1, 1];
    this.core = [0.5, 0.47];
  }

  async load() {
    const gl = this.gl;
    const [grain, fig] = await Promise.all([
      loadImage('public/tex/grain.png'),
      loadImage('public/tools/figure.png'),
    ]);
    upload(gl, this.tex.grain, grain);
    upload(gl, this.tex.figure, fig);
    this.figureAspect = fig.width / fig.height;

    const imgs = await Promise.all(
      TOOLS.map((n) => loadImage(`public/tools/${n}.png`).catch(() => null)));
    TOOLS.forEach((n, i) => {
      if (!imgs[i]) return;
      const t = texture(gl);
      upload(gl, t, imgs[i]);
      this.logos[n] = { tex: t, aspect: imgs[i].width / imgs[i].height };
    });
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
    this.portrait = h / w > 1.05;
    const aspect = W / H;
    perspective(FOV, aspect, 0.1, 100, this.proj);

    // The composition is re-solved for the actual viewport rather than scaled:
    // on a narrow screen the shell is pulled in and flattened so the cards stay
    // on stage instead of drifting off the sides.
    // Portrait is a genuine recomposition, not the desktop frame scaled down.
    // The reference is a landscape poster: mapped straight onto a tall screen
    // its cards collapse toward the vertical middle, which is exactly where the
    // figure stands. So on a phone the shell is spread wider and taller, the
    // cards shrink, and the figure steps back to leave the centre clear.
    const narrow = w < 760;
    const tall = aspect < 1.0;
    layoutCards(this.cards, aspect, FOV, CAM_Z, {
      spread: tall ? 1.05 : (aspect < 1.5 ? 0.90 : 1),
      // enough vertical stretch to open the composition, not so much that the
      // top and bottom cards leave the frame
      lift: tall ? 1.15 : 1,
      // shrunk only enough to stop the shell colliding with the figure; any
      // smaller and the wordmarks stop being readable on a phone, which
      // defeats the point of the section
      sizeMul: tall ? 0.95 : (narrow ? 0.9 : 1),
    });
    this.fig = layoutFigure(aspect, FOV, CAM_Z,
      tall ? 0.36 : 0.60, tall ? 0.605 : 0.60, tall ? 0.50 : 0.62);
    // the ring is measured against the SHORTER edge, or it overflows a phone
    this.ringScale = tall ? 0.60 : 1.0;
  }

  /** Screen-space hit test, using each card's projected quad. */
  pick(cx, cy) {
    const nx = (cx / this.cssW) * 2 - 1;
    const ny = 1 - (cy / this.cssH) * 2;
    let best = -1;
    let bestW = 1e9;
    for (const c of this.cards) {
      const s = c.screen;
      if (!s) continue;
      if (nx >= s.x0 && nx <= s.x1 && ny >= s.y0 && ny <= s.y1 && s.w < bestW) {
        best = c.i;
        bestW = s.w;
      }
    }
    return best;
  }

  render(t, dt, scroll) {
    const gl = this.gl;
    const [W, H] = this.res;
    const s = sample2(t);
    this.time = t;
    const aspect = W / H;

    const p = this.pointer;
    p.x = damp(p.x, p.inside ? p.tx : 0, 3.0, dt);
    p.y = damp(p.y, p.inside ? p.ty : 0, 3.0, dt);
    const gate = s.float;
    const ptr = { x: p.x * gate, y: p.y * gate };

    // scrolling dollies the camera through the room; the sequence itself is
    // time-based so its choreography cannot be scrubbed out of shape
    this.dolly = damp(this.dolly, scroll * 1.5, 4.0, dt);

    const view = new Float32Array([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0,
      -ptr.x * 0.25, -ptr.y * 0.15, -(CAM_Z + this.dolly), 1,
    ]);
    multiply(this.proj, view, this.mvp);

    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(this.quad);

    // where is the stroke's head on screen? the environment blushes around it
    this.ribbon.update(t, 0.105 + 0.028 * Math.sin(t * 0.9),
      Math.max(s.ribbonDraw, 0.001),
      Math.min(1, s.ribbonDraw * 2.2));
    const hp3 = this.ribbon.headPos;
    const hndc = projectPoint(this.mvp, hp3[0], hp3[1], hp3[2]);
    const headScr = [(hndc[0] + 1) * 0.5, (1 - hndc[1]) * 0.5,
      s.ribbonLife * 0.9];

    // ---- 1 environment ----------------------------------------------------
    {
      const pr = this.progs.env;
      gl.useProgram(pr.p);
      gl.uniform1i(pr.u.uGrain, bind(gl, this.tex.grain, 0));
      gl.uniform2f(pr.u.uRes, W, H);
      gl.uniform1f(pr.u.uTime, t);
      gl.uniform1f(pr.u.uAspect, aspect);
      gl.uniform1f(pr.u.uWake, s.wake);
      gl.uniform1f(pr.u.uBurst, s.burst);
      gl.uniform2f(pr.u.uCore, this.core[0], this.core[1]);
      gl.uniform3f(pr.u.uStroke, headScr[0], headScr[1], headScr[2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // ---- 2 core ring (additive) -------------------------------------------
    gl.blendFunc(gl.ONE, gl.ONE);
    {
      const pr = this.progs.ring;
      gl.useProgram(pr.p);
      gl.uniform2f(pr.u.uRes, W, H);
      gl.uniform1f(pr.u.uTime, t);
      gl.uniform1f(pr.u.uAspect, aspect);
      gl.uniform1f(pr.u.uLife, s.ring);
      gl.uniform1f(pr.u.uBurst, s.burst);
      gl.uniform1f(pr.u.uScale, this.ringScale);
      gl.uniform2f(pr.u.uCore, this.core[0], this.core[1]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.bindVertexArray(null);

    // ---- 3 / 5 ribbon ------------------------------------------------------
    // One strip (already rebuilt above), drawn in depth bands: the trail
    // weaves through the room, so its behind-the-figure and in-front-of-the-
    // cards stretches interleave.
    const drawRibbon = (zMin, zMax) => {
      const pr = this.progs.ribbon;
      gl.useProgram(pr.p);
      gl.uniformMatrix4fv(pr.u.uMVP, false, this.mvp);
      gl.uniform1f(pr.u.uIntensity, 0.5 + 0.7 * s.ribbonLife);
      gl.uniform1f(pr.u.uTime, t);
      gl.uniform2f(pr.u.uZBand, zMin, zMax);
      this.ribbon.draw();
    };
    // far half: everything beyond the figure
    drawRibbon(-99, this.fig.z);

    // ---- 4 figure ----------------------------------------------------------
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    {
      const pr = this.progs.figure;
      gl.useProgram(pr.p);
      const halfH = this.fig.halfH;
      const halfW = halfH * this.figureAspect;
      const breathe = 1 + Math.sin(t * 0.55) * 0.004;
      compose([0, this.fig.y, this.fig.z], [0, 0, 0],
        [halfW, halfH * breathe], this.model);
      multiply(this.mvp, this.model, this.figMvp);
      gl.uniformMatrix4fv(pr.u.uMVP, false, this.figMvp);
      gl.uniform2f(pr.u.uHalf, 1, 1);
      gl.uniform1i(pr.u.uFig, bind(gl, this.tex.figure, 0));
      gl.uniform1i(pr.u.uGrain, bind(gl, this.tex.grain, 1));
      gl.uniform1f(pr.u.uOpacity, s.wake);
      gl.uniform1f(pr.u.uRim, 0.55 + 0.75 * s.ring);
      gl.uniform2f(pr.u.uLightDir, 0.35, 0.55);
      gl.uniform1f(pr.u.uTime, t);
      gl.bindVertexArray(this.quad);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
    }

    // between the figure and the card shell
    gl.blendFunc(gl.ONE, gl.ONE);
    drawRibbon(this.fig.z, NEAR_CARD_Z);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // ---- 6 debris + cards, sorted far to near ------------------------------
    gl.bindVertexArray(this.quad);
    const items = [];
    for (const d of this.debris) {
      const ph = t * d.speed + d.phase;
      const pos = [
        d.home[0] + Math.sin(ph) * 0.16 * s.float,
        d.home[1] + Math.cos(ph * 0.8) * 0.20 * s.float,
        d.home[2],
      ];
      items.push({ kind: 'cube', d, pos, w: CAM_Z + this.dolly - pos[2] });
    }
    for (const c of this.cards) {
      c.hover = damp(c.hover, this.hovered === c.i ? 1 : 0, 8, dt);
      const pose = poseCard(c, t, s, ptr);
      items.push({
        kind: 'card', c, pose, w: CAM_Z + this.dolly - pose.pos[2],
      });
    }
    items.sort((a, b) => b.w - a.w);

    for (const it of items) {
      if (it.kind === 'cube') {
        const pr = this.progs.cube;
        gl.useProgram(pr.p);
        compose(it.pos, it.d.rot, [it.d.size, it.d.size], this.model);
        multiply(this.mvp, this.model, this.mvpTmp);
        gl.uniformMatrix4fv(pr.u.uMVP, false, this.mvpTmp);
        gl.uniform2f(pr.u.uHalf, 1, 1);
        gl.uniform1f(pr.u.uOpacity, s.mat * 0.9);
        gl.uniform2f(pr.u.uLight, -it.pos[0], -it.pos[1]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        continue;
      }

      const { c, pose } = it;
      const lg = this.logos[c.name];
      const pr = this.progs.card;
      gl.useProgram(pr.p);
      compose(pose.pos, pose.rot, [pose.scale[0] * 0.5, pose.scale[1] * 0.5],
        this.model);
      multiply(this.mvp, this.model, this.mvpTmp);
      gl.uniformMatrix4fv(pr.u.uMVP, false, this.mvpTmp);
      gl.uniform2f(pr.u.uHalf, 1, 1);
      gl.uniform1i(pr.u.uLogo, bind(gl, lg ? lg.tex : this.tex.grain, 0));
      gl.uniform1i(pr.u.uGrain, bind(gl, this.tex.grain, 1));

      const cardAspect = pose.scale[0] / pose.scale[1];
      // fit the logo inside the face with padding, preserving its aspect
      const pad = 0.70;
      const la = lg ? lg.aspect : 1;
      let lw = pad;
      let lh = (pad * cardAspect) / la;
      if (lh > pad) { lh = pad; lw = (pad * la) / cardAspect; }
      gl.uniform2f(pr.u.uLogoScale, lw, lh);
      gl.uniform1f(pr.u.uRadius, 0.22);
      gl.uniform1f(pr.u.uAspect, cardAspect);
      gl.uniform1f(pr.u.uOpacity, s.mat);
      gl.uniform1f(pr.u.uMat, s.mat);
      gl.uniform1f(pr.u.uHover, c.hover);
      gl.uniform1f(pr.u.uTime, t);
      gl.uniform2f(pr.u.uLight, -pose.pos[0] * 0.5, -pose.pos[1] * 0.5 + 0.4);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Cache the projected quad for hit testing. The corners are +/-1 in
      // MODEL space - compose() already baked the card's size into the matrix.
      let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      for (const [sx, sy] of CORNERS) {
        const [px, py] = projectPoint(this.mvpTmp, sx, sy, 0);
        x0 = Math.min(x0, px); x1 = Math.max(x1, px);
        y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      c.screen = { x0, x1, y0, y1, w: it.w };
    }
    gl.bindVertexArray(null);

    // ---- 6b the stroke's nearest passes, OVER the cards --------------------
    // in the reference the line regularly crosses in front of the card shell;
    // clipping it behind them is what made the first attempt read as static
    gl.blendFunc(gl.ONE, gl.ONE);
    drawRibbon(NEAR_CARD_Z, 99);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // ---- 7 embers ----------------------------------------------------------
    gl.blendFunc(gl.ONE, gl.ONE);
    {
      const pr = this.progs.spark;
      gl.useProgram(pr.p);
      gl.uniformMatrix4fv(pr.u.uMVP, false, this.mvp);
      gl.uniform1f(pr.u.uTime, t);
      gl.uniform1f(pr.u.uConverge, s.converge * 0.55);
      gl.uniform1f(pr.u.uLife, 0.25 + 0.75 * s.wake);
      gl.uniform2f(pr.u.uPointer, ptr.x, ptr.y);
      gl.uniform1f(pr.u.uRes, H);
      const hp = this.ribbon.headPos;
      gl.uniform3f(pr.u.uHead, hp[0], hp[1], hp[2]);
      this.sparks.draw(Math.round(this.sparks.count * this.quality));
    }

    // ---- 8 post ------------------------------------------------------------
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.quad);
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
}

export { TOOLS };
