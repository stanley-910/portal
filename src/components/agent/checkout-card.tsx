"use client";

import { useRoom, useSelf, useStorage } from "@liveblocks/react";
import type { Stripe, StripeElements } from "@stripe/stripe-js";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import {
  confirmCardHoldAction,
  myWalletAction,
  payShareAction,
  saveAndSubmitDetailsAction,
  startCardHoldAction,
  submitSavedDetailsAction,
  type Wallet,
} from "@/app/t/booking-actions";
import { DetailsForm } from "@/components/multiplayer/leg-booking";
import { Button, PixelClose } from "@/components/paper-atlas";
import type { Failure, PriceChange } from "@/lib/booking/flow";
import type { TravellerDetails } from "@/lib/booking/offer";
import { formatPhone } from "@/lib/booking/phone";
import { recordTiming } from "@/lib/performance";
import { iso2 } from "@/lib/entry/iso";
import { memberColor, type LegBooking, type Money } from "@/lib/liveblocks/types";

// A leg's checkout in Pip's thread (docs/booking/README.md). Everyone sees the bill: each rider's share and where
// they are. Each viewer gets buttons for their own seat only: their saved details with Looks good or Edit, then their
// card, confirmed here with Stripe.js. Details and cards come from the server for the viewer alone, never the room.

const fmt = (m: Money) => new Intl.NumberFormat("en", { style: "currency", currency: m.currency }).format(m.amount);
const brandName = (b: string) => (b === "amex" ? "Amex" : b === "mastercard" ? "Mastercard" : b[0].toUpperCase() + b.slice(1));

const stripes = new Map<string, Promise<Stripe | null>>();
const stripeFor = (key: string) => {
  // no test-mode assistant (Stripe's "Developers" panel) over the checkout: the demo runs on test keys in front of people
  if (!stripes.has(key)) stripes.set(key, import("@stripe/stripe-js").then(({ loadStripe }) => loadStripe(key, { developerTools: { assistant: { enabled: false } } })));
  return stripes.get(key)!;
};

/** Stripe's card field drawn in the page's own tokens, read off the root at the time it mounts. */
function appearance() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim() || undefined;
  return {
    theme: "flat" as const,
    variables: { colorText: v("--ink"), colorBackground: v("--paper"), colorPrimary: v("--ink"), colorDanger: v("--ink"), borderRadius: v("--radius-control") },
  };
}

/** What the card calls on the server. Swappable so the playground can walk its states without a booking. */
export type CheckoutCardActions = {
  wallet: typeof myWalletAction;
  submitSaved: typeof submitSavedDetailsAction;
  saveAndSubmit: typeof saveAndSubmitDetailsAction;
  startHold: typeof startCardHoldAction;
  confirmHold: typeof confirmCardHoldAction;
  payShare: typeof payShareAction;
};
const SERVER: CheckoutCardActions = {
  wallet: myWalletAction,
  submitSaved: submitSavedDetailsAction,
  saveAndSubmit: saveAndSubmitDetailsAction,
  startHold: startCardHoldAction,
  confirmHold: confirmCardHoldAction,
  payShare: payShareAction,
};

/** The leg as the card reads it from the room. Null when the leg is gone. */
export type CheckoutLeg = { from: string; to: string; booking: LegBooking | null; bookingNotice: string | null };

export function CheckoutCard({ legId }: { legId: string }) {
  const tripId = useRoom().id.slice("trip:".length);
  const me = useSelf((s) => s.id);
  const leg = useStorage((root) => root.legs[legId] ?? null);
  const from = useStorage((root) => { const l = root.legs[legId]; return (l && root.stops[l.from]?.name) ?? ""; });
  const to = useStorage((root) => { const l = root.legs[legId]; return (l && root.stops[l.to]?.name) ?? ""; });
  const members = useStorage((root) => root.members);
  return (
    <CheckoutBody
      tripId={tripId}
      legId={legId}
      me={me}
      // the booking is plain JSON in Storage, so its read-only snapshot is the same shape
      leg={leg ? { from: from ?? "", to: to ?? "", booking: (leg.booking ?? null) as LegBooking | null, bookingNotice: leg.bookingNotice ?? null } : null}
      members={members}
    />
  );
}

