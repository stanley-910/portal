import { z } from "zod";
import type { Mode, Place, SearchQuery } from "./types";

// Query-string shape is ADR-C06: flat `from*` / `to*` params, one per Place field.
const MODES = ["flight", "train", "bus", "ferry"] as const satisfies readonly Mode[];

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());

const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);

const schema = z.object({
  fromName: z.string().trim().min(1).max(200),
  fromLat: z.preprocess(blankToUndefined, lat),
  fromLng: z.preprocess(blankToUndefined, lng),
  fromIata: opt(z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/)),
  fromCountry: opt(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)),
  toName: z.string().trim().min(1).max(200),
  toLat: z.preprocess(blankToUndefined, lat),
  toLng: z.preprocess(blankToUndefined, lng),
  toIata: opt(z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/)),
  toCountry: opt(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)),
  date: z.iso.date(),
  modes: opt(
    z
      .string()
      .transform((s) => s.split(",").map((m) => m.trim()).filter(Boolean))
      .pipe(z.array(z.enum(MODES))),
  ),
  passengers: opt(z.coerce.number().int().min(1).max(9)),
  currency: opt(z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/)),
});

export type ParsedQuery = { success: true; data: SearchQuery } | { success: false; fields: string[] };

function place(name: string, lat: number, lng: number, iata?: string, country?: string): Place {
  return { name, lat, lng, ...(iata && { iata }), ...(country && { country }) };
}

// The globe UI sends `from`/`to` as JSON Place objects; expand them into the flat ADR-C06 params.
function expandJsonPlaces(params: URLSearchParams): Record<string, string> | null {
  const flat = Object.fromEntries(params);
  for (const side of ["from", "to"] as const) {
    const raw = flat[side];
    if (raw === undefined) continue;
    delete flat[side];
    let p: unknown;
    try {
      p = JSON.parse(raw);
    } catch {
      return null;
    }
    if (typeof p !== "object" || p === null) return null;
    const o = p as Record<string, unknown>;
    for (const key of ["name", "lat", "lng", "iata", "country"] as const) {
      const v = o[key];
      if (v !== undefined && v !== null) flat[`${side}${key[0].toUpperCase()}${key.slice(1)}`] = String(v);
    }
  }
  return flat;
}

export function parseSearchQuery(params: URLSearchParams): ParsedQuery {
  const flat = expandJsonPlaces(params);
  if (!flat) return { success: false, fields: ["from", "to"].filter((k) => params.has(k)) };
  const r = schema.safeParse(flat);
  if (!r.success) {
    return { success: false, fields: [...new Set(r.error.issues.map((i) => String(i.path[0] ?? "")))] };
  }
  const q = r.data;
  return {
    success: true,
    data: {
      from: place(q.fromName, q.fromLat, q.fromLng, q.fromIata, q.fromCountry),
      to: place(q.toName, q.toLat, q.toLng, q.toIata, q.toCountry),
      date: q.date,
      modes: [...new Set(q.modes ?? [])],
      passengers: q.passengers ?? 1,
      currency: q.currency ?? "USD",
    },
  };
}
