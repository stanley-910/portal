// Builds the globe's country borders and name labels from Natural Earth 50m (via world-atlas).
// Run with `pnpm borders`. Writes:
//   public/textures/borders.png: 4096×2048 equirectangular RGBA. In RGB, each country is filled with a 3-bit code
//     (one bit per channel), chosen so no two touching countries share a code. A border is wherever a channel
//     crosses 0.5, which the shader inks the same way it inks the coastline. The sea takes the code of the
//     nearest country, so channels only cross on land. Supersampled 4×4, so the crossing is sub-texel accurate.
//     A holds the country itself (1–255, sea included, by nearest country), so the shader can pick one out.
//   src/components/trip-globe/countries.ts: where each country's name sits, its long axis and its size.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { geoArea } from "d3-geo";
import { feature } from "topojson-client";

import world from "world-atlas/countries-50m.json" with { type: "json" };

import { eachInside, png, spans, unwrap, type Position, type Ring } from "./raster.mts";

const W = 4096;
const H = 2048;
const SS = 4; // supersamples per texel, per axis
const PNG_OUT = fileURLToPath(new URL("../public/textures/borders.png", import.meta.url));
const TS_OUT = fileURLToPath(new URL("../src/components/trip-globe/countries.ts", import.meta.url));

// Natural Earth's abbreviated names, spelled out for a label
const RENAME: Record<string, string> = {
  "United States of America": "United States",
  "Dem. Rep. Congo": "DR Congo",
  "Central African Rep.": "Central African Republic",
  "S. Sudan": "South Sudan",
  "W. Sahara": "Western Sahara",
  "Bosnia and Herz.": "Bosnia and Herzegovina",
  "Dominican Rep.": "Dominican Republic",
  "Eq. Guinea": "Equatorial Guinea",
  "Solomon Is.": "Solomon Islands",
  "Falkland Is.": "Falkland Islands",
  "Fr. Polynesia": "French Polynesia",
  "Fr. S. Antarctic Lands": "French Southern Lands",
  Macedonia: "North Macedonia",
  eSwatini: "Eswatini",
  "Timor-Leste": "Timor-Leste",
};
// Regions folded into a neighbour: no border is drawn between them, and they get no label of their own
const MERGE: Record<string, string> = { Somaliland: "Somalia", "N. Cyprus": "Cyprus" };
const NO_LABEL = new Set(["Siachen Glacier", "Ashmore and Cartier Is.", "Indian Ocean Ter."]);

// ---------- countries ----------

type Geometry = { type: "Polygon"; coordinates: Position[][] } | { type: "MultiPolygon"; coordinates: Position[][][] };

interface Country {
  name: string;
  rings: Ring[];
  polys: Position[][][];
}

// world-atlas is a TopoJSON topology; its types live in packages pnpm doesn't hoist, so describe what's used
const topo = world as unknown as Parameters<typeof feature>[0];
const fc = feature(topo, topo.objects.countries) as unknown as {
  features: { geometry: Geometry | null; properties: { name: string } }[];
};
const byName = new Map<string, Country>();
for (const f of fc.features) {
  const g = f.geometry;
  if (!g) continue;
  const raw = f.properties.name;
  const name = RENAME[MERGE[raw] ?? raw] ?? MERGE[raw] ?? raw;
  const c = byName.get(name) ?? { name, rings: [], polys: [] };
  byName.set(name, c);
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  // merged regions add their area to the border fill, but not to the label's polygon choice
  if (!MERGE[raw]) c.polys.push(...polys);
  for (const p of polys) for (const r of p) c.rings.push(unwrap(r));
  if (NO_LABEL.has(raw)) c.polys = [];
}
const countries = [...byName.values()];
if (countries.length > 255) throw new Error("Too many countries for a Uint8 raster");

// ---------- rasterising ----------

