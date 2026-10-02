// GLSL for the printed globe and the paper plane, ported verbatim from the Flight artboard.
// Halftone pitch, screen angles (15/45/75deg) and misregister follow the print tokens in DESIGN.md.

export const VS_QUAD = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const GLSL_COMMON = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float halftone(vec2 px, float k, float ang, float per) {
  float c = cos(ang), s = sin(ang);
  vec2 q = mat2(c, s, -s, c) * px / per;
  vec2 g = fract(q) - 0.5;
  float r = sqrt(clamp(k, 0.0, 1.0)) * 0.64;
  float aa = 0.8 / per;
  return (1.0 - smoothstep(r - aa, r + aa, length(g))) * step(0.02, k);
}
float lineAA(float d, float w, float fw) { return 1.0 - smoothstep(w, w + max(fw, 1e-5), d); }
`;

// The nebula lives on a shell around the globe rather than at infinity, so it drifts against the stars as the
// camera orbits and zooms. Both the globe pass and the star pass look it up through skyUV.
const GLSL_SKY = `
const float SKY_R = 9.0;
/** Where the view ray d from c meets the nebula shell, as a unit direction. */
vec3 skyPoint(vec3 c, vec3 d) {
  float b = dot(c, d);
  return (c + d * (-b + sqrt(b * b - dot(c, c) + SKY_R * SKY_R))) / SKY_R;
}
vec2 skyUV(vec3 s) {
  return vec2(atan(s.x, s.z) / 6.2831853 + 0.5, 0.5 - asin(clamp(s.y, -1.0, 1.0)) / 3.14159265);
}
/** Random 0–1 per cell of a lattice fixed to the sky (pcg3d), so stipple moves with the sky, not the screen. */
float skyGrain(vec3 s, float cells) {
  uvec3 q = uvec3(ivec3(floor(s * cells)) + 1048576);
  q = q * 1664525u + 1013904223u;
  q.x += q.y * q.z; q.y += q.z * q.x; q.z += q.x * q.y;
  q ^= q >> 16u;
  q.x += q.y * q.z; q.y += q.z * q.x; q.z += q.x * q.y;
  return float(q.x & 0xffffffu) / 16777216.0;
}
`;

export const FS_GLOBE = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uDpr;
uniform vec3 uC;
uniform vec3 uRr;
uniform vec3 uUu;
uniform vec3 uFf;
uniform float uTan;
uniform float uAsp;
uniform float uShift;
uniform vec3 uL;
uniform float uPer;
uniform sampler2D uEarth;
uniform sampler2D uBorders;
uniform bool uSurface;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uSea;
uniform vec3 uSeaDeep;
uniform vec3 uSage;
uniform vec3 uMoss;
uniform vec3 uShade;
uniform float uDark;
uniform vec3 uShP;
uniform float uShR;
uniform float uShA;
uniform sampler2D uSky;
uniform float uSkyInk;
out vec4 outColor;
const float PI = 3.14159265;
` + GLSL_COMMON + GLSL_SKY + `
vec3 rayDir(vec2 px) {
  vec2 ndc = px / uRes * 2.0 - 1.0;
  return normalize(uFf + uRr * (ndc.x * uTan * uAsp) + uUu * ((ndc.y + uShift) * uTan));
}
float closest(vec3 d) {
  float b = dot(uC, d);
  return b < 0.0 ? sqrt(max(dot(uC, uC) - b * b, 0.0)) : length(uC);
}
void main() {
  vec2 px = gl_FragCoord.xy;
  vec3 d = rayDir(px);
  float b = dot(uC, d);
  float disc = b * b - (dot(uC, uC) - 1.0);
  float dmin = closest(d);
  float fw = max(fwidth(dmin), 1e-5);
  vec3 paper = uPaper;
  vec3 ink = uInk;
  vec3 col = paper;

  // the sky: stippled nebulae, inked where their north rims catch the light and sparse inside
  // (the grain lattice is about one device pixel per cell)
  vec3 sp = skyPoint(uC, d);
  vec2 neb = texture(uSky, skyUV(sp)).rg;
  float edge = smoothstep(0.04, 0.3, neb.r) * (1.0 - smoothstep(0.3, 0.9, neb.r));
  float pNeb = clamp(pow(neb.g, 1.4) * 0.8 + edge * 0.16 + step(0.04, neb.r) * neb.r * 0.03, 0.0, 1.0);
  pNeb *= smoothstep(1.02, 1.12, dmin);
  col = mix(col, ink, step(skyGrain(sp, uRes.y / (2.0 * uTan)), pNeb) * uSkyInk);

  // engraved atmosphere: hatching that thickens toward the horizon
  float atm = exp(-max(dmin - 1.0, 0.0) * 14.0) * step(1.0, dmin);
  float hp = uPer * 1.1;
  float hd = abs(fract(px.y / hp) - 0.5) * hp;
  col = mix(col, uSea, lineAA(hd, atm * 0.9 * uDpr, uDpr) * 0.55 * atm);

  float front = step(b, 0.0);
  // Sky-only scissor rectangles skip the surface. The branch is uniform for the whole draw,
  // so texture derivatives stay valid, including helper fragments at the globe rectangle's edges.
  if (uSurface) {
    float tHit = disc > 0.0 ? -b - sqrt(disc) : -b;
    vec3 n = normalize(uC + d * tHit);
    float lon = atan(n.x, n.z);
    float lat = asin(clamp(n.y, -1.0, 1.0));
    vec2 uv = vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
    vec3 e = texture(uEarth, uv).rgb;
    float dif = max(dot(n, uL), 0.0);

    vec3 ocean = mix(paper, uSea, halftone(px, mix(mix(0.95, 0.36, dif), mix(0.28, 0.8, dif), uDark), 0.2618, uPer));
    float wg = e.g * 7.0;
    float wfw = fwidth(wg);
    float wl = lineAA(abs(fract(wg) - 0.5), 0.3 * wfw, wfw) * (1.0 - smoothstep(1.5, 3.6, wg)) * step(0.004, e.g);
    ocean = mix(ocean, uSeaDeep, wl * 0.8);

    vec3 land = mix(paper, uSage, halftone(px, mix(mix(1.0, 0.6, dif), mix(0.5, 0.95, dif), uDark), 0.7854, uPer));
    float kS = mix(clamp((1.0 - dif) * 0.75 + e.b * 0.35 - 0.12, 0.0, 1.0), clamp(dif * 0.6 + e.b * 0.25 - 0.25, 0.0, 1.0), uDark);
    land = mix(land, uMoss, halftone(px + vec2(1.2, -0.8) * uDpr, kS, 1.309, uPer * 0.92) * 0.9);

    float lf = e.r;
    float lfw = fwidth(lf);
    vec3 g = mix(ocean, land, smoothstep(0.5 - lfw, 0.5 + lfw, lf));
    g = mix(g, ink, lineAA(abs(lf - 0.5), 0.0, lfw * 1.6) * mix(0.85, 0.65, uDark));

    // country borders: each country is filled with a 3-bit code, and a border is wherever a channel crosses 0.5.
    // A finer, fainter line than the coast, kept off the sea and faded toward the limb where the texture minifies.
    vec3 bc = texture(uBorders, uv).rgb;
    vec3 b3 = 1.0 - smoothstep(vec3(0.0), (fwidth(bc) + 1e-5) * 1.5, abs(bc - 0.5));
    float onLand = smoothstep(0.5 + lfw, 0.5 + 2.5 * lfw + 1e-3, lf);
    float bLimb = smoothstep(0.08, 0.3, max(dot(n, -d), 0.0));
    g = mix(g, ink, max(b3.r, max(b3.g, b3.b)) * onLand * bLimb * mix(0.55, 0.75, uDark));

    float lonD = lon / PI * 180.0;
    float latD = lat / PI * 180.0;
    float fwLon = min(fwidth(lonD), fwidth(mod(lonD + 180.0, 360.0)));
    float fwLat = fwidth(latD);
    float dLon = abs(fract(lonD / 30.0 + 0.5) - 0.5) * 30.0;
    float dLat = abs(fract(latD / 30.0 + 0.5) - 0.5) * 30.0;
    float grat = max(lineAA(dLon, 0.25 * fwLon, fwLon), lineAA(dLat, 0.25 * fwLat, fwLat));
    g = mix(g, ink, grat * mix(0.3, 0.2, uDark));
    g = mix(g, ink, lineAA(abs(latD), 0.6 * fwLat, fwLat) * mix(0.2, 0.14, uDark));

    // the plane's shadow on the ground
    if (uShA > 0.0) {
      float sa = acos(clamp(dot(n, uShP), -1.0, 1.0));
      g = mix(g, g * uShade * 0.8, (1.0 - smoothstep(uShR * 0.45, uShR, sa)) * uShA);
    }

    float facing = max(dot(n, -d), 0.0);
    g *= mix(0.8, 1.0, smoothstep(0.0, 0.45, facing));
    g += vec3(0.05) * pow(dif, 10.0);

    col = mix(col, g, (1.0 - smoothstep(1.0 - fw, 1.0, dmin)) * front);
  }

  col += (hash(floor(px)) - 0.5) * 0.045 + (hash(floor(px / (3.0 * uDpr))) - 0.5) * 0.02;
  outColor = vec4(col, 1.0);
}`;

