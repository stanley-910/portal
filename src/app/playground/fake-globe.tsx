"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";

import { memberColor } from "@/components/paper-atlas";
import type { AgentSpot, GlobePin, LandedTrip, LatLng, RemoteFlight, TripGlobeHandle } from "@/components/trip-globe";
import { nearestPreviewHub } from "@/lib/transport/hubs/preview";
import { distanceKm } from "@/lib/transport/hubs/geo";

// A flat stand-in for <TripGlobe> on the playground: East Asia on paper, no WebGL. It keeps the handle's contract, so
// the real overlays (the ticket card, the route tag, pins, Pip) anchor to it exactly as they do on the globe. Click to
// take off, right-click to drop a stop, click again to land. Esc cancels.

const BOX = { west: 92, east: 148, south: -8, north: 50 };
const COS = Math.cos((21 * Math.PI) / 180);
const LIFT = 0.22; // how far a route's arc bows up, as a share of its length
const PIN_STEM = 20;
const PIN_FAN = 9;
const LAND_SLOP = 14;

const CITIES: { name: string; at: LatLng }[] = [
  { name: "Hong Kong", at: { lat: 22.3036, lng: 114.165 } },
  { name: "Shanghai", at: { lat: 31.196, lng: 121.3161 } },
  { name: "Seoul", at: { lat: 37.4691, lng: 126.451 } },
  { name: "Tokyo", at: { lat: 35.6808, lng: 139.7669 } },
  { name: "Osaka", at: { lat: 34.7336, lng: 135.5 } },
  { name: "Taipei", at: { lat: 25.0777, lng: 121.233 } },
  { name: "Beijing", at: { lat: 39.9042, lng: 116.4074 } },
  { name: "Bangkok", at: { lat: 13.69, lng: 100.75 } },
  { name: "Singapore", at: { lat: 1.3644, lng: 103.9915 } },
  { name: "Manila", at: { lat: 14.5086, lng: 121.0198 } },
  { name: "Hanoi", at: { lat: 21.2212, lng: 105.807 } },
  { name: "Kuala Lumpur", at: { lat: 2.7456, lng: 101.7072 } },
];

type Pt = { x: number; y: number };
type Size = { w: number; h: number };

const fit = ({ w, h }: Size) => {
  const s = Math.min(w / ((BOX.east - BOX.west) * COS), h / (BOX.north - BOX.south));
  return { s, ox: (w - (BOX.east - BOX.west) * COS * s) / 2, oy: (h - (BOX.north - BOX.south) * s) / 2 };
};
const projectIn = (size: Size, ll: LatLng): Pt => {
  const { s, ox, oy } = fit(size);
  return { x: ox + (ll.lng - BOX.west) * COS * s, y: oy + (BOX.north - ll.lat) * s };
};
const unprojectIn = (size: Size, p: Pt): LatLng => {
  const { s, ox, oy } = fit(size);
  return { lat: BOX.north - (p.y - oy) / s, lng: BOX.west + (p.x - ox) / (COS * s) };
};
/** The arc's control point: above the chord's middle, by a share of its length. */
const control = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - Math.hypot(b.x - a.x, b.y - a.y) * LIFT });
const along = (a: Pt, b: Pt, t: number): Pt => {
  const c = control(a, b);
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
};

export interface FakeGlobeProps {
  ref?: Ref<TripGlobeHandle>;
  /** Zoom reported to the nav bar: past 0.18 it goes compact. */
  zoom?: number;
  onTakeoff?: () => void;
  onLand?: (legs: LandedTrip[]) => void;
  onCancel?: () => void;
  /** A click on a landed route: your trip's (no id), or a stored leg's (its flight id, `leg:<id>`). */
  onRouteClick?: (id?: string) => void;
}

function tomorrow(plus: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1 + plus);
  return d;
}

/** Legs between consecutive points, as the globe reports them landed. */
export function landedLegs(points: LatLng[]): LandedTrip[] {
  return points.slice(1).map((to, i) => {
    const from = points[i];
    return {
      from: nearestPreviewHub(from),
      to: nearestPreviewHub(to),
      origin: from,
      destination: to,
      distanceKm: Math.round(distanceKm(from, to)),
      departDate: tomorrow(i),
    };
  });
}

