import "server-only";
import { publishedFare } from "../rail-cache/fares";
import { createInFlight } from "../../../in-flight.ts";
import { z } from "zod";
import { ProviderFailure, type Offer, type Place, type SearchQuery } from "../../types.ts";

export const DAILY_URL = "https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/DailyTimetable/TrainDate/";
export const TOKEN_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/);
// Current official OAS DTOs recorded in __fixtures__/official-contract.json.
const dailySchema = z.array(z.object({
  TrainDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  DailyTrainInfo: z.object({ TrainNo: z.string().min(1), Direction: z.number().int(), Overnight: z.boolean().optional() }),
  StopTimes: z.array(z.object({
    StopSequence: z.number().int().positive(), StationID: z.string().min(1),
    StationName: z.object({ Zh_tw: z.string().min(1) }),
    ArrivalTime: time.nullable().optional(), DepartureTime: time,
  })).min(2),
  UpdateTime: z.string().datetime({ offset: true }), VersionID: z.number().int(),
}));
export type Daily = z.infer<typeof dailySchema>;
export type DailyClient = (date: string, signal: AbortSignal) => Promise<Daily>;
const failure = (status: number) => new ProviderFailure(status === 401 || status === 403 ? "AUTH_FAILED" : status === 429 ? "RATE_LIMITED" : "UPSTREAM_ERROR", status === 429 || status >= 500);

/** Credentials supplied only by the server provider. Cache bounded, quotes never inferred. */
export function createDailyClient(credentials: { clientId?: string; clientSecret?: string }, fetcher: typeof fetch = fetch): DailyClient {
  let token: { value: string; expires: number } | undefined;
  const cache = new Map<string, { rows: Daily; expires: number }>();
  const shareToken = createInFlight<{ value: string; expires: number }>(1);
  const shareDate = createInFlight<Daily>(12);
  const getToken = (signal: AbortSignal) => shareToken("token", signal, async (signal) => {
    if (token && token.expires > Date.now()) return token;
    const response = await fetcher(TOKEN_URL, {
      method: "POST", signal, cache: "no-store",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: credentials.clientId!, client_secret: credentials.clientSecret! }),
    });
    if (!response.ok) throw failure(response.status);
    const parsed = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() }).safeParse(await response.json());
    if (!parsed.success) throw new ProviderFailure("BAD_RESPONSE");
    token = { value: parsed.data.access_token, expires: Date.now() + Math.max(0, parsed.data.expires_in - 30) * 1000 };
    return token;
  });
  return async (date, signal) => {
    signal.throwIfAborted();
    if (!credentials.clientId || !credentials.clientSecret) throw new ProviderFailure("NOT_CONFIGURED");
    const cached = cache.get(date);
    if (cached && cached.expires > Date.now()) return cached.rows;
    return shareDate(date, signal, async (signal) => {
    try {
      const authorization = await getToken(signal);
      const url = new URL(DAILY_URL + date);
      url.searchParams.set("$format", "JSON"); url.searchParams.set("$top", "1000");
      const response = await fetcher(url, { signal, cache: "no-store", headers: { authorization: `Bearer ${authorization.value}` } });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) token = undefined;
        throw failure(response.status);
      }
      const parsed = dailySchema.safeParse(await response.json());
      if (!parsed.success || parsed.data.length >= 1000 || parsed.data.some((row) => row.TrainDate !== date)) throw new ProviderFailure("BAD_RESPONSE");
      // Avoid holding arbitrary user dates forever. Request-time data remains timetable, never live.
      if (cache.size >= 12) cache.delete(cache.keys().next().value!);
      cache.set(date, { rows: parsed.data, expires: Date.now() + 5 * 60_000 });
      return parsed.data;
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof ProviderFailure) throw error;
      throw new ProviderFailure(error instanceof SyntaxError ? "BAD_RESPONSE" : "UPSTREAM_ERROR", true);
    }
    });
  };
}
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) + Number(value.slice(6, 8) || 0) / 60;
const at = (date: string, mins: number) => `${new Date(Date.parse(`${date}T00:00:00Z`) + mins * 60_000).toISOString().slice(0, 19)}+08:00`;
export function mapDaily(rows: Daily, q: SearchQuery, fromId: string, toId: string, from: Place, to: Place): Offer[] {
  return rows.flatMap((row): Offer[] => {
    const stops = [...row.StopTimes].sort((a, b) => a.StopSequence - b.StopSequence);
    if (new Set(stops.map((s) => s.StopSequence)).size !== stops.length) throw new ProviderFailure("BAD_RESPONSE");
    let previous = -1, days = 0;
    const timeline = stops.map((stop) => {
      const arrival = stop.ArrivalTime ? minutes(stop.ArrivalTime) : minutes(stop.DepartureTime);
      if (arrival < previous) days += 1440;
      const arrive = arrival + days;
      const departure = minutes(stop.DepartureTime);
      if (departure < arrival) days += 1440;
      previous = departure;
      return { ...stop, arrive, depart: departure + days };
    });
    if (days > 1440 || (days > 0 && row.DailyTrainInfo.Overnight === false)) throw new ProviderFailure("BAD_RESPONSE");
    const start = timeline.findIndex((stop) => stop.StationID === fromId);
    const end = timeline.findIndex((stop) => stop.StationID === toId);
    if (start < 0 || end <= start || !timeline[end].ArrivalTime) return [];
    const depart = at(row.TrainDate, timeline[start].depart), arrive = at(row.TrainDate, timeline[end].arrive);
    if (!depart.startsWith(q.date)) return [];
    const durationMin = (Date.parse(arrive) - Date.parse(depart)) / 60_000;
    if (durationMin <= 0 || !Number.isInteger(durationMin)) throw new ProviderFailure("BAD_RESPONSE");
    const fare = publishedFare({ country: "TW", operator: "THSR", from: [from.name], to: [to.name] });
    return [{
      id: `tdx:daily:${row.DailyTrainInfo.TrainNo}:${fromId}:${q.date}`, provider: "tdx", mode: "train", kind: "timetable",
      segments: [{ mode: "train", carrier: "THSR", number: row.DailyTrainInfo.TrainNo, from, to, depart, arrive, durationMin }],
      ...(fare ? { price: fare.price } : {}),
      bookingUrl: "https://irs.thsrc.com.tw/IMINT/",
      attribution: `TDX / THSR — dated timetable, source updated ${row.UpdateTime}: ${DAILY_URL}${row.TrainDate}; ${fare ? fare.note : "fares and seats not checked"}`,
    }];
  });
}
