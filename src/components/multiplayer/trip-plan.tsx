"use client";

import { useSelf } from "@liveblocks/react";

import { memberColor, type StoredOffer } from "@/lib/liveblocks/types";
import { usePlanActions, usePlanLegs, usePlanMembers, type PlanLeg } from "@/lib/trip/plan";

// The shared plan (M8, M13): every leg anyone has drawn, its options, votes and pick. A plain list for now; the
// data and every edit come from `@/lib/trip/plan`, so a redesign only replaces this file.

const SHOWN = 5;

const money = (o: StoredOffer) =>
  o.price ? o.price.amount.toLocaleString("en-US", { style: "currency", currency: o.price.currency, maximumFractionDigits: 0 }) : "Timetable";
/** Departure time as the provider wrote it. Arrivals are left out: some providers give them in UTC, not local time. */
const time = (iso: string) => iso.slice(11, 16);
const hours = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}`;

export function TripPlan() {
  const legs = usePlanLegs();
  if (!legs?.length) return null;
  return (
    <section
      aria-label="Trip plan"
      className="flex max-h-[calc(100dvh-12rem)] w-[min(92vw,380px)] flex-col gap-(--space-3) overflow-y-auto rounded-ticket border-(length:--line-ink) border-ink bg-paper-raised p-(--space-4) shadow-ticket"
    >
      {legs.map((leg) => (
        <LegCard key={leg.id} leg={leg} />
      ))}
    </section>
  );
}

function LegCard({ leg }: { leg: PlanLeg }) {
  const me = useSelf((s) => s.id);
  const members = usePlanMembers();
  const { setDate, retrySearch, vote, choose, toggleRider, removeLeg } = usePlanActions();
  const offers = leg.search.offers.slice(0, SHOWN);

  return (
    <article className="flex flex-col gap-(--space-2) border-b-(length:--line-hair) border-ink pb-(--space-3) last:border-b-0 last:pb-0">
      <header className="flex items-center justify-between gap-(--space-2)">
        <h3 className="type-title">
          {leg.from.hub} → {leg.to.hub}
        </h3>
        <button type="button" className="type-tag text-ink-muted" onClick={() => removeLeg(leg.id)}>
          Remove
        </button>
      </header>
      <p className="type-meta text-ink-muted">
        {leg.from.name} to {leg.to.name}
      </p>

      <div className="flex items-center gap-(--space-2)">
        <input
          type="date"
          aria-label="Date"
          value={leg.date}
          onChange={(e) => e.target.value && setDate(leg.id, e.target.value)}
          className="type-body h-9 rounded-tag border-(length:--line-hair) border-ink bg-paper px-(--space-2)"
        />
        <ul className="flex items-center gap-(--space-1)" aria-label="Riders">
          {members
            ? Object.entries(members).map(([id, info]) => {
                const riding = leg.riders.includes(id);
                return (
                  <li key={id}>
                    <button
                      type="button"
                      aria-pressed={riding}
                      title={info.name}
                      onClick={() => toggleRider(leg.id, id)}
                      className="type-tag grid size-8 place-items-center rounded-round border-2 bg-paper-raised aria-[pressed=false]:opacity-40"
                      style={{ borderColor: memberColor(info.color) }}
                    >
                      {info.name.slice(0, 1).toUpperCase()}
                    </button>
                  </li>
                );
              })
            : null}
        </ul>
      </div>

      {leg.search.status === "searching" ? <p className="type-body text-ink-muted">Searching</p> : null}
      {leg.search.status === "failed" ? (
        <button type="button" className="type-tag self-start underline" onClick={() => retrySearch(leg.id)}>
          Search failed. Retry
        </button>
      ) : null}
      {leg.search.status === "done" && offers.length === 0 ? <p className="type-body text-ink-muted">No routes found</p> : null}

      <ul className="flex flex-col gap-(--space-1)">
        {offers.map((o) => {
          const voters = leg.votes[o.id] ?? [];
          const chosen = leg.chosen?.id === o.id;
          return (
            <li
              key={o.id}
              className="flex items-center justify-between gap-(--space-2) rounded-tag border-(length:--line-hair) border-ink px-(--space-2) py-(--space-1) data-[chosen=true]:border-(length:--line-ink) data-[chosen=true]:bg-paper"
              data-chosen={chosen}
            >
              <span className="min-w-0">
                <span className="type-label block text-ink-muted">
                  {o.mode.toUpperCase()} · {o.carrier ?? o.provider}
                  {o.kind !== "live" ? " · ESTIMATED" : ""}
                </span>
                <span className="type-body block">
                  {o.kind === "estimated" ? "Any time" : time(o.depart)} · {hours(o.durationMin)}
                  {o.stops ? ` · ${o.stops} stop${o.stops > 1 ? "s" : ""}` : ""} · {money(o)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-(--space-1)">
                <button
                  type="button"
                  aria-pressed={!!me && voters.includes(me)}
                  className="type-tag h-8 rounded-tag border-(length:--line-hair) border-ink px-(--space-2) aria-pressed:bg-ink aria-pressed:text-paper-raised"
                  onClick={() => vote(leg.id, o.id)}
                >
                  ▲ {voters.length}
                </button>
                <button
                  type="button"
                  aria-pressed={chosen}
                  className="type-tag h-8 rounded-tag border-(length:--line-hair) border-ink px-(--space-2) aria-pressed:bg-ink aria-pressed:text-paper-raised"
                  onClick={() => choose(leg.id, chosen ? null : o.id)}
                >
                  {chosen ? "Picked" : "Pick"}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
