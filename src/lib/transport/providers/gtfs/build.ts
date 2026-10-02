// Build-time only (scripts/gtfs-build.mts, tests). Runs under plain `node`, hence `.ts` import specifiers.
import type { Mode } from "../../types";
import { cityAt } from "./geo.ts";
import { pairKey, type City, type PairDeparture, type PairFile, type PairService } from "./schema.ts";

type Row = Record<string, string>;

/** Shapes and fares are skipped on purpose: 154 MB + 65 MB in namtang (ADR-B01). */
export const NEEDED_FILES = [
  "agency.txt",
  "stops.txt",
  "routes.txt",
  "trips.txt",
  "stop_times.txt",
  "calendar.txt",
  "calendar_dates.txt",
  "frequencies.txt",
  "feed_info.txt",
] as const;

const MODE_BY_ROUTE_TYPE: Record<number, Mode> = { 2: "train", 3: "bus", 4: "ferry" };

export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.length > 1 || r[0] !== "");
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}

/** Namtang names are "ไทย;English". */
export function splitName(raw: string): { en: string; local?: string } {
  const i = raw.lastIndexOf(";");
  if (i < 0) return { en: raw.trim(), local: undefined };
  const en = raw.slice(i + 1).trim();
  const local = raw.slice(0, i).trim();
  return en ? { en, local: local || undefined } : { en: local, local: undefined };
}

export function gtfsSeconds(t: string): number | undefined {
  const m = /^\s*(\d+):(\d{2}):(\d{2})\s*$/.exec(t);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : undefined;
}

export interface FeedTables {
  agency: Row[];
  stops: Row[];
  routes: Row[];
  trips: Row[];
  stopTimes: Row[];
  calendar: Row[];
  calendarDates: Row[];
  frequencies: Row[];
  feedInfo: Row[];
}

export function readFeed(files: Record<string, string>): FeedTables {
  const t = (name: string) => (files[name] ? parseCsv(files[name]) : []);
  return {
    agency: t("agency.txt"),
    stops: t("stops.txt"),
    routes: t("routes.txt"),
    trips: t("trips.txt"),
    stopTimes: t("stop_times.txt"),
    calendar: t("calendar.txt"),
    calendarDates: t("calendar_dates.txt"),
    frequencies: t("frequencies.txt"),
    feedInfo: t("feed_info.txt"),
  };
}

export function feedCalendar(feed: FeedTables): { start: string; end: string } {
  const info = feed.feedInfo[0];
  const dates = [
    ...feed.calendar.flatMap((c) => [c.start_date, c.end_date]),
    ...feed.calendarDates.filter((d) => d.exception_type === "1").map((d) => d.date),
  ].filter(Boolean).sort();
  return {
    start: info?.feed_start_date || dates[0] || "",
    end: info?.feed_end_date || dates[dates.length - 1] || "",
  };
}

/** @param today YYYYMMDD */
export function assertFeedCurrent(feedId: string, feed: FeedTables, today: string): void {
  const { end } = feedCalendar(feed);
  if (!end || end < today) throw new Error(`GTFS feed ${feedId} calendar ended ${end || "(none)"}; rebuild needs a fresh feed`);
}

export interface Frequency {
  start: number;
  end: number;
  headway: number;
}

/**
 * Namtang lists departures as chained windows whose headway equals the window length
 * (07:25→20:00 every 45300 s = 07:25 and 20:00), or start==end with headway 0 (spec violation).
 * Hence end is inclusive and starts are de-duplicated (ADR-B02, ADR-B04).
 */
export function tripStarts(freqs: readonly Frequency[]): number[] {
  const out = new Set<number>();
  for (const f of freqs) {
    if (f.headway <= 0 || f.end <= f.start) {
      out.add(f.start);
      continue;
    }
    for (let t = f.start; t <= f.end; t += f.headway) out.add(t);
  }
  return [...out].sort((a, b) => a - b);
}

export interface BuildOptions {
  feedId: string;
  cities: readonly City[];
  routeTypes: readonly number[];
}

