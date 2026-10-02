import { z } from "zod";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const url = z.string().regex(/^https:\/\//);

const trainStation = z.object({
  city: z.string(), // stations of one city match together (Seoul + Yongsan)
  name: z.string(),
  nameLocal: z.string(),
  lat: z.number(),
  lng: z.number(),
  source: url,
});

/** One Korail train on one station pair (ADR-C05 / ADR-T05), cited. */
const trainRow = z.object({
  from: z.string(), // station key
  to: z.string(),
  carrier: z.string(), // grade, romanised: "KTX", "ITX-Saemaeul", "Mugunghwa", …
  gradeLocal: z.string(), // grade as the source prints it: "KTX-산천", "무궁화"
  number: z.string().regex(/^\d+$/),
  departures: z.array(hhmm).min(1), // local at origin
  days: z.array(z.number().int().min(0).max(6)).min(1).optional(), // departure weekday, 0 = Sun; omit = daily
  durationMin: z.number().int().positive(),
  fareKrw: z.number().int().positive(), // adult, standard car (일반실 어른)
  tz: z.literal("Asia/Seoul"),
  source: url,
});

export const trainStationsSchema = z.record(z.string(), trainStation);

export const trainSeedSchema = z.object({
  checked: ymd, // date the sources were read
  sampleWeek: z.tuple([ymd, ymd]), // 7 days read; `days` derives from it
  trains: z.array(trainRow),
});

export type TrainStation = z.infer<typeof trainStation>;
export type TrainRow = z.infer<typeof trainRow>;
export type TrainSeed = z.infer<typeof trainSeedSchema> & { stations: Record<string, TrainStation> };
