import { z } from "zod";

import type { SearchQuery } from "./types";

const placeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  country: z.string().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()).optional(),
  iata: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()).optional(),
  providerIds: z.partialRecord(
    z.enum(["travelpayouts", "12go", "tdx", "korea-tago", "china-rail", "busonlineticket", "gtfs"]),
    z.string().trim().min(1).max(200),
  ).optional(),
});

const querySchema = z.object({
  from: placeSchema,
  to: placeSchema,
  // Unlike a shape-only regex, z.iso.date rejects February 30 and invalid months.
  date: z.iso.date(),
  modes: z.array(z.enum(["flight", "train", "bus", "ferry"])).max(4).default([]),
  passengers: z.coerce.number().int().min(1).max(999).default(1),
  currency: z.string().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()).default("USD"),
});

/** Parse the public GET contract; coordinates in the JSON places must be numbers. */
export function parseSearchQuery(url: string): SearchQuery {
  const raw = Object.fromEntries(new URL(url).searchParams);
  return querySchema.parse({
    ...raw,
    from: JSON.parse(raw.from ?? "{}"),
    to: JSON.parse(raw.to ?? "{}"),
    modes: raw.modes ? [...new Set(raw.modes.split(","))] : [],
  });
}
