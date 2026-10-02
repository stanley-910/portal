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

/** One THSR train (ADR-C05 / ADR-T04): served stops in running order, cited. */
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
