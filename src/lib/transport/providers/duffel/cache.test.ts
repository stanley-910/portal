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
