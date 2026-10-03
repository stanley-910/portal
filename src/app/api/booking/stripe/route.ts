import { confirmCheckout, intentCancelled } from "@/lib/booking/flow";
import { verifyStripeSignature } from "@/lib/booking/stripe";
import { env } from "@/lib/env.server";

export const runtime = "nodejs";

/**
 * Stripe's webhook. Locally: `stripe listen --forward-to localhost:3000/api/booking/stripe` and put its secret in
 * STRIPE_WEBHOOK_SECRET. Without the secret every event is refused, and the return route alone confirms holds.
 */
export async function POST(request: Request) {
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response("Webhook not configured", { status: 400 });
  const body = await request.text();
  const event = verifyStripeSignature(body, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET);
  if (!event) return new Response("Bad signature", { status: 400 });
  const object = event.data.object;
  const id = typeof object.id === "string" ? object.id : null;
  if (!id) return Response.json({ received: true });
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await confirmCheckout(id);
      break;
    case "payment_intent.canceled":
      await intentCancelled(id);
      break;
  }
  return Response.json({ received: true });
}
