"use client";

import { useMemo, useState } from "react";

import { CheckoutBody, type CheckoutCardActions, type CheckoutLeg } from "@/components/agent/checkout-card";
import type { TravellerDetails } from "@/lib/booking/offer";
import type { LegBooking } from "@/lib/liveblocks/types";

import { MEMBERS } from "./fixtures";

// Pip's checkout card in the playground's thread, with no room, booking or card behind it. Each state starts the leg
// at that point of a group booking; the buttons then move it on as the server would, after a pause. Nothing is held
// or charged. Adding a new card needs Stripe, so its form only shows its failed state here.

export type CheckoutScenario = "details" | "pay" | "price" | "booked" | "ended";
export const CHECKOUT_SCENARIOS: { id: CheckoutScenario; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "pay", label: "Pay" },
  { id: "price", label: "Fare moved" },
  { id: "booked", label: "Booked" },
  { id: "ended", label: "Ended" },
];

const ME = "g_mei";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usd = (amount: number) => ({ amount, currency: "USD" });
const TRAVELLER: TravellerDetails = {
  title: "ms",
  gender: "f",
  givenName: "Mei",
  familyName: "Chan",
  bornOn: "1998-04-12",
  email: "mei@example.com",
  phone: "+85291234567",
  passport: { number: "K12345678", country: "HK", expiresOn: "2031-06-30" },
};

function bookingFor(scenario: CheckoutScenario): LegBooking | null {
  if (scenario === "ended") return null;
  const mine = scenario === "details" ? { details: false, paid: false } : scenario === "booked" ? { details: true, paid: true } : { details: true, paid: false };
  return {
    mode: "group",
    status: scenario === "details" ? "details" : scenario === "booked" ? "booked" : "paying",
    offerId: "off_playground",
    route: { origin: "PVG", destination: "HND", date: "2026-10-12" },
    deadline: scenario === "booked" ? null : new Date(Date.now() + 20 * 3600_000).toISOString(),
    total: usd(540),
    documents: true,
    reference: scenario === "booked" ? "PX7K2Q" : null,
    settledBy: ME,
    settledAt: Date.now() - 3600_000,
    seats: {
      [ME]: { share: usd(180), ...mine },
      g_joon: { share: usd(180), details: true, paid: scenario === "booked" },
      g_sam: { share: usd(180), details: scenario !== "details", paid: scenario === "booked" },
    },
  };
}

/** `solo`: booking alone in the home fare card, so only your seat. `inCard`: a settled leg in the trip plan. */
export function StandInCheckoutCard({ scenario, solo = false, inCard = solo }: { scenario: CheckoutScenario; solo?: boolean; inCard?: boolean }) {
  const [booking, setBooking] = useState<LegBooking | null>(() => {
    const b = bookingFor(scenario);
    return b && solo ? { ...b, seats: { [ME]: b.seats[ME] } } : b;
  });
  const [moved, setMoved] = useState(scenario === "price");
  const seat = (patch: Partial<LegBooking["seats"][string]>, status?: LegBooking["status"]) =>
    setBooking((b) => (b ? { ...b, ...(status ? { status } : {}), seats: { ...b.seats, [ME]: { ...b.seats[ME], ...patch } } } : b));

  const actions = useMemo<CheckoutCardActions>(
    () => ({
      wallet: async () => {
        await wait(300);
        return { traveller: TRAVELLER, cards: [{ id: "pm_playground", brand: "visa", last4: "4242", expMonth: 8, expYear: 2029 }], publishableKey: "pk_test_playground", email: TRAVELLER.email, nationalities: ["HKG"] };
      },
      submitSaved: async () => {
        await wait(600);
        seat({ details: true }, "paying");
        return { ok: true };
      },
      saveAndSubmit: async () => {
        await wait(600);
        seat({ details: true }, "paying");
        return { ok: true };
      },
      startHold: async (_t, _l, _card, accept) => {
        await wait(700);
        if (moved && !accept) return { ok: false, code: "PRICE_CHANGED", was: usd(180), now: usd(186) };
        setMoved(false);
        return { ok: true, clientSecret: null };
      },
      confirmHold: async () => {
        await wait(500);
        seat({ paid: true });
        return { ok: true };
      },
      payShare: async () => ({ ok: true, url: null }),
    }),
    [moved],
  );

  const leg: CheckoutLeg = {
    from: "Shanghai",
    to: "Tokyo",
    booking,
    bookingNotice: scenario === "ended" ? "The booking lapsed: not everyone's card was held in time." : null,
  };
  return <CheckoutBody tripId="playground" legId="l3" me={ME} leg={leg} members={MEMBERS} actions={actions} solo={solo} inCard={inCard} />;
}
