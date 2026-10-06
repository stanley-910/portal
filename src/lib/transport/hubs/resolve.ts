import { HUBS, HUB_LIMITS } from "./catalog";
import { distanceKm } from "./geo";
import connections from "./connections.json";
import type { Mode, Place } from "../types";
import type { Hub, HubCandidate, HubMode, HubPair, HubResolution, SeedConnection } from "./types";

export { HUBS, HUB_LIMITS } from "./catalog";
export { distanceKm } from "./geo";
export const CONNECTIONS: readonly SeedConnection[] = connections as SeedConnection[];
const MODES: HubMode[] = ["flight", "train", "ferry"];
const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const rounded = (value: number) => Math.round(value * 10) / 10;

function assertCoordinates(place: Place) {
  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)
    || Math.abs(place.lat) > 90 || Math.abs(place.lng) > 180) {
    throw new RangeError("Place coordinates must be finite latitude/longitude in degrees");
  }
}

const byIds = new WeakMap<readonly Hub[], Map<string, Hub>>();
/** The hub a place was snapped to, by id; undefined for an unsnapped place or an id this catalogue doesn't have. */
export function snappedHub(place: Place, hubs: readonly Hub[] = HUBS): Hub | undefined {
  if (!place.snap) return undefined;
  let byId = byIds.get(hubs);
  if (!byId) byIds.set(hubs, (byId = new Map(hubs.map((hub) => [hub.id, hub]))));
  return byId.get(place.snap);
}

/**
 * Radius-bounded pool before connection-aware shortlisting; never a global nearest fallback. A place snapped to a hub
 * is that hub alone, in its mode only: the person picked it, so nearby airports or stations don't stand in for it.
 */
export function nearbyHubs(place: Place, modes: readonly Mode[] = [], hubs: readonly Hub[] = HUBS): HubCandidate[] {
  assertCoordinates(place);
  const snapped = snappedHub(place, hubs);
  if (snapped) {
    return modes.length === 0 || modes.includes(snapped.mode) ? [{ hub: snapped, distanceKm: distanceKm(place, snapped) }] : [];
  }
  return MODES.filter((mode) => modes.length === 0 || modes.includes(mode)).flatMap((mode) => {
    return hubs.filter((hub) => hub.mode === mode)
      // Explicit airport selections are exact, not city-code substitutions.
      .filter((hub) => mode !== "flight" || !place.iata || hub.iata === place.iata.toUpperCase())
      .map((hub) => ({ hub, distanceKm: distanceKm(place, hub) }))
      .filter((candidate) => candidate.distanceKm <= HUB_LIMITS.radiusKm[mode])
      .sort((a, b) => a.distanceKm - b.distanceKm || compareId(a.hub.id, b.hub.id));
  });
}

/**
 * Rank pairs, not isolated nearest stops. Rail/ferry pairs require a bundled edge;
 * airports are geographic candidates until the flight provider returns an offer.
 * Nearby-hub coverage and scheduled-service coverage are deliberately separate.
 */
export function resolveHubs(
  origin: Place,
  destination: Place,
  modes: readonly Mode[] = [],
  hubs: readonly Hub[] = HUBS,
  edges: readonly SeedConnection[] = CONNECTIONS,
): HubResolution {
  const nearbyFrom = nearbyHubs(origin, modes, hubs);
  const nearbyTo = nearbyHubs(destination, modes, hubs);
  const directDistance = distanceKm(origin, destination);
  const pairs: HubPair[] = [];
  for (const from of nearbyFrom) {
    for (const to of nearbyTo) {
      const mode = from.hub.mode;
      if (mode !== to.hub.mode || from.hub.id === to.hub.id) continue;
      const edge = edges.find((edge) => edge.mode === mode
        && edge.from === from.hub.id && edge.to === to.hub.id);
      if (mode !== "flight" && !edge) continue;
      const lineDistance = distanceKm(from.hub, to.hub);
      // Nearby airports are not useful flight candidates for a local journey.
      if (mode === "flight" && (directDistance < 100 || lineDistance < 150)) continue;
      // The leg must make geographic progress toward the destination, and not
      // start beyond its end relative to the origin (overlapping catchments).
      if (distanceKm(from.hub, destination) <= to.distanceKm
        || distanceKm(to.hub, origin) <= from.distanceKm) continue;
      const access = from.distanceKm + to.distanceKm;
      // Overlapping catchments can otherwise suggest a backwards rail leg or a
      // long detour for HK → Macau. Bound the full geometric journey, not just
      // the hub-to-hub leg (still no road/border-time claim).
      if (access + lineDistance > directDistance * 1.75 + 25) continue;
      const detour = Math.max(0, access + lineDistance - directDistance);
      pairs.push({
        id: `${from.hub.id}->${to.hub.id}`,
        mode, from, to,
        distanceKm: rounded(lineDistance),
        accessDistanceKm: rounded(access),
        score: rounded(access + detour * 0.25 - (from.hub.importance + to.hub.importance) * 8),
        evidence: edge ? "bundled-connection" : "geographic-candidate",
        source: edge?.source ?? "Geographic shortlist; flight connection not verified",
        ...(edge ? { estimatedDurationMin: edge.durationMin } : {}),
      });
    }
  }
  pairs.sort((a, b) => a.score - b.score || compareId(a.id, b.id));
  const selected = MODES.flatMap((mode) => pairs.filter((pair) => pair.mode === mode)
    .slice(0, mode === "flight" ? HUB_LIMITS.flightPairs : HUB_LIMITS.candidatesPerMode));

  // Prefer stops that participate in a useful pair, then proximity. Pair endpoints
  // must all remain visible, even if four airport pairs use four distinct hubs.
  const shortlist = (candidates: HubCandidate[], side: "from" | "to") => MODES.flatMap((mode) => {
    const participating = new Set(selected.filter((pair) => pair.mode === mode).map((pair) => pair[side].hub.id));
    const ranked = candidates.filter((candidate) => candidate.hub.mode === mode).sort((a, b) =>
      Number(participating.has(b.hub.id)) - Number(participating.has(a.hub.id))
      || a.distanceKm - b.distanceKm || compareId(a.hub.id, b.hub.id));
    return ranked.slice(0, Math.max(HUB_LIMITS.candidatesPerMode, participating.size))
      .map((candidate) => ({ ...candidate, distanceKm: rounded(candidate.distanceKm) }));
  });
  return {
    origin, destination,
    from: shortlist(nearbyFrom, "from"), to: shortlist(nearbyTo, "to"),
    pairs: selected,
    limits: HUB_LIMITS,
  };
}