export function FakeGlobe({ ref, zoom = 0, onTakeoff, onLand, onCancel, onRouteClick }: FakeGlobeProps) {
  const box = useRef<HTMLDivElement>(null);
  const size = useRef({ w: 1, h: 1 });
  const frames = useRef(new Set<() => void>());
  const events = useRef({ onTakeoff, onLand, onCancel, onRouteClick, zoom });
  useEffect(() => {
    events.current = { onTakeoff, onLand, onCancel, onRouteClick, zoom };
  });

  // what's drawn; mirrored into refs so the handle reads the latest without re-creating itself
  const [trip, setTrip] = useState<{ points: LatLng[]; landed: boolean } | null>(null);
  const [pointer, setPointer] = useState<Pt | null>(null);
  const [pins, setPinsState] = useState<GlobePin[]>([]);
  const [flights, setFlights] = useState<RemoteFlight[]>([]);
  const [lifted, setLifted] = useState<{ stop: string; at: LatLng } | null>(null);
  const [agent, setAgentState] = useState<LatLng | null>(null);
  const [marker, setMarker] = useState<{ at: LatLng; name: string } | null>(null);
  const [drawn, setDrawn] = useState<Size>({ w: 1, h: 1 });
  const state = useRef({ trip, pins, lifted, agent, flights });
  useLayoutEffect(() => {
    state.current = { trip, pins, lifted, agent, flights };
  });

  const project = (ll: LatLng) => projectIn(size.current, ll);
  const unproject = (p: Pt) => unprojectIn(size.current, p);
  const placeOf = (at: LatLng) => {
    const hub = nearestPreviewHub(at);
    return { at, hub, name: hub?.city || hub?.name || null };
  };
  /** Pins as they stand now: a lifted stop's follow the pointer. */
  const standing = () => {
    const { pins, lifted } = state.current;
    return lifted ? pins.map((p) => (p.stop === lifted.stop ? { ...p, at: lifted.at } : p)) : pins;
  };
  const spot = (stop: string) => {
    const group = standing().filter((p) => p.stop === stop);
    if (!group.length) return null;
    const base = project(group[0].at);
    return { x: base.x, y: base.y - PIN_STEM, r: 12 + ((group.length - 1) * PIN_FAN) / 2 };
  };

  const land = (points: LatLng[]) => {
    setTrip({ points, landed: true });
    events.current.onLand?.(landedLegs(points));
  };

  useImperativeHandle(ref, (): TripGlobeHandle => ({
    cancel() {
      setTrip(null);
      setPointer(null);
      events.current.onCancel?.();
    },
    project: (ll) => ({ ...project(ll), visible: true }),
    routePoint: (from, to, t = 0.5) => ({ ...along(project(from), project(to), t), visible: true }),
    showTrip: (points) => land(points),
    // the flat globe draws every frame anyway
    requestFrame: () => {},
    onFrame(cb) {
      frames.current.add(cb);
      return () => frames.current.delete(cb);
    },
    setRemoteFlights: (list) => setFlights(list),
    setRemoteCursors: () => {},
    remoteCursor: () => null,
    setPins: (list) => setPinsState(list),
    pinSpot: (stop) => spot(stop),
    liftStop(stop, x, y) {
      const place = placeOf(unproject({ x, y: y + PIN_STEM }));
      setLifted({ stop, at: place.at });
      state.current.lifted = { stop, at: place.at };
      return place;
    },
    landing: (stop) => {
      const l = state.current.lifted;
      return l && l.stop === stop ? placeOf(l.at) : null;
    },
    dropStop(stop, at) {
      setLifted(null);
      if (at) setPinsState((list) => list.map((p) => (p.stop === stop ? { ...p, at } : p)));
    },
    placeAt: (x, y) => placeOf(unproject({ x, y })),
    remotePlane: () => null,
    zoom: () => events.current.zoom,
    flyTo(ll, _span, name) {
      setMarker({ at: ll, name: name ?? "" });
    },
    setAgent: (at) => setAgentState(at),
    agentSpot(): AgentSpot | null {
      const at = state.current.agent;
      if (!at) return null;
      const g = project(at);
      return { x: g.x, y: g.y - 48, ground: g, visible: true, arrived: true };
    },
    followAgent: () => {},
    // the flat stand-in draws no legs changing under the saucer
    legState: () => "shown",
    holdForAgent: () => {},
  }));

  // keep the box size, and run every frame callback each frame like the globe does after drawing
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      size.current = { w: el.clientWidth || 1, h: el.clientHeight || 1 };
      setDrawn(size.current);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    let raf = 0;
    const loop = () => {
      frames.current.forEach((cb) => cb());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    if (!marker) return;
    const t = window.setTimeout(() => setMarker(null), 3000);
    return () => window.clearTimeout(t);
  }, [marker]);

  // Esc while flying lands nothing and puts the plane away
  useEffect(() => {
    if (!trip || trip.landed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setTrip(null);
      events.current.onCancel?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [trip]);

  const local = (e: React.PointerEvent | React.MouseEvent): Pt => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const click = (e: React.MouseEvent) => {
    const p = local(e);
    const at = unproject(p);
    if (!trip || trip.landed) {
      // a click on a landed route opens its card again rather than starting over
      if (trip?.landed && onRoute(p, trip.points)) return events.current.onRouteClick?.();
      const stored = state.current.flights.find((f) => f.landed && onRoute(p, [f.origin, f.at]));
      if (stored) return events.current.onRouteClick?.(stored.id);
      setTrip({ points: [at], landed: false });
      events.current.onTakeoff?.();
      return;
    }
    // a click on the stop just left lands there; anywhere else lands the trip where it's clicked
    const last = project(trip.points.at(-1)!);
    if (Math.hypot(p.x - last.x, p.y - last.y) < LAND_SLOP) {
      if (trip.points.length > 1) land(trip.points);
      return;
    }
    land([...trip.points, at]);
  };
  // a right click while flying drops a stop and flies on
  const rightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!trip || trip.landed) return;
    const p = local(e);
    const last = project(trip.points.at(-1)!);
    if (Math.hypot(p.x - last.x, p.y - last.y) < LAND_SLOP) return;
    setTrip({ points: [...trip.points, unproject(p)], landed: false });
  };

  const onRoute = (p: Pt, points: LatLng[]) =>
    points.slice(1).some((to, i) => {
      const a = project(points[i]);
      const b = project(to);
      for (let t = 0; t <= 1; t += 0.05) {
        const q = along(a, b, t);
        if (Math.hypot(q.x - p.x, q.y - p.y) < 10) return true;
      }
      return false;
    });

  const at = (ll: LatLng) => projectIn(drawn, ll);
  const arc = (a: Pt, b: Pt) => {
    const c = control(a, b);
    return `M${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}`;
  };
  const pts = trip?.points.map(at) ?? [];
  const pinsNow = lifted ? pins.map((p) => (p.stop === lifted.stop ? { ...p, at: lifted.at } : p)) : pins;
  const byStop = new Map<string, GlobePin[]>();
  for (const p of pinsNow) byStop.set(p.stop, [...(byStop.get(p.stop) ?? []), p]);
  const { w, h } = drawn;
  const graticule: string[] = [];
  for (let lng = 100; lng <= 140; lng += 10) {
    const a = at({ lat: BOX.north, lng });
    const b = at({ lat: BOX.south, lng });
    graticule.push(`M${a.x},${a.y} L${b.x},${b.y}`);
  }
  for (let lat = 0; lat <= 50; lat += 10) {
    const a = at({ lat, lng: BOX.west });
    const b = at({ lat, lng: BOX.east });
    graticule.push(`M${a.x},${a.y} L${b.x},${b.y}`);
  }

  return (
    <div
      ref={box}
      className="pg-globe absolute inset-0"
      onClick={click}
      onContextMenu={rightClick}
      onPointerMove={(e) => (trip && !trip.landed ? setPointer(local(e)) : undefined)}
    >
      <svg width={w} height={h} className="absolute inset-0" aria-hidden>
        <path d={graticule.join(" ")} className="pg-graticule" />
        {CITIES.map((c) => {
          const p = at(c.at);
          return (
            <g key={c.name}>
              <circle cx={p.x} cy={p.y} r={2.5} className="pg-city" />
              <text x={p.x + 6} y={p.y + 4} className="pg-city-name">
                {c.name}
              </text>
            </g>
          );
        })}
        {flights.map((f) => (
          <path key={f.id} d={arc(at(f.origin), at(f.at))} className="pg-route" style={{ stroke: `var(--${memberColor(f.color ?? 0)})` }} />
        ))}
        {pts.slice(1).map((b, i) => (
          <path key={i} d={arc(pts[i], b)} className="pg-route" />
        ))}
        {trip && !trip.landed && pointer ? <path d={arc(pts.at(-1)!, pointer)} className="pg-route pg-route-live" /> : null}
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={4} className="pg-stop" />
        ))}
        {[...byStop.values()].flatMap((group) =>
          group.map((pin, i) => {
            const base = at(pin.at);
            const x = base.x + (i - (group.length - 1) / 2) * PIN_FAN;
            return (
              <g key={pin.key}>
                <path d={`M${base.x},${base.y} L${x},${base.y - PIN_STEM}`} className="pg-pin-stem" />
                <circle cx={x} cy={base.y - PIN_STEM} r={6} className="pg-pin-head" style={pin.color === null ? undefined : { fill: `var(--${memberColor(pin.color)})` }} />
              </g>
            );
          }),
        )}
        {marker ? (
          <g>
            <circle cx={at(marker.at).x} cy={at(marker.at).y} r={9} className="pg-marker" />
            <text x={at(marker.at).x + 12} y={at(marker.at).y - 10} className="pg-marker-name">
              {marker.name}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}
