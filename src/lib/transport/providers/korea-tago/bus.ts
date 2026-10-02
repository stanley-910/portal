import { distanceKm } from "../gtfs/geo";
import type { Offer, Place, SearchQuery } from "../../types";
import type { BusRow, BusSeed } from "./schema";
import { at } from "./train";

// KoBus express seed search (ADR-B07). Pure: no network, no env.
// Seoul and Busan each have two express terminals; every terminal in range counts, rows pick the pair.
const MATCH_KM = 10;
// KoBus booking page; takes no OD/date params (observed 2026-10-03).
export const KOBUS_BOOKING_URL = "https://www.kobus.co.kr/mrs/rotinf.do";

export function createBusSearch(seed: BusSeed) {
  const near = (lat: number, lng: number): Set<string> =>
    new Set(
      Object.entries(seed.terminals)
        .filter(([, t]) => distanceKm(lat, lng, t.lat, t.lng) <= (t.matchKm ?? MATCH_KM))
        .map(([key]) => key),
    );
  const rowsFor = (q: SearchQuery): BusRow[] => {
    const from = near(q.from.lat, q.from.lng);
    const to = near(q.to.lat, q.to.lng);
    return seed.buses.filter((b) => from.has(b.from) && to.has(b.to));
  };
  const place = (key: string): Place => {
    const t = seed.terminals[key];
    return { name: t.name, lat: t.lat, lng: t.lng, country: "KR", providerIds: { "korea-tago": key } };
  };

  return {
    covers: (q: SearchQuery) => rowsFor(q).length > 0,
    search(q: SearchQuery): Offer[] {
      const weekday = new Date(`${q.date}T00:00:00Z`).getUTCDay();
      return rowsFor(q)
        .filter((b) => !b.days || b.days.includes(weekday))
        .flatMap((b) =>
          b.departures.map((hhmm): Offer => ({
            id: `korea-tago:bus:${b.from}:${b.to}:${b.gradeLocal}:${q.date}T${hhmm}`,
            provider: "korea-tago",
            mode: "bus",
            kind: "timetable",
            segments: [
              {
                mode: "bus",
                carrier: b.carrier,
                from: place(b.from),
                to: place(b.to),
                depart: at(q.date, hhmm),
                arrive: at(q.date, hhmm, b.durationMin),
                durationMin: b.durationMin,
              },
            ],
            price: { amount: b.fareKrw, currency: "KRW", asOf: seed.checked },
            bookingUrl: KOBUS_BOOKING_URL,
          })),
        );
    },
  };
}
