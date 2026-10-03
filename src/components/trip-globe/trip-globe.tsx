"use client";

import { useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type Ref } from "react";

import { cursorUrl, memberColor, type CursorShape } from "@/components/paper-atlas";
import { cn } from "@/lib/utils";

import type { Hub } from "@/lib/transport/hubs/types";
import { GlobeEngine, type AgentSpot, type FlightState, type GlobeCursor, type GlobeMode, type GlobePin, type LandedTrip, type LatLng, type RemoteFlight } from "./engine";
import { openArea } from "./free-area";
import type { ThemeId } from "./palette";

export type TripGlobeTheme = ThemeId | "auto";

export interface TripGlobeHandle {
  /** Ends the current trip and returns to the idle globe. */
  cancel(): void;
  /** Where a place is on screen, in CSS px relative to the globe, and whether the globe hides it. */
  project(ll: LatLng): { x: number; y: number; visible: boolean } | null;
  /** Where a route's drawn arc is on screen, `t` of the way along (0.5, its peak, by default). */
  routePoint(from: LatLng, to: LatLng, t?: number): { x: number; y: number; visible: boolean } | null;
  /** Lands a whole trip at once, stops in order, as if it had been flown; onLand reports it. */
  showTrip(points: LatLng[]): void;
  /** Calls `cb` after every frame, for overlays that track places. Returns an unsubscribe function. */
  onFrame(cb: () => void): () => void;
  /** Draws other members' planes and routes. Replaces the previous list; planes move steadily between updates. */
  setRemoteFlights(flights: RemoteFlight[]): void;
  /** Other members' pointers, by id; null `at` hides one. Replaces the previous list. Their shadows are drawn here. */
  setRemoteCursors(cursors: { id: string; at: LatLng | null }[]): void;
  /** Where another member's pointer is on screen and the matrix [a, b, c, d] that lays it on the ground there. */
  remoteCursor(id: string): { x: number; y: number; lie: [number, number, number, number] } | null;
  /**
   * The pins at the trip's stops, one per rider arriving. Replaces the previous list: new pins drop in, after your
   * own plane has landed and gone when it's landing.
   */
  setPins(pins: GlobePin[]): void;
  /** Where the pins at a stop stand on screen: the middle of their heads and a radius round them. Null when hidden. */
  pinSpot(stop: string): { x: number; y: number; r: number } | null;
  /** Where another member's plane is on screen, for their name label. Null when hidden or not flying. */
  remotePlane(id: string): { x: number; y: number } | null;
  /** How far the view is zoomed in: 0 for the whole globe, 1 at the closest range. */
  zoom(): number;
  /** Turns the globe to centre a place, framing `spanDeg` degrees of arc around it. A `name` marks and names it there. */
  flyTo(ll: LatLng, spanDeg: number, name?: string): void;
  /** Sends Pip's saucer gliding to a place, or away (null). */
  setAgent(at: LatLng | null): void;
  /** Where Pip's saucer is on screen. Null when it isn't out. */
  agentSpot(): AgentSpot | null;
  /**
   * Turns the view to follow Pip's saucer. Dragging, scrolling or pinching the globe stops it and calls `onEnd`;
   * zooming doesn't.
   */
  followAgent(on: boolean, onEnd?: () => void): void;
}

export interface TripGlobeProps {
  /** "auto" follows prefers-color-scheme. Default "auto". */
  theme?: TripGlobeTheme;
  /** Called at takeoff, including uncovered points (null). Hub is a local preview, not a route result. */
  onTakeoff?: (from: Hub | null) => void;
  /**
   * Called once the plane touches down, with the trip's legs in order. Each click while flying ends a leg and flies
   * on; clicking that stop again (a double click) lands there. The search for the trip starts here.
   */
  onLand?: (legs: LandedTrip[]) => void;
  /** Called when a trip in progress is cancelled, from the globe or through the handle. */
  onCancel?: () => void;
  /** Called on a click on the landed trip's route. That click neither takes off nor cancels. */
  onRouteClick?: () => void;
  /**
   * Called when the place under the pointer changes, including when the globe turns under a still pointer.
   * Null once the pointer leaves the globe. Rounded to about 10 m.
   */
  onPointerLatLng?: (ll: LatLng | null) => void;
  /** Called when this viewer's trip changes: takeoff, every move of the plane, landing, cancel (null). Rounded. */
  onFlightChange?: (flight: FlightState | null) => void;
  /** This viewer's member colour slot (0 for `member-1`): their cursor and route. Default 0. */
  color?: number;
  /** The shape of this viewer's own cursor. Default "arrow". */
  cursorShape?: CursorShape;
  /** Seeds the generated sky. Leave it out for a new sky on every load; pass a trip's seed to share one sky. */
  skySeed?: string | number;
  /** The 2D earth data texture (land mask, coast distance, relief). */
  earthUrl?: string;
  /** The country borders data texture, from `pnpm borders`. */
  bordersUrl?: string;
  /** The province and state borders data texture, from `pnpm provinces`. */
  provincesUrl?: string;
  className?: string;
  ref?: Ref<TripGlobeHandle>;
}

