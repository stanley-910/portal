"use client";

import { convertCurrency, type Currency, type ExchangeRates } from "@/lib/currency";
import { memberColor, type Stay, type TripMember } from "@/lib/liveblocks/types";
import type { PlanLeg } from "@/lib/trip/plan";
import { nightsByStop, splitGaps, type Split } from "@/lib/trip/split";

// The cost split for the whole group: each member's total, opening to their fares by leg and their share of each
// stop's nights, then what the totals leave out. The numbers come from `computeSplit`, the same as Pip's get_split,
// and amounts stay in their own currencies; the picked currency only adds a rough sum.

const format = (amount: number, currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);

/** "HK$1,000 + CN¥900", or null with nothing priced. Each amount stays on one line; a long sum wraps between them. */
const sums = (totals: Record<string, number>) => {
  const parts = Object.entries(totals);
  if (!parts.length) return null;
  return parts.map(([currency, amount], i) => (
    <span key={currency} className="tsp-amount">
      {i ? " + " : null}
      {format(amount, currency)}
    </span>
  ));
};

/** The totals in the picked currency, when they mix currencies and every one of them converts. */
const roughly = (totals: Record<string, number>, currency: Currency, rates: ExchangeRates | null) => {
  const entries = Object.entries(totals);
  if (!rates || entries.length < 2) return null;
  let sum = 0;
  for (const [from, amount] of entries) {
    const converted = convertCurrency(amount, from, currency, rates);
    if (converted === null) return null;
    sum += converted;
  }
  return `≈ ${format(sum, currency)}`;
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
  stays: Readonly<Record<string, Readonly<Stay>>>;
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
  const gaps = splitGaps(split);
  if (!people.length) return null;

  return (
    <section className="tsp" aria-label="Split">
      <h3 className="ts-step">Split</h3>
      <ul className="tsp-list">
        {people.map((id) => {
          const m = split.members[id]!;
          const member = members[id];
          const unpriced = split.nights.filter((n) => !n.nightly && n.present.includes(id)).length;
          const total = sums(m.totals);
          const rough = roughly(m.totals, currency, rates);
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
                    {rough ? <small>{rough}</small> : null}
                  </span>
                </summary>
                <dl className="tsp-detail">
                  <dt>Fares</dt>
                  {m.fares.length ? (
                    m.fares.map((f) => (
                      <dd key={f.leg}>
                        <span>{legName(f.leg)}</span>
                        <span>
                          {f.price ? format(f.price.amount, f.price.currency) : "No option chosen"}
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
                        {sums(s.totals)}
                        {stays[s.stop]?.estimated ? <span className="ts-badge ts-badge-quiet">Estimated</span> : null}
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
      {gaps.legs.length || gaps.stops.length ? (
        <div className="tsp-missing">
          <p>Totals cover only what&apos;s priced.</p>
          <ul>
            {gaps.legs.map((id) => (
              <li key={`leg-${id}`}>{legName(id)}: no option chosen</li>
            ))}
            {gaps.stops.map((id) => (
              <li key={`stop-${id}`}>{stopName(id)}: no stay cost</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
