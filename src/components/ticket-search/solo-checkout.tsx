"use client";

import { useEffect, useState, useTransition } from "react";

import { finishSoloBookingAction, startSoloBookingAction, type SoloStep } from "@/app/t/booking-actions";
import { DetailsForm } from "@/components/multiplayer/leg-booking";
import { Button } from "@/components/paper-atlas";
import type { Failure, PriceChange } from "@/lib/booking/flow";
import { iso2 } from "@/lib/entry/iso";
import type { Money } from "@/lib/liveblocks/types";

// Book on the home globe for one rider (docs/booking/README.md): the saved trip's leg is settled, the rider's details
// go in and the card goes to Stripe, all in the fare card. No room to join, no trip page on the way.

/** What checkout calls on the server. Swappable so the playground can walk its states without a booking. */
export type SoloCheckoutActions = { start: typeof startSoloBookingAction; finish: typeof finishSoloBookingAction };
const SERVER: SoloCheckoutActions = { start: startSoloBookingAction, finish: finishSoloBookingAction };

const fmt = (m: Money) => new Intl.NumberFormat("en", { style: "currency", currency: m.currency }).format(m.amount);

export function SoloCheckout({
  tripId,
  legId,
  email,
  nationalities,
  onClose,
  actions = SERVER,
}: {
  tripId: string;
  legId: string;
  email: string | null;
  nationalities: string[];
  onClose: () => void;
  actions?: SoloCheckoutActions;
}) {
  const [busy, start] = useTransition();
  const [at, setAt] = useState<SoloStep | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  const [price, setPrice] = useState<{ change: PriceChange; then: "settle" | "pay" } | null>(null);
  const [details, setDetails] = useState<unknown>(null);
  const href = `/t/${tripId}?book=${encodeURIComponent(legId)}`;

  const settle = (accept?: Money) =>
    start(async () => {
      setError(null);
      setPrice(null);
      const result = await actions.start(tripId, legId, accept);
      if (result.ok) return setAt(result);
      if ("now" in result) setPrice({ change: result, then: "settle" });
      else setError(result);
    });

  const pay = (input: unknown, accept?: Money) =>
    start(async () => {
      setError(null);
      setPrice(null);
      setDetails(input);
      const result = await actions.finish(tripId, legId, input, accept);
      if (!result.ok) {
        if ("now" in result) setPrice({ change: result, then: "pay" });
        else setError(result);
        return;
      }
      if (result.url) return window.location.assign(result.url);
      setAt((a) => (a ? { ...a, step: "done" } : a));
    });

  // settles as soon as Book has saved the trip
  useEffect(() => settle(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const moved = price ? (
    <div className="ts-checkout-step" role="alert">
      <p className="ts-checkout-note">
        {price.change.was ? `The fare is now ${fmt(price.change.now)}, up from ${fmt(price.change.was)}.` : `The fare is ${fmt(price.change.now)}.`}
      </p>
      <div className="ts-checkout-actions">
        <Button variant="quiet" onClick={onClose}>
          Not now
        </Button>
        <Button disabled={busy} onClick={() => (price.then === "settle" ? settle(price.change.now) : pay(details, price.change.now))}>
          Continue
        </Button>
      </div>
    </div>
  ) : null;

  const problem = error ? (
    <div className="ts-checkout-step" role="alert">
      <p className="ts-checkout-note">{error.message}</p>
      <div className="ts-checkout-actions">
        <Button variant="quiet" onClick={onClose}>
          Back
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <section className="ts-checkout" aria-label="Checkout">
      <div className="tp-book-head">
        <span>Checkout</span>
        <span>{at ? fmt(at.share) : busy ? "Checking the fare…" : ""}</span>
      </div>
      {moved}
      {problem}
      {at?.step === "details" ? (
        <DetailsForm
          documents={at.documents}
          email={email}
          passportCountry={nationalities[0] ? (iso2(nationalities[0]) ?? "") : ""}
          busy={busy}
          invalid={error?.fields ?? []}
          submitLabel={busy ? "Opening checkout…" : `Pay · ${fmt(at.share)}`}
          onCancel={onClose}
          onSubmit={(input) => pay(input)}
        />
      ) : null}
      {at?.step === "pay" && !price ? (
        <Button block disabled={busy} onClick={() => pay(null)}>
          {busy ? "Opening checkout…" : `Pay · ${fmt(at.share)}`}
        </Button>
      ) : null}
      {at?.step === "wait" ? <p className="ts-checkout-note">Waiting for the others on this leg. <a href={href} className="ts-oneway">Open trip</a></p> : null}
      {at?.step === "done" ? (
        <p className="ts-empty" role="status">
          Your seat is paid. <a href={href} className="ts-oneway">See booking</a>
        </p>
      ) : null}
    </section>
  );
}
