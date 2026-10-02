// Snapshots the SRT (State Railway of Thailand) timetable into the srt seed (ADR-T06).
// Run: `pnpm srt:snapshot`. Pages cached in .cache/srt/<today>/ (delete to refetch). Never runs at request time.
//
// Sources (public, no login, observed 2026-10-03):
// - ttsview.railway.co.th/SRT_Schedule2022.php?ln=en&line=<n>&trip=<1|2> — SRT's "classic view" timetable:
//   one row per station, one column per train, departure times (terminus row = arrival). Browsers get a
//   meta-refresh to timetable_modern.php, whose data API sits behind Cloudflare Turnstile + JWT — not used.
// - ttsview.railway.co.th/timetable_modern/timetable_data.js — train type (`trainDetails`) and running
//   days (`trainRunningDays`).
// Stations (coords, Thai names) stay hand-curated in seed.json; this script only rebuilds `trains`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { seedSchema, TRAIN_TYPES, type SeedTrain, type TrainType } from "../src/lib/transport/providers/srt/schema.ts";

const BASE = "https://ttsview.railway.co.th";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SEED = `${ROOT}src/lib/transport/providers/srt/seed.json`;
const today = new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD
const CACHE = `${ROOT}.cache/srt/${today}/`;
const LINES = { 1: "northern", 2: "northeastern", 4: "southern" } as const;
const DATA_JS = `${BASE}/timetable_modern/timetable_data.js`;
const pageUrl = (line: number, trip: number) => `${BASE}/SRT_Schedule2022.php?ln=en&line=${line}&trip=${trip}`;

async function cached(file: string, url: string): Promise<string> {
  const path = CACHE + file;
  if (existsSync(path)) return readFileSync(path, "utf8");
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const text = await res.text();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(path, text);
  return text;
}