const latBounds = countries.map((c) => {
  let lo = 90;
  let hi = -90;
  for (const r of c.rings)
    for (const [, y] of r) {
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
  return [lo, hi] as const;
});

// pass 1: one sample per texel, giving each texel a country (0 = sea), then the sea by nearest country
const id = new Uint8Array(W * H);
countries.forEach((c, ci) => {
  const [lo, hi] = latBounds[ci];
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180;
    if (lat < lo || lat > hi) continue;
    eachInside(spans(c.rings, lat), W, (x) => (id[y * W + x] = ci + 1));
  }
});
const land = id.slice();
{
  // breadth-first flood from every land texel; x wraps round the globe
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

// colour the countries so touching ones (on land or across a strait) differ: greedy, most-connected first
const adj = countries.map(() => new Set<number>());
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
const code = new Int8Array(countries.length).fill(-1);
for (const ci of countries.map((_, i) => i).sort((a, b) => adj[b].size - adj[a].size)) {
  const used = new Set([...adj[ci]].map((j) => code[j]));
  const free = [0, 1, 2, 3, 4, 5, 6, 7].find((k) => !used.has(k));
  if (free === undefined) throw new Error(`No free code for ${countries[ci].name}`);
  code[ci] = free;
}

// pass 2: supersample the land, average each channel over the land samples in a texel;
// texels with no land take the code of their nearest country
const px = new Uint8Array(W * H * 4);
const landN = new Uint16Array(W);
const bitN = new Uint16Array(W * 3);
for (let y = 0; y < H; y++) {
  landN.fill(0);
  bitN.fill(0);
  for (let s = 0; s < SS; s++) {
    const lat = 90 - ((y + (s + 0.5) / SS) / H) * 180;
    countries.forEach((c, ci) => {
      const [lo, hi] = latBounds[ci];
      if (lat < lo || lat > hi) return;
      const k = code[ci];
      eachInside(spans(c.rings, lat), W * SS, (col) => {
        const x = (col / SS) | 0;
        landN[x]++;
        for (let b = 0; b < 3; b++) if (k & (1 << b)) bitN[x * 3 + b]++;
      });
    });
  }
  for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const k = code[id[y * W + x] - 1];
    for (let b = 0; b < 3; b++)
      px[o + b] = landN[x] ? Math.round((255 * bitN[x * 3 + b]) / landN[x]) : k & (1 << b) ? 255 : 0;
    px[o + 3] = id[y * W + x];
  }
}
writeFileSync(PNG_OUT, png(px, W, H));

// ---------- labels ----------

/** The point inside a polygon furthest from its edge (Mapbox's polylabel), in a plane, and that distance. */
function polylabel(rings: [number, number][][], precision: number): [number, number, number] {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of rings[0]) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const dist = (x: number, y: number) => {
    let inside = false;
    let best = Infinity;
    for (const r of rings)
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [ax, ay] = r[i];
        const [bx, by] = r[j];
        if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
        const dx = bx - ax;
        const dy = by - ay;
        const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
        best = Math.min(best, (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2);
      }
    return (inside ? 1 : -1) * Math.sqrt(best);
  };
  type Cell = { x: number; y: number; h: number; d: number; max: number };
  const cell = (x: number, y: number, h: number): Cell => {
    const d = dist(x, y);
    return { x, y, h, d, max: d + h * Math.SQRT2 };
  };
  const size = Math.min(maxX - minX, maxY - minY);
  let h = size / 2;
  const queue: Cell[] = [];
  if (size === 0) return [minX, minY, 0];
  for (let x = minX; x < maxX; x += size) for (let y = minY; y < maxY; y += size) queue.push(cell(x + h, y + h, h));
  let best = cell((minX + maxX) / 2, (minY + maxY) / 2, 0);
  while (queue.length) {
    queue.sort((a, b) => a.max - b.max);
    const c = queue.pop()!;
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    h = c.h / 2;
    queue.push(cell(c.x - h, c.y - h, h), cell(c.x + h, c.y - h, h), cell(c.x - h, c.y + h, h), cell(c.x + h, c.y + h, h));
  }
  return [best.x, best.y, best.d];
}

interface Label {
  name: string;
  lat: number;
  lng: number;
  /** Direction of the country's long axis, degrees counter-clockwise from east. */
  axis: number;
  /** Length along the long axis and across it, in degrees of arc. */
  span: number;
  width: number;
  /** Area in square degrees, for ranking. */
  area: number;
}

