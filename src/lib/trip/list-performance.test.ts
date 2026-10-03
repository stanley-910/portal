import { afterEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ getRooms: vi.fn(), getStorageDocument: vi.fn(), getActiveUsers: vi.fn() }));
vi.mock("@/lib/liveblocks/server", () => ({ liveblocks: () => mocked }));
import { listMyLibrary } from "./server";
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
describe("the library's reads", () => {
  it("reads at most four trips' plans at once", async () => {
    vi.useFakeTimers();
    let active = 0, peak = 0;
    mocked.getRooms.mockResolvedValue({ data: Array.from({ length: 12 }, (_, i) => ({ id: `trip:${i}`, metadata: { title: `Trip ${i}`, members: ["u"] }, createdAt: new Date(), lastConnectionAt: null })) });
    mocked.getActiveUsers.mockResolvedValue({ data: [] });
    mocked.getStorageDocument.mockImplementation(async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 10)); active--;
      return { members: { u: { name: "Ana" } }, legs: {}, stays: {}, stops: {} };
    });
    const work = listMyLibrary("u");
    await vi.advanceTimersByTimeAsync(50);
    expect(await work).toHaveLength(12);
    expect(peak).toBe(4);
  });
});
