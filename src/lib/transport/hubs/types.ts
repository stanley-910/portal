import type { Place } from "../types";

export type HubMode = "flight" | "train" | "ferry";
export interface Hub extends Place {
  id: string;
  mode: HubMode;
  city: string;
  code: string;
  /** 1 regional, 2 major, 3 large. A bounded relevance hint, not connectivity. */
  importance: number;
  source: string;
  timezone?: string;
}

export interface HubCandidate {
  hub: Hub;
  /** Great-circle access distance, NOT road distance or a transfer estimate. */
  distanceKm: number;
}

export interface SeedConnection {
  from: string;
  to: string;
  mode: "train" | "ferry";
  durationMin: number;
  source: string;
}

export interface HubPair {
  id: string;
  mode: HubMode;
  from: HubCandidate;
  to: HubCandidate;
  distanceKm: number;
  accessDistanceKm: number;
  /** Lower is better. Geography only; not a fare or a journey duration. */
  score: number;
  /** Neither value means a scheduled service has been verified. */
  evidence: "geographic-candidate" | "bundled-connection";
  source: string;
  estimatedDurationMin?: number;
}

export interface HubResolution {
  origin: Place;
  destination: Place;
  from: HubCandidate[];
  to: HubCandidate[];
  pairs: HubPair[];
  limits: { radiusKm: Record<HubMode, number>; candidatesPerMode: number; flightPairs: number };
}
