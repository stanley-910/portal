"use client";

import { useRoom, useSelf } from "@liveblocks/react";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { cancelSettleAction, dismissBookingNoticeAction, payShareAction, settleLegAction, submitDetailsAction } from "@/app/t/booking-actions";
import { Button } from "@/components/paper-atlas";
import type { Failure, PriceChange } from "@/lib/booking/flow";
import type { TravellerDetails } from "@/lib/booking/offer";
import { dialCode, formatPhone, phoneCountry } from "@/lib/booking/phone";
import { iso2 } from "@/lib/entry/iso";
import { memberColor, type Money, type StoredOffer } from "@/lib/liveblocks/types";
import { countries } from "@/lib/nationality";
import { isBookable, webUrlOrNull } from "@/lib/trip/offers";
import { usePlanActions, usePlanMembers, type PlanLeg } from "@/lib/trip/plan";

// Buying a leg from the plan panel (docs/booking/README.md). Everything here is status the server wrote; the
// buttons call its actions. Names, birthdays and passports go straight to the server and never into the room.

const fmt = (m: Money) => new Intl.NumberFormat("en", { style: "currency", currency: m.currency }).format(m.amount);

/** "31 h left", "40 min left", "past" */
function timeLeft(deadline: string, now: number): string {
  const ms = Date.parse(deadline) - now;
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "past";
  const h = Math.floor(ms / 3_600_000);
  return h >= 1 ? `${h} h left` : `${Math.max(1, Math.round(ms / 60_000))} min left`;
}

/** Where a pick that can't be bought in the app is booked: its provider's name, or the link's host. */
function providerName(offer: StoredOffer, url: string): string {
  const credit = offer.attribution?.split(" — ")[0].trim();
  return credit || new URL(url).hostname.replace(/^www\./, "");
}

