import { redirect } from "next/navigation";

import { confirmCheckout } from "@/lib/booking/flow";

export const runtime = "nodejs";

/**
 * Where Stripe Checkout sends a rider after they authorise their share. The session id is unguessable and maps to
 * one payment row, so this needs no login: it confirms the hold with Stripe and returns them to the trip. The
 * webhook does the same, so whichever arrives first marks the seat.
 */
export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("session_id");
  const where = sessionId && /^cs_[A-Za-z0-9_]+$/.test(sessionId) ? await confirmCheckout(sessionId) : null;
  redirect(where ? `/t/${where.roomId.replace(/^trip:/, "")}` : "/");
}
