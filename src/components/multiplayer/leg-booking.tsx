"use client";

import { useRoom, useSelf } from "@liveblocks/react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { cancelSettleAction, dismissBookingNoticeAction, settleLegAction } from "@/app/t/booking-actions";
import { Button, Select } from "@/components/paper-atlas";
import type { Failure, PriceChange } from "@/lib/booking/flow";
import type { TravellerDetails } from "@/lib/booking/offer";
import { dialCode, formatPhone, phoneCountry } from "@/lib/booking/phone";
import { iso2 } from "@/lib/entry/iso";
import type { Money, StoredOffer } from "@/lib/liveblocks/types";
import { countries } from "@/lib/nationality";
import { isBookable, webUrlOrNull } from "@/lib/trip/offers";
import { usePlanActions, type PlanLeg } from "@/lib/trip/plan";

// Buying a leg from the plan panel (docs/booking/README.md). Everything here is status the server wrote; the
// buttons call its actions. Names, birthdays and passports go straight to the server and never into the room. Once
// the leg is settled, its checkout is the same one Pip's chat and the home fare card show.

// loaded when a leg is settled, like Pip's checkout card, and kept out of this module's imports (it uses DetailsForm)
const CheckoutCard = dynamic(() => import("@/components/agent/checkout-card").then((m) => m.CheckoutCard), {
  loading: () => <p className="ts-checkout-note" role="status">Loading checkout…</p>,
});

const fmt = (m: Money) => new Intl.NumberFormat("en", { style: "currency", currency: m.currency }).format(m.amount);

/** Where a pick that can't be bought in the app is booked: its provider's name, or the link's host. */
function providerName(offer: StoredOffer, url: string): string {
  const credit = offer.attribution?.split(" — ")[0].trim();
  return credit || new URL(url).hostname.replace(/^www\./, "");
}

/** `focus` brings the leg's booking into view with its first control focused, once, e.g. after Book on the globe. */
export function LegBooking({ leg, focus = false }: { leg: PlanLeg; focus?: boolean }) {
  const room = useRoom();
  const tripId = room.id.slice("trip:".length);
  const me = useSelf((s) => s.id);
  const { retrySearch } = usePlanActions();
  const [busy, start] = useTransition();
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [price, setPrice] = useState<PriceChange | null>(null);
  const booking = leg.booking;
  const rider = !!me && leg.riders.includes(me);
  const root = useRef<HTMLDivElement>(null);
  const focused = useRef(false);

  useEffect(() => {
    const el = root.current;
    if (!focus || focused.current || !el) return;
    const control = el.querySelector<HTMLElement>("button, a[href]");
    if (!control) return;
    focused.current = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    control.focus({ preventScroll: true });
  });

  const run = (task: () => Promise<{ ok: true } | PriceChange | Failure>) =>
    start(async () => {
      setError(null);
      setPrice(null);
      const result = await task().catch((): Failure => { setUncertain(true); return { ok: false, code: "UPSTREAM_ERROR", message: "Connection lost. Check the booking status before trying again." }; });
      if (result.ok) return;
      if ("now" in result) setPrice(result);
      else setError(result);
    });

  const settle = (accept?: Money) => run(() => settleLegAction(tripId, leg.id, accept));

  const notice = leg.bookingNotice ? (
    <p className="tp-notice" role="status">
      <span>{leg.bookingNotice}</span>
      <button type="button" className="ts-oneway" onClick={() => start(() => dismissBookingNoticeAction(tripId, leg.id))}>
        Dismiss
      </button>
    </p>
  ) : null;

  const problem = error ? (
    <p className="tp-notice" role="alert">
      <span>{error.message}</span>
      {uncertain ? <a className="ts-oneway" href={`/t/${tripId}?book=${encodeURIComponent(leg.id)}`}>Check booking</a> : null}
      {/* an offer the airline no longer sells, as after a day away: a fresh search brings today's fares */}
      {error.code === "OFFER_GONE" && !leg.booking ? (
        <button type="button" className="ts-oneway" onClick={() => { setError(null); retrySearch(leg.id); }}>
          Search again
        </button>
      ) : null}
    </p>
  ) : null;

  const moved = price ? (
    <div className="tp-notice" role="alert">
      <span>
        {price.was ? `Now ${fmt(price.now)} a seat, was ${fmt(price.was)}.` : `${fmt(price.now)} a seat.`}
      </span>
      <span className="tp-notice-actions">
        <button type="button" className="ts-oneway" disabled={busy || uncertain} onClick={() => settle(price.now)}>
          Continue
        </button>
        <button type="button" className="ts-oneway" onClick={() => setPrice(null)}>
          Not now
        </button>
      </span>
    </div>
  ) : null;

  if (!booking) {
    const bookable = !!leg.chosen && isBookable(leg.chosen);
    // anything else is bought on its provider's site, by each rider
    const outside = leg.chosen && !bookable ? webUrlOrNull(leg.chosen.bookingUrl ?? undefined) : null;
    return (
      <div className="tp-book-row" ref={root}>
        {notice}
        {problem}
        {moved}
        {bookable && rider && !price ? (
          <Button variant="secondary" block disabled={busy || uncertain} onClick={() => settle()}>
            Settle and book
          </Button>
        ) : null}
        {outside && leg.chosen ? (
          <a className="ts-oneway" href={outside} target="_blank" rel="noopener noreferrer">
            Book on {providerName(leg.chosen, outside)}
          </a>
        ) : null}
      </div>
    );
  }

  const nobodyPaid = Object.values(booking.seats).every((s) => !s.paid);
  return (
    <section className="tp-book" aria-label="Booking" ref={root}>
      {problem}
      <CheckoutCard legId={leg.id} inCard />
      {rider && booking.status !== "booked" && nobodyPaid ? (
        <button type="button" className="ts-oneway tp-remove" disabled={busy || uncertain} onClick={() => run(() => cancelSettleAction(tripId, leg.id))}>
          Cancel settle
        </button>
      ) : null}
    </section>
  );
}

