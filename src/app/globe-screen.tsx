"use client";

import { useTheme } from "next-themes";
import { useRef, useState } from "react";

import { DEMO_PARTY, EntryPanel } from "@/components/entry";
import { Ticket } from "@/components/paper-atlas";
import { TripGlobe, type LandedTrip, type TripGlobeHandle } from "@/components/trip-globe";

import { createTrip } from "./t/actions";

/** "Sat 3 Oct" */
const formatDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
/** "9,624 km" */
const formatDistance = (km: number) => `${km.toLocaleString("en-US")} km`;

export function GlobeScreen() {
  const { resolvedTheme } = useTheme();
  const globe = useRef<TripGlobeHandle>(null);
  const [trip, setTrip] = useState<LandedTrip | null>(null);

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <TripGlobe
        ref={globe}
        theme={resolvedTheme === "dark" ? "dark" : resolvedTheme === "light" ? "light" : "auto"}
        onTakeoff={() => setTrip(null)}
        onLand={setTrip}
        onCancel={() => setTrip(null)}
      />
      <form action={createTrip} className="absolute top-(--space-4) left-(--space-4)">
        <button
          type="submit"
          className="type-tag h-9 rounded-tag border-(length:--line-hair) border-ink bg-paper-raised px-(--space-3) shadow-tag"
        >
          Plan with friends
        </button>
      </form>
      {trip ? (
        <div
          key={`${trip.from.code}-${trip.to.code}-${trip.destination.lat}`}
          className="absolute bottom-(--space-6) left-1/2 flex -translate-x-1/2 flex-col items-center gap-(--space-4) animate-in duration-500 ease-[cubic-bezier(0.2,0.9,0.25,1.15)] fade-in slide-in-from-bottom-[18px] motion-reduce:animate-none"
        >
          <EntryPanel leg={{ fromHub: trip.from.code, toHub: trip.to.code }} members={DEMO_PARTY} />
          <Ticket
            from={{ code: trip.from.code, city: trip.from.city }}
            to={{ code: trip.to.code, city: trip.to.city }}
            date={formatDate(trip.departDate)}
            distance={formatDistance(trip.distanceKm)}
            onClose={() => globe.current?.cancel()}
          />
        </div>
      ) : null}
    </main>
  );
}
