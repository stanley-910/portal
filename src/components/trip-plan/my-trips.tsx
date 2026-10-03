import Link from "next/link";

import type { TripSummary } from "@/lib/trip/server";

// UTC so the server and the browser print the same day.
const day = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" });

function meta(trip: TripSummary) {
  const when = new Date(trip.updatedAt);
  const updated = Number.isNaN(when.getTime()) ? "" : ` · ${day.format(when)}`;
  return `${trip.members} ${trip.members === 1 ? "person" : "people"}${updated}`;
}

/** The signed-in user's saved trips, newest first. Renders nothing when there are none. */
export function MyTrips({ trips }: { trips: TripSummary[] }) {
  if (!trips.length) return null;
  return (
    <nav aria-label="My trips" className="flex max-h-[50dvh] w-72 max-w-[calc(100vw-2*var(--space-4))] flex-col overflow-y-auto rounded-ticket border-(length:--line-ink) border-ink bg-paper-raised shadow-ticket">
      <h2 className="type-stamp px-(--space-3) pt-(--space-3)">My trips</h2>
      <ul>
        {trips.map((trip) => (
          <li key={trip.id}>
            <Link
              href={`/t/${trip.id}`}
              className="flex min-h-11 flex-col justify-center px-(--space-3) py-(--space-2) outline-offset-3 focus-visible:outline-2 focus-visible:outline-(--focus)"
            >
              <span className="type-body truncate">{trip.title}</span>
              <span className="type-meta text-ink-muted">{meta(trip)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
