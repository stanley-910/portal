// Snapshots one week of Korail timetables + adult fares into the korea-tago train seed.
// Run: `pnpm korea:snapshot`. Pages cached in .cache/korea-trains/<today>/ (delete to refetch).
// Never runs at request time.
//
// Source: train.asamaru.net per-pair timetable pages (public, no login; each page embeds the next
// 7 days with train grade, number, times, duration and fares). Korail's own search
// (korail.com/ticket/search) sits behind bot protection (POST to an obfuscated path → HTTP 500 in
// an automated browser, observed 2026-10-02), so it is not used.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { trainSeedSchema, trainStationsSchema, type TrainRow } from "../src/lib/transport/providers/korea-tago/schema.ts";

const BASE = "https://train.asamaru.net";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIR = `${ROOT}src/lib/transport/providers/korea-tago/`;
const today = new Date().toISOString().slice(0, 10);
const CACHE = `${ROOT}.cache/korea-trains/${today}/`;

// Station key → asamaru slug.
const SLUG: Record<string, string> = {
  seoul: "서울역-경부선-고속철도",
  yongsan: "용산역-호남선-고속철도",
  busan: "부산역-경부선-고속철도",
  daejeon: "대전역-경부선-고속철도",
  dongdaegu: "동대구역-경부선",
  "gwangju-songjeong": "광주송정역-호남선-고속철도",
  gangneung: "강릉역-강릉선",
  mokpo: "목포역-호남선-고속철도",
};
const PAIRS: [string, string][] = [
  ["seoul", "busan"],
  ["seoul", "daejeon"],
  ["seoul", "dongdaegu"],
  ["seoul", "gwangju-songjeong"],
  ["yongsan", "gwangju-songjeong"],
  ["seoul", "gangneung"],
  ["yongsan", "mokpo"],
];
const GRADE: Record<string, string> = {
  KTX: "KTX",
  "KTX-산천": "KTX-Sancheon",
  "KTX-청룡": "KTX-Cheongryong",
  "KTX-이음": "KTX-Eum",
  "ITX-새마을": "ITX-Saemaeul",
  "ITX-마음": "ITX-Maeum",
  "ITX-청춘": "ITX-Cheongchun",
  새마을호: "Saemaeul",
  무궁화: "Mugunghwa",
  누리로: "Nuriro",
};

// Seed cites the readable (decoded) URL; fetch gets it percent-encoded.
const pageUrl = (from: string, to: string) => `${BASE}/시간표/${SLUG[from]}/출발/${SLUG[to]}/도착/`;

async function cached(file: string, url: string): Promise<string> {
  const path = CACHE + file;
  if (existsSync(path)) return readFileSync(path, "utf8");
  const res = await fetch(encodeURI(url), { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const body = await res.text();
  writeFileSync(path, body);
  await new Promise((r) => setTimeout(r, 1_000));
  return body;
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

interface Run { date: string; carrier: string; gradeLocal: string; number: string; depart: string; durationMin: number; fareKrw: number }

let noFare = 0;

function parse(html: string): Run[] {
  const runs: Run[] = [];
  for (const sec of html.split(/class="cDateSection c-/).slice(1)) {
    const date = sec.slice(0, 10);
    const body = (sec.split("<tbody>")[1] ?? "").split("</tbody>")[0];
    for (const tr of body.split("<tr>").slice(1)) {
      const cell = (cls: string) => text(tr.match(new RegExp(`<td class="${cls}">([\\s\\S]*?)</td>`))?.[1] ?? "");
      const dep = cell("departure").match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/);
      const train = cell("train").match(/^(\S+) (\d+)$/);
      const dur = cell("duration").match(/^(\d{2}):(\d{2})$/);
      const fare = cell("fare").match(/^([\d,]+) 원/);
      if (!dep || !train || !dur) throw new Error(`unparsed row on ${date}: ${text(tr).slice(0, 120)}`);
      if (dep[1] !== date) throw new Error(`row date ${dep[1]} ≠ section ${date}`);
      if (!fare) { noFare++; continue; } // no fare published → not seeded (every seeded row needs a cited fare)
      const carrier = GRADE[train[1]];
      if (!carrier) throw new Error(`unknown grade ${train[1]}`);
      runs.push({
        date, carrier, gradeLocal: train[1], number: train[2], depart: dep[2],
        durationMin: Number(dur[1]) * 60 + Number(dur[2]), fareKrw: Number(fare[1].replaceAll(",", "")),
      });
    }
  }
  return runs;
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const stations = trainStationsSchema.parse(JSON.parse(readFileSync(`${DIR}train-stations.json`, "utf8")));
  const rows: TrainRow[] = [];
  const dates = new Set<string>();
  for (const [a, b] of PAIRS) {
    for (const [from, to] of [[a, b], [b, a]]) {
      if (!stations[from] || !stations[to]) throw new Error(`unknown station ${from}>${to}`);
      const url = pageUrl(from, to);
      const runs = parse(await cached(`${from}__${to}.html`, url));
      const byTrain = new Map<string, { run: Run; days: Set<number> }>();
      for (const r of runs) {
        dates.add(r.date);
        const k = `${r.number}|${r.depart}|${r.durationMin}|${r.fareKrw}|${r.carrier}`;
        const day = new Date(`${r.date}T00:00:00Z`).getUTCDay();
        const seen = byTrain.get(k);
        if (seen) seen.days.add(day);
        else byTrain.set(k, { run: r, days: new Set([day]) });
      }
      const pairRows = [...byTrain.values()]
        .sort((x, y) => minutes(x.run.depart) - minutes(y.run.depart) || x.run.number.localeCompare(y.run.number))
        .map(({ run, days }): TrainRow => ({
          from, to, carrier: run.carrier, gradeLocal: run.gradeLocal, number: run.number,
          departures: [run.depart],
          ...(days.size === 7 ? {} : { days: [...days].sort((x, y) => x - y) }),
          durationMin: run.durationMin, fareKrw: run.fareKrw, tz: "Asia/Seoul", source: url,
        }));
      console.log(`${from} → ${to}: ${pairRows.length} trains`);
      rows.push(...pairRows);
    }
  }
  const week = [...dates].sort();
  if (week.length !== 7) throw new Error(`expected 7 sample days, got ${week.join(",")}`);
  const seed = trainSeedSchema.parse({ checked: today, sampleWeek: [week[0], week[6]], trains: rows });
  // One train per line keeps the diff of a re-snapshot readable.
  const lines = seed.trains.map((t) => `    ${JSON.stringify(t)}`).join(",\n");
  writeFileSync(
    `${DIR}train-seed.json`,
    `{\n  "checked": "${seed.checked}",\n  "sampleWeek": ${JSON.stringify(seed.sampleWeek)},\n  "trains": [\n${lines}\n  ]\n}\n`,
  );
  console.log(`wrote ${rows.length} trains → ${DIR}train-seed.json (${noFare} runs skipped: no fare)`);
}

await main();
