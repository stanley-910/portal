import type { Stop } from "@/lib/liveblocks/types";
import type { Hub } from "@/lib/transport/hubs/types";
import { HUBS } from "@/lib/transport/hubs/catalog";
import { distanceKm } from "@/lib/transport/hubs/geo";
import { nearestPreviewHub } from "@/lib/transport/hubs/preview";
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

/** The exact same stop: the same clicked point at the same hub. */
export function sameStop(a: Pick<Stop, "lat" | "lng" | "hub">, b: Stop): boolean {
  return a.lat === b.lat && a.lng === b.lng && a.hub === b.hub;
}

/** Two clicks this close are one place: friends arriving in the same city share its stop, its stay and its nights. */
export const SHARED_STOP_KM = 25;

/**
 * Whether a new stop is the same place as one the trip already has, so the trip reuses that one: the same hub, or
 * within SHARED_STOP_KM. The first click's exact point stands; a later rider's search starts from it instead.
 */
export function sharesStop(a: Pick<Stop, "lat" | "lng" | "hub">, b: Pick<Stop, "lat" | "lng" | "hub">): boolean {
  if (a.hub && a.hub === b.hub) return true;
  return distanceKm(a, b) <= SHARED_STOP_KM;
}

/** Resolve transport from clicks afresh; never pass a preview ID/code as airport IATA. */
export function stopToPlace(stop: Stop): Place {
  return { name: stop.name, lat: stop.lat, lng: stop.lng };
}

const HUB_COUNTRY = new Map(HUBS.map((hub) => [hub.id, hub.country]));

/** A stop's country (ISO-2), for its flag: its hub's, else the nearest hub's, for stops saved without one. */
export const stopCountry = (stop: Pick<Stop, "lat" | "lng" | "hub">): string | null =>
  (stop.hub && HUB_COUNTRY.get(stop.hub)) || nearestPreviewHub(stop)?.country || null;
