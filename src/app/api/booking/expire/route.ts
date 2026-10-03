import { timingSafeEqual } from "node:crypto";

import { sweepBookings } from "@/lib/booking/flow";
import { env } from "@/lib/env.server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * The scheduled sweep of bookings in progress (vercel.json → crons). Vercel calls it with `Authorization: Bearer
 * $CRON_SECRET`; anything else is refused, so nobody can make the server cancel holds early. Trip pages and booking
 * actions still expire on their own, this catches rooms nobody opens before a deadline.
 */
export async function GET(request: Request) {
  const secret = env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret) return new Response("Sweep not configured", { status: 503 });
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Unauthorized", { status: 401 });
  const result = await sweepBookings();
  return Response.json(result);
}
