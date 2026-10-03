import "server-only";
import { ProviderFailure, type Offer, type Place, type SearchQuery, type TransportProvider } from "../../types";
import { servesModes } from "../stub";
import { distanceKm } from "../gtfs/geo";
import { matchRadiusKm } from "../match-radius";
import { seedSchema, type Seed } from "./snapshot";
import seedJson from "./seed.json";
import surfaceHubs from "../../hubs/surface-hubs.json";

function hubPlace(id: string): Place {
  const hub = surfaceHubs.find((item) => item.id === id);
  if (!hub) throw new Error(`Missing Vietnam rail hub ${id}`);
  const { name, lat, lng, country } = hub;
  return { name, lat, lng, country };
}
const stations: Record<"hanoi" | "saigon", Place> = {
  hanoi: hubPlace("train:HANOI"), saigon: hubPlace("train:SAIGON"),
};
function stationAt(p: Place, radius: number): keyof typeof stations | undefined {
  return (Object.keys(stations) as (keyof typeof stations)[])
    .map((id) => ({ id, km: distanceKm(p.lat, p.lng, stations[id].lat, stations[id].lng) }))
    .filter(({ km }) => km <= radius).sort((a, b) => a.km - b.km)[0]?.id;
}
function at(date: string, minutes: number): string {
  const day = new Date(Date.parse(`${date}T00:00:00Z`) + Math.floor(minutes / 1440) * 86_400_000).toISOString().slice(0, 10);
  return `${day}T${String(Math.floor(minutes % 1440 / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00+07:00`;
}
export function createVietnamRailProvider(seed: Seed): TransportProvider {
  const legs = (q: SearchQuery) => {
    const radius = matchRadiusKm(q.from, q.to, 20);
    const from = stationAt(q.from, radius), to = stationAt(q.to, radius);
    return from && to && from !== to ? seed.trains.filter((train) => train.from === from && train.to === to) : [];
  };
  return {
    id: "vietnam-rail", modes: ["train"],
    covers: (q) => servesModes(["train"], q) && legs(q).length > 0,
    async search(q, signal) {
      signal.throwIfAborted();
      if (!servesModes(["train"], q)) throw new ProviderFailure("UNSUPPORTED_ROUTE");
      const found = legs(q);
      if (!found.length) throw new ProviderFailure("UNSUPPORTED_ROUTE");
      return found.map((train): Offer => ({
        id: `vietnam-rail:${train.number}:${q.date}`, provider: "vietnam-rail", mode: "train", kind: "timetable",
        segments: [{ mode: "train", carrier: "Vietnam Railways", number: train.number,
          from: stations[train.from], to: stations[train.to], depart: at(q.date, train.departMin), arrive: at(q.date, train.arriveMin),
          durationMin: train.arriveMin - train.departMin }],
        bookingUrl: "https://dsvn.vn/",
        attribution: `Vietnam Railways — typical timetable, checked ${seed.checked}: ${seed.source} — confirm operating date; fares and seats not checked`,
      }));
    },
  };
}
export default createVietnamRailProvider(seedSchema.parse(seedJson));
