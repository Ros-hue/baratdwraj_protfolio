// GLSL for the hero compositor.
//
// Every clip arrives "packed": the left half of the video frame is premultiplied
// colour, the right half is the alpha matte. Unpacking here is what gives real
// per-pixel transparency in every browser, including Safari, which supports
// neither WebM alpha nor HEVC alpha on Windows-encoded files.

export const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;          // unit quad 0..1
uniform vec4 uRect;                        // x, y, w, h in pixels
uniform vec2 uRes;
uniform vec4 uUV;                          // sub-rect in the source texture
uniform vec2 uSkew;                        // parallax / drift offset in pixels
out vec2 vUV;
out vec2 vLocal;
out vec2 vScreen;
void main(){
  vLocal = aPos;
  vUV = uUV.xy + aPos * uUV.zw;
  vec2 px = uRect.xy + aPos * uRect.zw + uSkew;
  vScreen = px / uRes;
  vec2 clip = vec2(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
}`;

// --------------------------------------------------------------------------
// Background: not a flat fill. A flat #000 reads as "screen off"; the reference
// art has a faint mottled black, so the plate gets a low-amplitude texture, a
// deep vignette and a slow red ember behind the wordmark.
// --------------------------------------------------------------------------
export const FRAG_BG = `#version 300 es
precision highp float;
in vec2 vScreen;
uniform sampler2D uGrain;
uniform vec2 uRes;
uniform float uTime;
uniform float uEmber;      // 0..1 glow behind the type
uniform vec2  uEmberAt;    // normalised centre
uniform float uAspect;
out vec4 frag;

void main(){
  vec2 p = vScreen;
  float g = texture(uGrain, p * (uRes / 512.0) * 0.6 + vec2(uTime * 0.004, 0.0)).r;

  vec3 col = vec3(0.008, 0.008, 0.010);
  col += (g - 0.5) * 0.035;                       // mottled plate

  vec2 d = (p - uEmberAt) * vec2(uAspect, 1.0);
  float ember = exp(-dot(d, d) * 2.4);
  col += vec3(0.115, 0.012, 0.014) * ember * uEmber;

  vec2 v = (p - 0.5) * vec2(uAspect, 1.0);
  float vig = 1.0 - smoothstep(0.38, 1.15, length(v));
  col *= mix(0.35, 1.0, vig);

  frag = vec4(col, 1.0);
}`;

// --------------------------------------------------------------------------
// Letter: glyph coverage from the word atlas, surfaced with the distressed
// texture lifted from the supplied artwork, and revealed by a directional
// dissolve rather than a plain opacity fade.
// --------------------------------------------------------------------------
export const FRAG_LETTER = `#version 300 es
precision highp float;
in vec2 vUV;
in vec2 vLocal;
in vec2 vScreen;
uniform sampler2D uGlyph;
uniform sampler2D uGrunge;
uniform vec2  uGrungeScale;
uniform vec2  uGrungeOffset;
uniform vec3  uInk;
uniform float uOpacity;
uniform float uReveal;      // 0..1 dissolve
uniform float uSoften;      // simulated defocus while materialising
uniform float uEdgeLight;
uniform float uWear;        // how distressed the paint is
uniform float uWearGain;    // contrast of the wear pattern
out vec4 frag;

// Directional smear along the axis the letter is travelling. Blurring in x too
// would sample the NEIGHBOURING letter out of the shared atlas and ghost it into
// this one; a vertical-only smear is also the honest read of a rising object.
float glyph(vec2 uv, float r){
  if(r < 0.0002) return texture(uGlyph, uv).r;
  float a = texture(uGlyph, uv).r * 0.30;
  a += texture(uGlyph, uv + vec2(0.0,  r      )).r * 0.20;
  a += texture(uGlyph, uv + vec2(0.0, -r      )).r * 0.20;
  a += texture(uGlyph, uv + vec2(0.0,  r * 2.1)).r * 0.15;
  a += texture(uGlyph, uv + vec2(0.0, -r * 2.1)).r * 0.15;
  return a;
}

void main(){
  float cov = glyph(vUV, uSoften);
  if(cov <= 0.001) discard;

  // Two octaves of the same worn plate: a coarse one for blotching and abrasion,
  // a fine one for the scratches. Sampled in SCREEN space, so it reads as one
  // continuous distressed sheet lying across the whole wordmark.
  vec2 gu = vScreen * uGrungeScale + uGrungeOffset;
  float tex = texture(uGrunge, gu).r;
  float tex2 = texture(uGrunge, gu * 3.1 + vec2(0.37, 0.11)).r;
  float wear = mix(tex, tex2, 0.42);
  wear = clamp((wear - 0.5) * uWearGain + 0.5, 0.0, 1.0);

  // the artwork red is not flat: scratches drop it toward a dried oxblood, and
  // the untouched paint sits a little hotter than the base ink
  vec3 col = uInk * mix(1.0 - uWear, 1.0 + uWear * 0.30, wear);
  col = mix(col, uInk * vec3(0.42, 0.30, 0.30),
            smoothstep(0.30, 0.02, wear) * uWear * 1.2);

  // a hair of lift along the top of each stroke, as if lit from above
  float lift = smoothstep(0.0, 0.22, 1.0 - vLocal.y);
  col += uInk * lift * uEdgeLight * 0.28;

  // dissolve: threshold the texture so the letter emerges in flecks rather than
  // fading uniformly. n is the "appears last" field - low n surfaces first, so
  // the letter builds from its base upward through the worn grain.
  float n = wear * 0.55 + vLocal.y * 0.45;
  float m = clamp((uReveal * 1.4 - n) / 0.4, 0.0, 1.0);
  float a = cov * uOpacity * m;

  frag = vec4(col * a, a);
}`;

// --------------------------------------------------------------------------
// Figure: unpack colour+matte, grade it into the scene, optionally clip it to a
// glyph so the person genuinely lives inside a letter.
// --------------------------------------------------------------------------
export const FRAG_FIGURE = `#version 300 es
precision highp float;
in vec2 vUV;
in vec2 vLocal;
in vec2 vScreen;
uniform sampler2D uClip;      // packed video
uniform sampler2D uGrunge;
uniform sampler2D uMask;      // glyph coverage, when clipping into a letter
uniform vec4  uMaskUV;
uniform float uUseMask;
uniform float uOpacity;
uniform float uReveal;
uniform float uFeetFade;      // dissolve the floor contact into darkness
uniform float uTopFade;
uniform float uExposure;
uniform float uLift;          // shadow lift toward cool blue
uniform float uRimRed;        // bounce from the red typography
uniform float uContrast;
uniform float uDesat;
uniform vec2  uTexel;
uniform float uFloorY;        // frame-space start of the glossy-floor band
uniform vec2  uBand;          // wordmark cap-top / baseline in screen space
out vec4 frag;

// uv arrives in FRAME space (0..1 over the source video). That lets a figure be
// drawn on a quad that is not its own rectangle - which is exactly what putting
// a person inside a letter requires: the quad is the glyph, the sampling is his.
vec4 sampleClip(vec2 uv){
  if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  // colour occupies the left half, matte the right; inset by a texel so chroma
  // subsampling across the seam cannot bleed one into the other
  vec2 c = vec2(clamp(uv.x * 0.5, uTexel.x, 0.5 - uTexel.x), uv.y);
  vec3 col = texture(uClip, c).rgb;
  float a = texture(uClip, c + vec2(0.5, 0.0)).r;
  return vec4(col, a);
}

void main(){
  vec4 s = sampleClip(vUV);
  float a = s.a;
  if(a <= 0.004) discard;
  vec3 col = s.rgb / max(a, 0.06);        // undo premultiply before grading

  // --- grade -------------------------------------------------------------
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, 1.0 - uDesat);
  col = (col - 0.5) * uContrast + 0.5;
  col *= uExposure;
  col += vec3(0.010, 0.014, 0.030) * uLift * (1.0 - smoothstep(0.0, 0.5, l));

  // Red bounce from the wall of type behind him. Keyed off the MATTE, not the
  // quad, so it lands as a rim light on his actual silhouette - and gated to
  // the rows where the wordmark actually sits behind him. A red edge on his
  // shins, below the baseline where there is only blackness, reads as a fault.
  float edge = 1.0 - smoothstep(0.20, 0.90, s.a);
  float behindType = smoothstep(uBand.x - 0.04, uBand.x + 0.03, vScreen.y)
                   * (1.0 - smoothstep(uBand.y - 0.02, uBand.y + 0.05, vScreen.y));
  col += vec3(0.80, 0.10, 0.11) * uRimRed * edge * mix(0.12, 1.0, behindType);

  col = max(col, vec3(0.0));

  // --- coverage ----------------------------------------------------------
  if(uUseMask > 0.5){
    vec2 mu = uMaskUV.xy + vLocal * uMaskUV.zw;
    a *= texture(uMask, mu).r;
  }
  a *= smoothstep(0.0, uFeetFade, 1.0 - vLocal.y);
  a *= smoothstep(0.0, uTopFade, vLocal.y);

  // Glossy-floor band of the source frame. Reflections and specular smears
  // around the shoes survive the key with high alpha, so gating coverage alone
  // cannot remove them - they are bright PIXELS, not soft edges. The band is
  // therefore also driven down toward black, which both kills the halo and
  // reads correctly: he is standing in darkness, not on a lit studio floor.
  if(uFloorY < 1.0 && vUV.y > uFloorY){
    float depth = clamp((vUV.y - uFloorY) / max(1.0 - uFloorY, 1e-3), 0.0, 1.0);
    a *= mix(1.0, smoothstep(0.40, 0.82, a), min(depth * 1.6, 1.0));
    col *= mix(1.0, 0.10, smoothstep(0.0, 0.95, depth));
  }

  float n = texture(uGrunge, vLocal * vec2(1.7, 0.9) + vec2(0.13, 0.41)).r;
  float field = n * 0.45 + (1.0 - vLocal.y) * 0.55;   // surfaces feet-first
  a *= clamp((uReveal * 1.4 - field) / 0.4, 0.0, 1.0) * uOpacity;

  frag = vec4(col * a, a);
}`;

// --------------------------------------------------------------------------
// Contact shadow. The single cheapest thing that stops a keyed figure looking
// pasted on: some darkness that belongs to him, falling on what is behind him.
// --------------------------------------------------------------------------
export const FRAG_SHADOW = `#version 300 es
precision highp float;
in vec2 vLocal;
uniform float uOpacity;
uniform vec2  uFalloff;   // horizontal, vertical softness
out vec4 frag;
void main(){
  vec2 d = (vLocal - vec2(0.5, 1.0)) / uFalloff;
  float a = exp(-dot(d, d) * 3.0) * uOpacity;
  frag = vec4(0.0, 0.0, 0.0, clamp(a, 0.0, 1.0));
}`;

// --------------------------------------------------------------------------
// Final pass: grain, a breath of bloom on the reds, and the vignette.
// --------------------------------------------------------------------------
export const FRAG_POST = `#version 300 es
precision highp float;
in vec2 vScreen;
uniform sampler2D uGrain;
uniform vec2 uRes;
uniform float uTime;
uniform float uAmount;
uniform float uAspect;
uniform float uFlash;
out vec4 frag;
void main(){
  vec2 p = vScreen;
  vec2 jitter = vec2(fract(sin(uTime * 12.9898) * 43758.5453),
                     fract(sin(uTime * 78.233) * 12345.6789));
  float g = texture(uGrain, p * (uRes / 512.0) + jitter).r - 0.5;
  vec2 v = (p - 0.5) * vec2(uAspect, 1.0);
  float vig = smoothstep(0.42, 1.2, length(v));
  vec3 col = vec3(g * uAmount);
  col += vec3(0.085, 0.008, 0.011) * uFlash;
  frag = vec4(col, vig * 0.55 + uFlash * 0.1);
}`;
