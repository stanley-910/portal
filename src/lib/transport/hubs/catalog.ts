// Browser-safe location data shared by hover previews and server-side pairing.
// Do not import provider registries or credentials into this module.
import airports from "./airports.json";
import surfaceHubs from "./surface-hubs.json";
import type { Hub } from "./types";

export const HUBS: readonly Hub[] = [...airports, ...surfaceHubs] as Hub[];
export const HUB_LIMITS = {
  radiusKm: { flight: 200, train: 100, ferry: 60 },
  candidatesPerMode: 3,
  flightPairs: 4,
} as const;