/** `focus` brings the leg's booking into view with its first control focused, once, e.g. after Book on the globe. */
export function LegBooking({ leg, email, nationalities, focus = false }: { leg: PlanLeg; email: string | null; nationalities: string[]; focus?: boolean }) {
  const room = useRoom();
  const tripId = room.id.slice("trip:".length);
  const me = useSelf((s) => s.id);
  const members = usePlanMembers();
  const { retrySearch } = usePlanActions();
  const [busy, start] = useTransition();
  const [error, setError] = useState<Failure | null>(null);
  const [price, setPrice] = useState<PriceChange | null>(null);
  const [form, setForm] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const booking = leg.booking;
  const rider = !!me && leg.riders.includes(me);
  const seat = me && booking ? booking.seats[me] : null;
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

  useEffect(() => {
    if (!booking?.deadline) return;
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [booking?.deadline]);

  const run = (task: () => Promise<{ ok: true } | { ok: true; url?: string | null } | PriceChange | Failure>) =>
    start(async () => {
      setError(null);
      setPrice(null);
      const result = await task();
      if (!result.ok) {
        if ("now" in result) setPrice(result);
        else setError(result);
        return;
      }
      if ("url" in result && result.url) window.location.assign(result.url);
      else setForm(false);
    });

  const settle = (accept?: Money) => run(() => settleLegAction(tripId, leg.id, accept));
  const pay = (accept?: Money) => run(() => payShareAction(tripId, leg.id, accept));

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
        <button type="button" className="ts-oneway" disabled={busy} onClick={() => (booking ? pay(price.now) : settle(price.now))}>
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
          <Button variant="secondary" block disabled={busy} onClick={() => settle()}>
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

  const seats = Object.entries(booking.seats);
  const paid = seats.filter(([, s]) => s.paid).length;
  const detailsIn = seats.filter(([, s]) => s.details).length;
  const nobodyPaid = paid === 0;
  const status =
    booking.status === "booked"
      ? "Booked"
      : booking.mode === "separate"
        ? `${paid} of ${seats.length} bought`
        : booking.status === "details"
          ? `Details ${detailsIn} of ${seats.length}`
          : `${paid} of ${seats.length} paid`;
  const left = booking.deadline && booking.status !== "booked" ? timeLeft(booking.deadline, now) : null;

  const needsDetails = !!seat && !seat.details && !seat.paid && (booking.mode === "separate" || booking.status === "details");
  const canPay = !!seat && seat.details && !seat.paid && booking.status === "paying";

  return (
    <section className="tp-book" aria-label="Booking" ref={root}>
      <div className="tp-book-head">
        <span>{booking.mode === "separate" ? "Separate tickets" : "Group booking"}</span>
        <span>
          {status}
          {left ? ` · ${left}` : ""}
        </span>
      </div>
      {notice}
      {problem}
      {moved}
      <ul className="tp-seats">
        {seats.map(([id, s]) => {
          const info = members?.[id];
          const state = s.paid ? (booking.mode === "separate" ? (s.reference ? `ticket ${s.reference}` : "bought") : booking.status === "booked" ? "paid" : "held") : s.details ? "details in" : "waiting";
          return (
            <li key={id} className="tp-seat">
              <span className="tp-rider" aria-hidden style={{ borderColor: memberColor(info?.color ?? 1) }}>
                {(info?.name ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <span>
                {info?.name ?? "Someone"}
                {id === me ? " (you)" : ""} · {fmt(s.share)}
              </span>
              <span className="tp-seat-state" data-done={s.paid || undefined}>
                {state}
              </span>
            </li>
          );
        })}
      </ul>
      {booking.status === "booked" && booking.reference ? <p className="tp-book-ref">Reference {booking.reference}</p> : null}

      {needsDetails && !form ? (
        <Button variant="secondary" block disabled={busy} onClick={() => setForm(true)}>
          Enter my details
        </Button>
      ) : null}
      {needsDetails && form ? (
        <DetailsForm
          documents={booking.documents}
          email={email}
          passportCountry={nationalities[0] ? (iso2(nationalities[0]) ?? "") : ""}
          busy={busy}
          invalid={error?.fields ?? []}
          onCancel={() => setForm(false)}
          onSubmit={(details) => run(() => submitDetailsAction(tripId, leg.id, details))}
        />
      ) : null}
      {canPay && !price ? (
        <Button block disabled={busy} onClick={() => pay()}>
          {booking.mode === "separate" ? `Buy my seat · ${fmt(seat.share)}` : `Pay my share · ${fmt(seat.share)}`}
        </Button>
      ) : null}
      {seat?.paid && booking.status === "paying" && booking.mode === "group" ? <p className="ts-empty">Your card is held until everyone has paid.</p> : null}

      {rider && booking.status !== "booked" && nobodyPaid ? (
        <button type="button" className="ts-oneway tp-remove" disabled={busy} onClick={() => run(() => cancelSettleAction(tripId, leg.id))}>
          Cancel settle
        </button>
      ) : null}
    </section>
  );
}

const TITLES = ["mr", "ms", "mrs", "miss", "dr"] as const;

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
      <label>
        Title
        <select name="title" defaultValue={defaults?.title ?? "mr"} aria-invalid={bad("title")}>
          {TITLES.map((t) => (
            <option key={t} value={t}>
              {t[0].toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Gender
        <select name="gender" defaultValue={defaults?.gender ?? ""} required aria-invalid={bad("gender")}>
          <option value="" disabled>
            Pick
          </option>
          <option value="f">Female</option>
          <option value="m">Male</option>
        </select>
      </label>
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
      <label>
        Phone country
        <select name="phoneCountry" defaultValue={phoneCountry(defaults?.phone) ?? passportCountry} aria-invalid={bad("phone")}>
          <option value="">Pick</option>
          {countries().map((c) => {
            const two = iso2(c.code);
            const dial = two && dialCode(two);
            return dial ? (
              <option key={c.code} value={two}>
                {c.name} {dial}
              </option>
            ) : null;
          })}
        </select>
      </label>
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
          <label data-wide>
            Issuing country
            <select name="passportCountry" defaultValue={defaults?.passport?.country ?? passportCountry} required={documents} aria-invalid={bad("passport.country")}>
              <option value="" disabled>
                Pick
              </option>
              {countries().map((c) => {
                const two = iso2(c.code);
                return two ? (
                  <option key={c.code} value={two}>
                    {c.name}
                  </option>
                ) : null;
              })}
            </select>
          </label>
        </>
      ) : null}
      <div className="tp-form-actions">
        <button type="button" className="ts-oneway" onClick={onCancel}>
          Cancel
        </button>
        <Button type="submit" disabled={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
