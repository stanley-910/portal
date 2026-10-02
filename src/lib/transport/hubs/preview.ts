import { HUBS, HUB_LIMITS } from "./catalog";
import { distanceKm, type Coordinates } from "./geo";
import type { Hub } from "./types";

/** Local proximity only: neither country containment nor verified connectivity. */
export function nearestPreviewHub(point: Coordinates, hubs: readonly Hub[] = HUBS): Hub | null {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)
    || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) return null;
  let nearest: Hub | null = null;
  let bestDistance = Infinity;
  for (const hub of hubs) {
    const distance = distanceKm(point, hub);
    if (distance > HUB_LIMITS.radiusKm[hub.mode]) continue;
    if (distance < bestDistance || (distance === bestDistance && nearest && hub.id < nearest.id)) {
      nearest = hub;
      bestDistance = distance;
    }
  }
  return nearest;
}

export function hubPreviewLabel(hub: Hub): string {
  if (hub.mode === "flight") return `${hub.code} · ${hub.city || hub.name}`;
  return `${hub.mode === "train" ? "Rail" : "Ferry"} · ${hub.name}`;
}

/** At most 12.5 scans/second while moving; none while the ground point is still. */
export class HoverHubResolver {
  private lastPoint: Coordinates | null = null;
  private lastLookup = -Infinity;
  private hub: Hub | null = null;

  constructor(private readonly hubs: readonly Hub[] = HUBS) {}

  resolve(point: Coordinates | null, nowMs: number): Hub | null {
    // Leaving the sphere/dragging clears immediately, even inside the throttle.
    if (!point) {
      this.lastPoint = null;
      this.lastLookup = -Infinity;
      this.hub = null;
      return null;
    }
    if (this.lastPoint && (nowMs - this.lastLookup < 80
      || (this.lastPoint.lat === point.lat && this.lastPoint.lng === point.lng))) return this.hub;
    this.lastPoint = { ...point };
    this.lastLookup = nowMs;
    this.hub = nearestPreviewHub(point, this.hubs);
    return this.hub;
  }
}
