"use client";

import { useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type PointerEvent, type Ref } from "react";

import { cursorUrl, memberColor, RoundButton } from "@/components/paper-atlas";
import { cn } from "@/lib/utils";

import type { Airport } from "./airports";
import { GlobeEngine, type FlightState, type GlobeMode, type LandedTrip, type LatLng, type RemoteFlight } from "./engine";
import type { ThemeId } from "./palette";

export type TripGlobeTheme = ThemeId | "auto";

export interface TripGlobeHandle {
  /** Ends the current trip and returns to the idle globe. */
  cancel(): void;
  /** Where a place is on screen, in CSS px relative to the globe, and whether the globe hides it. */
  project(ll: LatLng): { x: number; y: number; visible: boolean } | null;
  /** Calls `cb` after every frame, for overlays that track places. Returns an unsubscribe function. */
  onFrame(cb: () => void): () => void;
  /** Draws other members' planes and routes. Replaces the previous list; planes ease toward new positions. */
  setRemoteFlights(flights: RemoteFlight[]): void;
  /** Where another member's plane is on screen, for their name label. Null when hidden or not flying. */
  remotePlane(id: string): { x: number; y: number } | null;
  /** How far the view is zoomed in: 0 for the whole globe, 1 at the closest range. */
  zoom(): number;
}

