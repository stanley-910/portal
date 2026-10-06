import { describe, expect, it } from "vitest";

import type { Hub } from "@/lib/transport/hubs/types";
import { LOCK_CATCH, LOCK_FROM, LOCK_RELEASE, LOCK_SPACING, lockAt, lockTargets } from "./hub-lock";

const hub = (id: string, importance: number, x: number, y = 0): Hub & { x: number; y: number } => ({
  id, mode: "flight", code: id, name: id, city: id, lat: 0, lng: 0, importance, source: "test", x, y,
});
const place = (h: Hub) => ({ x: (h as ReturnType<typeof hub>).x, y: (h as ReturnType<typeof hub>).y });

describe("locking on to hubs", () => {
  const big = hub("BIG", 3, 100), mid = hub("MID", 2, 200), small = hub("SML", 1, 300);
  it("offers bigger hubs first as you zoom in, and none zoomed out", () => {
    const ids = (zoom: number) => lockTargets(zoom, place, [big, mid, small]).map((t) => t.hub.id);
    expect(ids(0)).toEqual([]);
    expect(ids(LOCK_FROM[3])).toEqual(["BIG"]);
    expect(ids(LOCK_FROM[2])).toEqual(["BIG", "MID"]);
    expect(ids(1)).toEqual(["BIG", "MID", "SML"]);
  });
  it("keeps hubs apart on screen, the first in rank winning", () => {
    const near = hub("NEAR", 2, 100 + LOCK_SPACING - 1);
    const clear = hub("CLEAR", 2, 100 + LOCK_SPACING + 1);
    expect(lockTargets(1, place, [big, near, clear]).map((t) => t.hub.id)).toEqual(["BIG", "CLEAR"]);
  });
  it("skips hubs that aren't on screen", () => {
    expect(lockTargets(1, (h) => (h.id === "BIG" ? null : place(h)), [big, mid])).toHaveLength(1);
  });
  it("catches a hub close by and holds it until the pointer wanders off", () => {
    const targets = lockTargets(1, place, [big, mid]);
    expect(lockAt(targets, 100 + LOCK_CATCH + 1, 0, null)).toBeNull();
    const caught = lockAt(targets, 100 + LOCK_CATCH - 1, 0, null);
    expect(caught?.id).toBe("BIG");
    expect(lockAt(targets, 100 + LOCK_RELEASE - 1, 0, caught)?.id).toBe("BIG");
    expect(lockAt(targets, 100 + LOCK_RELEASE + 1, 0, caught)).toBeNull();
  });
  it("lets go of a hub that's no longer lockable, and takes the nearest of two, bigger ones counting nearer", () => {
    expect(lockAt([], 100, 0, big)).toBeNull();
    const pair = lockTargets(1, place, [hub("A", 3, 0), hub("B", 3, 30)]);
    expect(lockAt(pair, 20, 0, null)?.id).toBe("B");
    const mixed = lockTargets(1, place, [hub("SEA", 3, 0), hub("BFI", 2, 20)]);
    expect(lockAt(mixed, 11, 0, null)?.id).toBe("SEA");
    expect(lockAt(mixed, 16, 0, null)?.id).toBe("BFI");
  });
});
