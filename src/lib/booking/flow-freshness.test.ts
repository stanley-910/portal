import { beforeEach, describe, expect, it, vi } from "vitest";

const { read, fetchOffer } = vi.hoisted(() => ({ read: vi.fn(), fetchOffer: vi.fn() }));
vi.mock("@/lib/liveblocks/server", () => ({ liveblocks: () => ({ getStorageDocument: read }) }));
vi.mock("./duffel", () => ({ getOffer: fetchOffer }));
import { settleLeg } from "./flow";

beforeEach(() => { vi.clearAllMocks(); });
describe("booking freshness boundary", () => {
  it.each(["estimated", "cached", "timetable"])("rejects a %s Duffel choice before provider/booking calls", async (kind) => {
    read.mockResolvedValue({ legs: { leg: {
      riders: ["rider"], chosen: "duffel:off_test", search: { offers: [{ id: "duffel:off_test", provider: "duffel", kind }] },
    } } });
    expect(await settleLeg("trip:example", "leg", { id: "rider", name: null, email: null }))
      .toMatchObject({ ok: false, code: "WRONG_STATE" });
    expect(fetchOffer).not.toHaveBeenCalled();
  });
});
