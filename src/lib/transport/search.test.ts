import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fanOut } from "./search";
import { ProviderFailure, type Mode, type Offer, type ProviderId, type SearchQuery, type TransportProvider } from "./types";

const place = { name: "X", lat: 0, lng: 0 };
const query = (modes: Mode[] = []): SearchQuery => ({
  from: place,
  to: place,
  date: "2026-10-20",
  modes,
  passengers: 1,
  currency: "USD",
});

function offer(provider: ProviderId, depart: string): Offer {
  return {
    id: `${provider}:${depart}`,
    provider,
    mode: "flight",
    kind: "cached",
    segments: [{ mode: "flight", from: place, to: place, depart, arrive: depart, durationMin: 0 }],
  };
}

function fake(id: ProviderId, modes: Mode[], search: TransportProvider["search"]): TransportProvider {
  return { id, modes, covers: (q) => q.modes.length === 0 || q.modes.some((m) => modes.includes(m)), search };
}

const hang = () => new Promise<Offer[]>(() => {});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fanOut", () => {
  it("returns offers from healthy providers beside errors from failing and hanging ones", async () => {
    const result = await fanOut(query(), {
      timeoutMs: 50,
      providers: [
        fake("travelpayouts", ["flight"], async () => [offer("travelpayouts", "2026-10-20T09:00:00+08:00")]),
        fake("tdx", ["train"], async () => {
          throw new ProviderFailure("RATE_LIMITED", true);
        }),
        fake("gtfs", ["bus"], hang),
      ],
    });
    expect(result.offers.map((o) => o.provider)).toEqual(["travelpayouts"]);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        { provider: "tdx", code: "RATE_LIMITED", retryable: true },
        { provider: "gtfs", code: "TIMEOUT", retryable: true },
      ]),
    );
    expect(result.errors).toHaveLength(2);
    expect(result.tookMs).toBeGreaterThanOrEqual(0);
  });

  it("aborts the signal handed to a provider that runs past the timeout", async () => {
    let seen: AbortSignal | undefined;
    await fanOut(query(), {
      timeoutMs: 20,
      providers: [
        fake("gtfs", ["bus"], (_q, signal) => {
          seen = signal;
          return hang();
        }),
      ],
    });
    expect(seen?.aborted).toBe(true);
  });

  it("maps a non-ProviderFailure throw to UPSTREAM_ERROR", async () => {
    const result = await fanOut(query(), {
      providers: [
        fake("12go", ["ferry"], async () => {
          throw new Error("boom");
        }),
      ],
    });
    expect(result.errors).toEqual([{ provider: "12go", code: "UPSTREAM_ERROR", retryable: false }]);
  });

  it("skips providers whose modes do not match", async () => {
    const train = vi.fn(async () => [] as Offer[]);
    const result = await fanOut(query(["flight"]), {
      providers: [
        fake("travelpayouts", ["flight"], async () => [offer("travelpayouts", "2026-10-20T09:00:00+08:00")]),
        fake("tdx", ["train"], train),
      ],
    });
    expect(train).not.toHaveBeenCalled();
    expect(result.offers).toHaveLength(1);
  });

  it("returns empty offers and errors when no provider covers the query", async () => {
    const result = await fanOut(query(["ferry"]), {
      providers: [fake("travelpayouts", ["flight"], async () => [])],
    });
    expect(result.offers).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("treats a throwing covers() as not covering", async () => {
    const p = fake("tdx", ["train"], async () => []);
    p.covers = () => {
      throw new Error("bad");
    };
    const result = await fanOut(query(), { providers: [p] });
    expect(result.errors).toEqual([]);
  });

  it("ranks priced offers cheapest-first before timetable offers", async () => {
    const result = await fanOut(query(), {
      providers: [
        fake("travelpayouts", ["flight"], async () => [
          { ...offer("travelpayouts", "2026-10-20T01:30:00Z"), price: { amount: 120, currency: "USD" } },
          { ...offer("travelpayouts", "2026-10-20T10:00:00+08:00"), price: { amount: 80, currency: "USD" } },
        ]),
        fake("tdx", ["train"], async () => [offer("tdx", "2026-10-20T00:45:00Z")]),
      ],
    });

    expect(result.offers.map((o) => o.price?.amount ?? null)).toEqual([80, null, 120]);
  });

  it("prefers a lower-cost train over a faster expensive flight", async () => {
    const result = await fanOut(query(), {
      providers: [
        fake("travelpayouts", ["flight"], async () => [{
          ...offer("travelpayouts", "2026-10-20T09:00:00Z"),
          price: { amount: 91, currency: "USD" },
          segments: [{ ...offer("travelpayouts", "2026-10-20T09:00:00Z").segments[0], durationMin: 125 }],
        }]),
        fake("china-rail", ["train"], async () => [{
          ...offer("china-rail", "2026-10-20T08:00:00+08:00"),
          price: { amount: 553, currency: "CNY" },
          mode: "train",
          segments: [{ ...offer("china-rail", "2026-10-20T08:00:00+08:00").segments[0], mode: "train", durationMin: 277 }],
        }]),
      ],
    });
    expect(result.offers[0].mode).toBe("train");
  });

  it("aborts every provider when the caller signal aborts", async () => {
    const ctrl = new AbortController();
    const p = fanOut(query(), { timeoutMs: 5_000, signal: ctrl.signal, providers: [fake("gtfs", ["bus"], hang)] });
    ctrl.abort();
    const result = await p;
    expect(result.errors).toEqual([{ provider: "gtfs", code: "TIMEOUT", retryable: true }]);
  });
});
