// Scene four's lifecycle: rebuild the reference as living layers, then run
// the assembly. The environment is canvas (gallery.js); the twelve project
// cards are DOM buttons wearing sprites cut from the reference itself; the
// figure is the reference's own pixels, matted. Everything is placed through
// one fitCover() mapping, so the layers agree to the pixel.
//
// Interaction model:
//   pointer  -> a damped -1..1 pair; the deck yaws a couple of degrees, each
//               card drifts by its depth (near flanks move most, the far row
//               least), the figure counters gently, the plate slides opposite
//   hover    -> the card lifts toward the camera; its siblings ease back
//   scroll   -> past the intro, the whole universe dollies subtly toward you

import { createGL } from '../gl/renderer.js';
import { Gallery } from './gallery.js';
import { CARDS, PERSON, PORTRAIT, fitCover } from './layout4.js';
import { sample4, cardIn, popEase, T4 } from './timeline4.js';

const damp = (v, to, k, dt) => v + (to - v) * (1 - Math.exp(-k * dt));

export async function initGallery() {
  const section = document.getElementById('gallery');
  const canvas = document.getElementById('galleryStage');
  const deck = document.getElementById('galleryDeck');
  const person = document.getElementById('galleryPerson');
  if (!section || !canvas || !deck || !person) return null;

  const gl = createGL(canvas);
  if (!gl) {
    section.classList.add('is-fallback', 'is-set');
    return null;
  }
  const gallery = new Gallery(canvas, gl);
  await gallery.load();

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const labels = [...section.querySelectorAll('.g-label')];
  const num = document.getElementById('galleryNum');

  // ---- cards ---------------------------------------------------------------
  // far row surfaces first: entrance order is depth-sorted, back to front
  const order = CARDS.map((c, i) => i)
    .sort((a, b) => CARDS[b].depth - CARDS[a].depth);
  const rank = [];
  order.forEach((ci, k) => { rank[ci] = k; });

  const cards = CARDS.map((c, i) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'g-card';
    el.dataset.i = String(i);
    el.setAttribute('aria-label', `Project — ${c.title}`);
    el.style.setProperty('--tint',
      `rgba(${c.tint.map((v, k) => k < 3 ? Math.round(v * 255) : v)}, 0.5)`);
    el.style.zIndex = String(10 + Math.round((1 - c.depth) * 20));
    el.style.setProperty('--i', String(i));   // float dephasing
    el.innerHTML = `<span class="g-card__in">`
      + `<img src="public/projects/${c.id}.png" alt="" `
      + `draggable="false" loading="eager" decoding="async"></span>`;
    deck.appendChild(el);
    return el;
  });
  person.style.zIndex = '34';

  // ---- placement -----------------------------------------------------------
  let portrait = false;
  function place() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const f = gallery.resize(w, h, dpr);
    portrait = w / h < 0.75;
    section.classList.toggle('is-portrait', portrait);

    for (let i = 0; i < cards.length; i++) {
      const c = CARDS[i];
      const el = cards[i];
      if (portrait) {
        const p = PORTRAIT.get(i);
        if (!p) { el.style.display = 'none'; continue; }
        el.style.display = '';
        const cw = p.w * w;
        el.style.width = `${cw}px`;
        el.style.left = `${p.cx * w - cw / 2}px`;
        el.style.top = `${p.cy * h - (cw * c.box[3] / c.box[2]) / 2}px`;
      } else {
        el.style.display = '';
        el.style.width = `${c.box[2] * f.s}px`;
        el.style.left = `${c.box[0] * f.s + f.ox}px`;
        el.style.top = `${c.box[1] * f.s + f.oy}px`;
      }
    }

    // the red 01 belongs to the composition, not the viewport corners: it
    // rides just over the hero screen's top-left, where the reference puts it
    if (num && !portrait) {
      num.style.left = `${588 * f.s + f.ox}px`;
      num.style.top = `${46 * f.s + f.oy}px`;
      num.style.fontSize = `${Math.max(10, 15 * f.s)}px`;
    }

    // The figure keeps the plate's own cover mapping in EVERY orientation:
    // he must sit exactly over the hole the extractor filled behind him, or
    // the fill's soft edge reads as a box around his silhouette.
    person.style.width = `${PERSON.w * f.s}px`;
    person.style.left = `${PERSON.x * f.s + f.ox}px`;
    person.style.top = `${PERSON.y * f.s + f.oy}px`;
  }
  place();
  let resizeId;
  window.addEventListener('resize', () => {
    clearTimeout(resizeId);
    resizeId = setTimeout(place, 140);
  });

  // ---- pointer -------------------------------------------------------------
  const ptr = { tx: 0, ty: 0, x: 0, y: 0, inside: false };
  section.addEventListener('pointermove', (e) => {
    const r = section.getBoundingClientRect();
    ptr.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
    ptr.ty = ((e.clientY - r.top) / r.height) * 2 - 1;
    ptr.inside = true;
  }, { passive: true });
  section.addEventListener('pointerleave', () => { ptr.inside = false; });

  // hover: the deck learns something is hot so siblings can ease back
  deck.addEventListener('pointerover', (e) => {
    if (e.target.closest('.g-card')) deck.classList.add('is-hot');
  });
  deck.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget || !e.relatedTarget.closest('.g-card')) {
      deck.classList.remove('is-hot');
    }
  });

  // ---- the clock -----------------------------------------------------------
  const state = { started: 0, running: false, visible: false, raf: 0, last: 0, set: false };

  const frame = (now) => {
    if (!state.running) return;
    const dt = Math.min(0.05, (now - state.last) / 1000 || 0.016);
    state.last = now;
    const t = reduced ? T4.live + 2 : (now - state.started) / 1000;
    const s = sample4(t);

    // scroll dolly: progress of the pin through its extra scroll room
    const r = section.getBoundingClientRect();
    const room = section.offsetHeight - window.innerHeight;
    const sp = room > 4 ? Math.min(1, Math.max(0, -r.top / room)) : 0;

    ptr.x = damp(ptr.x, ptr.inside ? ptr.tx : 0, 2.8, dt);
    ptr.y = damp(ptr.y, ptr.inside ? ptr.ty : 0, 2.8, dt);
    gallery.par.x = ptr.x;
    gallery.par.y = ptr.y;
    gallery.dolly = sp;
    gallery.render(t, s);

    // the deck yaws with the pointer - the "looking around the room" degree
    const live = s.live ? 1 : 0;
    deck.style.transform =
      `rotateY(${(ptr.x * 2.1 * live).toFixed(3)}deg) `
      + `rotateX(${(-ptr.y * 1.4 * live).toFixed(3)}deg) `
      + `scale(${(1 + sp * 0.045).toFixed(4)})`;

    for (let i = 0; i < cards.length; i++) {
      if (portrait && !PORTRAIT.get(i)) continue;
      const el = cards[i];
      const d = CARDS[i].depth;
      const e = popEase(cardIn(s.deck, rank[i], cards.length));
      const rise = (1 - e) * (0.42 * window.innerHeight);
      const str = (6 + (1 - d) * 26) * live;
      const tx = ptr.x * str;
      const ty = ptr.y * str * 0.55;
      el.style.transform =
        `translate3d(${tx.toFixed(2)}px, ${(ty + rise).toFixed(2)}px, 0) `
        + `rotateX(${((1 - e) * -24).toFixed(2)}deg) `
        + `rotateZ(${((1 - e) * (i % 2 ? 3.5 : -3.5)).toFixed(2)}deg) `
        + `scale(${(0.84 + e * 0.16).toFixed(4)})`;
      const op = Math.min(1, Math.max(0, e * 2.4));
      el.style.opacity = op.toFixed(3);
      // blur -> sharp is part of the pop; cleared once settled so hover and
      // floating never pay for a live filter
      if (e < 0.995) {
        el.style.filter = `blur(${((1 - Math.min(1, e)) * 7).toFixed(2)}px)`;
      } else if (el.style.filter) {
        el.style.filter = '';
      }
    }

    // the figure: rises into the light after his gallery is mostly up
    const pe = s.person;
    person.style.transform =
      `translate3d(${(ptr.x * -9 * live).toFixed(2)}px, `
      + `${(ptr.y * -5 * live + (1 - pe) * 34).toFixed(2)}px, 0) `
      + `scale(${(0.985 + pe * 0.015 + sp * 0.03).toFixed(4)})`;
    person.style.opacity = pe.toFixed(3);

    if (s.labels > 0 && !state.set) {
      state.set = true;
      section.classList.add('is-labels');
    }
    if (s.live) section.classList.add('is-live');

    state.raf = requestAnimationFrame(frame);
  };

  const start = () => {
    if (state.running) return;
    state.running = true;
    state.last = performance.now();
    if (!state.started) state.started = performance.now();
    state.raf = requestAnimationFrame(frame);
  };
  const stop = () => { state.running = false; cancelAnimationFrame(state.raf); };

  new IntersectionObserver((entries) => {
    for (const e of entries) {
      state.visible = e.isIntersecting;
      if (e.isIntersecting) start(); else stop();
    }
  }, { threshold: 0.22 }).observe(section);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stop();
    else if (state.visible) start();
  });

  labels.forEach((el, i) => el.style.setProperty('--li', String(i)));

  // review hook: canvas only (the cards are DOM; screenshot the pane for those)
  window.__shot4 = async (name = 'gallery', at = null) => {
    const t = at !== null ? at : (performance.now() - state.started) / 1000;
    gallery.render(t, sample4(t));
    const url = canvas.toDataURL('image/png');
    await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
    return `${canvas.width}x${canvas.height} @ t=${t.toFixed(2)}`;
  };
  window.__gallery = { gallery, state, section };

  return { gallery, section };
}
