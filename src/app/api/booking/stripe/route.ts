import { confirmCardHold, confirmCheckout, intentCancelled } from "@/lib/booking/flow";
import { verifyStripeSignature } from "@/lib/booking/stripe";
import { env } from "@/lib/env.server";

export const runtime = "nodejs";

/**
 * Stripe's webhook. Locally: `stripe listen --forward-to localhost:3000/api/booking/stripe --events checkout.session.completed,checkout.session.async_payment_succeeded,payment_intent.amount_capturable_updated,payment_intent.succeeded,payment_intent.canceled` and put its secret in
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
    // a hold confirmed in the app: the browser reports it too, and whichever comes first records it
    case "payment_intent.amount_capturable_updated":
    case "payment_intent.succeeded":
      await confirmCardHold(id);
      break;
    case "payment_intent.canceled":
      await intentCancelled(id);
      break;
  }
  return Response.json({ received: true });
}
