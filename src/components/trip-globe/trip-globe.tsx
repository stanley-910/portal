"use client";

import { useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type PointerEvent, type Ref } from "react";

import { cursorUrl, memberColor, RoundButton } from "@/components/paper-atlas";
import { cn } from "@/lib/utils";

import { hubPreviewLabel } from "@/lib/transport/hubs/preview";
import type { Hub } from "@/lib/transport/hubs/types";
import { GlobeEngine, type GlobeMode, type LandedTrip, type LatLng } from "./engine";
import type { ThemeId } from "./palette";

export type TripGlobeTheme = ThemeId | "auto";

export interface TripGlobeHandle {
  /** Ends the current trip and returns to the idle globe. */
  cancel(): void;
  /** Where a place is on screen, in CSS px relative to the globe, and whether the globe hides it. */
  project(ll: LatLng): { x: number; y: number; visible: boolean } | null;
  /** Calls `cb` after every frame, for overlays that track places. Returns an unsubscribe function. */
  onFrame(cb: () => void): () => void;
}

export interface TripGlobeProps {
  /** "auto" follows prefers-color-scheme. Default "auto". */
  theme?: TripGlobeTheme;
  /** Called at takeoff, including uncovered points (null). Hub is a local preview, not a route result. */
  onTakeoff?: (from: Hub | null) => void;
  /** Called once the plane touches down. The search for the trip starts here. */
  onLand?: (trip: LandedTrip) => void;
  /** Called when a trip in progress is cancelled, from the globe or through the handle. */
  onCancel?: () => void;
  /**
   * Called when the place under the pointer changes, including when the globe turns under a still pointer.
   * Null once the pointer leaves the globe. Rounded to about 10 m.
   */
  onPointerLatLng?: (ll: LatLng | null) => void;
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
  earthUrl = "/textures/earth.png",
  className,
  ref,
}: TripGlobeProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GlobeEngine | null>(null);
  const [mode, setMode] = useState<GlobeMode>("idle");
  const [from, setFrom] = useState<Hub | null>(null);
  const [preview, setPreview] = useState<Hub | null>(null);
  const [landed, setLanded] = useState<LandedTrip | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const resolved = useResolvedTheme(theme);

  // Latest callbacks, so the engine never needs rebuilding when a parent re-renders.
  const handlers = useRef({ onTakeoff, onLand, onCancel, onPointerLatLng });
  useEffect(() => {
    handlers.current = { onTakeoff, onLand, onCancel, onPointerLatLng };
  });
  const frameListeners = useRef(new Set<() => void>());

  useEffect(() => {
    let lastPointer: LatLng | null = null;
    const engine = new GlobeEngine(rootRef.current!, glRef.current!, hudRef.current!, earthUrl, {
      onModeChange: (m, a) => {
        setMode(m);
        setFrom(a);
        if (m !== "landed") setLanded(null);
        if (m === "flying") handlers.current.onTakeoff?.(a);
      },
      onPreviewChange: setPreview,
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
      onFrame: (cb) => {
        const listeners = frameListeners.current;
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    }),
    [],
  );

  const label =
    mode === "flying"
      ? `Flying from ${from?.city || from?.name || "selected point"}`
      : mode === "landed" && landed
        ? `Trip ${landed.from?.city || landed.from?.name || "selected point"} to ${landed.to?.city || landed.to?.name || "selected point"}`
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
      <output aria-label="Nearby transport hub" aria-live="polite" className="sr-only">
        {preview ? hubPreviewLabel(preview) : ""}
      </output>
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        className="type-meta absolute bottom-(--space-2) left-(--space-2) rounded-tag bg-paper-raised px-(--space-2) text-ink-muted"
        onPointerDown={stop}
        onPointerUp={stop}
      >
        Hub data: OurAirports · Wikidata · © OpenStreetMap contributors
      </a>
      {mode === "flying" ? (
        <div className="absolute top-6 right-6" onPointerDown={stop} onPointerUp={stop}>
          <RoundButton label="Cancel trip" onClick={() => engineRef.current?.cancel()} />
        </div>
      ) : null}
      {unsupported ? (
        <p className="type-body absolute inset-x-0 top-1/2 text-center text-ink-muted">This browser cannot draw the globe.</p>
      ) : null}
    </div>
  );
}
