import { describe, expect, it } from "vitest";

import { D2R, vecOf, type Vec3 } from "./vec";
import { CHOICE, chooseVehicle, landMask, waterShare, type LandAt } from "./vehicle-choice";

const at = (lat: number, lng: number) => vecOf(lat * D2R, lng * D2R);
// a toy world: land everywhere west of 120°E, sea to the east
const westIsLand: LandAt = (v: Vec3) => Math.atan2(v[0], v[2]) / D2R < 120;

const pick = (from: Vec3, to: Vec3, extra: Partial<Parameters<typeof chooseVehicle>[0]> = {}) =>
  chooseVehicle({ from, to, landAt: westIsLand, current: "flight", ...extra });

describe("chooseVehicle", () => {
  it("keeps what's showing until the leg is long enough to judge", () => {
    expect(pick(at(30, 110), at(30, 110.1), { current: "train" })).toBe("train");
  });

  it("goes by bus on short land legs and by train on longer ones", () => {
    expect(pick(at(30, 110), at(30, 110.8))).toBe("bus"); // ~77 km
    expect(pick(at(30, 100), at(30, 106))).toBe("train"); // ~580 km
  });

  it("flies once a land leg is too long for a train", () => {
    expect(pick(at(30, 90), at(30, 105))).toBe("flight"); // ~1,440 km
  });

  it("takes a ferry across a short stretch of sea and flies across a wide one", () => {
    expect(pick(at(30, 119.5), at(30, 123))).toBe("ferry"); // mostly sea, ~340 km
    expect(pick(at(30, 119.5), at(30, 130))).toBe("flight"); // mostly sea, ~1,000 km
  });

  it("listens to the hubs under each end", () => {
    // a station makes a short land leg a train
    expect(pick(at(30, 110), at(30, 110.8), { toHub: "train" })).toBe("train");
    // a ferry terminal with a little water makes it a ferry
    expect(pick(at(30, 119), at(30, 120.4), { toHub: "ferry" })).toBe("ferry");
    // airports don't count: most cities' nearest hub is one
    expect(pick(at(30, 100), at(30, 107), { fromHub: "flight", toHub: "flight" })).toBe("train");
  });

  it("treats every leg as land until the mask loads", () => {
    expect(chooseVehicle({ from: at(30, 119.5), to: at(30, 123), landAt: null, current: "flight" })).toBe("train");
  });

  it("has thresholds that agree with each other", () => {
    expect(CHOICE.settleKm).toBeLessThan(CHOICE.busKm);
    expect(CHOICE.busKm).toBeLessThan(CHOICE.ferryKm);
    expect(CHOICE.ferryKm).toBeLessThan(CHOICE.flyKm);
  });
});

describe("waterShare and landMask", () => {
  it("samples the line and reads the texture's red channel like the shader", () => {
    expect(waterShare(at(30, 100), at(30, 110), westIsLand)).toBe(0);
    expect(waterShare(at(30, 125), at(30, 130), westIsLand)).toBe(1);
    // 2x1 texture: the western half (lon < 0) is land, the eastern sea
    const mask = landMask(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 255]), 2, 1);
    expect(mask(at(0, -90))).toBe(true);
    expect(mask(at(0, 90))).toBe(false);
    expect(waterShare(at(0, 10), at(0, 20), () => null)).toBeNull();
  });
});
