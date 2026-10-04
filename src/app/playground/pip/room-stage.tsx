"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { Launcher } from "@/components/agent/agent-chat";
import { PipSaucer, type PipSaucerHandle } from "@/components/agent/pip-saucer";
import type { GlobePin, RemoteFlight, TripGlobeHandle } from "@/components/trip-globe";

import type { RoomEvent, RoomLeg, RoomScript } from "./room-scenarios";

// A trip room as the lab plays it: the script stands in for the room, and this does what the room's components do
// with it. Stored legs go on the globe as routes (RemotePlanes, storedFlights), a pin per rider where each leg ends
// (RiderPins), and Pip's presence and marks drive its saucer (PipCursor). Pip's launcher shows it leave and come back.

const flightsOf = (script: RoomScript, legs: RoomLeg[]): RemoteFlight[] =>
  legs.flatMap((leg) => {
    const from = script.stops[leg.from];
    const to = script.stops[leg.to];
    if (!from || !to) return [];
    const at = { lat: to.lat, lng: to.lng };
    const ahead = { lat: at.lat + (at.lat - from.lat) * 0.01, lng: at.lng + (at.lng - from.lng) * 0.01 };
    return [{ id: `leg:${leg.id}`, origin: { lat: from.lat, lng: from.lng }, at, ahead, landed: true, color: script.members[leg.by].color - 1 }];
  });

const pinsOf = (script: RoomScript, legs: RoomLeg[]): GlobePin[] => {
  const seen = new Set<string>();
  const pins: GlobePin[] = [];
  for (const leg of legs) {
    const to = script.stops[leg.to];
    for (const rider of leg.riders) {
      const key = `${leg.to}:${rider}`;
      if (!to || seen.has(key)) continue;
      seen.add(key);
      pins.push({ key, stop: leg.to, at: { lat: to.lat, lng: to.lng }, color: script.members[rider].color - 1 });
    }
  }
  return pins;
};

export const describeRoom = (e: RoomEvent): string => {
  switch (e.t) {
    case "presence":
      return e.activity ? `presence: ${e.activity}${e.at ? ` @ ${e.at.lat.toFixed(1)},${e.at.lng.toFixed(1)}` : ""}` : "presence: off";
    case "legs":
      return `legs: ${e.legs.map((l) => `${l.from} → ${l.to} (${l.riders.join(", ")})`).join("; ")}`;
    case "marks":
      return `marks: ${e.marks.map((m) => m.text).join(" | ")}`;
    default:
      return e.t;
  }
};

export function RoomStage({ globe, script, run, speed, onStart, onEvent }: {
  globe: RefObject<TripGlobeHandle | null>;
  script: RoomScript;
  run: number;
  speed: number;
  /** The question goes in: the log's clock starts. */
  onStart: () => void;
  onEvent: (note: string | undefined, event: RoomEvent) => void;
}) {
  const saucer = useRef<PipSaucerHandle>(null);
  const [presence, setPresence] = useState<{ activity: string | null; at: { lat: number; lng: number } | null }>({ activity: null, at: null });
  const latest = useRef({ script, speed, onStart, onEvent });
  useEffect(() => {
    latest.current = { script, speed, onStart, onEvent };
  });

  // each run puts the trip as it was on the globe, then plays the script
  useEffect(() => {
    const g = globe.current;
    const { script } = latest.current;
    g?.cancel();
    g?.setRemoteFlights(flightsOf(script, script.before));
    g?.setPins(pinsOf(script, script.before));
    if (!run) return;
    const timers: number[] = [];
    let t = 1200;
    timers.push(window.setTimeout(() => latest.current.onStart(), t));
    for (const beat of script.beats) {
      t += beat.wait / latest.current.speed;
      timers.push(
        window.setTimeout(() => {
          const e = beat.event;
          latest.current.onEvent(beat.note, e);
          if (e.t === "presence") setPresence({ activity: e.activity, at: e.at ?? null });
          else if (e.t === "legs") {
            globe.current?.setRemoteFlights(flightsOf(script, e.legs));
            globe.current?.setPins(pinsOf(script, e.legs));
          } else if (e.t === "marks") saucer.current?.play(e.marks);
        }, t),
      );
    }
    return () => {
      for (const id of timers) window.clearTimeout(id);
      setPresence({ activity: null, at: null });
    };
  }, [globe, run]);

  useEffect(() => () => {
    globe.current?.setRemoteFlights([]);
    globe.current?.setPins([]);
  }, [globe]);

  return (
    <>
      <PipSaucer ref={saucer} globe={globe} at={presence.at} busy={!!presence.activity} />
      <Launcher unread={false} onOpen={() => {}} />
    </>
  );
}
