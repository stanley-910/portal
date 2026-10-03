import type { Mode } from "@/lib/transport/types";
import { distanceKm } from "@/lib/transport/hubs/geo";

import { computeSplit, type SplitInput } from "./split";
import { stopCountry } from "./stops";

// My Trips as a library: each trip the person is in, read from its saved plan into what the sidebar draws (its
// stops, legs and people) and the numbers it shows. Pure: the server reads the plans and who's in each room
// (`listMyLibrary` in ./server), and this turns one of them into a `LibraryTrip`. Never throws on a garbled plan.

export type LibraryStop = { id: string; name: string; code: string; country: string | null; lat: number; lng: number };

export type LibraryLeg = {
  id: string;
  from: LibraryStop;
  to: LibraryStop;
  /** The picked option's mode, else the best option's, else a flight. */
  mode: Mode;
  /** YYYY-MM-DD. */
  date: string;
  riders: string[];
  /** Who drew it, for its colour; null for Pip's. */
  by: string | null;
};

export type LibraryMember = {
  id: string;
  name: string;
  /** Member colour slot, 0 for `member-1`. */
  slot: number;
  /** In the trip's room right now. */
  present: boolean;
  you: boolean;
};

export type LibraryTrip = {
  id: string;
  title: string;
  /** Whether the person owns it, and so can rename it for everyone. Members can rename too; see `renameTrip`. */
  owner: boolean;
  updatedAt: string;
  members: LibraryMember[];
  /** In travel order. */
  legs: LibraryLeg[];
  /** The person's share so far, by currency; empty when nothing is priced. */
  share: Record<string, number>;
};

