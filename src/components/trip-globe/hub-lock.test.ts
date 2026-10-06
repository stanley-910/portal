import { describe, expect, it } from "vitest";

import type { Hub } from "@/lib/transport/hubs/types";
import {
  CITY_GRIP_FAR, CITY_GRIP_NEAR, CITY_LOCK_FROM, FLYING_REACH, CITY_REACH_MIN, CITY_RELEASE, CITY_SHARE, cityReach, LOCK_CATCH, LOCK_FROM,
  LOCK_RELEASE, LOCK_SPACING, lockAt, lockTargets, reachCities, type LockTarget,
} from "./hub-lock";

const hub = (id: string, importance: number, x: number, y = 0): Hub & { x: number; y: number } => ({
  id, mode: "flight", code: id, name: id, city: id, lat: 0, lng: 0, importance, source: "test", x, y,
});
const place = (h: Hub) => ({ x: (h as ReturnType<typeof hub>).x, y: (h as ReturnType<typeof hub>).y });
const id = (t: { id: string } | null) => t?.id.replace("airport:", "") ?? null;
/** City targets as the engine places them, reached for `zoom`. */
const cities = (zoom: number, ...at: [name: string, importance: number, x: number, y?: number][]): LockTarget[] => {
  const out = at.map(([name, importance, x, y = 0]) => ({ ...lockTargets(1, place, [hub(name, importance, x, y)])[0], id: `city:${name}`, hub: null }));
  reachCities(out, zoom);
  return out;
};

describe("locking on to hubs", () => {
  const big = hub("BIG", 3, 100), mid = hub("MID", 2, 200), small = hub("SML", 1, 300);
  it("offers bigger hubs first as you zoom in, and none zoomed out", () => {
    const ids = (zoom: number) => lockTargets(zoom, place, [big, mid, small]).map((t) => t.id);
    expect(ids(0)).toEqual([]);
    expect(ids(LOCK_FROM[3])).toEqual(["BIG"]);
    expect(ids(LOCK_FROM[2])).toEqual(["BIG", "MID"]);
    expect(ids(1)).toEqual(["BIG", "MID", "SML"]);
  });
  it("keeps hubs apart on screen, the first in rank winning", () => {
    const near = hub("NEAR", 2, 100 + LOCK_SPACING - 1);
    const clear = hub("CLEAR", 2, 100 + LOCK_SPACING + 1);
    expect(lockTargets(1, place, [big, near, clear]).map((t) => t.id)).toEqual(["BIG", "CLEAR"]);
  });
  it("skips hubs that aren't on screen", () => {
    expect(lockTargets(1, (h) => (h.id === "BIG" ? null : place(h)), [big, mid])).toHaveLength(1);
  });
  it("catches a hub close by and holds it until the pointer wanders off", () => {
    const targets = lockTargets(1, place, [big, mid]);
    expect(lockAt(targets, 100 + LOCK_CATCH + 1, 0, null)).toBeNull();
    const caught = lockAt(targets, 100 + LOCK_CATCH - 1, 0, null);
    expect(id(caught)).toBe("BIG");
    expect(id(lockAt(targets, 100 + LOCK_RELEASE - 1, 0, caught))).toBe("BIG");
    expect(lockAt(targets, 100 + LOCK_RELEASE + 1, 0, caught)).toBeNull();
  });
  it("lets go of a hub that's no longer lockable, and takes the nearest of two, bigger ones counting nearer", () => {
    expect(lockAt([], 100, 0, lockTargets(1, place, [big])[0])).toBeNull();
    const pair = lockTargets(1, place, [hub("A", 3, 0), hub("B", 3, 30)]);
    expect(id(lockAt(pair, 20, 0, null))).toBe("B");
    const mixed = lockTargets(1, place, [hub("SEA", 3, 0), hub("BFI", 2, 20)]);
    expect(id(lockAt(mixed, 11, 0, null))).toBe("SEA");
    expect(id(lockAt(mixed, 16, 0, null))).toBe("BFI");
  });
});

