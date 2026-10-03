import "server-only";
import ferryRoutes from "./ferry-routes.json";
import busRoutes from "./bus-routes.json";
import { matchesRoute } from "./match";
import { tagged, twelveGoUrl } from "./links";
import type { Mode, Offer, Place, SearchQuery, TransportProvider } from "../../types";

export interface SeedStop {
  name: string;
  lat: number;
  lng: number;
  country: string;
  slug: string;
}

export interface SeedRoute {
  from: SeedStop;
  to: SeedStop;
  operators: string[];
  departures: string[];
  tz: string;
  durationMin: number;
  source: string;
}

const seeds: Record<Mode, SeedRoute[]> = {
  ferry: ferryRoutes as SeedRoute[],
  bus: busRoutes as SeedRoute[],
  flight: [],
  train: [],
};

export function routesFor(mode: Mode): SeedRoute[] {
  return seeds[mode] ?? [];
}

function offsetFor(date: string, time: string, tz: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const localMs = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(localMs));
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return (Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute)) - localMs) / 60_000;
}

function localIso(date: string, time: string, tz: string, durationMin: number): [string, string] {
  const offset = offsetFor(date, time, tz);
  const sign = offset >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offset);
  const offsetText = `${sign}${String(Math.floor(absoluteOffset / 60)).padStart(2, "0")}:${String(absoluteOffset % 60).padStart(2, "0")}`;
  const depart = `${date}T${time}:00${offsetText}`;
  const arrive = new Date(new Date(depart).getTime() + durationMin * 60_000).toISOString();
  return [depart, arrive];
}

function place(stop: SeedStop): Place {
  return { ...stop };
}

function offer(route: SeedRoute, query: SearchQuery, mode: "ferry" | "bus", direction: "forward" | "reverse", departure: string): Offer {
  const from = direction === "forward" ? route.from : route.to;
  const to = direction === "forward" ? route.to : route.from;
  const [depart, arrive] = localIso(query.date, departure, route.tz, route.durationMin);
  return {
    id: `12go:${mode}:${from.slug}-${to.slug}:${query.date}:${departure}`,
    provider: "12go",
    mode,
    segments: [{
      mode,
      carrier: route.operators.join(", "),
      from: place(from),
      to: place(to),
      depart,
      arrive,
      durationMin: route.durationMin,
    }],
    kind: direction === "reverse" ? "estimated" : "timetable",
    attribution: direction === "reverse"
      ? `Modelled reverse-direction timing from the opposite-direction timetable; confirm with operator · ${route.source}`
      : `Bundled estimated timetable · ${route.source}`,
    bookingUrl: tagged(twelveGoUrl(from.slug, to.slug)),
  };
}

export const twelveGo: TransportProvider = {
  id: "12go",
  modes: ["ferry", "bus"],
  covers(query) {
    const modes = query.modes.length === 0 ? ["ferry", "bus"] as const : query.modes;
    return modes.some((mode) => routesFor(mode).some((route) => matchesRoute(query.from, query.to, route) !== null));
  },
  async search(query) {
    const modes: Array<"ferry" | "bus"> = query.modes.length === 0
      ? ["ferry", "bus"]
      : query.modes.filter((mode): mode is "ferry" | "bus" => mode === "ferry" || mode === "bus");
    return modes.flatMap((mode) => routesFor(mode).flatMap((route) => {
      const direction = matchesRoute(query.from, query.to, route);
      return direction ? route.departures.map((departure) => offer(route, query, mode, direction, departure)) : [];
    }));
  },
};

export default twelveGo;
