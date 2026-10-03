"use client";

import { formatMoney, inCurrency, sumIn, type Currency, type ExchangeRates } from "@/lib/currency";
import { memberColor, type TripMember } from "@/lib/liveblocks/types";
import type { PlanLeg } from "@/lib/trip/plan";
import { nightsByStop, type PlanStay, type Split } from "@/lib/trip/split";

// The cost split for the whole group: each member's total, opening to their fares by leg and their share of each
// stop's nights, where a leg with no pick or a night with no price says so. The numbers come from `computeSplit`, the same as Pip's get_split,
// and amounts are kept in their own currencies; they show in the picked one, each where it can't convert.

/**
 * Totals in the picked currency: one sum when every currency converts, else each in its own ("HK$1,000 + CN¥900"),
 * or null with nothing priced. Each amount stays on one line; a long sum wraps between them.
 */
const sums = (totals: Record<string, number>, currency: Currency, rates: ExchangeRates | null) => {
  const parts = Object.entries(totals);
  if (!parts.length) return null;
  const sum = sumIn(totals, currency, rates);
  if (sum !== null) return <span className="tsp-amount">{formatMoney({ amount: sum, currency })}</span>;
  return parts.map(([c, amount], i) => (
    <span key={c} className="tsp-amount">
      {i ? " + " : null}
      {formatMoney({ amount, currency: c })}
    </span>
  ));
};

export function TripSplit({
  split,
  legs,
  members,
  stays,
  me,
  currency,
  rates,
}: {
  split: Split;
  legs: PlanLeg[];
  members: Readonly<Record<string, Pick<TripMember, "name" | "color">>>;
  stays: readonly PlanStay[];
  me: string | null;
  currency: Currency;
  rates: ExchangeRates | null;
}) {
  const legName = (id: string) => {
    const leg = legs.find((l) => l.id === id);
    return leg ? `${leg.from.code ?? leg.from.name} → ${leg.to.code ?? leg.to.name}` : "A removed leg";
  };
  const stopName = (id: string) => {
    for (const l of legs) {
      if (l.to.id === id) return l.to.name;
      if (l.from.id === id) return l.from.name;
    }
    return "A removed stop";
  };
  // in join order, so everyone sees the same list; a rider who isn't a member any more comes last
  const people = [...Object.keys(members).filter((id) => split.members[id]), ...Object.keys(split.members).filter((id) => !members[id])];
  if (!people.length) return null;

  return (
    <section className="tsp" aria-label="Split">
      <h3 className="ts-step">Split</h3>
      <ul className="tsp-list">
        {people.map((id) => {
          const m = split.members[id]!;
          const member = members[id];
          const unpriced = split.nights.filter((n) => !n.nightly && n.present.includes(id)).length;
          const total = sums(m.totals, currency, rates);
          return (
            <li key={id}>
              <details className="tsp-member">
                <summary>
                  <span className="tsp-dot" style={{ background: memberColor(member?.color ?? 1) }} aria-hidden />
                  <span className="tsp-name">
                    {member?.name ?? "Someone"}
                    {id === me ? <span className="ts-badge ts-badge-quiet">You</span> : null}
                  </span>
                  <span className="tsp-total" data-none={!total || undefined}>
                    {total ?? "Nothing yet"}
                  </span>
                  <svg className="tsp-chevron" width={10} height={10} viewBox="0 0 10 10" aria-hidden>
                    <path d="M2 3.5 5 6.5 8 3.5" />
                  </svg>
                </summary>
                <dl className="tsp-detail">
                  <dt>Fares</dt>
                  {m.fares.length ? (
                    m.fares.map((f) => (
                      <dd key={f.leg}>
                        <span>{legName(f.leg)}</span>
                        <span>
                          {f.price ? formatMoney(inCurrency(f.price, currency, rates)) : "No option chosen"}
                          {f.price && f.kind !== "live" ? <span className="ts-badge ts-badge-quiet">Estimated</span> : null}
                        </span>
                      </dd>
                    ))
                  ) : (
                    <dd>None</dd>
                  )}
                  <dt>Stays</dt>
                  {nightsByStop(m.nightShares).map((s) => (
                    <dd key={s.stop}>
                      <span>
                        {stopName(s.stop)}, {s.nights} night{s.nights > 1 ? "s" : ""}
                      </span>
                      <span>
                        {sums(s.totals, currency, rates)}
                        {stays.some((stay) => stay.stop === s.stop && stay.estimated) ? <span className="ts-badge ts-badge-quiet">Estimated</span> : null}
                      </span>
                    </dd>
                  ))}
                  {unpriced ? (
                    <dd>
                      <span>
                        {unpriced} unpriced night{unpriced > 1 ? "s" : ""}
                      </span>
                    </dd>
                  ) : m.nightShares.length ? null : (
                    <dd>None</dd>
                  )}
                </dl>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