export const VS_PLANE = `#version 300 es
in vec3 aPos;
in vec3 aNrm;
in vec3 aSm;
in float aPart;
uniform vec3 uC;
uniform vec3 uRr;
uniform vec3 uUu;
uniform vec3 uFf;
uniform float uTan;
uniform float uAsp;
uniform float uShift;
uniform vec3 uPP;
uniform vec3 uPX;
uniform vec3 uPY;
uniform vec3 uPZ;
uniform float uHull;
uniform vec2 uRes;
out vec3 vFN;
out vec3 vW;
out vec3 vObj;
out float vPart;
vec4 proj(vec3 w) {
  vec3 q = w - uC;
  float vx = dot(q, uRr);
  float vy = dot(q, uUu);
  float vz = dot(q, uFf);
  float zn = 0.004;
  float zf = 10.0;
  return vec4(vx / (uTan * uAsp), vy / uTan - uShift * vz, vz * (zf + zn) / (zf - zn) - 2.0 * zf * zn / (zf - zn), vz);
}
vec3 toW(vec3 o) { return uPP + uPX * o.x + uPY * o.y + uPZ * o.z; }
void main() {
  vec3 w = toW(aPos);
  vec4 c = proj(w);
  if (uHull > 0.0) {
    vec4 c2 = proj(toW(aPos + aSm * 0.05));
    vec2 dir = c2.xy / c2.w - c.xy / c.w;
    float l = length(dir);
    if (l > 1e-6) c.xy += dir / l * uHull * 2.0 / uRes * c.w;
  }
  vFN = normalize(uPX * aNrm.x + uPY * aNrm.y + uPZ * aNrm.z);
  vW = w;
  vObj = aPos;
  vPart = aPart;
  gl_Position = c;
}`;

