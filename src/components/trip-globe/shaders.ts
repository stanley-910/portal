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
uniform float uGlobe;
uniform sampler2D uEarth;
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
out vec4 outColor;
const float PI = 3.14159265;
` + GLSL_COMMON + `
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

  // engraved atmosphere: hatching that thickens toward the horizon
  float atm = exp(-max(dmin - 1.0, 0.0) * 14.0) * step(1.0, dmin);
  float hp = uPer * 1.1;
  float hd = abs(fract(px.y / hp) - 0.5) * hp;
  col = mix(col, uSea, lineAA(hd, atm * 0.9 * uDpr, uDpr) * 0.55 * atm);

  // globe view only: offset cut-out shadow and the double ring
  float dsh = closest(rayDir(px - vec2(7.0, -11.0) * uDpr));
  col = mix(col, col * uShade, (1.0 - smoothstep(1.0, 1.0 + 2.0 * fw, dsh)) * step(1.0, dmin) * uGlobe);
  col = mix(col, ink, lineAA(abs(dmin - 1.05), 0.45 * fw, fw) * 0.85 * uGlobe);
  col = mix(col, ink, lineAA(abs(dmin - 1.07), 0.45 * fw, fw) * 0.85 * uGlobe);

  // the surface, computed for every pixel so derivatives stay valid
  float tHit = disc > 0.0 ? -b - sqrt(disc) : -b;
  vec3 n = normalize(uC + d * tHit);
  float lon = atan(n.x, n.z);
  float lat = asin(clamp(n.y, -1.0, 1.0));
  vec3 e = texture(uEarth, vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI)).rgb;
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
  float sa = acos(clamp(dot(n, uShP), -1.0, 1.0));
  g = mix(g, g * uShade * 0.8, (1.0 - smoothstep(uShR * 0.45, uShR, sa)) * uShA);

  float facing = max(dot(n, -d), 0.0);
  g *= mix(0.8, 1.0, smoothstep(0.0, 0.45, facing));
  g += vec3(0.05) * pow(dif, 10.0);

  float front = step(b, 0.0);
  col = mix(col, g, (1.0 - smoothstep(1.0 - fw, 1.0, dmin)) * front);
  col = mix(col, ink, lineAA(abs(dmin - 1.0), 0.7 * fw, fw) * front);

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
