// Which vehicle stands in for a leg while you draw it: a guess from the leg's shape, before any search runs. It only
// sets the mood (the search still offers every mode), so it favours what a traveller would expect at a glance.
//
// The signals, cheapest first:
//   length      great-circle km from where the leg took off to the pointer;
//   water       the share of that line over the sea, sampled from the globe's own land mask;
//   hubs        a train station or ferry terminal under either end, from the local hub preview.
//
// The thresholds are judgement calls, not measured, so they live in CHOICE for tuning:
//   - past `flyKm` on land, or past `ferryKm` over water, it's a plane;
//   - a leg mostly over water (`sea` or more) is a ferry, so is one ending at a ferry terminal with some water;
//   - over land, a station at either end means a train;
//   - otherwise short land legs (under `busKm`) are a bus, longer ones a train.
// Airports don't count: most cities' nearest hub is one, so they'd turn every land leg into a flight.
// Under `settleKm` nothing changes, so the plane doesn't flicker while you're still beside the takeoff point.
import type { HubMode } from "@/lib/transport/hubs/types";

import { angle, EARTH_RADIUS_KM, llOf, slerp, type Vec3 } from "./vec";
import type { Vehicle } from "./vehicle-models";

export const CHOICE = {
  settleKm: 30,
  busKm: 120,
  flyKm: 1200,
  ferryKm: 700,
  /** Share of the line over water that makes it a sea crossing. */
  sea: 0.35,
  /** Share over water that, with a ferry terminal at an end, still makes it a ferry. */
  ferryHub: 0.1,
};

/** Whether a point on the unit sphere is land. Null when the mask hasn't loaded. */
export type LandAt = (v: Vec3) => boolean | null;

/** The share of the great circle from a to b over water, from up to 48 evenly spaced samples; null without a mask. */
export function waterShare(a: Vec3, b: Vec3, landAt: LandAt): number | null {
  const km = EARTH_RADIUS_KM * angle(a, b);
  const n = Math.max(8, Math.min(48, Math.ceil(km / 25)));
  let water = 0;
  for (let i = 0; i <= n; i++) {
    const land = landAt(slerp(a, b, i / n));
    if (land === null) return null;
    if (!land) water++;
  }
  return water / (n + 1);
}

export interface VehicleInput {
  from: Vec3;
  to: Vec3;
  landAt: LandAt | null;
  /** The mode of the hub nearest each end, if one is in range. */
  fromHub?: HubMode | null;
  toHub?: HubMode | null;
  /** What's showing now, kept for legs too short to judge. */
  current: Vehicle;
}

export function chooseVehicle({ from, to, landAt, fromHub = null, toHub = null, current }: VehicleInput): Vehicle {
  const km = EARTH_RADIUS_KM * angle(from, to);
  if (km < CHOICE.settleKm) return current;
  const water = (landAt && waterShare(from, to, landAt)) ?? 0;
  const ferryEnd = fromHub === "ferry" || toHub === "ferry";

  if (water >= CHOICE.sea || (ferryEnd && water >= CHOICE.ferryHub)) return km <= CHOICE.ferryKm ? "ferry" : "flight";
  if (km > CHOICE.flyKm) return "flight";
  if (fromHub === "train" || toHub === "train") return "train";
  return km < CHOICE.busKm ? "bus" : "train";
}

/** A land mask sampled from the earth data texture's red channel (land where it's 0.5 or more). */
export function landMask(data: Uint8ClampedArray, width: number, height: number): LandAt {
  return (v) => {
    const { lat, lon } = llOf(v);
    // the same mapping as the globe shader's uv
    const x = Math.min(width - 1, Math.max(0, Math.floor((lon / (2 * Math.PI) + 0.5) * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * height)));
    return data[(y * width + x) * 4] >= 128;
  };
}
