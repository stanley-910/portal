"use client";

import { useTheme } from "next-themes";
import { useEffect, useState, useSyncExternalStore } from "react";

import { DEMO_PARTY, EntryPanel } from "@/components/entry";
import { Glyph, Timeline, TripTag, type GlyphKind } from "@/components/ticket-search";
import {
  Cursor,
  cursorUrl,
  MEMBER_COLORS,
  memberColor,
  RoundButton,
  Route,
  Sticker,
  Tag,
  Ticket,
  type CursorShape,
} from "@/components/paper-atlas";

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

const GLYPHS: GlyphKind[] = ["flight", "train", "bus", "ferry", "hotel"];

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
        <RoundButton label="Close" variant="quiet" />
      </div>
      <div className="ts-glyphs flex flex-wrap items-center gap-6 text-ink">
        {GLYPHS.map((k) => (
          <Glyph key={k} kind={k} size={28} />
        ))}
        {GLYPHS.map((k) => (
          <Glyph key={`${k}-sticker`} kind={k} size={28} sticker />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-8">
        <TripTag mode="flight" from="HKG" to="PVG" price="$165" style={{ position: "relative" }} />
        <TripTag mode="train" from="Hong Kong" to="Shanghai" price="$92" style={{ position: "relative" }} />
        <TripTag mode="ferry" from="Hong Kong" to="Macau" price="$24" style={{ position: "relative" }} />
        <TripTag mode="bus" from="Kuala Lumpur" to="Singapore" price="$18" style={{ position: "relative" }} />
      </div>
      <div className="grid w-72 gap-3">
        <Timeline legs={[{ kind: "flight", minutes: 168, label: "Flight 2h 48m" }]} />
        <Timeline
          legs={[
            { kind: "flight", minutes: 610, label: "Flight 10h 10m" },
            { kind: "wait", minutes: 105, label: "Layover 1h 45m" },
            { kind: "flight", minutes: 225, label: "Flight 3h 45m" },
          ]}
        />
        <Timeline legs={[{ kind: "train", minutes: 500, label: "Train 8h 20m" }]} />
        <Timeline legs={[{ kind: "ferry", minutes: 60, label: "Ferry 1h" }]} />
        <Timeline legs={[{ kind: "bus", minutes: 330, label: "Bus 5h 30m" }]} />
      </div>
      <div className="flex flex-wrap items-start gap-8">
        <EntryPanel leg={{ fromHub: "HKG", toHub: "PVG" }} members={DEMO_PARTY} />
        <EntryPanel leg={{ fromHub: "ICN", toHub: "PVG", onwardCountry: "JPN" }} members={DEMO_PARTY} />
        <EntryPanel leg={{ fromHub: "PVG", toHub: "HND" }} members={DEMO_PARTY} />
      </div>
    </div>
  );
}

const SHAPES: CursorShape[] = ["arrow", "compass", "map"];
const PEOPLE = ["Mei", "Joon", "Aiko"];

/** Every cursor shape in every member colour, and a pad where pretend members drift about. */
export function CursorGallery() {
  const { resolvedTheme } = useTheme();
  // resolvedTheme is only known on the client
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const theme = mounted && resolvedTheme === "dark" ? "dark" : "light";
  const [shape, setShape] = useState<CursorShape>("arrow");
  const t = useTicker();
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        {SHAPES.map((s) => (
          <div key={s} className="flex flex-wrap items-center gap-x-10 gap-y-4">
            <span className="type-tag w-20">{s}</span>
            {MEMBER_COLORS.map((c) => (
              <span key={c} className="relative h-8 w-8">
                <Cursor shape={s} color={c} x={6} y={4} />
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="flex gap-2" role="group" aria-label="Cursor shape">
        {SHAPES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={shape === s}
            onClick={() => setShape(s)}
            className="type-tag h-11 rounded-tag border border-ink bg-paper-raised px-4 shadow-tag aria-pressed:bg-ink aria-pressed:text-paper-raised"
          >
            {s}
          </button>
        ))}
      </div>
      <div
        className="relative h-72 overflow-hidden rounded-ticket border border-ink bg-paper"
        style={{ cursor: cursorUrl(shape, memberColor(PEOPLE.length), theme) }}
      >
        {/* a scrap of printed map, sea and land, so the shadows fall on something */}
        <div aria-hidden className="absolute inset-y-0 left-0 w-1/2" style={halftone("sea")} />
        <div aria-hidden className="absolute inset-y-0 right-0 w-1/2" style={halftone("sage")} />
        {PEOPLE.map((name, i) => (
          <Cursor
            key={name}
            shape={shape}
            color={memberColor(i)}
            name={name}
            x={180 + 140 * Math.sin(t * 0.7 + i * 2.1) + 60 * i}
            y={110 + 70 * Math.sin(t * 1.1 + i * 1.3)}
            altitude={0.5 + 0.45 * Math.sin(t * 0.9 + i * 2.4)}
          />
        ))}
      </div>
    </div>
  );
}

const halftone = (ink: string) => ({
  backgroundImage: `radial-gradient(var(--${ink}) 32%, transparent 36%)`,
  backgroundSize: "var(--halftone-pitch) var(--halftone-pitch)",
});

/** Seconds since mount, ticking about ten times a second; frozen when the viewer prefers reduced motion. */
function useTicker() {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    const id = setInterval(() => setT((performance.now() - start) / 1000), 100);
    return () => clearInterval(id);
  }, []);
  return t;
}
