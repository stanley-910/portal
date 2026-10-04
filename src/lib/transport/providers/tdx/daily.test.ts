import { describe, expect, it, vi } from "vitest";
import { createDailyClient, mapDaily, TOKEN_URL, type Daily } from "./daily";
import fixture from "./__fixtures__/daily-contract.json";
import seedJson from "./seed.json";
import { seedSchema } from "./schema";
import { createTdxProvider } from "./index";
import { fanOut } from "../../search";
import type { SearchQuery } from "../../types";
const q: SearchQuery = { from: { name: "Taipei", lat: 25.0478, lng: 121.517 }, to: { name: "Zuoying", lat: 22.6873, lng: 120.3076 }, date: "2026-10-14", modes: ["train"], passengers: 1, currency: "USD" };
const signal = () => new AbortController().signal;
const creds = { clientId: "test-client", clientSecret: "test-secret" };
const seed = seedSchema.parse(seedJson);
function responses(...bodies: unknown[]) {
  return vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(bodies.shift()), { status: 200 }));
}
describe("TDX official dated timetable contract", () => {
  it("uses documented OAuth, forwards cancellation, caches timetable and adds the published fare", async () => {
    const fetcher = responses({ access_token: "test-token", expires_in: 3600 }, fixture);
    const client = createDailyClient(creds, fetcher), abort = signal();
    const rows = await client(q.date, abort);
    expect(await client(q.date, abort)).toBe(rows);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe(TOKEN_URL);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
    expect(fetcher.mock.calls[1][1]?.signal?.aborted).toBe(false);
    const offer = mapDaily(rows, q, "1000", "1070", q.from, q.to)[0];
    expect(offer.kind).toBe("timetable"); expect(offer.price).toEqual({ amount: 1490, currency: "TWD" });
    expect(offer.attribution).toMatch(/Published standard car, reserved fare/);
    expect(offer.segments[0].arrive).toBe("2026-10-14T09:30:00+08:00");
    expect(offer.segments[0].durationMin).toBe(90);
  });
  it("reports missing credentials, auth/rate errors, and malformed/mismatched dates", async () => {
    await expect(createDailyClient({})(q.date, signal())).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    for (const [status, code] of [[401, "AUTH_FAILED"], [403, "AUTH_FAILED"], [429, "RATE_LIMITED"], [503, "UPSTREAM_ERROR"]] as const) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status }));
      await expect(createDailyClient(creds, fetcher)(q.date, signal())).rejects.toMatchObject({ code });
    }
    for (const body of [{ error: "bad" }, [{ ...fixture[0], TrainDate: "2026-10-13" }], [{ ...fixture[0], StopTimes: [] }]]) {
      await expect(createDailyClient(creds, responses({ access_token: "x", expires_in: 3600 }, body))(q.date, signal())).rejects.toMatchObject({ code: "BAD_RESPONSE" });
    }
  });
  it("preserves seed behaviour when optional client is absent and falls back on API failure", async () => {
    expect((await createTdxProvider(seed).search(q, signal())).length).toBeGreaterThan(10);
    const failed = createTdxProvider(seed, undefined, async () => { throw new Error("upstream unavailable"); });
    const result = await fanOut(q, { providers: [failed], signal: signal() });
    expect(result.errors).toHaveLength(1);
    expect(result.offers.length).toBeGreaterThan(10);
    expect(result.offers.every((o) => o.kind === "estimated")).toBe(true);
  });
  it("honours cancellation, and does not replace authoritative empty schedules with seed guesses", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(createDailyClient(creds)(q.date, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(await createTdxProvider(seed, undefined, async () => []).search(q, signal())).toEqual([]);
  });
  it("maps previous-day overnight services onto origin date without fabricating arrivals", () => {
    const overnight: Daily = [{ ...fixture[0], TrainDate: "2026-10-13", DailyTrainInfo: { ...fixture[0].DailyTrainInfo, Overnight: true }, StopTimes: [
      { StopSequence: 1, StationID: "0990", StationName: { Zh_tw: "南港" }, ArrivalTime: null, DepartureTime: "23:50:00" },
      { StopSequence: 2, StationID: "1000", StationName: { Zh_tw: "台北" }, ArrivalTime: "00:10:00", DepartureTime: "00:12:00" },
      { StopSequence: 3, StationID: "1070", StationName: { Zh_tw: "左營" }, ArrivalTime: "02:10:00", DepartureTime: "02:10:00" },
    ] }];
    const offer = mapDaily(overnight, q, "1000", "1070", q.from, q.to)[0];
    expect(offer.segments[0].depart).toBe("2026-10-14T00:12:00+08:00");
    expect(offer.segments[0].arrive).toBe("2026-10-14T02:10:00+08:00");
    const noArrival = structuredClone(overnight); noArrival[0].StopTimes[2].ArrivalTime = null;
    expect(mapDaily(noArrival, q, "1000", "1070", q.from, q.to)).toEqual([]);
  });
});

describe("TDX concurrent readers", () => {
  it("shares date/token requests and keeps another reader alive when one aborts", async () => {
    let finish!: (response: Response) => void;
    let upstream!: AbortSignal;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (url === TOKEN_URL) return Response.json({ access_token: "fixture", expires_in: 3600 });
      upstream = init!.signal!;
      return new Promise<Response>((resolve) => { finish = resolve; });
    });
    const client = createDailyClient(creds, fetcher);
    const a = new AbortController(), b = new AbortController();
    const first = client(q.date, a.signal), second = client(q.date, b.signal);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    a.abort(); await rejected;
    expect(upstream.aborted).toBe(false);
    finish(Response.json(fixture));
    expect(await second).toEqual(fixture);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("requests both independent service dates before either finishes", async () => {
    const resolvers = new Map<string, (rows: Daily) => void>();
    const daily = vi.fn((date: string) => new Promise<Daily>((resolve) => resolvers.set(date, resolve)));
    const work = createTdxProvider(seed, undefined, daily).search(q, signal());
    expect(daily).toHaveBeenCalledTimes(2);
    for (const finish of resolvers.values()) finish([]);
    expect(await work).toEqual([]);
  });
});
