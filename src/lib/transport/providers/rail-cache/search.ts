import type { Calendar, ScheduleCache, CachedTrip } from "./schema";

const DAY = 86_400_000;
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}
export function runsOn(calendar: Calendar, originDate: string): boolean {
  if (calendar.excludeDates?.includes(originDate)) return false;
  if (calendar.includeDates?.includes(originDate)) return true;
  if (calendar.start && originDate < calendar.start || calendar.end && originDate > calendar.end) return false;
  if (calendar.kind === "dated") return calendar.dates?.includes(originDate) ?? false;
  if (calendar.days && !calendar.days.includes(new Date(`${originDate}T00:00:00Z`).getUTCDay())) return false;
  return true; // explicitly labelled typical schedule, never live availability
}
export function timestamp(originDate: string, seconds: number, offset: string): string {
  const date = addDays(originDate, Math.floor(seconds / 86400));
  const time = new Date((seconds % 86400) * 1000).toISOString().slice(11, 19);
  return `${date}T${time}${offset}`;
}
export interface CachedJourney {
  trip: CachedTrip;
  from: string;
  to: string;
  depart: string;
  arrive: string;
  durationMin: number;
}
export function createScheduleSearch(cache: ScheduleCache) {
  const departures = new Map<string, { trip: CachedTrip; index: number }[]>();
  for (const trip of cache.trips) {
    for (let i = 0; i < trip.stops.length - 1; i++) {
      const stop = trip.stops[i];
      if (stop.departure === undefined) continue;
      const entries = departures.get(stop.station) ?? [];
      entries.push({ trip, index: i });
      departures.set(stop.station, entries);
    }
  }
  return (from: ReadonlySet<string>, to: ReadonlySet<string>, date: string): CachedJourney[] => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || addDays(date, 0) !== date) return [];
    const result: CachedJourney[] = [];
    const seen = new Set<string>();
    for (const station of from) {
      for (const { trip, index } of departures.get(station) ?? []) {
        const departure = trip.stops[index].departure!;
        // Query date is the passenger's boarding date, not necessarily train-origin date.
        const originDate = addDays(date, -Math.floor(departure / 86400));
        if (!runsOn(trip.calendar, originDate)) continue;
        for (const stop of trip.stops.slice(index + 1)) {
          if (!to.has(stop.station) || stop.arrival === undefined || stop.arrival <= departure) continue;
          const depart = timestamp(originDate, departure, trip.offset);
          const arrive = timestamp(originDate, stop.arrival, trip.offset);
          const key = [trip.source, trip.number, station, stop.station, depart, arrive].join("|");
          if (seen.has(key)) continue;
          seen.add(key);
          result.push({ trip, from: station, to: stop.station, depart, arrive, durationMin: (stop.arrival - departure) / 60 });
        }
      }
    }
    return result.sort((a, b) => a.depart.localeCompare(b.depart) || a.durationMin - b.durationMin);
  };
}