export interface TripGlobeProps {
  /** "auto" follows prefers-color-scheme. Default "auto". */
  theme?: TripGlobeTheme;
  /** Called when a trip starts: the plane takes off from the airport nearest the click. */
  onTakeoff?: (from: Airport) => void;
  /** Called once the plane touches down. The search for the trip starts here. */
  onLand?: (trip: LandedTrip) => void;
  /** Called when a trip in progress is cancelled, from the globe or through the handle. */
  onCancel?: () => void;
  /**
   * Called when the place under the pointer changes, including when the globe turns under a still pointer.
   * Null once the pointer leaves the globe. Rounded to about 10 m.
   */
  onPointerLatLng?: (ll: LatLng | null) => void;
  /** Called when this viewer's trip changes: takeoff, every move of the plane, landing, cancel (null). Rounded. */
  onFlightChange?: (flight: FlightState | null) => void;
  /** Seeds the generated sky. Leave it out for a new sky on every load; pass a trip's seed to share one sky. */
  skySeed?: string | number;
  /** The 2D earth data texture (land mask, coast distance, relief). */
  earthUrl?: string;
  className?: string;
  ref?: Ref<TripGlobeHandle>;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";
function subscribeSystemTheme(onChange: () => void) {
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function useResolvedTheme(theme: TripGlobeTheme): ThemeId {
  const systemDark = useSyncExternalStore(
    subscribeSystemTheme,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );
  return theme === "auto" ? (systemDark ? "dark" : "light") : theme;
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;
const roundLatLng = (ll: LatLng | null): LatLng | null => (ll ? { lat: round4(ll.lat), lng: round4(ll.lng) } : null);
const roundFlight = (f: FlightState | null): FlightState | null =>
  f && { origin: roundLatLng(f.origin)!, at: roundLatLng(f.at)!, ahead: roundLatLng(f.ahead)!, landed: f.landed };
const sameLatLng = (a: LatLng | null, b: LatLng | null) => a === b || (!!a && !!b && a.lat === b.lat && a.lng === b.lng);

/**
 * The globe screen's canvas: click to take off, move to fly, click to land, drag to turn.
 * Owns its WebGL and overlay canvases; place the Ticket and any results beside it.
 */
export function TripGlobe({
  theme = "auto",
  onTakeoff,
  onLand,
  onCancel,
  onPointerLatLng,
  onFlightChange,
  earthUrl = "/textures/earth.png",
  skySeed,
  className,
  ref,
}: TripGlobeProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GlobeEngine | null>(null);
  const [mode, setMode] = useState<GlobeMode>("idle");
  const [from, setFrom] = useState<Airport | null>(null);
  const [landed, setLanded] = useState<LandedTrip | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const resolved = useResolvedTheme(theme);

  // Latest callbacks, so the engine never needs rebuilding when a parent re-renders.
  const handlers = useRef({ onTakeoff, onLand, onCancel, onPointerLatLng, onFlightChange });
  useEffect(() => {
    handlers.current = { onTakeoff, onLand, onCancel, onPointerLatLng, onFlightChange };
  });
  const frameListeners = useRef(new Set<() => void>());

  useEffect(() => {
    let lastPointer: LatLng | null = null;
    let lastFlight = "null";
    const engine = new GlobeEngine(rootRef.current!, glRef.current!, hudRef.current!, earthUrl, {
      onModeChange: (m, a) => {
        setMode(m);
        setFrom(a);
        if (m !== "landed") setLanded(null);
        if (m === "flying" && a) handlers.current.onTakeoff?.(a);
      },
      onLand: (trip) => {
        setLanded(trip);
        handlers.current.onLand?.(trip);
      },
      onCancel: () => handlers.current.onCancel?.(),
      onFrame: () => {
        const ll = roundLatLng(engine.pointerLatLng());
        if (!sameLatLng(ll, lastPointer)) {
          lastPointer = ll;
          handlers.current.onPointerLatLng?.(ll);
        }
        const flight = roundFlight(engine.flight());
        const key = JSON.stringify(flight);
        if (key !== lastFlight) {
          lastFlight = key;
          handlers.current.onFlightChange?.(flight);
        }
        for (const cb of frameListeners.current) cb();
      },
    });
    if (!engine.start()) setUnsupported(true);
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [earthUrl]);

  useEffect(() => {
    engineRef.current?.setTheme(resolved);
  }, [resolved]);

  useEffect(() => {
    if (skySeed !== undefined) engineRef.current?.setSkySeed(skySeed);
  }, [skySeed]);

  // set after hydration: the cursor image depends on the client's theme
  useEffect(() => {
    if (rootRef.current)
      rootRef.current.style.cursor = mode === "flying" ? "none" : cursorUrl("arrow", memberColor(0), resolved);
  }, [mode, resolved]);

  useImperativeHandle(
    ref,
    () => ({
      cancel: () => engineRef.current?.cancel(),
      project: (ll) => engineRef.current?.project(ll) ?? null,
      setRemoteFlights: (flights) => engineRef.current?.setRemoteFlights(flights),
      remotePlane: (id) => engineRef.current?.remotePlane(id) ?? null,
      onFrame: (cb) => {
        const listeners = frameListeners.current;
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      zoom: () => engineRef.current?.zoom() ?? 0,
    }),
    [],
  );

  const label =
    mode === "flying" && from
      ? `Flying from ${from.city}`
      : mode === "landed" && landed
        ? `Trip ${landed.from.city} to ${landed.to.city}`
        : "Globe";

  const stop = (e: PointerEvent) => e.stopPropagation();

  return (
    <div
      ref={rootRef}
      className={cn("relative h-full w-full touch-none overflow-hidden bg-paper select-none", className)}
      onPointerDown={(e) => engineRef.current?.pointerDown(e.nativeEvent)}
      onPointerMove={(e) => engineRef.current?.pointerMove(e.nativeEvent)}
      onPointerUp={(e) => engineRef.current?.pointerUp(e.nativeEvent)}
      onPointerCancel={(e) => engineRef.current?.pointerUp(e.nativeEvent)}
      onPointerLeave={() => engineRef.current?.pointerLeave()}
    >
      <canvas ref={glRef} role="img" aria-label={label} className="absolute inset-0 block size-full" />
      <canvas ref={hudRef} aria-hidden className="pointer-events-none absolute inset-0 block size-full" />
      {mode === "flying" ? (
        <div className="absolute top-24 right-6" onPointerDown={stop} onPointerUp={stop}>
          <RoundButton label="Cancel trip" onClick={() => engineRef.current?.cancel()} />
        </div>
      ) : null}
      {unsupported ? (
        <p className="type-body absolute inset-x-0 top-1/2 text-center text-ink-muted">This browser cannot draw the globe.</p>
      ) : null}
    </div>
  );
}
