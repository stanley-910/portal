import { z } from "zod";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const url = z.string().regex(/^https:\/\//);
const tz = z.enum(["Asia/Kuala_Lumpur", "Asia/Singapore", "Asia/Bangkok"]);

const city = z.object({
  name: z.string(),
  botSlug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/), // BOT city name, lowercased, spaces→"-"
  country: z.enum(["MY", "SG", "TH"]),
  lat: z.number(),
  lng: z.number(),
  tz,
  source: url,
});

/** One operator on one pair (ADR-C05): published first/last departure, local at origin, cited. */
const route = z.object({
  from: z.string(), // city key
  to: z.string(),
  carrier: z.string(),
  departures: z.array(hhmm).min(1),
  durationMin: z.number().int().positive(), // BOT "Est. Duration" for the pair
  tz,
  source: url,
});

export const seedSchema = z
  .object({
    checked: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    cities: z.record(z.string(), city),
    routes: z.array(route),
  })
  .refine((s) => s.routes.every((r) => r.from in s.cities && r.to in s.cities && r.from !== r.to), "route references unknown city")
  .refine((s) => s.routes.every((r) => s.cities[r.from]?.tz === r.tz), "route tz ≠ origin city tz");

export type City = z.infer<typeof city>;
export type SeedRoute = z.infer<typeof route>;
export type Seed = z.infer<typeof seedSchema>;
