import type { PairFile } from "./schema";

/** Replace one publisher without dropping other feeds or retaining withdrawn services. */
export function replaceFeedPairs(
  existing: Record<string, PairFile>, incoming: Record<string, PairFile>, feedId: string,
): Record<string, PairFile> {
  const result: Record<string, PairFile> = {};
  for (const key of new Set([...Object.keys(existing), ...Object.keys(incoming)])) {
    const old = existing[key];
    const next = incoming[key];
    const departures = [
      ...(old?.departures.filter((d) => d.feed !== feedId) ?? []),
      ...(next?.departures ?? []),
    ];
    if (departures.some((d) => next?.departures.includes(d) && d.feed !== feedId)) {
      throw new Error(`Replacement contains a different feed than ${feedId}`);
    }
    if (!departures.length) continue;
    const stops = { ...old?.stops, ...next?.stops };
    const services = { ...old?.services, ...next?.services };
    const usedStops = new Set(departures.flatMap((d) => [d.from, d.to]));
    const usedServices = new Set(departures.map((d) => d.svc));
    result[key] = {
      from: (next ?? old).from, to: (next ?? old).to,
      stops: Object.fromEntries(Object.entries(stops).filter(([id]) => usedStops.has(id))),
      services: Object.fromEntries(Object.entries(services).filter(([id]) => usedServices.has(id))),
      departures,
    };
  }
  return result;
}

/** Refuse expired or implausible date windows; never extend service calendars. */
export function assertHorizon(end: string, today: string, minDays: number): number {
  const dateMs = (value: string) => {
    if (!/^\d{8}$/.test(value)) throw new Error(`Invalid GTFS calendar date: ${value}`);
    const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    const ms = Date.parse(`${iso}T00:00:00Z`);
    if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== iso) throw new Error(`Invalid GTFS calendar date: ${value}`);
    return ms;
  };
  if (!Number.isInteger(minDays) || minDays < 0) throw new Error("minDays must be a nonnegative integer");
  const days = Math.floor((dateMs(end) - dateMs(today)) / 86_400_000);
  if (days < minDays) throw new Error(`GTFS calendar ends ${end}: ${days} days remaining (need ${minDays}); upstream refresh required`);
  return days;
}
