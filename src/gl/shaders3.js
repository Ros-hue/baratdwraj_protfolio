// GLSL for the time machine.
//
// The palette is deliberately different from scene two: that room is lit by a
// pure red core, this one by warm amber tungsten with a red-hot indicator. Both
// sit on the same near-black, which is what makes them read as two rooms in one
// film rather than two different websites.

// NB vUV is flipped to y-DOWN. Every normalised coordinate handed to these
// shaders (the clock pivot, the floor centre, the node positions) is computed
// from CSS pixels, where y grows downward. Leaving vUV y-up silently renders
// the floor across the ceiling.
export const V3 = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vUV;
void main(){
  vUV = vec2(aPos.x, 1.0 - aPos.y);
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

// --------------------------------------------------------------------------
// The room: warm black, a reflective floor, and the ring mechanism the figure
// stands inside. Everything is drawn in one pass because it is all a function
// of screen position — there is no geometry here worth uploading.
// --------------------------------------------------------------------------
export const F3_ROOM = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uGrain;
uniform vec2  uRes;
uniform float uTime;
uniform float uAspect;
uniform float uWake;      // 0..1 the room comes up
uniform float uRings;     // 0..1 the floor mechanism engages
uniform vec2  uFloor;     // centre of the ring system, normalised
uniform vec2  uPivot;     // the clock's hand pivot
uniform float uHeat;      // how hot the active end of the timeline is
uniform vec2  uActive;    // screen position of the active year
uniform vec2  uFig;       // where the figure stands (x, feet y)
out vec4 frag;

const vec3 AMBER = vec3(1.00, 0.56, 0.20);
const vec3 EMBER = vec3(1.00, 0.22, 0.07);

// perspective floor: squash y so the rings read as ellipses lying flat
vec2 floorSpace(vec2 p, vec2 c){
  vec2 d = (p - c) * vec2(uAspect, 1.0);
  d.y /= 0.30;                       // viewing angle
  return d;
}

void main(){
  vec2 p = vUV;
  vec3 col = vec3(0.013, 0.010, 0.009);

  // --- ambient: a warm pool under the clock ------------------------------
  vec2 dp = (p - uPivot) * vec2(uAspect, 1.0);
  col += AMBER * 0.045 * exp(-dot(dp, dp) * 1.1) * uWake;

  // --- the floor ----------------------------------------------------------
  float horizon = 0.545;
  {
    // smoothstep rather than a hard cut: branching on the horizon leaves a
    // visible seam straight across the frame
    float onFloor = smoothstep(horizon - 0.05, horizon + 0.06, p.y);
    float depth = clamp((p.y - horizon) / (1.0 - horizon), 0.0, 1.0);

    // concentric rings. Each is offset in phase and speed so the mechanism
    // reads as several independent parts, not one spinning disc.
    vec2 fp = floorSpace(p, uFloor);
    float r = length(fp);
    float a = atan(fp.y, fp.x);

    // The pool of warm light behind the figure. The reference never lights the
    // man himself - it lights the floor BEHIND him and lets his silhouette
    // read dark against it. This is most of what makes him visible.
    vec2 fd = vec2((p.x - uFig.x) * uAspect, (p.y - uFig.y + 0.10) * 2.1);
    float pool = exp(-dot(fd, fd) * 3.4);
    col += vec3(1.0, 0.44, 0.16) * pool * 0.16 * uWake;

    float rings = 0.0;
    for(int i = 0; i < 5; i++){
      float fi = float(i);
      float R = 0.16 + fi * 0.135;
      float spin = uTime * (0.05 + fi * 0.023) * (mod(fi, 2.0) < 0.5 ? 1.0 : -1.4);
      float band = smoothstep(0.010, 0.0, abs(r - R));
      // a slow sweep of brightness travelling round each ring
      float sweep = 0.55 + 0.45 * sin(a * (1.0 + fi) + spin * 6.0);
      rings += band * sweep * (1.0 - fi * 0.14);
    }
    col += AMBER * rings * 0.5 * uRings * (1.0 - depth * 0.35) * onFloor
         * (1.0 + pool * 2.2);

    // wet reflection of the light above, streaked toward the viewer
    float streak = exp(-abs(p.x - uFloor.x) * uAspect * 2.0);
    col += AMBER * streak * 0.16 * (1.0 - depth) * uWake * onFloor;
    // the active year's heat spills onto the floor beneath it
    float hx = exp(-abs(p.x - uActive.x) * uAspect * 3.2);
    col += EMBER * hx * 0.20 * (1.0 - depth) * uHeat * onFloor;

    col *= mix(1.0, 0.35, depth * onFloor);
  }

  // --- vignette + grain ---------------------------------------------------
  float g = texture(uGrain, p * (uRes / 512.0) * 0.5 + vec2(uTime * 0.002, 0.0)).r;
  col += (g - 0.5) * 0.024;
  vec2 v = (p - 0.5) * vec2(uAspect, 1.0);
  col *= 1.0 - smoothstep(0.44, 1.16, length(v)) * 0.9;

  frag = vec4(col, 1.0);
}`;

// --------------------------------------------------------------------------
// The clock: a huge dial whose lower rim sweeps across the top of the frame,
// its tick marks, and the beam it throws at the active year.
// --------------------------------------------------------------------------
export const F3_CLOCK = `#version 300 es
precision highp float;
in vec2 vUV;
uniform vec2  uRes;
uniform float uTime;
uniform float uAspect;
uniform vec2  uPivot;     // where the hand turns
uniform vec2  uDialC;     // centre of the dial itself — not the same point
uniform float uDial;      // dial radius, in height units
uniform float uReveal;    // 0..1 the dial draws itself in
uniform float uHand;      // hand angle, radians — points at the active year
uniform float uHand2;     // the ornate secondary hand
uniform vec2  uTarget;    // where the beam lands (the active node), normalised
uniform float uBeam;      // 0..1 beam strength
uniform float uHeat;
out vec4 frag;

// a tapered clock hand along direction ang, from the pivot
float handShape(vec2 d, float ang, float len, float w0, float w1){
  vec2 hv = vec2(cos(ang), sin(ang));
  float along = dot(d, hv);
  float across = abs(d.x * hv.y - d.y * hv.x);
  if(along < 0.0 || along > len) return 0.0;
  float wid = mix(w0, w1, along / len);
  return smoothstep(wid, wid * 0.25, across);
}

const vec3 AMBER = vec3(1.00, 0.60, 0.24);
const vec3 EMBER = vec3(1.00, 0.20, 0.06);

void main(){
  vec2 p = vUV;
  vec2 d = (p - uPivot) * vec2(uAspect, 1.0);
  float r = length(d);
  float a = atan(d.y, d.x);
  vec3 col = vec3(0.0);
  float draw = smoothstep(0.0, 1.0, uReveal);

  // --- dial rim and ticks -------------------------------------------------
  // measured about the DIAL's centre, which sits above frame; only the shallow
  // lower sweep of that circle is ever visible, which is what makes the clock
  // read as enormous rather than as a ring floating in the corner
  vec2 dd = (p - uDialC) * vec2(uAspect, 1.0);
  float dr = length(dd);
  float da2 = atan(dd.y, dd.x);
  float onScreen = smoothstep(0.05, 0.45, da2) * smoothstep(3.10, 2.70, da2);

  float rim = smoothstep(0.0035, 0.0, abs(dr - uDial));
  col += AMBER * rim * 0.60 * onScreen * draw;
  float rim2 = smoothstep(0.0026, 0.0, abs(dr - uDial * 0.945));
  col += AMBER * rim2 * 0.32 * onScreen * draw;
  float rim3 = smoothstep(0.0030, 0.0, abs(dr - uDial * 1.07));
  col += AMBER * rim3 * 0.14 * onScreen * draw;

  // ticks: short radial dashes, longer every fifth
  {
    float n = da2 * 190.0 / 3.14159;
    float f = abs(fract(n) - 0.5);
    float major = step(0.5, abs(fract(n / 5.0) - 0.5) * 2.0 - 0.4);
    float tick = smoothstep(0.42, 0.48, f);
    float len = mix(0.011, 0.022, major);
    float inBand = smoothstep(len, 0.0, abs(dr - uDial * 0.972));
    col += AMBER * tick * inBand * (0.45 + 0.55 * major) * onScreen * draw;
  }

  // --- the beam thrown at the active year ---------------------------------
  // A cone of light from the pivot to the year it points at, with a hot core
  // line running its centre and a flood where it lands — the reference's
  // signature: the clock PROJECTS light into the timeline.
  float da = a - uHand;
  da = atan(sin(da), cos(da));
  float reach = smoothstep(1.30, 0.05, r);
  float wedge = exp(-da * da * 70.0);
  col += EMBER * wedge * reach * 0.50 * uBeam * (0.86 + 0.14 * sin(uTime * 2.2));
  col += mix(EMBER, vec3(1.0, 0.62, 0.34), 0.45)
       * exp(-da * da * 850.0) * reach * 0.80 * uBeam;
  // impact flood where the beam lands
  vec2 td = (p - uTarget) * vec2(uAspect, 1.0);
  col += vec3(1.0, 0.24, 0.08) * exp(-dot(td, td) * 160.0) * 1.1 * uBeam;
  col += vec3(1.0, 0.50, 0.24) * exp(-dot(td, td) * 950.0) * 1.3 * uBeam;

  // --- the primary hand: cream, tapered, riding inside the beam ------------
  float h1 = handShape(d, uHand, 0.34, 0.0050, 0.0010);
  col += vec3(1.0, 0.90, 0.78) * h1 * 1.05 * draw;

  // --- the ornate secondary hand -------------------------------------------
  // the reference pairs the beam with a decorative cream hand carrying a
  // pierced screw ornament partway down and a fine needle tip
  float h2 = handShape(d, uHand2, 0.30, 0.0056, 0.0008);
  col += vec3(0.98, 0.84, 0.66) * h2 * 0.95 * draw;
  {
    vec2 hv2 = vec2(cos(uHand2), sin(uHand2));
    // the pierced screw-head ornament, just short of halfway down the hand:
    // a four-lobed clover (one lobe aligned with the hand) with a bored centre
    vec2 orn = hv2 * 0.135;
    vec2 ov = d - orn;
    float od = length(ov);
    float oa = atan(ov.y, ov.x);
    float orad = 0.0110 * (0.72 + 0.28 * cos(4.0 * (oa - uHand2)));
    float rose = smoothstep(orad, orad * 0.70, od)
               * smoothstep(0.0036, 0.0052, od);
    col += vec3(0.98, 0.86, 0.70) * rose * 1.0 * draw;
    // needle: a brighter core line beyond the ornament
    float h2c = handShape(d, uHand2, 0.30, 0.0016, 0.0004);
    float outer = smoothstep(0.15, 0.19, dot(d, hv2));
    col += vec3(1.0, 0.96, 0.90) * h2c * outer * 0.9 * draw;
  }

  // --- pivot: a shaded ball, lit from upper left ---------------------------
  {
    float ball = smoothstep(0.0165, 0.0135, r);
    vec2 hi = d - vec2(-0.005, -0.005);
    float sheen = exp(-dot(hi, hi) * 9000.0);
    col += (vec3(0.92, 0.80, 0.66) * 0.85 + vec3(1.0, 0.98, 0.94) * sheen) * ball * draw;
    col += AMBER * exp(-r * r * 900.0) * 0.5 * draw;      // warm halo
  }

  frag = vec4(col, 1.0);
}`;

// --------------------------------------------------------------------------
// The timeline arc, its nodes, and the energy that travels along it.
// --------------------------------------------------------------------------
export const F3_TRACK = `#version 300 es
precision highp float;
in vec2 vUV;
uniform vec2  uRes;
uniform float uTime;
uniform float uAspect;
uniform vec3  uArc;        // centre x, centre y, radius (normalised, height units)
uniform vec2  uSpan;       // start and end angle of the visible arc
uniform float uReveal;     // 0..1 the line draws itself from 2021 forward
uniform float uActiveU;    // continuous position of the active year, 0..5
uniform float uHeat;
uniform vec2  uNodes[6];
uniform float uNodeIn[6];  // per-node materialisation
out vec4 frag;

const vec3 AMBER = vec3(1.00, 0.62, 0.26);
const vec3 EMBER = vec3(1.00, 0.24, 0.08);

void main(){
  vec2 p = vUV;
  vec2 d = (p - uArc.xy) * vec2(uAspect, 1.0);
  float r = length(d);
  float a = atan(d.y, d.x);
  vec3 col = vec3(0.0);

  // --- the rail -----------------------------------------------------------
  // u runs 0..1 from the 2021 end to the 2026 end
  float u = clamp((a - uSpan.x) / (uSpan.y - uSpan.x), 0.0, 1.0);
  float within = step(min(uSpan.x, uSpan.y) - 0.02, a)
               * step(a, max(uSpan.x, uSpan.y) + 0.02);
  float drawn = smoothstep(uReveal + 0.02, uReveal - 0.06, u);

  // the reference rail is a double track with a soft glow between the lines
  float line = smoothstep(0.0016, 0.0, abs(r - (uArc.z - 0.0035)));
  float line2 = smoothstep(0.0014, 0.0, abs(r - (uArc.z + 0.0035)));
  float glow = exp(-pow((r - uArc.z) / 0.011, 2.0));
  col += AMBER * (line * 0.85 + line2 * 0.55 + glow * 0.24) * within * drawn;

  // fine minute-ticks hanging just beneath the rail
  {
    float tn = a * 260.0 / 3.14159;
    float tf = smoothstep(0.40, 0.47, abs(fract(tn) - 0.5));
    float band2 = smoothstep(0.0, 0.004, r - (uArc.z + 0.006))
                * smoothstep(0.017, 0.009, r - (uArc.z + 0.006));
    col += AMBER * tf * band2 * 0.30 * within * drawn;
  }

  // energy running along the rail toward the active year
  float head = uActiveU / 5.0;
  float chase = fract(u * 2.4 - uTime * 0.28);
  float pulse = pow(max(0.0, 1.0 - abs(u - head) * 6.0), 2.0);
  col += EMBER * (line + line2 * 0.6) * (0.55 * pulse + 0.20 * pow(chase, 8.0))
       * within * drawn * (0.6 + 0.4 * uHeat);

  // the stretch already travelled runs hotter than the stretch ahead
  col += EMBER * line * smoothstep(head + 0.04, head - 0.10, u) * 0.30 * within * drawn;

  // --- nodes --------------------------------------------------------------
  for(int i = 0; i < 6; i++){
    vec2 nd = (p - uNodes[i]) * vec2(uAspect, 1.0);
    float ndr = length(nd);
    float near = 1.0 - clamp(abs(float(i) - uActiveU), 0.0, 1.0);
    float k = uNodeIn[i];
    col += vec3(1.0, 0.88, 0.74) * smoothstep(0.0055, 0.0015, ndr) * k;
    col += mix(AMBER, EMBER, near) * exp(-ndr * ndr * 2600.0) * (0.5 + 0.9 * near) * k;
    // the active node throws a wider halo
    col += EMBER * exp(-ndr * ndr * 420.0) * 0.42 * near * k * uHeat;
  }

  frag = vec4(col, 1.0);
}`;

// --------------------------------------------------------------------------
// The figure. As in scene two only his SHAPE comes from the artwork; the amber
// rim is generated here so he is lit by this room.
// --------------------------------------------------------------------------
export const V3_QUAD = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
uniform vec4 uRect;    // x, y, w, h in pixels
uniform vec2 uRes;
out vec2 vUV;
void main(){
  vUV = aPos;
  vec2 px = uRect.xy + aPos * uRect.zw;
  gl_Position = vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0);
}`;

export const F3_FIGURE = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uFig;
uniform sampler2D uGrain;
uniform float uOpacity;
uniform float uRim;
uniform vec2  uLightDir;   // toward the active year
uniform float uHeat;
out vec4 frag;

void main(){
  // vUV is already y-down from V3_QUAD and the texture is uploaded unflipped,
  // so v maps straight through; inverting here stands him on his head
  vec4 s = texture(uFig, vUV);
  float a = s.a;
  if(a <= 0.004) discard;

  // dark, not black: enough base for the suit's folds to exist
  vec3 col = s.rgb * 0.105 + vec3(0.022, 0.011, 0.007) * a;

  // rim from the matte's own gradient, so it rides his real outline
  vec2 texel = vec2(1.0) / vec2(textureSize(uFig, 0));
  float ax = texture(uFig, vUV + vec2(texel.x, 0.0)).a
           - texture(uFig, vUV - vec2(texel.x, 0.0)).a;
  float ay = texture(uFig, vUV + vec2(0.0, texel.y)).a
           - texture(uFig, vUV - vec2(0.0, texel.y)).a;
  vec2 n = vec2(-ax, -ay);
  float edge = length(n);
  if(edge > 0.001){
    vec2 nn = normalize(n);
    // key rim from the active-year side, plus a weaker fill on the opposite
    // edge and a halo on upward-facing hair — the reference wraps him softly
    // on BOTH sides rather than etching one hard outline
    float key = clamp(dot(nn, normalize(uLightDir)), 0.0, 1.0);
    float fill = clamp(dot(nn, normalize(vec2(-uLightDir.x, uLightDir.y))), 0.0, 1.0);
    float up = clamp(-nn.y, 0.0, 1.0);
    col += vec3(1.0, 0.55, 0.22) * pow(key, 5.0) * edge * 4.2 * uRim;
    col += vec3(1.0, 0.40, 0.15) * pow(fill, 5.0) * edge * 2.0 * uRim;
    col += vec3(1.0, 0.60, 0.28) * pow(up, 3.0) * edge * 1.4 * uRim;
    col += vec3(1.0, 0.28, 0.10) * pow(key, 2.5) * edge * 0.8 * uRim * uHeat;
  }
  // the floor pool throws warmth back up at his legs
  col += vec3(1.0, 0.44, 0.17) * smoothstep(0.55, 1.0, vUV.y) * 0.16 * uRim * a;

  float g = texture(uGrain, gl_FragCoord.xy / 512.0).r;
  col += (g - 0.5) * 0.018;

  float o = a * uOpacity;
  frag = vec4(col * o, o);
}`;

// --------------------------------------------------------------------------
// The nearest arcs of the floor mechanism, drawn OVER the figure's feet. This
// is what plants him INSIDE the machine instead of on top of a backdrop: the
// far side of every ring passes behind him, the near side in front.
// --------------------------------------------------------------------------
export const F3_RINGS_FRONT = `#version 300 es
precision highp float;
in vec2 vUV;
uniform float uTime;
uniform float uAspect;
uniform float uRings;
uniform vec2  uFloor;
uniform float uCut;       // only rows below this are near-side floor
out vec4 frag;

void main(){
  vec2 p = vUV;
  if(p.y < uCut){ discard; }
  vec2 d = (p - uFloor) * vec2(uAspect, 1.0);
  d.y /= 0.30;
  float r = length(d);
  float a = atan(d.y, d.x);
  float e = 0.0;
  for(int i = 0; i < 5; i++){
    float fi = float(i);
    float R = 0.16 + fi * 0.135;
    float spin = uTime * (0.05 + fi * 0.023) * (mod(fi, 2.0) < 0.5 ? 1.0 : -1.4);
    float band = smoothstep(0.010, 0.0, abs(r - R));
    float sweep = 0.55 + 0.45 * sin(a * (1.0 + fi) + spin * 6.0);
    e += band * sweep * (1.0 - fi * 0.14);
  }
  float soft = smoothstep(uCut, uCut + 0.03, p.y);
  vec3 col = vec3(1.0, 0.56, 0.20) * e * 0.30 * uRings * soft;
  frag = vec4(col, 0.0);
}`;

// --------------------------------------------------------------------------
export const F3_POST = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uGrain;
uniform vec2 uRes;
uniform float uTime;
uniform float uAmount;
uniform float uAspect;
out vec4 frag;
void main(){
  vec2 j = vec2(fract(sin(uTime * 12.9898) * 43758.5453),
                fract(sin(uTime * 78.233) * 12345.6789));
  float g = texture(uGrain, vUV * (uRes / 512.0) + j).r - 0.5;
  vec2 v = (vUV - 0.5) * vec2(uAspect, 1.0);
  frag = vec4(vec3(g * uAmount), smoothstep(0.48, 1.2, length(v)) * 0.45);
}`;
