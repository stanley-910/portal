// Snapshots one week of the official THSR timetable into the tdx provider seed (ADR-T04).
// Run: `pnpm thsr:snapshot [monday YYYY-MM-DD]`. Responses cached in .cache/thsr/
// (delete to refetch). Never runs at request time.
//
// Times: thsrc.com.tw timetable search (the form on the page in TIMETABLE_PAGE), Taipei <-> Zuoying
// both directions, one call per direction per day = 14 calls. Stations: TDX guest
// `/v2/Rail/THSR/Station` (1 call; guest answers 401 without browser-like headers, observed 2026-10-02).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { seedSchema, type Seed, type SeedTrain, type Station } from "../src/lib/transport/providers/tdx/schema.ts";

type Stop = SeedTrain["stops"][number];

const TIMETABLE_PAGE = "https://www.thsrc.com.tw/ArticleContent/a3b630bb-1066-4352-a1ef-58c7b4e8ef7c";
const SEARCH = "https://www.thsrc.com.tw/TimeTable/Search";
const STATIONS = "https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/Station?$format=JSON";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CACHE = `${ROOT}.cache/thsr/`;
const OUT = `${ROOT}src/lib/transport/providers/tdx/seed.json`;
const monday = process.argv[2] ?? "2026-10-12";

interface TdxStation {
  StationID: string;
  StationCode: string;
  StationName: { Zh_tw: string; En: string };
  StationPosition: { PositionLat: number; PositionLon: number };
}
interface TrainItem {
  TrainNumber: string;
  RunDate: string; // "YYYY/MM/DD"; a search also lists the previous night's cross-midnight trains
  StationInfo: { StationName: string; DepartureTime: string; Show: boolean }[];
}

async function cached(file: string, fetchIt: () => Promise<string>): Promise<string> {
  const path = CACHE + file;
  if (existsSync(path)) return readFileSync(path, "utf8");
  const body = await fetchIt();
  writeFileSync(path, body);
  await new Promise((r) => setTimeout(r, 1_000));
  return body;
}

async function ok(res: Response): Promise<string> {
  if (!res.ok) throw new Error(`${res.url} → HTTP ${res.status}`);
  return res.text();
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const key = (en: string) => en.toLowerCase();

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const tdx = JSON.parse(
    await cached("stations.json", async () =>
      ok(await fetch(STATIONS, { headers: { "user-agent": UA, referer: "https://tdx.transportdata.tw/" } })),
    ),
  ) as TdxStation[];
  const stations: Record<string, Station> = {};
  for (const s of tdx) {
    stations[key(s.StationName.En)] = {
      id: s.StationID,
      code: s.StationCode,
      name: s.StationName.En,
      nameLocal: s.StationName.Zh_tw,
      lat: s.StationPosition.PositionLat,
      lng: s.StationPosition.PositionLon,
      source: STATIONS.replace("?$format=JSON", ""),
    };
  }

  const byTrain = new Map<string, { train: SeedTrain; days: Set<number>; sig: string }>();
  for (let i = 0; i < 7; i++) {
    const date = addDays(monday, i);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    for (const [dir, from, to] of [["S", "TaiPei", "ZuoYing"], ["N", "ZuoYing", "TaiPei"]] as const) {
      const body = await cached(`${date}-${dir}.json`, async () => {
        const d = date.replaceAll("-", "/");
        const form = new URLSearchParams({
          SearchType: "S", Lang: "EN", StartStation: from, EndStation: to,
          OutWardSearchDate: d, OutWardSearchTime: "00:00", ReturnSearchDate: d, ReturnSearchTime: "00:00", DiscountType: "",
        });
        return ok(await fetch(SEARCH, {
          method: "POST",
          body: form,
          headers: { "user-agent": UA, "x-requested-with": "XMLHttpRequest", referer: TIMETABLE_PAGE },
        }));
      });
      const items = (JSON.parse(body) as { data: { DepartureTable: { TrainItem: TrainItem[] } } }).data.DepartureTable.TrainItem;
      for (const t of items) {
        if (t.RunDate !== date.replaceAll("-", "/")) continue;
        const stops: Stop[] = t.StationInfo.filter((s) => s.Show).map((s) => {
          if (!stations[key(s.StationName)]) throw new Error(`unknown station ${s.StationName}`);
          return [key(s.StationName), s.DepartureTime];
        });
        const sig = JSON.stringify(stops);
        const id = `${dir}${t.TrainNumber}`;
        const seen = byTrain.get(id);
        if (seen && seen.sig !== sig) throw new Error(`train ${t.TrainNumber} stop times differ across the week`);
        if (seen) seen.days.add(weekday);
        else byTrain.set(id, { sig, days: new Set([weekday]), train: { number: t.TrainNumber, direction: dir, stops, source: TIMETABLE_PAGE } });
      }
    }
  }

  const trains = [...byTrain.values()]
    .map(({ train, days }) => (days.size === 7 ? train : { ...train, days: [...days].sort((a, b) => a - b) }))
    .sort((a, b) => a.direction.localeCompare(b.direction) || a.stops[0][1].localeCompare(b.stops[0][1]) || a.number.localeCompare(b.number));
  const seed: Seed = seedSchema.parse({
    checked: new Date().toISOString().slice(0, 10),
    sampleWeek: [monday, addDays(monday, 6)],
    tz: "Asia/Taipei",
    stations,
    trains,
  });
  // One train per line keeps the diff of a re-snapshot readable.
  const lines = trains.map((t) => `    ${JSON.stringify(t)}`).join(",\n");
  const head = JSON.stringify({ ...seed, trains: [] }, null, 2).replace(/"trains": \[\]\n}$/, "");
  writeFileSync(OUT, `${head}"trains": [\n${lines}\n  ]\n}\n`);
  console.log(`wrote ${trains.length} trains, ${Object.keys(stations).length} stations → ${OUT}`);
}

await main();
