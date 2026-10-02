import "server-only";
import { ProviderFailure, type Offer, type Place, type SearchQuery, type TransportProvider } from "../../types";
import { servesModes } from "../stub";
import cityList from "./cities.json";
import { cityAt } from "./geo";
import meta from "./meta.json";
import { pairs as builtPairs } from "./pairs";
import { departuresOn } from "./schedule";
import { pairKey, type City, type FeedMeta, type GtfsMeta, type PairFile } from "./schema";

export interface GtfsProviderOptions {
  cities: readonly City[];
  feeds: readonly FeedMeta[];
  pairs: Readonly<Record<string, () => Promise<PairFile>>>;
}

const MODES = ["bus"] as const; // T05 adds "train"

export function createGtfsProvider(opts: GtfsProviderOptions): TransportProvider {
  const feeds = new Map(opts.feeds.map((f) => [f.id, f]));
  const keyFor = (q: SearchQuery) => {
    const a = cityAt(opts.cities, q.from.lat, q.from.lng);
    const b = cityAt(opts.cities, q.to.lat, q.to.lng);
    return a && b && a.id !== b.id ? pairKey(a.id, b.id) : undefined;
  };

  return {
    id: "gtfs",
    modes: [...MODES],
    covers(q) {
      const key = keyFor(q);
      return servesModes(MODES, q) && key !== undefined && key in opts.pairs;
    },
    async search(q) {
      const key = keyFor(q);
      const load = key ? opts.pairs[key] : undefined;
      if (!load) throw new ProviderFailure("UNSUPPORTED_ROUTE");
      const pair = await load();
      const place = (stopKey: string, country?: string): Place => {
        const s = pair.stops[stopKey];
        return { name: s.name, lat: s.lat, lng: s.lng, ...(country ? { country } : {}), providerIds: { gtfs: stopKey } };
      };
      return departuresOn(pair, q.date)
        .filter(({ departure: d }) => (MODES as readonly string[]).includes(d.mode) && (q.modes.length === 0 || q.modes.includes(d.mode)))
        .map(({ departure: d, depart, arrive }): Offer => {
          const feed = feeds.get(d.feed);
          return {
            id: `gtfs:${d.id}:${q.date}`,
            provider: "gtfs",
            mode: d.mode,
            kind: "timetable",
            segments: [
              {
                mode: d.mode,
                carrier: d.op,
                ...(d.num ? { number: d.num } : {}),
                from: place(d.from, feed?.country),
                to: place(d.to, feed?.country),
                depart,
                arrive,
                durationMin: Math.round((d.arr - d.dep) / 60),
              },
            ],
            ...(feed ? { attribution: feed.attribution } : {}),
          };
        });
    },
  };
}

export default createGtfsProvider({
  cities: cityList,
  feeds: (meta as GtfsMeta).feeds,
  pairs: builtPairs,
});
