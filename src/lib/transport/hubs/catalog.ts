// Browser-safe location data shared by hover previews and server-side pairing.
// Do not import provider registries or credentials into this module.
import airports from "./airports.json";
import surfaceHubs from "./surface-hubs.json";
import type { Hub } from "./types";

export const HUBS: readonly Hub[] = [...airports, ...surfaceHubs] as Hub[];
export { HUB_LIMITS } from "./limits";
