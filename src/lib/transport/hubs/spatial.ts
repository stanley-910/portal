import type { Coordinates } from "./geo";
const RAD = Math.PI / 180;
const CELL = 0.05;
const vector = ({ lat, lng }: Coordinates) => {
  const c = Math.cos(lat * RAD);
  return [c * Math.cos(lng * RAD), Math.sin(lat * RAD), c * Math.sin(lng * RAD)];
};
const bucket = (v: number) => Math.floor(v / CELL);
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

/** A spherical spatial hash: no date-line/pole special cases or approximate nearest choice. */
export class GeoIndex<T> {
  private cells = new Map<string, { item: T; v: number[]; order: number }[]>();
  constructor(items: readonly T[], coordinates: (item: T) => Coordinates) {
    items.forEach((item, order) => {
      const v = vector(coordinates(item));
      const k = key(...v.map(bucket) as [number, number, number]);
      const cell = this.cells.get(k) ?? [];
      cell.push({ item, v, order });
      this.cells.set(k, cell);
    });
  }
  /** Broad phase only. Callers retain their exact distance and tie-breaking semantics. */
  nearby(point: Coordinates, km: number): T[] {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) return [];
    const v = vector(point);
    const radius = 2 * Math.sin(Math.min(Math.PI, km / 6371) / 2) + 1e-12;
    const lo = v.map((n) => bucket(n - radius));
    const hi = v.map((n) => bucket(n + radius));
    const found: { item: T; order: number }[] = [];
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      for (const row of this.cells.get(key(x, y, z)) ?? []) {
        if (row.v.every((n, i) => Math.abs(n - v[i]) <= radius)) found.push(row);
      }
    }
    // Original order preserves first-wins ties (city labels, custom catalogues).
    return found.sort((a, b) => a.order - b.order).map((r) => r.item);
  }
}
