import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./duffel", () => ({ searchDuffelStays: vi.fn() }));
vi.mock("./liteapi", () => ({ searchLiteStays: vi.fn() }));
import { searchDuffelStays } from "./duffel";
import { searchLiteStays } from "./liteapi";
import { searchAvailableHotels } from "./live";
import type { HotelSearchQuery } from "./types";
import type { LiveStay } from "./duffel-map";
const query: HotelSearchQuery = { city: "Tokyo", lat: 35, lng: 139, checkIn: "2027-01-01", checkOut: "2027-01-02", occupants: 2, filter: 4 };
const stay: LiveStay = { id: "hotel", name: "Fixture", city: "Tokyo", lat: 35, lng: 139, kind: "hotel", stars: 4, bedsPerRoom: 2, pricePerNight: { amount: 100, currency: "USD" }, rooms: 1, total: 100, freshness: "live" };
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
describe("preferred hotel latency", () => {
  it("returns Duffel immediately and cancels the unused secondary request", async () => {
    vi.useFakeTimers();
    let secondarySignal: AbortSignal | undefined;
    vi.mocked(searchDuffelStays).mockResolvedValue([stay]);
    vi.mocked(searchLiteStays).mockImplementation((_q, signal) => {
      secondarySignal = signal;
      return new Promise((resolve) => signal?.addEventListener("abort", () => resolve(null), { once: true }));
    });
    const result = await searchAvailableHotels(query);
    expect(result[0].id).toBe(stay.id);
    expect(secondarySignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("still waits for the secondary source when Duffel is unavailable", async () => {
    vi.mocked(searchDuffelStays).mockRejectedValue(new Error("offline"));
    vi.mocked(searchLiteStays).mockResolvedValue([stay]);
    expect((await searchAvailableHotels(query))[0].id).toBe(stay.id);
  });
});
