import type { Mode } from "../../types";

export interface City {
  id: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
  radiusKm: number;
}

export interface PairStop {
  name: string;
  lat: number;
  lng: number;
}

export interface PairService {
  days: number[]; // Mon..Sun, 1 = runs
  start: string; // YYYYMMDD
  end: string;
  add: string[];
  remove: string[];
}

/** One departure from the origin city; `dep`/`arr` are seconds after service-day midnight, may exceed 86400. */
export interface PairDeparture {
  id: string;
  feed: string;
  op: string;
  num?: string;
  mode: Mode;
  tz: string;
  svc: string;
  from: string;
  to: string;
  dep: number;
  arr: number;
}

export interface PairFile {
  from: string;
  to: string;
  stops: Record<string, PairStop>;
  services: Record<string, PairService>;
  departures: PairDeparture[];
}

export interface FeedMeta {
  id: string;
  name: string;
  url: string;
  country: string;
  licence: string;
  attribution: string;
  version?: string;
  calendarStart: string;
  calendarEnd: string;
}

export interface GtfsMeta {
  builtAt: string;
  feeds: FeedMeta[];
  pairs: string[];
}

export const pairKey = (from: string, to: string) => `${from}__${to}`;
