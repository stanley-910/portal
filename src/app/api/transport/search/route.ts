import { z } from "zod";

import { searchTransport } from "@/lib/transport/search";
import type { SearchQuery } from "@/lib/transport/types";

export const runtime = "nodejs";

const place = z.object({
  name: z.string().trim().min(1),
  lat: z.coerce.number().finite().min(-90).max(90),
  lng: z.coerce.number().finite().min(-180).max(180),
  iata: z.string().trim().regex(/^[A-Za-z]{3}$/).optional(),
});

const schema = z.object({
  from: place,
  to: place,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  modes: z.array(z.enum(["flight", "train", "bus", "ferry"])).default(["flight", "train", "bus", "ferry"]),
  passengers: z.coerce.number().int().min(1).max(999).default(1),
  currency: z.string().regex(/^[A-Za-z]{3}$/).default("USD"),
});

function parseQuery(request: Request): SearchQuery {
  const raw = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = schema.parse({
    ...raw,
    from: JSON.parse(raw.from ?? "{}"),
    to: JSON.parse(raw.to ?? "{}"),
    modes: raw.modes ? raw.modes.split(",") : undefined,
  });
  return { ...parsed, currency: parsed.currency.toUpperCase() };
}

export async function GET(request: Request) {
  try {
    const query = parseQuery(request);
    const result = await searchTransport(query, request.signal);
    return Response.json(result);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      return Response.json({ code: "BAD_QUERY" }, { status: 400 });
    }
    throw error;
  }
}
