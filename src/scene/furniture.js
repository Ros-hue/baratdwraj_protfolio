// The DOM layer over the canvas: welcome strip, chips, edge arrows, dot grids
// and the header's chamfered rule.
//
// These are real text nodes rather than pixels, so they stay crisp, selectable
// and accessible. Their positions are driven from the same layout object the
// compositor uses, so they track the wordmark exactly at any viewport size.

import { REF } from './layout.js';

const DOT_COLS = 8;
const DOT_ROWS = 2;

export class Furniture {
  constructor(root = document) {
    this.root = document.documentElement;
    this.welcome = root.getElementById('welcome');
    this.chipArtist = root.getElementById('chipArtist');
    this.chipLegend = root.getElementById('chipLegend');
    this.arrowsL = root.getElementById('arrowsL');
    this.arrowsR = root.getElementById('arrowsR');
    this.dotsBR = root.getElementById('dotsBR');
    this.rule = root.getElementById('hdrRule');
    this.rulePath = root.getElementById('hdrRulePath');
    this.hdr = root.getElementById('hdr');
    this._build();
  }

  _build() {
    for (const [box, n] of [[this.arrowsL, REF.arrows.count],
      [this.arrowsR, REF.arrows.count]]) {
      box.innerHTML = '';
      for (let i = 0; i < n; i++) {
        const el = document.createElement('i');
        el.style.setProperty('--i', i);
        box.appendChild(el);
      }
    }
    for (const box of [this.dotsBR]) {
      box.innerHTML = '';
      for (let i = 0; i < DOT_COLS * DOT_ROWS; i++) {
        const el = document.createElement('i');
        // ripple outward from the corner rather than sweeping in reading order
        const col = i % DOT_COLS;
        const row = (i / DOT_COLS) | 0;
        el.style.setProperty('--i', col + row * 2);
        box.appendChild(el);
      }
    }
    this.hdr.querySelectorAll('.hdr__nav li').forEach((li, i) => {
      li.style.setProperty('--i', i);
    });
  }

  /** Re-anchor everything to the current layout. */
  apply(L) {
    const s = this.root.style;
    const { w, h, word, portrait } = L;

    s.setProperty('--welcome-y', `${L.welcomeY}px`);
    s.setProperty('--welcome-size',
      `${clampPx(word.capH * 0.125, 12, 30)}px`);

    const chip = clampPx(word.capH * (portrait ? 0.11 : 0.075), 9.5, 18);
    s.setProperty('--chip-size', `${chip}px`);
    s.setProperty('--artist-x', `${L.artist.x}px`);
    s.setProperty('--artist-y', `${L.artist.y}px`);
    // the LEGEND chip hangs off the right edge on a phone, so it is anchored by
    // its own measured width rather than by a guessed percentage
    const legendW = this.chipLegend.getBoundingClientRect().width || 0;
    const lx = L.legend.alignRight ? L.legend.x - legendW : L.legend.x;
    s.setProperty('--legend-x', `${lx}px`);
    s.setProperty('--legend-y', `${L.legend.y}px`);
    this.root.classList.toggle('is-portrait', !!portrait);

    s.setProperty('--arrow-l', `${w * REF.arrows.left}px`);
    s.setProperty('--arrow-r', `${w * REF.arrows.right}px`);
    s.setProperty('--arrow-top', `${h * REF.arrows.top}px`);
    s.setProperty('--arrow-span', `${h * (REF.arrows.bottom - REF.arrows.top)}px`);
    const ah = clampPx(h * 0.0125, 5, 11);
    s.setProperty('--arrow-h', `${ah}px`);
    s.setProperty('--arrow-w', `${ah * 1.55}px`);

    const dot = clampPx(w * 0.0088, 5, 15);
    s.setProperty('--dot-size', `${dot}px`);
    s.setProperty('--dot-gap', `${dot * 0.62}px`);
    s.setProperty('--dots-br-x', `${w * REF.dotsBR.x}px`);
    s.setProperty('--dots-br-y', `${h * REF.dotsBR.y}px`);

    this._rule(L);
    this.portrait = portrait;
  }

  /**
   * The header underline is a chamfered HUD bracket, not a straight rule: it
   * steps down at the left, runs across, and steps back up at the right.
   * Built in real pixels so the 45 degree corners stay 45 degrees.
   */
  _rule(L) {
    const { w } = L;
    const hdrH = this.hdr.getBoundingClientRect().height || 70;
    const y = Math.round(hdrH) - 0.5;
    const c = Math.min(26, Math.max(12, w * 0.016));   // chamfer run
    const rise = Math.min(14, c * 0.55);
    const pts = [
      [0, y - rise],
      [c, y],
      [w - c, y],
      [w, y - rise],
    ];
    this.rule.setAttribute('viewBox', `0 0 ${w} ${Math.ceil(hdrH) + 2}`);
    this.rulePath.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
    const len = this.rulePath.getTotalLength
      ? this.rulePath.getTotalLength() : w + 80;
    this.rule.style.setProperty('--len', `${Math.ceil(len)}`);
  }
}

function clampPx(v, lo, hi) {
  return Math.round(Math.min(hi, Math.max(lo, v)) * 100) / 100;
}
