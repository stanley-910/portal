"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

import { HomePip, type HomePipHandle } from "@/components/agent/home-pip";
import { TripGlobe, type LandedTrip, type TripGlobeHandle } from "@/components/trip-globe";
import type { SoloEvent, SoloLeg } from "@/lib/agent/solo";
import { useCursorPref } from "@/lib/cursor-pref";
import { stopFromPoint } from "@/lib/trip/stops";

import { SCENARIOS, type Scenario } from "./scenarios";

// Pip's tool calls played on the real globe: the home globe with Pip's panel, and /api/pip answered from a script
// (scenarios.ts), so each tool's saucer and globe transitions can be watched, replayed and slowed down. The log reads
// out each streamed event and what the saucer does, with when, from the moment the question is sent.

const SPEEDS = [0.5, 1, 2];

type Line = { t: number; kind: "event" | "saucer" | "globe" | "note"; text: string };

const describe = (e: SoloEvent): string => {
  switch (e.t) {
    case "step":
      return `step ${e.done ? "done" : "start"}: ${e.label}`;
    case "activity":
      return e.label ? `activity: ${e.label}${e.at ? ` @ ${e.at.lat.toFixed(1)},${e.at.lng.toFixed(1)}` : ""}` : "activity: off";
    case "trip":
      return `trip: ${e.legs.map((l) => `${l.from.name} → ${l.to.name}`).join(", ") || "none"}`;
    case "marks":
      return `marks: ${e.marks.map((m) => m.text).join(" | ")}`;
    case "card":
      return `card: ${e.card.type}`;
    default:
      return e.t;
  }
};

export function PipLab() {
  const globe = useRef<TripGlobeHandle>(null);
  const pip = useRef<HomePipHandle>(null);
  const { resolvedTheme } = useTheme();
  const cursorPref = useCursorPref();
  const [scenario, setScenario] = useState<Scenario>(SCENARIOS[0]);
  const [speed, setSpeed] = useState(1);
  const [run, setRun] = useState(0);
  const [legs, setLegs] = useState<SoloLeg[]>([]);
  const [log, setLog] = useState<Line[]>([]);
  const started = useRef(0);
  const pipDates = useRef<string[] | null>(null);
  const live = useRef({ scenario, speed, run });
  useEffect(() => {
    live.current = { scenario, speed, run };
  }, [scenario, speed, run]);

  const note = (kind: Line["kind"], text: string) => setLog((l) => [...l, { t: performance.now() - started.current, kind, text }]);

  // /api/pip plays the scenario's script; a new run abandons the old stream
  useEffect(() => {
    const real = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.href).pathname !== "/api/pip") return real(input, init);
      const { scenario, speed, run } = live.current;
      const encoder = new TextEncoder();
      let i = 0;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (live.current.run !== run || i >= scenario.beats.length) return controller.close();
          const beat = scenario.beats[i++];
          if (beat.wait) await new Promise((r) => setTimeout(r, beat.wait / speed));
          if (live.current.run !== run) return controller.close();
          if (beat.note) note("note", beat.note);
          if (beat.event.t !== "text") note("event", describe(beat.event));
          controller.enqueue(encoder.encode(`${JSON.stringify(beat.event)}\n`));
        },
      });
      return Promise.resolve(new Response(stream, { headers: { "content-type": "application/x-ndjson" } }));
    };
    return () => {
      window.fetch = real;
    };
  }, []);

  // what the saucer does, as the globe reports it
  useEffect(() => {
    const g = globe.current;
    if (!g) return;
    let state = "gone";
    return g.onFrame(() => {
      const spot = g.agentSpot();
      const next = !spot ? "gone" : spot.arrived ? "arrived" : "flying";
      if (next === state) return;
      state = next;
      note("saucer", next === "gone" ? "saucer gone" : next === "arrived" ? "saucer arrived" : "saucer flying");
    });
  }, []);

  // each run starts from the scenario's globe and asks its question
  useEffect(() => {
    if (!run) return;
    const g = globe.current;
    const { before, ask } = live.current.scenario;
    g?.cancel();
    g?.setPins([]);
    if (before.length) {
      pipDates.current = before.map((l) => l.date);
      g?.showTrip([before[0].from, ...before.map((l) => l.to)], "quiet");
    }
    const id = window.setTimeout(() => {
      started.current = performance.now();
      setLog([{ t: 0, kind: "note", text: `asks: “${ask}”` }]);
      pip.current?.ask(ask);
    }, before.length ? 1200 : 300);
    return () => window.clearTimeout(id);
  }, [run]);

  const onLand = (flown: LandedTrip[]) => {
    const dates = pipDates.current;
    pipDates.current = null;
    note("globe", `landed ${flown.length} leg${flown.length === 1 ? "" : "s"}`);
    globe.current?.setPins(flown.map((l, i) => ({ key: `you:${i}`, stop: `stop:${i}`, at: l.destination, color: cursorPref.color })));
    setLegs(flown.map((l, i) => ({ from: stopFromPoint(l.origin, l.from), to: stopFromPoint(l.destination, l.to), date: dates?.[i] ?? "" })));
  };

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <TripGlobe
        ref={globe}
        color={cursorPref.color}
        cursorShape={cursorPref.shape}
        theme={resolvedTheme === "dark" ? "dark" : resolvedTheme === "light" ? "light" : "auto"}
        onLand={onLand}
        onCancel={() => setLegs([])}
      />
      <HomePip
        key={run}
        ref={pip}
        globe={globe}
        account
        trip={legs}
        onTrip={(planned) => {
          pipDates.current = planned.map((l) => l.date);
          globe.current?.showTrip([planned[0].from, ...planned.map((l) => l.to)]);
        }}
      />
      <aside className="pl-panel" data-globe-obstacle aria-label="Pip lab">
        <div className="pg-group" role="group" aria-label="Scenario">
          {SCENARIOS.map((s) => (
            <button key={s.id} type="button" className="pg-chip" aria-pressed={scenario.id === s.id} onClick={() => setScenario(s)}>
              {s.label}
            </button>
          ))}
        </div>
        <p className="pl-tool">
          <code>{scenario.tool}</code> · {scenario.ask}
        </p>
        <div className="pg-group">
          <button type="button" className="pg-chip pl-play" onClick={() => {
              setLegs([]);
              setRun((r) => r + 1);
            }}>
            {run ? "Replay" : "Play"}
          </button>
          {SPEEDS.map((s) => (
            <button key={s} type="button" className="pg-chip" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        <ol className="pl-log">
          {log.map((l, i) => (
            <li key={i} data-kind={l.kind}>
              <span className="pl-t">{(l.t / 1000).toFixed(2)}s</span>
              <span>{l.text}</span>
            </li>
          ))}
        </ol>
      </aside>
    </main>
  );
}
