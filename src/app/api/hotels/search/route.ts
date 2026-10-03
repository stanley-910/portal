import { z } from "zod";

import { searchDuffelStays } from "@/lib/hotels/duffel";
import { rankStays, searchHotels } from "@/lib/hotels/search";
import type { HotelFilter } from "@/lib/hotels/types";

export const runtime = "nodejs";
const querySchema = z.object({
  city: z.string().trim().min(1).max(100),
  lat: z.coerce.number().finite().min(-90).max(90),
  lng: z.coerce.number().finite().min(-180).max(180),
  checkIn: z.iso.date(),
  checkOut: z.iso.date(),
  occupants: z.coerce.number().int().min(1).max(4),
  filter: z.union([z.literal("hostel"), z.coerce.number().int().min(2).max(5)]),
}).superRefine((value, ctx) => {
  if (Date.parse(value.checkOut) <= Date.parse(value.checkIn)) {
    ctx.addIssue({ code: "custom", path: ["checkOut"], message: "Check-out must be after check-in" });
  }
});

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return Response.json({ code: "BAD_QUERY", fields: parsed.error.issues.map((issue) => String(issue.path[0])) }, { status: 400 });
  }
  const query = { ...parsed.data, filter: parsed.data.filter as HotelFilter };
  // live rates when Duffel has them, else the estimates
  const live = await searchDuffelStays(query, request.signal);
  return Response.json({ hotels: live ? rankStays(live, query) : searchHotels(query) });
}