describe("locking on to cities", () => {
  it("grips harder the further in you are, from a pebble as the first names print to a stone before the hubs", () => {
    expect(cityReach(CITY_LOCK_FROM).catch).toBe(CITY_GRIP_FAR);
    expect(cityReach(LOCK_FROM[3]).catch).toBe(CITY_GRIP_NEAR);
    expect(cityReach(0.4).catch).toBeGreaterThan(cityReach(0.25).catch);
    expect(cityReach(0.6).catch).toBeLessThan(cityReach(0.8).catch);
    expect(cityReach(0.5).release).toBeCloseTo(cityReach(0.5).catch * CITY_RELEASE);
  });
  it("reaches only a share of the way to the nearest other city, never less than its own dot", () => {
    expect(cityReach(0.6, 60).catch).toBe(60 * CITY_SHARE);
    expect(cityReach(0.6, 300).catch).toBe(cityReach(0.6).catch);
    expect(cityReach(0.6, 12).catch).toBe(CITY_REACH_MIN);
  });
  it("gives each city its own reach from its nearest neighbour", () => {
    const [a, b, c] = cities(0.6, ["A", 3, 0], ["B", 2, 50], ["C", 1, 400]);
    expect(a.reach.catch).toBe(50 * CITY_SHARE);
    expect(b.reach.catch).toBe(50 * CITY_SHARE);
    expect(c.reach.catch).toBe(cityReach(0.6).catch);
  });
  it("lets a city go before its neighbour catches, so a sweep between them never bounces", () => {
    const pair = cities(0.6, ["A", 2, 0], ["B", 2, 100]);
    let held = lockAt(pair, 0, 0, null);
    expect(id(held)).toBe("city:A");
    const seq: (string | null)[] = [];
    for (let x = 0; x <= 100; x += 2) {
      held = lockAt(pair, x, 0, held);
      if (seq[seq.length - 1] !== id(held)) seq.push(id(held));
    }
    expect(seq).toEqual(["city:A", null, "city:B"]);
    // A keeps hold to its release, lets go, and B only catches within its own reach
    expect(id(lockAt(pair, pair[0].reach.release - 1, 0, pair[0]))).toBe("city:A");
    expect(lockAt(pair, pair[0].reach.release + 1, 0, pair[0])).toBeNull();
    expect(lockAt(pair, 100 - pair[1].reach.catch - 1, 0, null)).toBeNull();
  });
  it("pulls from further in open country than in a crowd, and no further than the zoom's grip", () => {
    const sparse = cities(0.4, ["Edmonton", 2, 0], ["Calgary", 2, 300]);
    expect(sparse[0].reach.catch).toBe(cityReach(0.4).catch);
    expect(lockAt(sparse, 155, 0, null)).toBeNull();
    const dense = cities(0.4, ["Seattle", 2, 0], ["Vancouver", 2, 0, -31]);
    expect(dense[0].reach.catch).toBeCloseTo(31 * CITY_SHARE);
    expect(id(lockAt(dense, 0, -10, null))).toBe("city:Seattle");
    expect(id(lockAt(dense, 0, -21, null))).toBe("city:Vancouver");
    expect(lockAt(dense, 0, -15.5, null)).toBeNull();
  });
  it("lets a bigger city win a near tie where two crowd within a dot's reach", () => {
    const pair = cities(0.6, ["Town", 1, 0], ["Capital", 3, 16]);
    expect(pair[0].reach.catch).toBe(CITY_REACH_MIN);
    expect(id(lockAt(pair, 7, 0, null))).toBe("city:Capital");
    expect(id(lockAt(pair, 4, 0, null))).toBe("city:Town");
  });
});

describe("locking on while flying", () => {
  it("pulls from much nearer, so the plane sweeps past", () => {
    const targets = lockTargets(1, (h) => ({ x: (h as Hub & { x: number }).x, y: 0 }), [
      { id: "airport:SEA", mode: "flight", code: "SEA", name: "SEA", city: "Seattle", lat: 0, lng: 0, importance: 3, source: "test", x: 100 } as Hub,
    ]);
    const catchPx = targets[0].reach.catch;
    expect(lockAt(targets, 100 + catchPx - 1, 0, null)?.id).toBe("airport:SEA");
    const flying = FLYING_REACH(targets[0].reach);
    expect(flying.catch).toBeLessThan(catchPx);
    expect(lockAt(targets, 100 + catchPx - 1, 0, null, FLYING_REACH)).toBeNull();
    const caught = lockAt(targets, 100 + flying.catch - 1, 0, null, FLYING_REACH);
    expect(caught?.id).toBe("airport:SEA");
    // it holds a little past where it caught, and lets go soon after
    expect(lockAt(targets, 100 + flying.release - 1, 0, caught, FLYING_REACH)?.id).toBe("airport:SEA");
    expect(lockAt(targets, 100 + flying.release + 1, 0, caught, FLYING_REACH)).toBeNull();
  });
  it("still catches a crowded city from close up while flying", () => {
    const crowded = { catch: 22, release: 26.4, importancePx: 3.3 };
    expect(FLYING_REACH(crowded).catch).toBe(14);
    expect(FLYING_REACH({ catch: 10, release: 12, importancePx: 1.5 }).catch).toBe(10);
  });
});
