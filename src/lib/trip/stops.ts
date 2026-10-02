import type { Stop } from "@/lib/liveblocks/types";
import type { Hub } from "@/lib/transport/hubs/types";
import type { Place } from "@/lib/transport/types";

type Point = { lat: number; lng: number };

/** The hub is a local preview, not a snapped endpoint or a chosen transport mode. */
export function stopFromPoint(point: Point, hub: Hub | null): Stop {
  return {
    lat: point.lat,
    lng: point.lng,
    hub: hub?.id ?? null,
    code: hub?.code ?? null,
    name: hub?.city || hub?.name || `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`,
  };
}

/** Sharing only by hub would silently replace a later member's exact clicked point. */
export function sameStop(a: Pick<Stop, "lat" | "lng" | "hub">, b: Stop): boolean {
  return a.lat === b.lat && a.lng === b.lng && a.hub === b.hub;
}

/** Resolve transport from clicks afresh; never pass a preview ID/code as airport IATA. */
export function stopToPlace(stop: Stop): Place {
  return { name: stop.name, lat: stop.lat, lng: stop.lng };
}
