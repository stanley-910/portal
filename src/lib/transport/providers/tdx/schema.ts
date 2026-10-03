import { z } from "zod";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const url = z.string().regex(/^https:\/\//);

const station = z.object({
  id: z.string(), // TDX StationID, e.g. "1000" Taipei
  code: z.string(), // TDX StationCode, e.g. "TPE"
  name: z.string(),
  nameLocal: z.string(),
  lat: z.number(),
  lng: z.number(),
  source: url,
});

/** One THSR train: served stops in running order, cited. */
const seedTrain = z.object({
  number: z.string().regex(/^\d{4}$/),
  direction: z.enum(["S", "N"]), // southbound (Nangang → Zuoying) / northbound
  // [station key, "HH:MM" departure]; a time smaller than the previous stop's = next day.
  stops: z.array(z.tuple([z.string(), hhmm])).min(2),
  days: z.array(z.number().int().min(0).max(6)).min(1).optional(), // start weekday, 0 = Sun; omit = daily
  source: url,
});

export const seedSchema = z
  .object({
    checked: ymd, // date the sources were read
    sampleWeek: z.tuple([ymd, ymd]), // Mon..Sun whose timetable was read; `days` derives from it
    tz: z.literal("Asia/Taipei"),
    stations: z.record(z.string(), station),
    trains: z.array(seedTrain),
  })
  .refine((s) => s.trains.every((t) => t.stops.every(([k]) => k in s.stations)), "train stop references unknown station");

export type Station = z.infer<typeof station>;
export type SeedTrain = z.infer<typeof seedTrain>;
export type Seed = z.infer<typeof seedSchema>;

// --- Intercity bus (國道客運) seed ---

const busTerminal = z.object({
  name: z.string(),
  nameLocal: z.string(),
  city: z.string(),
  lat: z.number(),
  lng: z.number(),
  source: url,
});

export const busTerminalsSchema = z.object({
  checked: ymd,
  terminals: z.record(z.string(), busTerminal),
});

const busRoute = z.object({
  operator: z.string(), // English short name, shown as Segment.carrier
  operatorLocal: z.string(),
  bookingUrl: url,
  source: url, // where the trip times were read
  crossCheck: url, // 公路局 timetable the times were compared against
});

/** One scheduled run: seeded terminals it serves in running order (published local times, Asia/Taipei). */
const busTrip = z.object({
  route: z.string(),
  sub: z.string(), // TDX SubRouteName, e.g. "1619B"
  // [terminal key, "HH:MM"]; a time smaller than the previous stop's = next day.
  stops: z.array(z.tuple([z.string(), hhmm])).min(2),
  days: z.array(z.number().int().min(0).max(6)).min(1).optional(), // start weekday, 0 = Sun; omit = daily
});

export const busSeedSchema = z
  .object({
    checked: ymd,
    tz: z.literal("Asia/Taipei"),
    routes: z.record(z.string(), busRoute),
    trips: z.array(busTrip),
  })
  .refine((s) => s.trips.every((t) => t.route in s.routes), "trip references unknown route");

export type BusTerminals = z.infer<typeof busTerminalsSchema>;
export type BusSeed = z.infer<typeof busSeedSchema>;
export type BusTrip = z.infer<typeof busTrip>;