const TITLES = ["mr", "ms", "mrs", "miss", "dr"] as const;
const TITLE_OPTIONS = TITLES.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }));
const GENDERS = [
  { value: "f", label: "Female" },
  { value: "m", label: "Male" },
];
// the passport's issuing country as Duffel wants it: ISO-2
const COUNTRY_OPTIONS = countries().flatMap((c) => {
  const two = iso2(c.code);
  return two ? [{ value: two, label: c.name }] : [];
});
// the country a phone number is read in, with its dialling code
const PHONE_OPTIONS = COUNTRY_OPTIONS.flatMap((o) => {
  const dial = dialCode(o.value);
  return dial ? [{ value: o.value, label: `${o.label} ${dial}` }] : [];
});

export function DetailsForm({
  documents,
  showPassport = documents,
  defaults = null,
  email,
  passportCountry,
  busy,
  invalid,
  submitLabel = "Save details",
  onCancel,
  onSubmit,
}: {
  /** The airline needs a passport: its fields are required. */
  documents: boolean;
  /** Passport fields shown though not required, e.g. to keep a saved one up to date. */
  showPassport?: boolean;
  /** Saved details to start from. */
  defaults?: TravellerDetails | null;
  email: string | null;
  passportCountry: string;
  busy: boolean;
  invalid: string[];
  submitLabel?: string;
  onCancel: () => void;
  onSubmit: (details: unknown) => void;
}) {
  const bad = (name: string) => invalid.includes(name) || undefined;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim();
    onSubmit({
      title: text("title"),
      gender: text("gender"),
      givenName: text("givenName"),
      familyName: text("familyName"),
      bornOn: text("bornOn"),
      email: text("email"),
      // read in the picked country on the server, unless it starts with + or 00
      phone: text("phone"),
      phoneCountry: text("phoneCountry"),
      passport: showPassport && (documents || text("passportNumber")) ? { number: text("passportNumber"), country: text("passportCountry"), expiresOn: text("passportExpires") } : null,
    });
  };
  return (
    <form className="tp-form" onSubmit={submit}>
      <div className="tp-form-field">
        <span>Title</span>
        <Select name="title" aria-label="Title" defaultValue={defaults?.title ?? "mr"} options={TITLE_OPTIONS} aria-invalid={bad("title")} />
      </div>
      <div className="tp-form-field">
        <span>Gender</span>
        <Select name="gender" aria-label="Gender" defaultValue={defaults?.gender ?? ""} required options={GENDERS} aria-invalid={bad("gender")} />
      </div>
      <label>
        Given names
        <input name="givenName" required defaultValue={defaults?.givenName} autoComplete="given-name" aria-invalid={bad("givenName")} />
      </label>
      <label>
        Family name
        <input name="familyName" required defaultValue={defaults?.familyName} autoComplete="family-name" aria-invalid={bad("familyName")} />
      </label>
      <label data-wide>
        Date of birth
        <input name="bornOn" type="date" required defaultValue={defaults?.bornOn} autoComplete="bday" max={new Date().toISOString().slice(0, 10)} aria-invalid={bad("bornOn")} />
      </label>
      <div className="tp-form-field">
        <span>Phone country</span>
        <Select
          name="phoneCountry"
          aria-label="Phone country"
          defaultValue={phoneCountry(defaults?.phone) ?? passportCountry}
          searchable
          options={PHONE_OPTIONS}
          aria-invalid={bad("phone")}
        />
      </div>
      <label>
        Phone
        <input name="phone" type="tel" required defaultValue={defaults?.phone ? formatPhone(defaults.phone) : undefined} placeholder="9123 4567" autoComplete="tel" aria-invalid={bad("phone")} />
      </label>
      <label data-wide>
        Email for the ticket
        <input name="email" type="email" required defaultValue={defaults?.email ?? email ?? ""} autoComplete="email" aria-invalid={bad("email")} />
      </label>
      {showPassport ? (
        <>
          <label>
            Passport number
            <input name="passportNumber" required={documents} autoComplete="off" defaultValue={defaults?.passport?.number} aria-invalid={bad("passport.number")} />
          </label>
          <label>
            Expires
            <input name="passportExpires" type="date" required={documents} defaultValue={defaults?.passport?.expiresOn} min={new Date().toISOString().slice(0, 10)} aria-invalid={bad("passport.expiresOn")} />
          </label>
          <div className="tp-form-field" data-wide>
            <span>Issuing country</span>
            <Select
              name="passportCountry"
              aria-label="Issuing country"
              defaultValue={defaults?.passport?.country ?? passportCountry}
              required={documents}
              searchable
              options={COUNTRY_OPTIONS}
              aria-invalid={bad("passport.country")}
            />
          </div>
        </>
      ) : null}
      <div className="tp-form-actions">
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
