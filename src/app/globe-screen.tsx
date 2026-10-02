"use client";

import { useTheme } from "next-themes";
import { useRef, useState } from "react";

import { Ticket } from "@/components/paper-atlas";
import { TripGlobe, type LandedTrip, type TripGlobeHandle } from "@/components/trip-globe";

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
      {trip ? (
        <div
          key={`${trip.from.code}-${trip.to.code}-${trip.destination.lat}`}
          className="absolute bottom-(--space-6) left-1/2 -translate-x-1/2 animate-in duration-500 ease-[cubic-bezier(0.2,0.9,0.25,1.15)] fade-in slide-in-from-bottom-[18px] motion-reduce:animate-none"
        >
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