const groupBy = <T>(rows: readonly T[], key: (r: T) => string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
};

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export function buildPairs(feed: FeedTables, opts: BuildOptions): Record<string, PairFile> {
  const { feedId, cities } = opts;
  const k = (id: string) => `${feedId}:${id}`;
  const singleAgency = feed.agency.length === 1 ? feed.agency[0] : undefined;
  const agencies = new Map(feed.agency.map((a) => [a.agency_id, a]));
  const routes = new Map(
    feed.routes.filter((r) => opts.routeTypes.includes(Number(r.route_type))).map((r) => [r.route_id, r]),
  );
  const stops = new Map(feed.stops.map((s) => [s.stop_id, s]));
  const stopCity = new Map<string, string>();
  for (const s of feed.stops) {
    const c = cityAt(cities, Number(s.stop_lat), Number(s.stop_lon));
    if (c) stopCity.set(s.stop_id, c.id);
  }

  const services = new Map<string, PairService>();
  for (const c of feed.calendar) {
    services.set(c.service_id, {
      days: WEEKDAYS.map((d) => (c[d] === "1" ? 1 : 0)),
      start: c.start_date,
      end: c.end_date,
      add: [],
      remove: [],
    });
  }
  for (const d of feed.calendarDates) {
    let s = services.get(d.service_id);
    if (!s) {
      s = { days: [0, 0, 0, 0, 0, 0, 0], start: "", end: "", add: [], remove: [] };
      services.set(d.service_id, s);
    }
    (d.exception_type === "1" ? s.add : s.remove).push(d.date);
  }

  const stopTimes = groupBy(feed.stopTimes, (r) => r.trip_id);
  const freqs = groupBy(feed.frequencies, (r) => r.trip_id);
  const out: Record<string, PairFile> = {};
  const seen = new Set<string>();

  for (const trip of feed.trips) {
    const route = routes.get(trip.route_id);
    const mode = route && MODE_BY_ROUTE_TYPE[Number(route.route_type)];
    const svc = services.get(trip.service_id);
    if (!route || !mode || !svc) continue;
    const agency = agencies.get(route.agency_id) ?? singleAgency;
    if (!agency) continue;
    const st = (stopTimes.get(trip.trip_id) ?? [])
      .slice()
      .sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    if (st.length < 2) continue;

    const base = gtfsSeconds(st[0].departure_time || st[0].arrival_time) ?? 0;
    const f = freqs.get(trip.trip_id);
    const starts = f?.length
      ? tripStarts(
          f.map((r) => ({
            start: gtfsSeconds(r.start_time) ?? 0,
            end: gtfsSeconds(r.end_time) ?? 0,
            headway: Number(r.headway_secs) || 0,
          })),
        )
      : [base];

    const legs: Array<{ from: Row; to: Row; fromCity: string; toCity: string }> = [];
    const originCities = new Set<string>();
    for (let i = 0; i < st.length; i++) {
      const a = stopCity.get(st[i].stop_id);
      if (!a || originCities.has(a)) continue;
      originCities.add(a);
      const reached = new Set<string>();
      for (let j = i + 1; j < st.length; j++) {
        const b = stopCity.get(st[j].stop_id);
        if (!b || b === a || reached.has(b)) continue;
        reached.add(b);
        legs.push({ from: st[i], to: st[j], fromCity: a, toCity: b });
      }
    }
    if (!legs.length) continue;

    const op = splitName(agency.agency_name).en;
    const num = route.route_short_name.trim() || undefined;
    for (const leg of legs) {
      const dep0 = gtfsSeconds(leg.from.departure_time || leg.from.arrival_time);
      const arr0 = gtfsSeconds(leg.to.arrival_time || leg.to.departure_time);
      if (dep0 === undefined || arr0 === undefined) continue;
      const key = pairKey(leg.fromCity, leg.toCity);
      const pair = (out[key] ??= { from: leg.fromCity, to: leg.toCity, stops: {}, services: {}, departures: [] });
      for (const start of starts) {
        const dep = start + dep0 - base;
        const arr = start + arr0 - base;
        const dedupe = `${key}|${op}|${leg.from.stop_id}|${leg.to.stop_id}|${dep}|${arr}|${trip.service_id}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        const d: PairDeparture = {
          id: k(`${trip.trip_id}:${dep}`),
          feed: feedId,
          op,
          ...(num ? { num } : {}),
          mode,
          tz: agency.agency_timezone,
          svc: k(trip.service_id),
          from: k(leg.from.stop_id),
          to: k(leg.to.stop_id),
          dep,
          arr,
        };
        pair.departures.push(d);
      }
      for (const s of [leg.from, leg.to]) {
        const stop = stops.get(s.stop_id);
        if (stop) {
          pair.stops[k(s.stop_id)] = {
            name: splitName(stop.stop_name).en,
            lat: Number(stop.stop_lat),
            lng: Number(stop.stop_lon),
          };
        }
      }
      pair.services[k(trip.service_id)] = svc;
    }
  }

  for (const p of Object.values(out)) p.departures.sort((a, b) => a.dep - b.dep || a.op.localeCompare(b.op) || a.id.localeCompare(b.id));
  return out;
}

/** Merges pair files from several feeds into one map. */
export function mergePairs(into: Record<string, PairFile>, from: Record<string, PairFile>): Record<string, PairFile> {
  for (const [key, p] of Object.entries(from)) {
    const target = into[key];
    if (!target) {
      into[key] = p;
      continue;
    }
    Object.assign(target.stops, p.stops);
    Object.assign(target.services, p.services);
    target.departures.push(...p.departures);
    target.departures.sort((a, b) => a.dep - b.dep || a.op.localeCompare(b.op) || a.id.localeCompare(b.id));
  }
  return into;
}