export type LibraryInput = {
  id: string;
  title: string;
  owner: boolean;
  updatedAt: string;
  /** The plan as `getStorageDocument(room, "json")` returns it. */
  plan: unknown;
  /** Ids of whoever is in the room right now. */
  present: ReadonlySet<string>;
};

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const MODES = new Set<Mode>(["flight", "train", "bus", "ferry"]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "HKG", or the name's first three letters for a stop without a code. */
const codeOf = (code: unknown, name: string) => (str(code).trim() || name.replace(/[^A-Za-z]/g, "").slice(0, 3) || "···").toUpperCase();

function stopOf(id: string, raw: unknown): LibraryStop | null {
  if (!isObj(raw)) return null;
  const lat = num(raw.lat);
  const lng = num(raw.lng);
  if (lat === null || lng === null) return null;
  const name = str(raw.name).trim() || "A stop";
  const hub = typeof raw.hub === "string" ? raw.hub : null;
  return { id, name, code: codeOf(raw.code, name), country: stopCountry({ lat, lng, hub }), lat, lng };
}

function modeOf(leg: Raw): Mode {
  const offers = isObj(leg.search) && Array.isArray(leg.search.offers) ? leg.search.offers.filter(isObj) : [];
  const picked = offers.find((o) => o.id === leg.chosen) ?? offers[0];
  const mode = picked?.mode as Mode | undefined;
  return mode && MODES.has(mode) ? mode : "flight";
}

/** One trip for the library, from its saved plan. Legs that lost a stop or have no date are left out. */
export function libraryTripOf(input: LibraryInput, userId: string): LibraryTrip {
  const doc = isObj(input.plan) ? input.plan : {};
  const rawStops = isObj(doc.stops) ? doc.stops : {};
  const rawMembers = isObj(doc.members) ? doc.members : {};
  const stops = new Map<string, LibraryStop>();
  for (const [id, raw] of Object.entries(rawStops)) {
    const stop = stopOf(id, raw);
    if (stop) stops.set(id, stop);
  }
  const legs: LibraryLeg[] = (isObj(doc.legs) ? Object.entries(doc.legs) : [])
    .filter((e): e is [string, Raw] => isObj(e[1]))
    .flatMap(([id, leg]) => {
      const from = stops.get(str(leg.from));
      const to = stops.get(str(leg.to));
      const date = str(leg.date);
      if (!from || !to || !ISO_DAY.test(date)) return [];
      const riders = Array.isArray(leg.riders) ? leg.riders.filter((r): r is string => typeof r === "string") : [];
      const by = str(leg.createdBy) || null;
      return [{ id, from, to, mode: modeOf(leg), date, riders, by, at: num(leg.createdAt) ?? 0 }];
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `at` only orders them
    .map(({ at, ...leg }) => leg);

  const members: LibraryMember[] = Object.entries(rawMembers)
    .filter((e): e is [string, Raw] => isObj(e[1]))
    .map(([id, m]) => ({
      id,
      name: str(m.name).trim() || "Someone",
      // the room counts colours from 1
      slot: Math.max(0, (num(m.color) ?? 1) - 1),
      present: input.present.has(id),
      you: id === userId,
    }));
  // you first, then everyone in the order they joined
  members.sort((a, b) => Number(b.you) - Number(a.you));

  let share: Record<string, number> = {};
  try {
    share = computeSplit(doc as SplitInput).members[userId]?.totals ?? {};
  } catch {
    // an unpriceable plan still lists, with no share
  }

  return { id: input.id, title: input.title, owner: input.owner, updatedAt: input.updatedAt, members, legs, share };
}

/** The legs this person rides; a trip where they ride none counts all of it as theirs (e.g. they only plan it). */
export const myLegs = (trip: LibraryTrip, userId: string) => {
  const mine = trip.legs.filter((l) => l.riders.includes(userId));
  return mine.length ? mine : trip.legs;
};

export const firstDay = (trip: LibraryTrip) => trip.legs[0]?.date ?? null;
export const lastDay = (trip: LibraryTrip) => trip.legs.at(-1)?.date ?? null;
/** Past once its last leg has left; a trip with no legs yet is upcoming. */
export const isPast = (trip: LibraryTrip, today: string) => {
  const last = lastDay(trip);
  return !!last && last < today;
};
export const isGroup = (trip: LibraryTrip) => trip.members.length > 1;

/** Average speeds for a rough time in transit, km/h, door to door of the vehicle; the sidebar marks it estimated. */
const SPEED: Record<Mode, number> = { flight: 650, train: 160, bus: 60, ferry: 30 };

export type TripStats = { km: number; legs: number; cities: number; countries: number; nights: number; hours: number; modes: Mode[] };

/** The numbers for a trip, counting the person's own legs: distance, stops, countries, nights away and modes. */
export function statsOf(trip: LibraryTrip, userId: string): TripStats {
  const legs = myLegs(trip, userId);
  const km = legs.reduce((sum, l) => sum + distanceKm(l.from, l.to), 0);
  const cities = new Set(legs.flatMap((l) => [l.from.name, l.to.name]));
  const countries = new Set(legs.flatMap((l) => [l.from.country, l.to.country]).filter(Boolean));
  const first = legs[0]?.date;
  const last = legs.at(-1)?.date;
  const nights = first && last ? Math.max(0, Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000)) : 0;
  const hours = Math.round(legs.reduce((sum, l) => sum + distanceKm(l.from, l.to) / SPEED[l.mode], 0));
  const modes = [...new Set(legs.map((l) => l.mode))];
  return { km: Math.round(km), legs: legs.length, cities: cities.size, countries: countries.size, nights, hours, modes };
}

/** Lifetime totals over trips already taken: distance and countries. */
export function travelled(trips: LibraryTrip[], userId: string, today: string) {
  const past = trips.filter((t) => isPast(t, today));
  const legs = past.flatMap((t) => myLegs(t, userId));
  return {
    km: Math.round(legs.reduce((sum, l) => sum + distanceKm(l.from, l.to), 0)),
    countries: new Set(legs.flatMap((l) => [l.from.country, l.to.country]).filter(Boolean)).size,
    trips: past.length,
  };
}