export const FS_PLANE = `#version 300 es
precision highp float;
in vec3 vFN;
in vec3 vW;
in vec3 vObj;
in float vPart;
uniform vec3 uC;
uniform vec3 uL;
uniform float uMode;
uniform vec3 uFill;
uniform vec3 uInkS;
uniform vec3 uRoundel;
out vec4 outColor;
` + GLSL_COMMON + `
void main() {
  float facing = dot(vFN, vW - uC);
  if (uMode > 0.5) {
    if (facing < 0.0) discard;
    outColor = vec4(uInkS, 1.0);
    return;
  }
  if (facing > 0.0) discard;
  vec3 base = uFill;
  int part = int(vPart + 0.5);
  if (part == 3) base = uRoundel;
  if (part == 1 && vObj.y > 0.0 && length(vec2(abs(vObj.x) - 0.33, vObj.z + 0.09)) < 0.042) base = uRoundel;
  if (part == 0) {
    if (abs(vObj.x) > 0.045 && vObj.y > 0.005 && vObj.y < 0.04 && vObj.z > -0.26 && vObj.z < 0.3 && fract(vObj.z * 26.0) < 0.4) base = uInkS;
    if (vObj.z > 0.36 && vObj.y > 0.015) base = mix(base, uInkS, 0.85);
  }
  // flat paper with a soft smooth shade: no dot screen, so it can't be mistaken for the globe's print showing through
  float dif = max(dot(vFN, uL), 0.0);
  float k = clamp((1.0 - dif) * 0.85 - 0.12, 0.0, 1.0);
  vec3 col = mix(base, uInkS, k * 0.16);
  col += vec3(0.04) * pow(dif, 8.0);
  outColor = vec4(col, 1.0);
}`;

