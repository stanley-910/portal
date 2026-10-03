import { afterEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ getRooms: vi.fn(), getStorageDocument: vi.fn() }));
vi.mock("@/lib/liveblocks/server", () => ({ liveblocks: () => mocked }));
import { listMyTrips, listTripMetadata } from "./server";
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
describe("progressive trip costs", () => {
  it("returns metadata without fetching complete storage documents", async () => {
    mocked.getRooms.mockResolvedValue({ data: [{ id: "trip:abc", metadata: { title: "Fixture", members: ["u"] }, createdAt: new Date(), lastConnectionAt: null }] });
    const trips = await listTripMetadata("u");
    expect(trips[0].title).toBe("Fixture");
    expect(mocked.getStorageDocument).not.toHaveBeenCalled();
  });
  it("reuses listed metadata and bounds concurrent enrichment", async () => {
    vi.useFakeTimers();
    let active = 0, peak = 0;
    mocked.getStorageDocument.mockImplementation(async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 10)); active--;
      return { members: { u: { name: "Ana" } }, legs: {}, stays: {}, stops: {} };
    });
    const metadata = Array.from({ length: 12 }, (_, i) => ({ id: String(i), title: `Trip ${i}`, members: 1, updatedAt: "2026-11-15" }));
    const work = listMyTrips("u", metadata);
    await vi.advanceTimersByTimeAsync(50);
    expect(await work).toHaveLength(12);
    expect(peak).toBe(4); expect(mocked.getRooms).not.toHaveBeenCalled();
  });
});
