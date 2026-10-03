import Link from "next/link";
import type { ReactNode } from "react";

import type { TripSummary } from "@/lib/trip/server";
import { DeleteTripButton } from "./delete-trip-button";

// UTC so the server and the browser print the same day.
const day = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" });

function meta(trip: TripSummary) {
  const when = new Date(trip.updatedAt);
  const updated = Number.isNaN(when.getTime()) ? "" : ` · ${day.format(when)}`;
  const costs = trip.costs
    ? Object.entries(trip.costs).map(([currency, amount]) => new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount)).join(" + ")
    : null;
  return `${trip.members} ${trip.members === 1 ? "person" : "people"}${costs ? ` · You owe ${costs}` : ""}${updated}`;
}

function money(value: { amount: number; currency: string } | null) {
  return value
    ? new Intl.NumberFormat("en", { style: "currency", currency: value.currency, maximumFractionDigits: 2 }).format(value.amount)
    : "Not selected";
}

/** The signed-in user's saved trips, newest first. Renders nothing when there are none. */
export function MyTrips({ trips }: { trips: TripSummary[] }) {
  return (
    <nav aria-label="My trips" className="w-full max-w-2xl overflow-hidden rounded-ticket border-(length:--line-ink) border-ink bg-paper-raised shadow-ticket">
      {trips.length ? (
      <ul>
        {trips.map((trip) => (
          <li key={trip.id}>
            <details className="border-b-(length:--line-hair) border-line last:border-b-0">
              <summary className="flex min-h-11 cursor-pointer list-none flex-col justify-center px-(--space-3) py-(--space-2) outline-offset-3 focus-visible:outline-2 focus-visible:outline-(--focus)">
                <span className="type-body truncate">{trip.title}</span>
                <span className="type-meta text-ink-muted">{meta(trip)}</span>
              </summary>
              <div className="grid gap-(--space-3) px-(--space-3) pb-(--space-3)">
                <CostGroup title="Flights and transport">
                  {trip.breakdown?.fares.length ? trip.breakdown.fares.map((fare, index) => (
                    <CostRow key={`${fare.label}-${index}`} label={fare.label} value={money(fare.price)} detail={fare.kind === "estimated" ? "Estimated" : fare.kind ?? undefined} />
                  )) : <p className="type-meta text-ink-muted">No transport selected.</p>}
                </CostGroup>
                <CostGroup title="Hotels">
                  {trip.breakdown?.nights.length ? trip.breakdown.nights.map((night) => (
                    <CostRow key={`${night.stop}-${night.date}`} label={`${night.stop} · ${night.date}`} value={money(night.share)} />
                  )) : <p className="type-meta text-ink-muted">No hotel nights selected.</p>}
                </CostGroup>
                <div className="flex flex-wrap items-center gap-(--space-3)">
                  <Link href={`/t/${trip.id}`} className="type-meta text-ink underline underline-offset-4">Open trip</Link>
                  <DeleteTripButton tripId={trip.id} />
                </div>
              </div>
            </details>
          </li>
        ))}
      </ul>
      ) : (
        <p className="type-body px-(--space-4) py-(--space-5) text-ink-muted">You have not saved any trips yet.</p>
      )}
    </nav>
  );
}

function CostGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-(--space-1)">
      <h3 className="type-caption text-ink-muted">{title}</h3>
      {children}
    </section>
  );
}

function CostRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-(--space-3)">
      <span className="type-meta">{label}{detail ? ` · ${detail}` : ""}</span>
      <strong className="type-meta">{value}</strong>
    </div>
  );
}
