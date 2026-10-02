import type { PairDeparture, PairFile, PairService } from "./schema";

const DAY_S = 86_400;
const DAY_MS = DAY_S * 1000;

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const compact = (isoDate: string) => isoDate.replaceAll("-", "");
const utcMidnight = (isoDate: string) => Date.parse(`${isoDate}T00:00:00Z`);

export function runsOn(s: PairService, isoDate: string): boolean {
  const d = compact(isoDate);
  if (s.remove.includes(d)) return false;
  if (s.add.includes(d)) return true;
  if ((s.start && d < s.start) || (s.end && d > s.end)) return false;
  const weekday = (new Date(utcMidnight(isoDate)).getUTCDay() + 6) % 7; // Mon = 0
  return s.days[weekday] === 1;
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetMinutes(tz: string, instantMs: number): number {
  let f = offsetFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" });
    offsetFormatters.set(tz, f);
  }
  const name = f.formatToParts(instantMs).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Service-day date + GTFS seconds (may exceed 24 h) → ISO 8601 with the timezone's offset. */
export function isoAt(serviceDate: string, secs: number, tz: string): string {
  const wallMs = utcMidnight(serviceDate) + secs * 1000;
  let off = offsetMinutes(tz, wallMs);
  off = offsetMinutes(tz, wallMs - off * 60_000);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  return `${new Date(wallMs).toISOString().slice(0, 19)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export interface DatedDeparture {
  departure: PairDeparture;
  depart: string;
  arrive: string;
}

/** Departures leaving the origin on local calendar date `isoDate`, incl. ones from the previous service day past 24:00. */
export function departuresOn(pair: PairFile, isoDate: string): DatedDeparture[] {
  const day = utcMidnight(isoDate);
  const out: DatedDeparture[] = [];
  for (const d of pair.departures) {
    const serviceDate = ymd(day - Math.floor(d.dep / DAY_S) * DAY_MS);
    const svc = pair.services[d.svc];
    if (!svc || !runsOn(svc, serviceDate)) continue;
    out.push({ departure: d, depart: isoAt(serviceDate, d.dep, d.tz), arrive: isoAt(serviceDate, d.arr, d.tz) });
  }
  return out.sort((a, b) => Date.parse(a.depart) - Date.parse(b.depart));
}
