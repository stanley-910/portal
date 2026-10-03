"use client";

import { useState, type RefObject } from "react";

import { TripLibrary } from "@/components/library";
import { NavBar, NavButton, PlaceSearch } from "@/components/nav-bar";
import { CurrencySetting } from "@/components/transport/currency-selector";
import type { TripGlobeHandle } from "@/components/trip-globe";
import { setCurrencyPref, useCurrencyPref } from "@/lib/currency-pref";
import { useExchangeRates } from "@/lib/exchange-rates";
import type { LibraryTrip } from "@/lib/trip/library";

import { FakeGlobe } from "./fake-globe";
import type { Persona } from "./fixtures";
import { LIB_TODAY, LIB_TRIPS } from "./library-fixtures";
import "./library.css";

// The home globe's trip library, <TripLibrary>, on the flat stand-in globe with made-up trips. Renames save after a
// moment and stick for the visit; nothing is stored. The switches top right show its loading, empty and failed states.

type DataState = "trips" | "loading" | "empty" | "error";
const STATES: { id: DataState; label: string }[] = [
  { id: "trips", label: "Trips" },
  { id: "loading", label: "Loading" },
  { id: "empty", label: "Empty" },
  { id: "error", label: "Error" },
];

export function LibraryScene({ globe, persona, compact }: { globe: RefObject<TripGlobeHandle | null>; persona: Persona; compact: boolean }) {
  const currency = useCurrencyPref();
  const rates = useExchangeRates();
  const [open, setOpen] = useState(true);
  const [data, setData] = useState<DataState>("trips");
  const [trips, setTrips] = useState<LibraryTrip[]>(LIB_TRIPS);
  const [selected, setSelected] = useState<string | null>(LIB_TRIPS[0].id);
  const drop = (id: string) => {
    setTrips((list) => list.filter((t) => t.id !== id));
    setSelected((s) => (s === id ? null : s));
  };

  return (
    <main className="lib-scene relative h-dvh w-full overflow-hidden bg-paper">
      <FakeGlobe ref={globe} zoom={compact ? 0.5 : 0} />
      <NavBar
        globe={globe}
        name={persona.name}
        email={persona.email}
        account={persona.account}
        nationalities={persona.nationalities}
        color={persona.color}
        settings={<CurrencySetting currency={currency} rates={rates} error={false} onChange={setCurrencyPref} />}
      >
        <PlaceSearch globe={globe} />
        <NavButton variant="secondary" icon={TRIPS_ICON} label="Trips" aria-pressed={open} onClick={() => setOpen((o) => !o)} />
      </NavBar>

      <TripLibrary
        trips={data === "trips" ? trips : data === "empty" ? [] : null}
        error={data === "error" ? "Check your connection and try again." : null}
        userId="mei"
        today={LIB_TODAY}
        open={open}
        onOpenChange={setOpen}
        selected={selected}
        onSelect={setSelected}
        onRename={(id, title) =>
          new Promise((resolve) =>
            window.setTimeout(() => {
              setTrips((list) => list.map((t) => (t.id === id ? { ...t, title } : t)));
              resolve(true);
            }, 300),
          )
        }
        hrefFor={(id) => `#trip-${id}`}
        // the app confirms first; here the trip just goes, until the page is reloaded
        onLeave={drop}
        onDelete={drop}
        currency={currency}
        rates={rates}
        draw={({ flights, pins }) => {
          globe.current?.setRemoteFlights(flights);
          globe.current?.setPins(pins);
        }}
        globe={globe}
      />

      {/* the scene's own playground switches: the library's data states */}
      <div className="lib-dev" data-library-keep data-anchor-avoid>
        <div className="pg-group" role="group" aria-label="Library data">
          {STATES.map((s) => (
            <button key={s.id} type="button" className="pg-chip" aria-pressed={data === s.id} onClick={() => setData(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

const TRIPS_ICON = <path d="M2.5 4h11M2.5 8h11M2.5 12h7" />;
