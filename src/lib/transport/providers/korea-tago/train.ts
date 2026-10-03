import { distanceKm } from "../gtfs/geo";
import type { Offer, Place, SearchQuery } from "../../types";
import type { TrainRow, TrainSeed } from "./schema";

// Korail seed search. Pure: no network, no env.
const MATCH_KM = 15;
const OFFSET = "+09:00"; // Asia/Seoul, no DST
// Korail's own search page; takes no OD/date params (korail.com SPA, observed 2026-10-02).
export const KORAIL_BOOKING_URL = "https://www.korail.com/ticket/search/general";

/** Nearest station within MATCH_KM picks the city; every station in that city matches (Seoul + Yongsan). */
function stationsNear(seed: TrainSeed, lat: number, lng: number): Set<string> {
  let city: string | undefined;
  let bestKm = MATCH_KM;
  for (const s of Object.values(seed.stations)) {
    const km = distanceKm(lat, lng, s.lat, s.lng);
    if (km <= bestKm) {
      city = s.city;
      bestKm = km;
    }
  }
  return new Set(city === undefined ? [] : Object.keys(seed.stations).filter((k) => seed.stations[k].city === city));
}

/** `date` + `hhmm` + `plusMin`, as local ISO with +09:00. */
export function at(date: string, hhmm: string, plusMin = 0): string {
  return `${new Date(Date.parse(`${date}T${hhmm}:00Z`) + plusMin * 60_000).toISOString().slice(0, 19)}${OFFSET}`;
}

export function createTrainSearch(seed: TrainSeed) {
  const rowsFor = (q: SearchQuery): TrainRow[] => {
    const from = stationsNear(seed, q.from.lat, q.from.lng);
    const to = stationsNear(seed, q.to.lat, q.to.lng);
    return seed.trains.filter((t) => from.has(t.from) && to.has(t.to));
  };
  const place = (key: string): Place => {
    const s = seed.stations[key];
    return { name: s.name, lat: s.lat, lng: s.lng, country: "KR", providerIds: { "korea-tago": key } };
  };

  return {
    covers: (q: SearchQuery) => rowsFor(q).length > 0,
    search(q: SearchQuery): Offer[] {
      const weekday = new Date(`${q.date}T00:00:00Z`).getUTCDay();
      return rowsFor(q)
        .filter((t) => !t.days || t.days.includes(weekday))
        .flatMap((t) =>
          t.departures.map((hhmm): Offer => ({
            id: `korea-tago:${t.number}:${t.from}:${q.date}T${hhmm}`,
            provider: "korea-tago",
            mode: "train",
            kind: "timetable",
            segments: [
              {
                mode: "train",
                carrier: t.carrier,
                number: t.number,
                from: place(t.from),
                to: place(t.to),
                depart: at(q.date, hhmm),
                arrive: at(q.date, hhmm, t.durationMin),
                durationMin: t.durationMin,
              },
            ],
            price: { amount: t.fareKrw, currency: "KRW", asOf: seed.checked },
            bookingUrl: KORAIL_BOOKING_URL,
          })),
        )
        .sort((a, b) => Date.parse(a.segments[0].depart) - Date.parse(b.segments[0].depart));
    },
  };
}
