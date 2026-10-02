import { z } from "zod";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const url = z.string().regex(/^https:\/\//);

const station = z.object({
  city: z.string(), // every station of the matched city is a candidate (Bangkok has two terminals)
  name: z.string(),
  nameLocal: z.string(),
  tts: z.string(), // row label on the SRT TTS timetable page, used by `pnpm srt:snapshot`
  lat: z.number(),
  lng: z.number(),
  country: z.string().length(2).optional(), // default TH
  source: url,
});

// SRT's own type keys (ttsview timetable_data.js `trainDetails[n].type`).
export const TRAIN_TYPES = ["special", "express", "rapid", "ordinary", "local", "suburban", "feeder_dm", "tourist"] as const;

/** One SRT train (ADR-C05 / ADR-T06): seeded stops in running order, cited. */
const seedTrain = z.object({
  number: z.string().regex(/^\d{1,4}$/),
  type: z.enum(TRAIN_TYPES),
  line: z.enum(["northern", "northeastern", "southern"]),
  direction: z.enum(["out", "in"]), // TTS trip 1 = outbound from Bangkok, trip 2 = inbound
  // [station key, "HH:MM"]: departure, except the terminus = arrival. Smaller than the previous = next day.
  stops: z.array(z.tuple([z.string(), hhmm])).min(2),
  days: z.array(z.number().int().min(0).max(6)).min(1).optional(), // start weekday, 0 = Sun; omit = daily
  source: url,
});

export const seedSchema = z
  .object({
    checked: ymd, // date the sources were read
    tz: z.literal("Asia/Bangkok"),
    stations: z.record(z.string(), station),
    trains: z.array(seedTrain),
  })
  .refine((s) => s.trains.every((t) => t.stops.every(([k]) => k in s.stations)), "train stop references unknown station");

export type Station = z.infer<typeof station>;
export type SeedTrain = z.infer<typeof seedTrain>;
export type TrainType = SeedTrain["type"];
export type Seed = z.infer<typeof seedSchema>;
