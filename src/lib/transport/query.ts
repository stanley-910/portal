import { z } from "zod";
import type { SearchQuery } from "./types";

const optionalText = <T extends z.ZodType>(schema: T) => z.preprocess(
  (value) => typeof value === "string" && !value.trim() ? undefined : value, schema.optional(),
);
const placeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  country: optionalText(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)),
  iata: optionalText(z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/)),
  providerIds: z.partialRecord(
    z.enum(["travelpayouts", "12go", "tdx", "korea-tago", "china-rail", "busonlineticket", "gtfs", "srt", "duffel", "vietnam-rail", "official-ferries", "rail-cache"]),
    z.string().trim().min(1).max(200),
  ).optional(),
});
const querySchema = z.object({
  from: placeSchema,
  to: placeSchema,
  date: z.iso.date(),
  modes: z.array(z.enum(["flight", "train", "bus", "ferry"])).max(4),
  passengers: optionalText(z.coerce.number().int().min(1).max(9)).transform((value) => value ?? 1),
  currency: optionalText(z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/)).transform((value) => value ?? "USD"),
});

export type ParsedQuery = { success: true; data: SearchQuery } | { success: false; fields: string[] };

function parse(params: URLSearchParams): SearchQuery {
  const raw = Object.fromEntries(params);
  const place = (side: "from" | "to") => {
    // JSON has strict numeric coordinates. Only flat query-string numbers are
    // coerced; null/empty JSON latitude must never silently become zero.
    if (raw[side] !== undefined) return JSON.parse(raw[side]);
    const number = (value: string | undefined) => value?.trim() ? Number(value) : undefined;
    return {
      name: raw[`${side}Name`], lat: number(raw[`${side}Lat`]), lng: number(raw[`${side}Lng`]),
      iata: raw[`${side}Iata`], country: raw[`${side}Country`],
    };
  };
  const parsed = querySchema.parse({
    ...raw, from: place("from"), to: place("to"),
    modes: [...new Set((raw.modes ?? "").split(",").map((mode) => mode.trim()).filter(Boolean))],
  });
  // Keep the established Place shape: absent optional keys are omitted.
  for (const side of ["from", "to"] as const) {
    for (const key of ["iata", "country", "providerIds"] as const) {
      if (parsed[side][key] === undefined) delete parsed[side][key];
    }
  }
  return parsed;
}

/** URL helper throws on invalid input; URLSearchParams form preserves per-field diagnostics. */
export function parseSearchQuery(url: string): SearchQuery;
export function parseSearchQuery(params: URLSearchParams): ParsedQuery;
export function parseSearchQuery(input: string | URLSearchParams): SearchQuery | ParsedQuery {
  if (typeof input === "string") return parse(new URL(input).searchParams);
  try {
    return { success: true, data: parse(input) };
  } catch (error) {
    if (error instanceof SyntaxError) return { success: false, fields: ["from", "to"].filter((key) => input.has(key)) };
    if (!(error instanceof z.ZodError)) throw error;
    const fields = error.issues.map(({ path }) => {
      const [side, field] = path.map(String);
      return (side === "from" || side === "to") && field
        ? `${side}${field[0].toUpperCase()}${field.slice(1)}` : side;
    });
    return { success: false, fields: [...new Set(fields)] };
  }
}
