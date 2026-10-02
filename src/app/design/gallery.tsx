"use client";

import { useTheme } from "next-themes";
import { useState, useSyncExternalStore } from "react";

import { DEMO_PARTY, EntryPanel } from "@/components/entry";
import { RoundButton, Route, Sticker, Tag, Ticket } from "@/components/paper-atlas";

export function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();
  // resolvedTheme is only known on the client
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const current = mounted ? resolvedTheme : undefined;
  return (
    <div className="flex gap-2" role="group" aria-label="Theme">
      {(["light", "dark"] as const).map((t) => (
        <button
          key={t}
          type="button"
          aria-pressed={current === t}
          onClick={() => setTheme(t)}
          className="type-tag h-11 rounded-tag border border-ink bg-paper-raised px-4 shadow-tag aria-pressed:bg-ink aria-pressed:text-paper-raised"
        >
          {t === "light" ? "Day" : "Night"}
        </button>
      ))}
    </div>
  );
}

function noop() {
  return () => {};
}

const HKG = { code: "HKG", city: "Hong Kong" };
const CDG = { code: "CDG", city: "Paris" };

export function ComponentGallery() {
  const [searching, setSearching] = useState(true);
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-center gap-10 py-6">
        <Ticket from={HKG} to={CDG} date="Sat 3 Oct" distance="9,624 km" searching={searching} onClose={() => setSearching((s) => !s)} />
        <Ticket from={HKG} to={CDG} date="Sat 3 Oct" distance="9,624 km" searching={false} flat />
      </div>
      <div className="flex flex-wrap items-center gap-8">
        <Tag>HKG</Tag>
        <Sticker shape="plane" title="Traveller" />
        <Sticker shape="plane" rotate={45} />
        <Sticker shape="star" title="Origin" />
        <Sticker shape="star" size={44} />
        <Route marching />
        <Route lift={0.4} />
        <RoundButton label="Close" />
      </div>
      <div className="flex flex-wrap items-start gap-8">
        <EntryPanel leg={{ fromHub: "HKG", toHub: "PVG" }} members={DEMO_PARTY} />
        <EntryPanel leg={{ fromHub: "ICN", toHub: "PVG", onwardCountry: "JPN" }} members={DEMO_PARTY} />
        <EntryPanel leg={{ fromHub: "PVG", toHub: "HND" }} members={DEMO_PARTY} />
      </div>
    </div>
  );
}
