// Builds the globe's province and state borders from Natural Earth 10m admin-1.
// Run with `pnpm provinces`. Downloads the source once into .cache/, then writes:
//   public/textures/provinces.png: 4096×2048 equirectangular RGBA, laid out like borders.png. In RGB, each province is
//     filled with a 3-bit code (one bit per channel) so no two touching provinces share one, and a border is wherever
//     a channel crosses 0.5. The sea takes the code of the nearest province. Supersampled 4×4. A is unused (255).
// Small countries (Hong Kong, Singapore) are kept whole: at the closest zoom their districts would only be noise.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { geoArea } from "d3-geo";

import { eachInside, png, spans, unwrap, type Position, type Ring } from "./raster.mts";

const W = 4096;
const H = 2048;
const SS = 4; // supersamples per texel, per axis
const SIMPLIFY = 0.02; // degrees, about 2 km: a quarter of a texel
const MIN_COUNTRY_KM2 = 30_000; // countries smaller than this get no internal borders
const EARTH_KM2 = 4 * Math.PI * 6371 ** 2;

// Pinned, so the texture rebuilds the same way.
const NE_COMMIT = "ca96624a56bd078437bca8184e78163e5039ad19";
const NE_FILE = "ne_10m_admin_1_states_provinces.geojson";
const SOURCE = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_COMMIT}/geojson/${NE_FILE}`;
const CACHE = fileURLToPath(new URL(`../.cache/natural-earth/${NE_COMMIT}/`, import.meta.url));
const PNG_OUT = fileURLToPath(new URL("../public/textures/provinces.png", import.meta.url));

type Geometry = { type: "Polygon"; coordinates: Position[][] } | { type: "MultiPolygon"; coordinates: Position[][][] };
interface Feature {
  geometry: Geometry | null;
  properties: { adm1_code: string; adm0_a3: string };
}

async function source(): Promise<{ features: Feature[] }> {
  const file = CACHE + NE_FILE;
  if (!existsSync(file)) {
    console.log(`Downloading ${SOURCE}`);
    const response = await fetch(SOURCE);
    if (!response.ok) throw new Error(`Natural Earth returned ${response.status}`);
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Douglas–Peucker in plain degrees; good enough at a tolerance well under a texel. */
function simplify(r: Ring, tol: number): Ring {
  if (r.length < 5) return r;
  const keep = new Uint8Array(r.length);
  keep[0] = keep[r.length - 1] = 1;
  const stack: [number, number][] = [[0, r.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = r[a];
    const [bx, by] = r[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let far = -1;
    let dmax = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (r[i][0] - ax) - dx * (r[i][1] - ay)) / len;
      if (d > dmax) {
        dmax = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const out = r.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : r;
}

const fc = await source();

// small countries become a single region, so no lines are drawn inside them
const countryArea = new Map<string, number>();
for (const f of fc.features) {
  if (!f.geometry) continue;
  const km2 = geoArea(f as unknown as Parameters<typeof geoArea>[0]) * EARTH_KM2;
  countryArea.set(f.properties.adm0_a3, (countryArea.get(f.properties.adm0_a3) ?? 0) + km2);
}

const regions = new Map<string, Ring[]>();
for (const f of fc.features) {
  const g = f.geometry;
  if (!g) continue;
  const { adm0_a3: country, adm1_code: code } = f.properties;
  const key = (countryArea.get(country) ?? 0) < MIN_COUNTRY_KM2 ? country : code;
  const rings = regions.get(key) ?? [];
  regions.set(key, rings);
  for (const p of g.type === "Polygon" ? [g.coordinates] : g.coordinates) for (const r of p) rings.push(simplify(unwrap(r), SIMPLIFY));
}
const provinces = [...regions.values()];
if (provinces.length > 65535) throw new Error("Too many provinces for a Uint16 raster");

const latBounds = provinces.map((rings) => {
  let lo = 90;
  let hi = -90;
  for (const r of rings)
    for (const [, y] of r) {
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
  return [lo, hi] as const;
});
// rows each province covers, so a scanline only visits provinces that cross it
const rowsOf = (lo: number, hi: number, rows: number) =>
  [Math.max(0, Math.floor(((90 - hi) / 180) * rows)), Math.min(rows - 1, Math.ceil(((90 - lo) / 180) * rows))] as const;
const byRow: number[][] = Array.from({ length: H }, () => []);
provinces.forEach((_, pi) => {
  const [a, b] = rowsOf(...latBounds[pi], H);
  for (let y = a; y <= b; y++) byRow[y].push(pi);
});

// pass 1: one sample per texel, giving each texel a province (0 = sea), then the sea by nearest province
const id = new Uint16Array(W * H);
for (let y = 0; y < H; y++) {
  const lat = 90 - ((y + 0.5) / H) * 180;
  for (const pi of byRow[y]) eachInside(spans(provinces[pi], lat), W, (x) => (id[y * W + x] = pi + 1));
}
{
  let queue = new Int32Array(W * H);
  let n = 0;
  for (let i = 0; i < W * H; i++) if (id[i]) queue[n++] = i;
  while (n) {
    const next = new Int32Array(W * H);
    let m = 0;
    for (let q = 0; q < n; q++) {
      const i = queue[q];
      const x = i % W;
      const y = (i - x) / W;
      for (const j of [y * W + ((x + 1) % W), y * W + ((x + W - 1) % W), y > 0 ? i - W : -1, y < H - 1 ? i + W : -1])
        if (j >= 0 && !id[j]) {
          id[j] = id[i];
          next[m++] = j;
        }
    }
    queue = next;
    n = m;
  }
}

// colour the provinces so touching ones differ: greedy, most-connected first
const adj = provinces.map(() => new Set<number>());
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const a = id[y * W + x] - 1;
    for (const j of [y * W + ((x + 1) % W), y < H - 1 ? (y + 1) * W + x : -1]) {
      const b = j >= 0 ? id[j] - 1 : a;
      if (a !== b) {
        adj[a].add(b);
        adj[b].add(a);
      }
    }
  }
const code = new Int8Array(provinces.length).fill(-1);
for (const pi of provinces.map((_, i) => i).sort((a, b) => adj[b].size - adj[a].size)) {
  const used = new Set([...adj[pi]].map((j) => code[j]));
  const free = [0, 1, 2, 3, 4, 5, 6, 7].find((k) => !used.has(k));
  if (free === undefined) throw new Error(`No free code for province ${pi}`);
  code[pi] = free;
}

// pass 2: supersample the land and average each channel over its samples; texels with no land take the nearest code
const px = new Uint8Array(W * H * 4);
const landN = new Uint16Array(W);
const bitN = new Uint16Array(W * 3);
const subRows: number[][] = Array.from({ length: H * SS }, () => []);
provinces.forEach((_, pi) => {
  const [a, b] = rowsOf(...latBounds[pi], H * SS);
  for (let y = a; y <= b; y++) subRows[y].push(pi);
});
for (let y = 0; y < H; y++) {
  landN.fill(0);
  bitN.fill(0);
  for (let s = 0; s < SS; s++) {
    const lat = 90 - ((y + (s + 0.5) / SS) / H) * 180;
    for (const pi of subRows[y * SS + s]) {
      const k = code[pi];
      eachInside(spans(provinces[pi], lat), W * SS, (col) => {
        const x = (col / SS) | 0;
        landN[x]++;
        for (let b = 0; b < 3; b++) if (k & (1 << b)) bitN[x * 3 + b]++;
      });
    }
  }
  for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const k = code[id[y * W + x] - 1];
    for (let b = 0; b < 3; b++)
      px[o + b] = landN[x] ? Math.round((255 * bitN[x * 3 + b]) / landN[x]) : k & (1 << b) ? 255 : 0;
    px[o + 3] = 255;
  }
}
writeFileSync(PNG_OUT, png(px, W, H));
console.log(`Wrote ${provinces.length} provinces to provinces.png`);
