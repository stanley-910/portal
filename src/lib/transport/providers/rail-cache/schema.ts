export interface Calendar {
  kind: "dated" | "published" | "typical";
  dates?: string[];
  start?: string;
  end?: string;
  days?: number[];
  includeDates?: string[];
  excludeDates?: string[];
  notes?: string;
}
export interface CachedStation {
  name: string;
  country: string;
  aliases: string[];
  lat?: number;
  lng?: number;
  coordinateSource?: string;
}
export interface CachedStop { station: string; arrival?: number; departure?: number }
export interface CachedTrip {
  id: string;
  source: string;
  number: string;
  country: string;
  offset: string;
  calendar: Calendar;
  stops: CachedStop[];
  operator?: string;
  notes?: string;
  locator?: Record<string, string | number>;
}
export interface ScheduleCache {
  version: number;
  stations: Record<string, CachedStation>;
  sources: Record<string, { group: string; url?: string; path: string; sha256: string; retrievedAt?: string | null }>;
  trips: CachedTrip[];
}
