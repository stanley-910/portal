"use client";

import { useTheme } from "next-themes";
import { useEffect, useState, useSyncExternalStore } from "react";

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
