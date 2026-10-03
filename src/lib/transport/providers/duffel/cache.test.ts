import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderFailure, type SearchQuery } from "../../types";

const requestOffers = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("./client", () => ({ DUFFEL_TIMEOUT_MS: 10_000, requestOffers: (...a: unknown[]) => requestOffers(...a) }));
vi.mock("./map", () => ({ mapOffers: (raw: unknown[]) => raw }));

const { duffel, clearDuffelCache } = await import("./index");

const query: SearchQuery = {
  from: { name: "Taipei", lat: 25.08, lng: 121.23, iata: "TPE" },
  to: { name: "Hong Kong", lat: 22.31, lng: 113.92, iata: "HKG" },
  date: "2026-11-15",
  modes: [],
  passengers: 1,
  currency: "USD",
};
const signal = () => new AbortController().signal;

describe("Duffel search reuse", () => {
  beforeEach(() => {
    clearDuffelCache();
    requestOffers.mockReset();
    vi.useRealTimers();
  });

  it("asks Duffel once for the same route, day and party, even while the first search runs", async () => {
    requestOffers.mockResolvedValue(["a"]);
    const [x, y] = await Promise.all([duffel.search(query, signal()), duffel.search(query, signal())]);
    expect(await duffel.search(query, signal())).toEqual(["a"]);
    expect([x, y]).toEqual([["a"], ["a"]]);
    expect(requestOffers).toHaveBeenCalledTimes(1);
    await duffel.search({ ...query, passengers: 2 }, signal());
    expect(requestOffers).toHaveBeenCalledTimes(2);
  });

  it("searches city to city, so a trip's airport pairs between the same cities share one request", async () => {
    requestOffers.mockResolvedValue(["a"]);
    const shanghai = (iata: string) => ({ ...query, from: { ...query.to, iata: "HKG" }, to: { name: "Shanghai", lat: 31.2, lng: 121.5, iata } });
    await Promise.all([duffel.search(shanghai("PVG"), signal()), duffel.search(shanghai("SHA"), signal())]);
    expect(requestOffers).toHaveBeenCalledTimes(1);
    expect(requestOffers.mock.calls[0].slice(1, 3)).toEqual(["HKG", "SHA"]);
  });

  it("stops asking for a minute once Duffel says to slow down", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    requestOffers.mockRejectedValueOnce(new ProviderFailure("RATE_LIMITED", true));
    await expect(duffel.search(query, signal())).rejects.toThrow();
    await expect(duffel.search({ ...query, date: "2026-11-16" }, signal())).rejects.toThrow("RATE_LIMITED");
    expect(requestOffers).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 61_000);
    requestOffers.mockResolvedValueOnce(["b"]);
    expect(await duffel.search({ ...query, date: "2026-11-16" }, signal())).toEqual(["b"]);
  });

  it("falls back to an older answer when Duffel refuses, and asks again once it's old", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    requestOffers.mockResolvedValueOnce(["old"]);
    await duffel.search(query, signal());
    vi.setSystemTime(Date.now() + 6 * 60_000);
    requestOffers.mockRejectedValueOnce(new ProviderFailure("UPSTREAM_ERROR"));
    expect(await duffel.search(query, signal())).toEqual(["old"]);
    vi.setSystemTime(Date.now() + 30 * 60_000);
    requestOffers.mockRejectedValueOnce(new ProviderFailure("UPSTREAM_ERROR"));
    await expect(duffel.search(query, signal())).rejects.toThrow();
  });
});
