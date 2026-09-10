// The finale - the closing shot, built from the reference's own pixels.
// The plate (wordmark + red fog + his smoke) and the matted man are cut from
// Footer image.jpg by tools/extract_fin.py; these shaders stage the reveal
// and keep the frame breathing.

export const V6 = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUV;
void main(){
  vUV = vec2(aPos.x, 1.0 - aPos.y);
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

// --------------------------------------------------------------------------
// The plate, staged. Two gates ride the sequence: uGlow lifts the dim red
// world (fog first), uWord brings up the bright content - the wordmark
// emerges through the fog, sharpening as it comes. On top: a slow breathing
// pulse and a whisper of drifting live fog so the photograph never freezes.
// --------------------------------------------------------------------------
export const F6_PLATE = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uPlate;
uniform sampler2D uGrain;
uniform vec4  uCover;     // viewport uv -> frame fraction
uniform float uTime;
uniform float uAspect;
uniform float uGlow;      // the red world's exposure
uniform float uWord;      // the bright content's arrival + sharpness
uniform vec2  uPar;
out vec4 frag;

vec3 plateAt(vec2 p){ return texture(uPlate, clamp(p, 0.001, 0.999)).rgb; }

void main(){
  vec2 uv = vUV + vec2(-uPar.x * 0.006, -uPar.y * 0.004);
  vec2 p = uv * uCover.xy + uCover.zw;

  // blur -> sharp as the title card arrives
  float rad = (1.0 - uWord) * 0.012;
  vec3 base = plateAt(p);
  if(rad > 0.0005){
    vec3 acc = base;
    acc += plateAt(p + vec2(rad, 0.0));
    acc += plateAt(p - vec2(rad, 0.0));
    acc += plateAt(p + vec2(0.0, rad * uAspect));
    acc += plateAt(p - vec2(0.0, rad * uAspect));
    base = acc * 0.2;
  }

  // staging: dim ember world first, bright content gated by its own
  // luminance so the wordmark surfaces through the fog
  float lum = dot(base, vec3(0.299, 0.587, 0.114));
  float bright = smoothstep(0.30, 0.58, lum);
  float gate = uGlow * (1.0 - bright) + uWord * bright;
  float breathe = 1.0 + 0.035 * sin(uTime * 0.5) * uGlow;
  vec3 col = base * (0.03 + 0.97 * gate) * breathe;

  // a whisper of live fog, red, only where the plate already glows
  float g1 = texture(uGrain, p * vec2(0.55, 0.48)
                     + vec2(uTime * 0.008, -uTime * 0.013)).r;
  float g2 = texture(uGrain, p * vec2(1.2, 1.0)
                     + vec2(-uTime * 0.005, -uTime * 0.020)).r;
  float billow = smoothstep(0.25, 0.95, g1 * 0.6 + g2 * 0.4);
  float glowMass = smoothstep(0.05, 0.35, lum) * (1.0 - bright);
  col += vec3(0.42, 0.05, 0.03) * billow * glowMass * 0.16 * uGlow;

  // film grain
  float g = texture(uGrain, p * 3.6 + vec2(uTime * 0.09, 0.0)).r;
  col += (g - 0.5) * 0.016 * uGlow;

  frag = vec4(col, 1.0);
}`;

// --------------------------------------------------------------------------
// The man - the reference's own pixels, so his grade and rim are exact. He
// arrives on his opacity alone; his edges are already film-soft.
// --------------------------------------------------------------------------
export const F6_MAN = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uMan;
uniform vec4  uRect;      // his quad in viewport fractions
uniform float uOp;
out vec4 frag;

void main(){
  vec2 l = (vUV - uRect.xy) / uRect.zw;
  if(l.x < 0.0 || l.x > 1.0 || l.y < 0.0 || l.y > 1.0) discard;
  vec4 s = texture(uMan, l);
  if(s.a < 0.004) discard;
  frag = vec4(s.rgb * s.a * uOp, s.a * uOp);
}`;

// --------------------------------------------------------------------------
// Foreground smoke, drawn OVER the man: a thin red veil drifting up through
// the final frame. Additive and very quiet.
// --------------------------------------------------------------------------
export const F6_SMOKE = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uGrain;
uniform float uTime;
uniform float uAspect;
uniform float uOp;
uniform vec2  uPar;
out vec4 frag;

void main(){
  vec2 p = vUV + vec2(uPar.x * 0.010, uPar.y * 0.006);
  float g1 = texture(uGrain, p * vec2(0.7, 0.55) + vec2(uTime * 0.005, -uTime * 0.018)).r;
  float g2 = texture(uGrain, p * vec2(1.6, 1.25) + vec2(-uTime * 0.008, -uTime * 0.027)).r;
  float smoke = smoothstep(0.45, 0.95, g1 * 0.6 + g2 * 0.4);
  float band = smoothstep(0.10, 0.55, vUV.y);
  vec3 col = vec3(0.55, 0.10, 0.06) * smoke * band * 0.10 * uOp;
  frag = vec4(col, 0.0);
}`;
