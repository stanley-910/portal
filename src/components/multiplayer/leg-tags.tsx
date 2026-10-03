"use client";

import type { CSSProperties, RefObject } from "react";

import { TripTag, useTagOnRoute } from "@/components/ticket-search/trip-tag";
import type { TripGlobeHandle } from "@/components/trip-globe";
import { formatMoney, inCurrency } from "@/lib/currency";
import { useCurrencyPref } from "@/lib/currency-pref";
import { useExchangeRates } from "@/lib/exchange-rates";
import type { StoredOffer } from "@/lib/liveblocks/types";
import { usePlanLegs, type PlanLeg } from "@/lib/trip/plan";

/** What a leg's stub shows: the pick, else the option with the most votes (the earlier one on a tie), else nothing. */
export function legOffer(leg: Pick<PlanLeg, "chosen" | "votes" | "search">): StoredOffer | null {
  if (leg.chosen) return leg.chosen;
  let best: StoredOffer | null = null;
  let most = 0;
  for (const offer of leg.search.offers) {
    const n = leg.votes[offer.id]?.length ?? 0;
    if (n > most) [best, most] = [offer, n];
  }
  return best;
}

function LegTag({ leg, globe, onOpen, money }: { leg: PlanLeg; globe: RefObject<TripGlobeHandle | null>; onOpen: () => void; money: (o: StoredOffer | null) => string | null }) {
  const tag = useTagOnRoute(globe, leg.from, leg.to);
  const offer = legOffer(leg);
  return (
    <TripTag
      ref={tag}
      mode={offer?.mode ?? "flight"}
      from={leg.from.code || leg.from.name}
      to={leg.to.code || leg.to.name}
      price={money(offer)}
      className="pa-cast pointer-events-auto"
      style={{ "--alt": 0.3, visibility: "hidden" } as CSSProperties}
      aria-label={`Open the plan for ${leg.from.name} to ${leg.to.name}`}
      onClick={onOpen}
    />
  );
}

/** Every stored leg's ticket stub, riding on its route. Each opens the trip plan. */
export function LegTags({ globe, onOpen }: { globe: RefObject<TripGlobeHandle | null>; onOpen: () => void }) {
  const legs = usePlanLegs();
  const currency = useCurrencyPref();
  const rates = useExchangeRates();
  if (!legs?.length) return null;
  const money = (o: StoredOffer | null) => (o?.price ? formatMoney(inCurrency(o.price, currency, rates)) : null);
  return (
    <div className="pointer-events-none absolute inset-0 isolate overflow-hidden">
      {legs.map((leg) => (
        <LegTag key={leg.id} leg={leg} globe={globe} onOpen={onOpen} money={money} />
      ))}
    </div>
  );
}
