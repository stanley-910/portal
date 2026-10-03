import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const credentials = vi.hoisted(() => ({ DUFFEL_ACCESS_TOKEN: undefined as string | undefined, LITEAPI_API_KEY: undefined as string | undefined }));
vi.mock("@/lib/env.server", () => ({ env: credentials }));

import { GET } from "@/app/api/hotels/search/route";
import fixture from "./fixtures/liteapi.json";
import { mapLiteStay } from "./liteapi-map";
import { searchHotels } from "./search";
import type { HotelSearchQuery } from "./types";

const query: HotelSearchQuery = { city: "Tokyo", lat: 35.67, lng: 139.76, checkIn: "2027-01-15", checkOut: "2027-01-18", occupants: 3, filter: 4, guestNationality: "HK" };
const request = (changes: Partial<HotelSearchQuery> = {}, signal?: AbortSignal) => {
  const fields = Object.entries({ ...query, ...changes }).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]);
  return new Request(`http://localhost/api/hotels/search?${new URLSearchParams(fields)}`, { signal });
};
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => { credentials.LITEAPI_API_KEY = "production-fixture-key"; credentials.DUFFEL_ACCESS_TOKEN = undefined; vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); fetchMock.mockReset(); });

// Documentation-shaped offline fixture, NOT a recorded real hotel or production availability.
// Sources: docs.liteapi.travel/docs/hotel-rates-api-json-data-structure and /docs/displaying-hotel-details.
describe("LiteAPI quote mapping", () => {
  it("honours public selling price and preserves whole-party dates/total", () => {
    const stay = mapLiteStay(fixture.rates.data[0], fixture.detail, query, "2026-10-03T00:00:00Z");
    expect(stay).toMatchObject({ total: 480, rooms: 2, pricePerNight: { amount: 80, currency: "USD" }, freshness: "live", source: "LiteAPI", quote: { checkIn: query.checkIn, checkOut: query.checkOut, occupants: 3, guestNationality: "HK" } });
  });
  it("drops incomplete or mismatched multi-room offers", () => {
    const row = structuredClone(fixture.rates.data[0]);
    row.roomTypes[0].rates.pop();
    expect(mapLiteStay(row, fixture.detail, query, "now")).toBeNull();
    expect(mapLiteStay(fixture.rates.data[0], fixture.detail, { ...query, occupants: 4 }, "now")).toBeNull();
  });
  it("drops extra charges, invalid currency, invalid coordinates and non-hotel metadata", () => {
    const row = structuredClone(fixture.rates.data[0]);
    row.roomTypes[0].rates[0].retailRate.taxesAndFees[0].included = false;
    expect(mapLiteStay(row, fixture.detail, query, "now")).toBeNull();
    row.roomTypes[0].rates[0].retailRate.taxesAndFees[0].included = true;
    row.roomTypes[0].offerRetailRate.currency = "EUR";
    expect(mapLiteStay(row, fixture.detail, query, "now")).toBeNull();
    const detail = structuredClone(fixture.detail);
    detail.data.location.latitude = 999;
    expect(mapLiteStay(fixture.rates.data[0], detail, query, "now")).toBeNull();
    detail.data.location.latitude = 35;
    detail.data.hotelType = "Hostel";
    expect(mapLiteStay(fixture.rates.data[0], detail, query, "now")).toBeNull();
  });
});

describe("hotel route with optional live sources", () => {
  it("returns mapped live rates through the actual route without another seller's booking link", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(fixture.rates)).mockResolvedValueOnce(Response.json(fixture.detail));
    const response = await GET(request());
    const { hotels } = await response.json();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(hotels[0]).toMatchObject({ freshness: "live", source: "LiteAPI", totalPrice: { amount: 480, currency: "USD" }, nights: 3, rooms: 2 });
    expect(hotels[0].bookingUrl).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.liteapi.travel/v3.0/hotels/rates");
    expect(init).toMatchObject({ cache: "no-store", headers: { "X-API-Key": credentials.LITEAPI_API_KEY } });
    expect(JSON.parse(init!.body as string)).toMatchObject({ checkin: query.checkIn, checkout: query.checkOut, guestNationality: "HK", occupancies: [{ adults: 2 }, { adults: 1 }] });
    expect(fetchMock.mock.calls[1][1]?.signal).toBe(init?.signal);
  });
  it.each(["missing key", "sandbox key", "missing nationality", "hostel"])("keeps old estimates without network for %s", async (condition) => {
    if (condition === "missing key") credentials.LITEAPI_API_KEY = undefined;
    if (condition === "sandbox key") credentials.LITEAPI_API_KEY = "sand_test";
    const changes: Partial<HotelSearchQuery> = condition === "missing nationality" ? { guestNationality: undefined } : condition === "hostel" ? { filter: "hostel" } : {};
    const { hotels } = await (await GET(request(changes))).json();
    expect(hotels).toEqual(searchHotels({ ...query, ...changes }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not expose a Duffel test-token quote as live", async () => {
    credentials.DUFFEL_ACCESS_TOKEN = "duffel_test_fixture";
    credentials.LITEAPI_API_KEY = undefined;
    const { hotels } = await (await GET(request())).json();
    expect(hotels).toEqual(searchHotels(query));
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([401, 429, 500, 204])("falls back for HTTP %i", async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status }));
    const { hotels } = await (await GET(request())).json();
    expect(hotels).toEqual(searchHotels(query));
  });
  it.each([{ data: [] }, { error: "bad response" }, { ...fixture.rates, sandbox: true }])("falls back for empty, malformed or sandbox rates", async (body) => {
    fetchMock.mockResolvedValueOnce(Response.json(body));
    const { hotels } = await (await GET(request())).json();
    expect(hotels).toEqual(searchHotels(query));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("drops malformed rows without losing a valid hotel", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: [{ broken: true }, ...fixture.rates.data] })).mockResolvedValueOnce(Response.json(fixture.detail));
    const { hotels } = await (await GET(request())).json();
    expect(hotels).toHaveLength(1);
    expect(hotels[0].freshness).toBe("live");
  });
  it("falls back when hotel metadata fails or mismatches the quote", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(fixture.rates)).mockResolvedValueOnce(Response.json({ data: { ...fixture.detail.data, id: "another-hotel" } }));
    const { hotels } = await (await GET(request())).json();
    expect(hotels).toEqual(searchHotels(query));
  });
  it("passes cancellation to fetch and returns fallback when aborted", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const response = GET(request({}, controller.signal));
    controller.abort();
    const { hotels } = await (await response).json();
    expect(hotels).toEqual(searchHotels(query));
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });
  it("uses an eight-second shared deadline through detail lookup", async () => {
    const timeout = new AbortController();
    const deadlines = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    fetchMock.mockResolvedValueOnce(Response.json(fixture.rates));
    let detailStarted!: () => void;
    const started = new Promise<void>((resolve) => { detailStarted = resolve; });
    fetchMock.mockImplementationOnce(async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new DOMException("Deadline", "TimeoutError")), { once: true });
      detailStarted();
    }));
    const response = GET(request());
    await started;
    timeout.abort();
    const { hotels } = await (await response).json();
    expect(hotels).toEqual(searchHotels(query));
    expect(deadlines.mock.calls.every(([milliseconds]) => milliseconds === 8_000)).toBe(true);
    expect(fetchMock.mock.calls[1][1]?.signal).toBe(fetchMock.mock.calls[0][1]?.signal);
  });
  it("rejects an invalid nationality instead of silently replacing it", async () => {
    expect((await GET(request({ guestNationality: "XX" }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