const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** Every <tr> as its cell texts (scripts/styles stripped). */
function rows(html: string): string[][] {
  const body = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
  return [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((tr) =>
    [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((td) => text(td[1])),
  );
}

interface Column {
  number: string;
  stops: Stops; // [TTS station label, HH:MM]
}

/** Station rows (`[label, "Dep."|"Arr."]`), then a train-number row, then one time row per station. */
function columns(html: string): Column[] {
  const all = rows(html);
  const stations = all.filter((r) => r.length === 2 && /^(Dep|Arr)\.$/.test(r[1])).map((r) => r[0]);
  const head = all.findIndex((r) => r.length > 2 && r.every((c) => /^\d{1,4}$/.test(c)));
  if (!stations.length || head < 0) throw new Error("timetable layout changed: no station rows or train-number row");
  const grid = all.slice(head + 1, head + 1 + stations.length);
  if (grid.length !== stations.length || grid.some((r) => r.length !== all[head].length)) {
    throw new Error("timetable layout changed: time grid does not match station rows");
  }
  return all[head].map((number, c) => ({
    number,
    stops: stations.flatMap((label, r): [string, string][] => (/^\d\d:\d\d$/.test(grid[r][c]) ? [[label, grid[r][c]]] : [])),
  }));
}

/** `'<n>': { name: '…', type: '<type>' …}` and `'<n>': { text: { th: '…', en: '<days>' } …}` from timetable_data.js. */
function trainMeta(js: string): { types: Map<string, string>; days: Map<string, string> } {
  const block = (name: string) => js.slice(js.indexOf(`const ${name}`), js.indexOf("};", js.indexOf(`const ${name}`)));
  const types = new Map([...block("trainDetails").matchAll(/'(\d+)':\s*\{[^}]*type:\s*'(\w+)'/g)].map((m) => [m[1], m[2]]));
  const days = new Map([...block("trainRunningDays").matchAll(/'(\d+)':\s*\{\s*text:\s*\{[^}]*en:\s*'([^']*)'/g)].map((m) => [m[1], m[2]]));
  return { types, days };
}

/** SRT running-day label → weekdays (0 = Sun); null = drop the train; undefined = daily. */
function weekdays(label: string | undefined): number[] | null | undefined {
  if (label === undefined || label === "Everyday") return undefined;
  if (label === "Workdays Only" || label === "Mon - Fri") return [1, 2, 3, 4, 5];
  if (label === "Sat - Sun") return [0, 6];
  return null; // "Cancelled", "GO:<date>" (start date; th and en labels disagree) — not seeded
}

const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
type Stops = [string, string][];
const MAX_HOP_MIN = 6 * 60;
/** Extra midnight rolls + over-long hops; 0 = plausible. */
function badness(stops: Stops): number {
  let rolls = 0;
  let long = 0;
  for (let i = 1; i < stops.length; i++) {
    const hop = mins(stops[i][1]) - mins(stops[i - 1][1]);
    if (hop < 0) rolls++;
    if ((hop + 1440) % 1440 > MAX_HOP_MIN) long++;
  }
  return Math.max(0, rolls - 1) + long;
}

const without = (stops: Stops, i: number) => stops.filter((_, j) => j !== i);
const swap = (stops: Stops, i: number): Stops => [...stops.slice(0, i), stops[i + 1], stops[i], ...stops.slice(i + 2)];

/**
 * A train runs < 24 h and TTS lists every station, so a column rolls past midnight at most once and no
 * hop takes > MAX_HOP_MIN. Two known breaks (observed 2026-10-03):
 * - spur rows listed against running order (Nakhon Si Thammarat / Khao Chum Thong Jn, Surat Thani /
 *   Khiri Ratthanikhom) → swap the adjacent pair;
 * - source typos (train 23: Surin 00:48 between Buri Ram 03:12 and Sikhoraphum 04:17) → drop the stop.
 * Never guess a time. Still inconsistent (trains 355/356: Ramathibodi/Ban Pong out of place) → null, skip the train.
 */
function repair(col: Column, swapped: string[], dropped: string[]): Stops | null {
  let s = col.stops;
  while (badness(s) > 0) {
    const i = s.findIndex((_, k) => k + 1 < s.length && badness(swap(s, k)) < badness(s));
    if (i >= 0) {
      swapped.push(`${col.number} ${s[i][0]}<>${s[i + 1][0]}`);
      s = swap(s, i);
      continue;
    }
    const bad = s.findIndex((_, k) => badness(without(s, k)) < badness(s));
    if (bad < 0) return null;
    dropped.push(`${col.number} ${s[bad][0]} ${s[bad][1]}`);
    s = without(s, bad);
  }
  return s;
}

async function main() {
  const seed = seedSchema.parse(JSON.parse(readFileSync(SEED, "utf8")));
  const byLabel = new Map(Object.entries(seed.stations).map(([k, s]) => [s.tts, k]));
  const meta = trainMeta(await cached("timetable_data.js.txt", DATA_JS));
  const trains: SeedTrain[] = [];
  const seen = new Set<string>();
  const skipped: string[] = [];
  const dropped: string[] = [];
  const swapped: string[] = [];

  for (const [lineNo, line] of Object.entries(LINES)) {
    for (const trip of [1, 2] as const) {
      const url = pageUrl(Number(lineNo), trip);
      for (const col of columns(await cached(`line${lineNo}-trip${trip}.html`, url))) {
        const full = repair(col, swapped, dropped);
        if (!full) {
          skipped.push(`${col.number} (inconsistent times)`);
          continue;
        }
        const stops = full.flatMap(([label, hhmm]): [string, string][] => {
          const key = byLabel.get(label);
          return key ? [[key, hhmm]] : [];
        });
        const cities = new Set(stops.map(([k]) => seed.stations[k].city));
        if (cities.size < 2) continue; // does not link two seeded cities
        const key = `${col.number}|${JSON.stringify(stops)}`;
        if (seen.has(key)) continue; // TTS repeats some columns verbatim (e.g. 52, 318)
        seen.add(key);
        const type = meta.types.get(col.number);
        if (!type || !(TRAIN_TYPES as readonly string[]).includes(type)) {
          skipped.push(`${col.number} (type ${type ?? "missing"})`);
          continue;
        }
        const days = weekdays(meta.days.get(col.number));
        if (days === null) {
          skipped.push(`${col.number} (${meta.days.get(col.number)})`);
          continue;
        }
        trains.push({
          number: col.number,
          type: type as TrainType,
          line,
          direction: trip === 1 ? "out" : "in",
          stops,
          ...(days ? { days } : {}),
          source: url,
        });
      }
    }
  }

  const dup = trains.map((t) => t.number).filter((n, i, a) => a.indexOf(n) !== i);
  if (dup.length) throw new Error(`same train number with different stops: ${[...new Set(dup)].join(", ")}`);
  const out = seedSchema.parse({ ...seed, checked: today, trains });
  writeFileSync(SEED, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`srt seed: ${trains.length} trains, ${Object.keys(seed.stations).length} stations`);
  if (skipped.length) console.log(`skipped trains: ${skipped.join(", ")}`);
  if (swapped.length) console.log(`spur stops reordered by time: ${swapped.join(", ")}`);
  if (dropped.length) console.log(`dropped out-of-order stops: ${dropped.join(", ")}`);
}

await main();
