// Small 3-vector helpers for the globe. World units: the globe has radius 1, y is north, z faces lon 0.
export type Vec3 = [number, number, number];

export const D2R = Math.PI / 180;
export const EARTH_RADIUS_KM = 6371;

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export function smooth(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export function ease(t: number) {
  t = clamp(t, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
export function wrapPi(a: number) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export function norm(a: Vec3): Vec3 {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
/** v projected onto the plane tangent to the sphere at n, normalised. */
export const tangent = (v: Vec3, n: Vec3) => norm(sub(v, mul(n, dot(v, n))));
export const angle = (a: Vec3, b: Vec3) => Math.acos(clamp(dot(a, b), -1, 1));
export function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const w = angle(a, b);
  const s = Math.sin(w);
  if (s < 1e-5) return norm(lerp(a, b, t));
  return add(mul(a, Math.sin((1 - t) * w) / s), mul(b, Math.sin(t * w) / s));
}
/** Unit vector for a latitude and longitude in radians. */
export function vecOf(lat: number, lon: number): Vec3 {
  const c = Math.cos(lat);
  return [c * Math.sin(lon), Math.sin(lat), c * Math.cos(lon)];
}
/** Latitude and longitude in radians for a unit vector. */
export const llOf = (v: Vec3) => ({ lat: Math.asin(clamp(v[1], -1, 1)), lon: Math.atan2(v[0], v[2]) });
/** v rotated by angle a (radians) about the unit axis k (right-hand rule). */
export function rotAround(v: Vec3, k: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
}