// Bakes the nebula field once per sky seed into an equirectangular RG8 texture on the SKY_R shell.
// r: cloud cover (0 to 1). g: the rim lit from the north, where the stipple gathers.
export const FS_SKY_BAKE = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform vec4 uBlob[12];
uniform int uBlobs;
uniform vec3 uSeed;
out vec4 outColor;
float h3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(
    mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s / 0.97;
}
float cover(vec3 d) {
  float m = 0.0;
  for (int i = 0; i < 12; i++) {
    if (i >= uBlobs) break;
    float a = acos(clamp(dot(d, uBlob[i].xyz), -1.0, 1.0)) / uBlob[i].w;
    m = max(m, exp(-a * a));
  }
  if (m < 0.03) return 0.0;
  // domain-warped noise gives the billowing edges
  vec3 q = d * 3.2 + uSeed;
  vec3 w = vec3(fbm(q), fbm(q + vec3(5.2, 1.3, 2.8)), fbm(q + vec3(1.7, 9.2, 4.4)));
  float n = fbm(q * 1.8 + w * 2.2);
  return smoothstep(0.46, 0.6, m * 0.85 + (n - 0.5) * 1.1);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float lon = (uv.x - 0.5) * 6.2831853;
  float lat = (0.5 - uv.y) * 3.14159265;
  vec3 d = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
  float c = cover(d);
  float lit = 0.0;
  if (c > 0.0) {
    vec3 north = vec3(0.0, 1.0, 0.0) - d * d.y;
    north = length(north) > 1e-3 ? normalize(north) : vec3(1.0, 0.0, 0.0);
    lit = clamp((c - cover(normalize(d + north * 0.018))) * 1.6, 0.0, 1.0);
  }
  outColor = vec4(c, lit, 0.0, 1.0);
}`;

// Stars as instanced quads. Each one sits at infinity or on a nearer shell (aStar.w), so the layers part as the
// camera moves. The fragment shader stipples a solid core, a halo and, for the bright few, four diffraction spikes.
export const VS_STAR = `#version 300 es
in vec2 aCorner;
in vec4 aStar;
in vec4 aLook;
uniform vec3 uC;
uniform vec3 uRr;
uniform vec3 uUu;
uniform vec3 uFf;
uniform float uTan;
uniform float uAsp;
uniform float uShift;
uniform vec2 uRes;
uniform float uDpr;
out vec2 vQ;
out vec2 vOff;
flat out vec4 vLook;
flat out float vSeed;
void main() {
  bool near = aStar.w > 0.0;
  vec3 v = near ? aStar.xyz * aStar.w - uC : aStar.xyz;
  float vz = dot(v, uFf);
  if (vz <= 1e-4) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // nearer stars grow a little as the camera closes in on them
  float scale = near ? clamp(aStar.w / length(v), 0.75, 1.5) : 1.0;
  vec2 ndc = vec2(dot(v, uRr) / (vz * uTan * uAsp), dot(v, uUu) / (vz * uTan) - uShift);
  float r = (max(aLook.x * 4.0, aLook.y) + 2.0) * scale;
  vec2 off = aCorner * r;
  gl_Position = vec4(ndc + off * uDpr * 2.0 / uRes, 0.0, 1.0);
  float c = cos(aLook.z), s = sin(aLook.z);
  vQ = mat2(c, -s, s, c) * off / scale;
  vOff = off;
  vLook = aLook;
  vSeed = fract(aStar.x * 91.7 + aStar.y * 37.3 + aStar.z * 13.1) * 100.0;
}`;

export const FS_STAR = `#version 300 es
precision highp float;
in vec2 vQ;
in vec2 vOff;
flat in vec4 vLook;
flat in float vSeed;
uniform vec3 uC;
uniform vec3 uRr;
uniform vec3 uUu;
uniform vec3 uFf;
uniform float uTan;
uniform float uAsp;
uniform float uShift;
uniform vec2 uRes;
uniform float uDpr;
uniform sampler2D uSky;
uniform vec3 uInk;
uniform float uSkyInk;
out vec4 outColor;
` + GLSL_COMMON + GLSL_SKY + `
void main() {
  float r = length(vQ);
  float core = vLook.x;
  float k = 1.0 - smoothstep(core * 0.85, core * 1.05, r);
  k += 0.5 * exp(-r / (core * 1.3));
  float L = vLook.y;
  if (L > 0.0) {
    vec2 a = abs(vQ);
    float w = core * 0.3 + 0.55;
    k += 1.3 * exp(-a.y * a.y / (w * w)) * pow(max(1.0 - a.x / L, 0.0), 2.2);
    k += 1.3 * exp(-a.x * a.x / (w * w)) * pow(max(1.0 - a.y / (L * 1.2), 0.0), 2.2);
    k += 0.3 * exp(-r / (L * 0.2));
  }
  k *= vLook.w;

  // hidden behind the globe, fading out through its atmosphere, and behind the body of a nebula
  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec3 d = normalize(uFf + uRr * (ndc.x * uTan * uAsp) + uUu * ((ndc.y + uShift) * uTan));
  float b = dot(uC, d);
  float dmin = b < 0.0 ? sqrt(max(dot(uC, uC) - b * b, 0.0)) : length(uC);
  k *= smoothstep(1.02, 1.15, dmin);
  k *= 1.0 - 0.9 * smoothstep(0.35, 0.8, texture(uSky, skyUV(skyPoint(uC, d))).r);

  // stipple: each device pixel, anchored to the star so the grain doesn't crawl as it moves, is inked or not
  if (hash(floor(vOff * uDpr) + vSeed) >= k) discard;
  outColor = vec4(uInk, uSkyInk);
}`;