/** The card itself, from the leg and its riders. `actions` defaults to the server's. */
export function CheckoutBody({
  tripId,
  legId,
  me,
  leg,
  members,
  actions = SERVER,
  solo = false,
}: {
  tripId: string;
  legId: string;
  me: string | null;
  leg: CheckoutLeg | null;
  members: Record<string, { name?: string; color?: number }> | null;
  actions?: CheckoutCardActions;
  /**
   * Booking alone, in the home globe's fare card: no bill of riders or group talk, just a header with your price and
   * where you are, under the fare card's own divider.
   */
  solo?: boolean;
}) {
  const from = leg?.from ?? "";
  const to = leg?.to ?? "";
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [busy, start] = useTransition();
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [price, setPrice] = useState<PriceChange | null>(null);
  const [modal, setModal] = useState<"details" | "card" | null>(null);

  const booking = leg?.booking ?? null;
  const seat = me && booking ? booking.seats[me] : null;
  const needsDetails = !!seat && !seat.details && !seat.paid && (booking!.mode === "separate" || booking!.status === "details");
  const canPay = !!seat && seat.details && !seat.paid && booking!.status === "paying";

  const refresh = useCallback(() => {
    void actions.wallet().then((value) => { setWallet(value); setError(null); }).catch(() => setError("Couldn't load your saved details. Try again."));
  }, [actions]);
  useEffect(() => {
    if (needsDetails || canPay) refresh();
  }, [needsDetails, canPay, refresh]);

  const fail = (f: Failure | PriceChange) => {
    if ("now" in f) return setPrice(f);
    setError(f.message);
    setFields(f.fields ?? []);
  };
  const run = (task: () => Promise<void>) =>
    start(async () => {
      setError(null);
      setPrice(null);
      setFields([]);
      const started = performance.now();
      try { await task(); recordTiming("checkout", started); }
      catch { setUncertain(true); setError("Connection lost. Check the booking status before trying payment again."); }
    });

  // a saved card: hold the share on it, with 3-D Secure in place if the bank asks
  const confirmSaved = (card: string, accept?: Money) =>
    run(async () => {
      const started = await actions.startHold(tripId, legId, card, accept);
      if (!started.ok) return fail(started);
      if (started.clientSecret) {
        const stripe = wallet?.publishableKey ? await stripeFor(wallet.publishableKey) : null;
        if (!stripe) return setError("Couldn't load the card form. Try again.");
        const res = await stripe.confirmCardPayment(started.clientSecret, { payment_method: card });
        if (res.error) return setError(res.error.message ?? "The card was declined.");
      }
      const done = await actions.confirmHold(tripId, legId);
      if (!done.ok) fail(done);
    });

  // no in-app card field on this server: Stripe's own page, and back here after
  const checkoutPage = (accept?: Money) =>
    run(async () => {
      const r = await actions.payShare(tripId, legId, accept);
      if (!r.ok) return fail(r);
      if (r.url) window.location.assign(r.url);
    });

  if (!leg) return <p className="pip-changes-note">That leg is gone.</p>;
  if (!booking) {
    return (
      <div className={solo ? "ts-checkout-body" : "pip-checkout"}>
        <div className="pip-checkout-head">
          <span>
            {from} → {to}
          </span>
        </div>
        <p className="pip-changes-note">{leg.bookingNotice ?? "Not being booked any more."}</p>
      </div>
    );
  }

  const seats = Object.entries(booking.seats);
  const card = wallet?.cards[0] ?? null;
  const inApp = !!wallet?.publishableKey;
  const left = booking.deadline && booking.status !== "booked" ? new Date(booking.deadline) : null;

  const when = (d: Date) => d.toLocaleString("en", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const stage = booking.status === "booked" ? "Booked" : seat?.paid ? "Card held" : needsDetails ? "Your details" : canPay ? "Payment" : "Checking";
  return (
    <div className={solo ? "ts-checkout-body" : "pip-checkout"}>
      {solo ? (
        <div className="tp-book-head">
          <span>Checkout</span>
          <span>{seat ? `${fmt(seat.share)} · ${stage}` : stage}</span>
        </div>
      ) : (
        <>
          <div className="pip-checkout-head">
            <span>
              {from} → {to}
            </span>
            <span>{booking.status === "booked" ? "Booked" : booking.mode === "group" ? "Group booking" : "Separate tickets"}</span>
          </div>
          <ul className="pip-bill">
            {seats.map(([id, s]) => {
              const info = members?.[id];
              const state = s.paid ? (booking.status === "booked" ? "Paid" : booking.mode === "separate" ? "Ticketed" : "Card held") : s.details ? "Details in" : "Waiting";
              return (
                <li key={id}>
                  <span className="tp-rider" aria-hidden style={{ borderColor: memberColor(info?.color ?? 1) }}>
                    {(info?.name ?? "?").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="pip-bill-who">
                    {info?.name ?? "Someone"}
                    {id === me ? " (you)" : ""}
                  </span>
                  <span className="pip-bill-share">{fmt(s.share)}</span>
                  <span className="pip-bill-state" data-done={s.paid || undefined}>
                    {state}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {booking.status === "booked" && booking.reference ? <p className="pip-changes-note">Reference {booking.reference}</p> : null}
      {left ? <p className="pip-changes-note">{solo ? `Fare held until ${when(left)}.` : `Everyone has until ${when(left)}.`}</p> : null}
      {leg.bookingNotice ? <p className="pip-changes-note" role="status">{leg.bookingNotice}</p> : null}
      {error ? <p className="pip-checkout-error" role="alert">{error}{!wallet ? <> <button type="button" className="pip-action" onClick={refresh}>Try again</button></> : null}</p> : null}
      {uncertain ? <a className="pip-action" href={`/t/${tripId}?book=${encodeURIComponent(legId)}&pip=open`}>Check booking</a> : null}
      {price ? (
        <div className="pip-checkout-actions" role="alert">
          <span className="pip-changes-note">Now {fmt(price.now)} for your seat{price.was ? `, was ${fmt(price.was)}` : ""}.</span>
          <Act solo={solo} variant="secondary" disabled={busy || uncertain} onClick={() => (card && inApp ? confirmSaved(card.id, price.now) : inApp ? setModal("card") : checkoutPage(price.now))}>
            Continue
          </Act>
        </div>
      ) : null}

      {needsDetails && wallet ? (
        wallet.traveller && (!booking.documents || wallet.traveller.passport) ? (
          <div className="pip-checkout-step">
            <p className="pip-checkout-sub">Your details</p>
            <TravellerSummary details={wallet.traveller} passport={booking.documents} />
            <div className="pip-checkout-actions">
              <Act solo={solo} disabled={busy || uncertain} onClick={() => run(async () => { const r = await actions.submitSaved(tripId, legId); if (!r.ok) fail(r); })}>
                Looks good
              </Act>
              <button type="button" className="pip-action" disabled={busy || uncertain} onClick={() => setModal("details")}>
                Edit
              </button>
            </div>
          </div>
        ) : (
          <Act solo={solo} block disabled={busy || uncertain} onClick={() => setModal("details")}>
            {wallet.traveller ? "Add my passport" : "Enter my details"}
          </Act>
        )
      ) : null}

      {canPay && wallet && !price ? (
        card && inApp ? (
          <div className="pip-checkout-actions">
            <Act solo={solo} disabled={busy || uncertain} onClick={() => confirmSaved(card.id)}>
              {busy ? "Holding…" : `Confirm · ${fmt(seat!.share)} on ${brandName(card.brand)} ·${card.last4}`}
            </Act>
            <button type="button" className="pip-action" disabled={busy || uncertain} onClick={() => setModal("card")}>
              Another card
            </button>
          </div>
        ) : (
          <Act solo={solo} block disabled={busy || uncertain} onClick={() => (inApp ? setModal("card") : checkoutPage())}>
            {inApp ? `Add a card · ${fmt(seat!.share)}` : `Pay my share · ${fmt(seat!.share)}`}
          </Act>
        )
      ) : null}
      {seat?.paid && booking.status === "paying" && booking.mode === "group" ? <p className="pip-changes-note">Your card is held. Nobody is charged until every seat is.</p> : null}

      {modal === "details" ? (
        <Modal title="Your details" onClose={() => setModal(null)}>
          <DetailsForm
            documents={booking.documents}
            showPassport={booking.documents || !!wallet?.traveller?.passport}
            defaults={wallet?.traveller ?? null}
            email={wallet?.email ?? null}
            passportCountry={wallet?.nationalities[0] ? (iso2(wallet.nationalities[0]) ?? "") : ""}
            busy={busy || uncertain}
            invalid={fields}
            submitLabel="Save and use"
            onCancel={() => setModal(null)}
            onSubmit={(details) =>
              run(async () => {
                const r = await actions.saveAndSubmit(tripId, legId, details);
                if (!r.ok) return fail(r);
                setModal(null);
                refresh();
              })
            }
          />
          {error ? <p className="pip-checkout-error" role="alert">{error}{uncertain ? <> <a className="pip-action" href={`/t/${tripId}?book=${encodeURIComponent(legId)}&pip=open`}>Check booking</a></> : null}</p> : null}
        </Modal>
      ) : null}

      {modal === "card" && wallet?.publishableKey && seat ? (
        <Modal title={`Hold ${fmt(price?.now ?? seat.share)}`} onClose={() => setModal(null)}>
          <NewCard
            publishableKey={wallet.publishableKey}
            start={() => actions.startHold(tripId, legId, null, price?.now)}
            onHeld={() =>
              run(async () => {
                const done = await actions.confirmHold(tripId, legId);
                if (!done.ok) return fail(done);
                setModal(null);
                refresh();
              })
            }
            onFail={fail}
          />
        </Modal>
      ) : null}
    </div>
  );
}

/**
 * One of checkout's actions: a button in the home fare card, where the fare card's buttons are; one of Pip's small
 * pixel chips in its chat, like the replies it suggests.
 */
function Act({ solo, block = false, variant, disabled, onClick, children }: { solo: boolean; block?: boolean; variant?: "secondary"; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  if (solo) {
    return (
      <Button block={block} variant={variant} disabled={disabled} onClick={onClick}>
        {children}
      </Button>
    );
  }
  return (
    <button type="button" className="pip-suggestion" disabled={disabled} onClick={onClick}>
      <span className="pip-px">{children}</span>
    </button>
  );
}

function TravellerSummary({ details: d, passport }: { details: TravellerDetails; passport: boolean }) {
  const title = d.title[0].toUpperCase() + d.title.slice(1);
  return (
    <dl className="pip-traveller">
      <dt>Name</dt>
      <dd>
        {title} {d.givenName} {d.familyName}
      </dd>
      <dt>Born</dt>
      <dd>{d.bornOn}</dd>
      <dt>Contact</dt>
      <dd>
        {d.email} · {formatPhone(d.phone)}
      </dd>
      {passport && d.passport ? (
        <>
          <dt>Passport</dt>
          <dd>
            {d.passport.country} ·{d.passport.number.slice(-4)}, expires {d.passport.expiresOn}
          </dd>
        </>
      ) : null}
    </dl>
  );
}

/** A native modal dialog: Esc and the close button dismiss it. */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  // No close() on cleanup: a dialog leaves the top layer when it's removed, and closing it fires `close`, which would
  // call onClose and shut the modal straight after opening it wherever effects run twice (React's dev mode).
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);
  return (
    <dialog ref={ref} data-globe-obstacle className="pip-dialog" aria-label={title} onClose={onClose} onCancel={onClose} onKeyDown={(e) => e.stopPropagation()}>
      <div className="pip-dialog-head">
        <p className="pip-caption">{title}</p>
        <PixelClose onClick={onClose} />
      </div>
      {children}
    </dialog>
  );
}

/** Stripe's embedded card field for a new card: holds the share on it and saves it for next time. */
function NewCard({
  publishableKey,
  start,
  onHeld,
  onFail,
}: {
  publishableKey: string;
  start: () => Promise<{ ok: true; clientSecret: string | null } | PriceChange | Failure>;
  onHeld: () => void;
  onFail: (f: Failure | PriceChange) => void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const ready = useRef<{ stripe: Stripe; elements: StripeElements } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "paying">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let gone = false;
    void (async () => {
      const started = await start();
      if (gone) return;
      if (!started.ok) return onFail(started);
      if (!started.clientSecret) return onHeld();
      const stripe = await stripeFor(publishableKey);
      if (gone || !stripe || !mount.current) return setError("Couldn't load the card form.");
      const elements = stripe.elements({ clientSecret: started.clientSecret, appearance: appearance() });
      elements.create("payment", { layout: "tabs" }).mount(mount.current);
      ready.current = { stripe, elements };
      setState("ready");
    })().catch(() => { if (!gone) setError("Couldn't open the card form. Check the booking status and try again."); });
    return () => {
      gone = true;
      ready.current?.elements.getElement("payment")?.destroy();
      ready.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = async () => {
    const r = ready.current;
    if (!r) return;
    setState("paying");
    setError(null);
    const res = await r.stripe.confirmPayment({ elements: r.elements, redirect: "if_required", confirmParams: { return_url: window.location.href } }).catch(() => null);
    if (!res) { setError("Connection lost. Close this form and check your booking status before trying again."); return; }
    if (res.error) {
      setError(res.error.message ?? "The card was declined.");
      return setState("ready");
    }
    onHeld();
  };

  return (
    <div className="pip-newcard">
      <div ref={mount} />
      {state === "loading" ? <p className="pip-changes-note">Loading the card form…</p> : null}
      {error ? <p className="pip-checkout-error" role="alert">{error} <button type="button" className="pip-action" onClick={() => window.location.reload()}>Check booking</button></p> : null}
      <Button block disabled={state !== "ready"} onClick={pay}>
        {state === "paying" ? "Holding…" : "Hold and save card"}
      </Button>
      <p className="pip-changes-note">Held, not charged, until every seat is. Saved for your next booking.</p>
    </div>
  );
}
