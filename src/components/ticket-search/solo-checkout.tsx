"use client";

import { useEffect, useState, useTransition } from "react";

import { finishSoloBookingAction, soloLegAction, startSoloBookingAction, type SoloLeg, type SoloStep } from "@/app/t/booking-actions";
import { CheckoutBody } from "@/components/agent/checkout-card";
import { DetailsForm } from "@/components/multiplayer/leg-booking";
import { Button } from "@/components/paper-atlas";
import type { Failure, PriceChange } from "@/lib/booking/flow";
import { recordTiming } from "@/lib/performance";
import { iso2 } from "@/lib/entry/iso";
import type { Money } from "@/lib/liveblocks/types";

// Book on the home globe for one rider (docs/booking/README.md): the saved trip's leg is settled, then the rider's
// details and card go in right in the fare card, as in Pip's checkout. No room to join, no trip page, no Stripe page
// unless this server has no in-app card field.

/** What checkout calls on the server. Swappable so the playground can walk its states without a booking. */
export type SoloCheckoutActions = { start: typeof startSoloBookingAction; finish: typeof finishSoloBookingAction; leg?: typeof soloLegAction };
const SERVER: SoloCheckoutActions = { start: startSoloBookingAction, finish: finishSoloBookingAction, leg: soloLegAction };

/** How often the card re-reads the leg while its booking is under way: a hold or the airline's order lands later. */
const POLL_MS = 3_000;

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
  const [uncertain, setUncertain] = useState(false);
  const [at, setAt] = useState<SoloStep | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  const [price, setPrice] = useState<{ change: PriceChange; then: "settle" | "pay" } | null>(null);
  const [details, setDetails] = useState<unknown>(null);
  const href = `/t/${tripId}?book=${encodeURIComponent(legId)}`;

  const settle = (accept?: Money) =>
    start(async () => {
      setError(null);
      setPrice(null);
      const result = await actions.start(tripId, legId, accept).catch((): Failure => ({ ok: false, code: "UPSTREAM_ERROR", message: "Connection lost while checking the fare. Open the trip to check its status." }));
      if (result.ok) return setAt(result);
      if ("now" in result) setPrice({ change: result, then: "settle" });
      else setError(result);
    });

  const pay = (input: unknown, accept?: Money) =>
    start(async () => {
      setError(null);
      setPrice(null);
      setDetails(input);
      const started = performance.now();
      const result = await actions.finish(tripId, legId, input, accept).catch((): Failure => { setUncertain(true); return { ok: false, code: "UPSTREAM_ERROR", message: "Connection lost. Check your booking before trying payment again." }; });
      if (!result.ok) {
        if ("now" in result) setPrice({ change: result, then: "pay" });
        else setError(result);
        return;
      }
      recordTiming("checkout", started);
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
        <Button disabled={busy || uncertain} onClick={() => (price.then === "settle" ? settle(price.change.now) : pay(details, price.change.now))}>
          Continue
        </Button>
      </div>
    </div>
  ) : null;

  const problem = error ? (
    <div className="ts-checkout-step" role="alert">
      <p className="ts-checkout-note">{error.message}</p>
      {/* a refused detail is fixed in the form below, which has its own Cancel */}
      {error.code === "INVALID" ? null : (
        <div className="ts-checkout-actions">
          <Button variant="quiet" onClick={onClose}>
            Back
          </Button>
        </div>
      )}
    </div>
  ) : null;

  // once settled, the in-app checkout: saved details and cards, a card field, and the bill as it fills in
  if (at && actions.leg && !price && !error) {
    return <InAppCheckout tripId={tripId} legId={legId} read={actions.leg} />;
  }

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
          busy={busy || uncertain}
          invalid={error?.fields ?? []}
          submitLabel={busy ? "Opening checkout…" : `Pay · ${fmt(at.share)}`}
          onCancel={onClose}
          onSubmit={(input) => pay(input)}
        />
      ) : null}
      {at?.step === "pay" && !price ? (
        <Button block disabled={busy || uncertain} onClick={() => pay(null)}>
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

/** Pip's checkout body, fed by reading the leg on the server instead of from the room. */
function InAppCheckout({ tripId, legId, read }: { tripId: string; legId: string; read: typeof soloLegAction }) {
  const [snap, setSnap] = useState<SoloLeg | null>(null);
  const [lost, setLost] = useState(false);
  const booked = snap?.leg?.booking?.status === "booked";
  useEffect(() => {
    let live = true;
    const load = () => read(tripId, legId).then((s) => { if (live) { setSnap(s); setLost(!s); } }).catch(() => live && setLost(true));
    void load();
    // nothing more lands once it's booked or nobody's booking it
    const timer = booked ? null : window.setInterval(load, POLL_MS);
    return () => { live = false; if (timer) window.clearInterval(timer); };
  }, [tripId, legId, read, booked]);
  return (
    <section className="ts-checkout" aria-label="Checkout">
      {snap ? (
        <CheckoutBody tripId={tripId} legId={legId} me={snap.me} leg={snap.leg} members={snap.members} solo />
      ) : lost ? (
        <p className="ts-checkout-note" role="alert">Couldn&apos;t load the booking. <a href={`/t/${tripId}?book=${encodeURIComponent(legId)}`} className="ts-oneway">Open trip</a></p>
      ) : (
        <p className="ts-checkout-note">Loading checkout…</p>
      )}
    </section>
  );
}