const place = (hub: Hub | null) => hub?.city || hub?.name || "selected point";

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
  f && { origin: roundLatLng(f.origin)!, at: roundLatLng(f.at)!, ahead: roundLatLng(f.ahead)!, landed: f.landed, vehicle: f.vehicle };
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
  onRouteClick,
  onPointerLatLng,
  onFlightChange,
  earthUrl = "/textures/earth.png",
  bordersUrl = "/textures/borders.png",
  provincesUrl = "/textures/provinces.png",
  skySeed,
  color = 0,
  cursorShape = "arrow",
  className,
  ref,
}: TripGlobeProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GlobeEngine | null>(null);
  // the pins last set, so an engine that starts later still gets them
  const pins = useRef<GlobePin[]>([]);
  const [mode, setMode] = useState<GlobeMode>("idle");
  const [from, setFrom] = useState<Hub | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [landed, setLanded] = useState<LandedTrip[] | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [cursor, setCursor] = useState<GlobeCursor>({ lie: { angle: 0, squash: 1 }, offset: [0, 0], marker: null });
  const resolved = useResolvedTheme(theme);

  // Latest callbacks, so the engine never needs rebuilding when a parent re-renders.
  const handlers = useRef({ onTakeoff, onLand, onCancel, onRouteClick, onPointerLatLng, onFlightChange });
  useEffect(() => {
    handlers.current = { onTakeoff, onLand, onCancel, onRouteClick, onPointerLatLng, onFlightChange };
  });
  const frameListeners = useRef(new Set<() => void>());
  const followEnd = useRef<(() => void) | null>(null);

  // While a trip is landed, the page changing (a panel opening, closing, or growing as results arrive) re-frames
  // its route in the space left open. Settled changes only: it waits for the page to be still for a moment.
  useEffect(() => {
    if (mode !== "landed") return;
    let timer = 0;
    const reframe = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => engineRef.current?.reframe(), 200);
    };
    const page = new MutationObserver(reframe);
    page.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", reframe);
    return () => {
      window.clearTimeout(timer);
      page.disconnect();
      window.removeEventListener("resize", reframe);
    };
  }, [mode]);

  useEffect(() => {
    let lastPointer: LatLng | null = null;
    let lastFlight = "null";
    const engine = new GlobeEngine(rootRef.current!, glRef.current!, hudRef.current!, earthUrl, bordersUrl, provincesUrl, {
      onModeChange: (m, a) => {
        setMode(m);
        setFrom(a);
        if (m !== "landed") setLanded(null);
        if (m === "flying") handlers.current.onTakeoff?.(a);
      },
      onPreviewChange: (_hub, name) => setPreview(name),
      onCursorChange: setCursor,
      onLand: (legs) => {
        setLanded(legs);
        handlers.current.onLand?.(legs);
      },
      onCancel: () => {
        // Clear the rendered route as part of cancellation, not only through the mode-change callback.
        // This keeps the map clear when a cancel is triggered by an overlay or imperative handle.
        setLanded(null);
        handlers.current.onCancel?.();
      },
      onRouteClick: () => handlers.current.onRouteClick?.(),
      onFollowEnd: () => followEnd.current?.(),
      // routes are framed in the space the page leaves open: a point is covered when what's on top there isn't the
      // globe. Pass-through overlays (pointer-events: none) like cursors and labels don't count, nor do cards that
      // ride on the route itself (data-globe-follow), which would otherwise push the route away from its own card,
      // nor small floaters that move about on their own, like Pip's launcher (data-globe-float): framing around
      // them made the globe chase Pip as it hopped out of the card's way.
      freeArea: () => {
        const root = rootRef.current!;
        const box = root.getBoundingClientRect();
        return openArea(box.width, box.height, (x, y) => {
          const el = document.elementFromPoint(box.left + x, box.top + y);
          return !!el && !root.contains(el) && !el.closest("[data-globe-follow], [data-globe-float]");
        });
      },
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
    // pins set before the engine started
    if (pins.current.length) engine.setPins(pins.current);
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [earthUrl, bordersUrl, provincesUrl]);

  useEffect(() => {
    engineRef.current?.setTheme(resolved);
  }, [resolved, earthUrl, bordersUrl, provincesUrl]);

  useEffect(() => {
    if (skySeed !== undefined) engineRef.current?.setSkySeed(skySeed);
  }, [skySeed, earthUrl, bordersUrl, provincesUrl]);

  useEffect(() => {
    engineRef.current?.setColor(color);
  }, [color, earthUrl, bordersUrl, provincesUrl]);

  // set after hydration: the cursor image depends on the client's theme
  useEffect(() => {
    if (rootRef.current)
      rootRef.current.style.cursor = mode === "flying" ? "none" : cursorUrl(cursorShape, memberColor(color), resolved, { ...cursor, noShadow: true });
    engineRef.current?.setCursorShape(cursorShape);
  }, [mode, resolved, cursor, color, cursorShape]);

  useImperativeHandle(
    ref,
    () => ({
      cancel: () => engineRef.current?.cancel(),
      project: (ll) => engineRef.current?.project(ll) ?? null,
      routePoint: (from, to, t) => engineRef.current?.routePoint(from, to, t) ?? null,
      setRemoteFlights: (flights) => engineRef.current?.setRemoteFlights(flights),
      setRemoteCursors: (cursors) => engineRef.current?.setRemoteCursors(cursors),
      remoteCursor: (id) => engineRef.current?.remoteCursor(id) ?? null,
      setPins: (list) => {
        pins.current = list;
        engineRef.current?.setPins(list);
      },
      pinSpot: (stop) => engineRef.current?.pinSpot(stop) ?? null,
      remotePlane: (id) => engineRef.current?.remotePlane(id) ?? null,
      onFrame: (cb) => {
        const listeners = frameListeners.current;
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      zoom: () => engineRef.current?.zoom() ?? 0,
      flyTo: (ll, spanDeg, name) => engineRef.current?.flyTo(ll, spanDeg, name),
      showTrip: (points) => engineRef.current?.showTrip(points),
      setAgent: (at) => engineRef.current?.setAgent(at),
      agentSpot: () => engineRef.current?.agentSpot() ?? null,
      followAgent: (on, onEnd) => {
        followEnd.current = on ? (onEnd ?? null) : null;
        engineRef.current?.setFollow(on);
      },
    }),
    [],
  );

  const label =
    mode === "flying"
      ? `Flying from ${place(from)}`
      : mode === "landed" && landed?.length
        ? `Trip ${place(landed[0].from)} to ${place(landed.at(-1)!.to)}${landed.length > 1 ? `, ${landed.length} legs` : ""}`
        : "Globe";

  // While flying, Esc or a right-click puts the plane away. Esc typed into a field stays with the field.
  useEffect(() => {
    if (mode !== "flying") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "Escape" || e.defaultPrevented || t?.closest("input, textarea, select, [contenteditable]")) return;
      engineRef.current?.cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  return (
    <div
      ref={rootRef}
      data-globe-root
      className={cn("relative h-full w-full touch-none overflow-hidden bg-paper select-none", className)}
      onPointerDown={(e) => engineRef.current?.pointerDown(e.nativeEvent)}
      onPointerMove={(e) => engineRef.current?.pointerMove(e.nativeEvent)}
      onPointerUp={(e) => engineRef.current?.pointerUp(e.nativeEvent)}
      onPointerCancel={(e) => engineRef.current?.pointerUp(e.nativeEvent)}
      onPointerLeave={() => engineRef.current?.pointerLeave()}
      onContextMenu={(e) => {
        if (mode !== "flying") return;
        e.preventDefault();
        engineRef.current?.cancel();
      }}
    >
      <canvas ref={glRef} role="img" aria-label={label} className="absolute inset-0 block size-full" />
      <canvas ref={hudRef} aria-hidden className="pointer-events-none absolute inset-0 block size-full" />
      <output aria-label="Nearby place" aria-live="polite" className="sr-only">
        {preview ?? ""}
      </output>
      {unsupported ? (
        <p className="type-body absolute inset-x-0 top-1/2 text-center text-ink-muted">This browser cannot draw the globe.</p>
      ) : null}
    </div>
  );
}