const SQDEG = (180 / Math.PI) ** 2;
const texels: number[][] = countries.map(() => []);
for (let i = 0; i < W * H; i++) if (land[i]) texels[land[i] - 1].push(i);
const labels: Label[] = [];
countries.forEach((c, ci) => {
  if (!c.polys.length) return;
  // anchor: the pole of inaccessibility of the largest piece
  const main = c.polys.reduce((a, b) =>
    geoArea({ type: "Polygon", coordinates: b }) > geoArea({ type: "Polygon", coordinates: a }) ? b : a,
  );
  const ring0 = unwrap(main[0]);
  const lat0 = ring0.reduce((s, p) => s + p[1], 0) / ring0.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const local = main.map((r) => unwrap(r).map(([x, y]) => [x * k, y] as [number, number]));
  const [ax, ay] = polylabel(local, 0.05);
  const lng = ((((ax / k + 180) % 360) + 360) % 360) - 180;

  // the main landmass and what lies near it: its box, grown by a quarter and 2°. Far-off pieces (French Guiana,
  // Alaska) would otherwise swing the axis and stretch the span across an ocean.
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ring0) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const gx = (x1 - x0) * 0.25 + 2;
  const gy = (y1 - y0) * 0.25 + 2;
  const near = (lon: number, lat: number) => {
    const l = lon + 360 * Math.round(((x0 + x1) / 2 - lon) / 360);
    return l >= x0 - gx && l <= x1 + gx && lat >= y0 - gy && lat <= y1 + gy;
  };

  // long axis: principal component of those texels, in a plane round the anchor
  let sw = 0;
  let mx = 0;
  let my = 0;
  const pts: [number, number, number][] = [];
  for (const i of texels[ci]) {
    const x = i % W;
    const lat = 90 - (((i - x) / W + 0.5) / H) * 180;
    const w = Math.cos((lat * Math.PI) / 180);
    if (near(((x + 0.5) / W) * 360 - 180, lat)) {
      let dl = ((x + 0.5) / W) * 360 - 180 - lng;
      dl -= 360 * Math.round(dl / 360);
      const p: [number, number, number] = [dl * Math.cos((ay * Math.PI) / 180), lat - ay, w];
      pts.push(p);
      sw += w;
      mx += p[0] * w;
      my += p[1] * w;
    }
  }
  if (!sw) return;
  mx /= sw;
  my /= sw;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y, w] of pts) {
    sxx += w * (x - mx) ** 2;
    syy += w * (y - my) ** 2;
    sxy += w * (x - mx) * (y - my);
  }
  sxx /= sw;
  syy /= sw;
  sxy /= sw;
  const tr = (sxx + syy) / 2;
  const det = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy ** 2);
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const area = geoArea({ type: "MultiPolygon", coordinates: c.polys }) * SQDEG;
  // a uniform bar of length L has standard deviation L / √12
  const r1 = (x: number) => Math.round(x * 100) / 100;
  labels.push({
    name: c.name,
    lat: r1(ay),
    lng: r1(lng),
    axis: Math.round((theta * 180) / Math.PI),
    span: r1(Math.sqrt(12 * (tr + det))),
    width: r1(Math.sqrt(12 * Math.max(tr - det, 0))),
    area: Math.round(area * 10) / 10,
  });
});
labels.sort((a, b) => b.area - a.area);

writeFileSync(
  TS_OUT,
  `// Generated by scripts/build-borders.mts from Natural Earth 50m (world-atlas). Do not edit.
// Where each country's name is printed on the globe, biggest first.

export interface CountryLabel {
  name: string;
  lat: number;
  lng: number;
  /** Direction of the country's long axis, degrees counter-clockwise from east. */
  axis: number;
  /** Length along the long axis and across it, in degrees of arc. */
  span: number;
  width: number;
  /** Area in square degrees. */
  area: number;
}

export const COUNTRY_LABELS: CountryLabel[] = [
${labels.map((l) => `  ${JSON.stringify(l).replace(/"(\w+)":/g, "$1: ")},`).join("\n")}
];
`,
);
console.log(`Wrote ${countries.length} countries to borders.png and ${labels.length} labels to countries.ts`);
