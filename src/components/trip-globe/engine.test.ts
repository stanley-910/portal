import { afterEach, describe, expect, it, vi } from "vitest";
import { cursorImageReach } from "@/components/paper-atlas/cursor";
import { GlobeEngine, type GlobeCursor, type GlobeEvents } from "./engine";
import { add, angle, D2R, dot, EARTH_RADIUS_KM, len, mul, norm, slerp, sub, vecOf, type Vec3 } from "./vec";

function engine() {
  const onLand = vi.fn();
  const onModeChange = vi.fn();
  const onPreviewChange = vi.fn();
  const globe = new GlobeEngine({} as HTMLElement, {} as HTMLCanvasElement,
    { getContext: () => ({}) } as unknown as HTMLCanvasElement, "", "", "", { onLand, onModeChange, onPreviewChange });
  return { globe, onLand, onModeChange, onPreviewChange };
}
const point = (lat: number, lng: number) => vecOf(lat * D2R, lng * D2R);

describe("globe hub preview lifecycle", () => {
  it("starts and lands uncovered trips without requiring an airport", () => {
    const { globe, onModeChange, onLand } = engine();
    globe["takeoff"](point(0, -140));
    expect(onModeChange).toHaveBeenCalledWith("flying", null);
    globe["land"](point(5, -140));
    expect(onLand).toHaveBeenCalledWith([expect.objectContaining({ from: null, to: null })]);
    const [trip] = onLand.mock.calls[0][0];
    expect(trip.origin.lng).toBeCloseTo(-140);
    expect(trip.destination.lat).toBeCloseTo(5);
    expect(trip.distanceKm).toBeGreaterThan(550);
  });
  it("preserves precise click points even when a nearby surface hub is previewed", () => {
    const { globe, onLand } = engine();
    globe["takeoff"](point(22.305, 114.165));
    globe["land"](point(31.23, 121.47));
    const [trip] = onLand.mock.calls[0][0];
    expect(trip.from.mode).toBe("train");
    expect(trip.origin.lat).toBeCloseTo(22.305);
    expect(trip.destination.lng).toBeCloseTo(121.47);
  });
  it("lands one leg per stop, each departing a day after the last", () => {
    const { globe, onLand } = engine();
    globe["takeoff"](point(22.305, 114.165));
    globe["addStop"](point(31.23, 121.47));
    globe["addStop"](point(35.68, 139.77));
    expect(onLand).not.toHaveBeenCalled();
    globe["finish"]();
    const legs = onLand.mock.calls[0][0];
    expect(legs).toHaveLength(2);
    expect(legs[0].origin.lat).toBeCloseTo(22.305);
    expect(legs[0].destination.lat).toBeCloseTo(31.23);
    expect(legs[1].origin.lat).toBeCloseTo(31.23);
    expect(legs[1].destination.lng).toBeCloseTo(139.77);
    expect(legs[1].departDate.getTime() - legs[0].departDate.getTime()).toBeGreaterThan(20 * 3600_000);
    globe.cancel();
    expect(globe["via"]).toEqual([]);
  });
  it("snaps each leg's own ends: a stop can be arrived at one hub and left from another", () => {
    const { globe, onLand } = engine();
    const hnd = { id: "airport:HND", mode: "flight" as const, code: "HND", iata: "HND", name: "Haneda", city: "Tokyo", lat: 35.55, lng: 139.79, importance: 3, source: "test" };
    const tokyo = { ...hnd, id: "train:TOKYO", mode: "train" as const, code: "TOKYO", iata: undefined, name: "Tokyo Station", lat: 35.68, lng: 139.77 };
    globe.showTrip([{ lat: 31.23, lng: 121.47 }, { lat: 35.6, lng: 139.7, arrive: hnd, leave: tokyo }, { lat: 34.73, lng: 135.5 }], "quiet");
    const [into, out] = onLand.mock.calls[0][0];
    expect(into.to.id).toBe("airport:HND");
    expect(into.snapped).toEqual({ from: false, to: true });
    expect(out.from.id).toBe("train:TOKYO");
    expect(out.snapped).toEqual({ from: true, to: false });
    expect(out.origin.lat).toBeCloseTo(35.6);
  });
  it("keeps the last stop's snap when a trip is finished there", () => {
    const { globe, onLand } = engine();
    const hnd = { id: "airport:HND", mode: "flight" as const, code: "HND", iata: "HND", name: "Haneda", city: "Tokyo", lat: 35.55, lng: 139.79, importance: 3, source: "test" };
    globe["takeoff"](point(31.23, 121.47));
    globe["addStop"](point(35.55, 139.79), { arrive: hnd, leave: hnd });
    globe["finish"]();
    const [leg] = onLand.mock.calls[0][0];
    expect(leg.to.id).toBe("airport:HND");
    expect(leg.snapped).toEqual({ from: false, to: true });
  });
  it("takes off, stops and lands on the hub it's locked on, snapping each leg's end there", () => {
    const { globe, onLand } = engine();
    const hub = (id: string, lat: number, lng: number) => ({ id: `airport:${id}`, mode: "flight" as const, code: id, iata: id, name: id, city: id, lat, lng, importance: 3, source: "test" });
    const sea = hub("SEA", 47.45, -122.31), hnd = hub("HND", 35.55, 139.79);
    // as clicks locked on SEA, then right-clicked on HND, then a click on open ground
    globe["takeoff"](globe["hubPoint"](sea), false, { leave: sea });
    globe["addStop"](globe["hubPoint"](hnd), { arrive: hnd, leave: hnd });
    globe["land"](point(31.23, 121.47));
    const [into, out] = onLand.mock.calls[0][0];
    expect(into.from.id).toBe("airport:SEA");
    expect(into.origin.lat).toBeCloseTo(47.45);
    expect(into.snapped).toEqual({ from: true, to: true });
    expect(out.snapped).toEqual({ from: true, to: false });
  });
  it("lets go of the start's hub when a leg ends at a hub of another mode", () => {
    const { globe, onLand } = engine();
    const hkg = { id: "airport:HKG", mode: "flight" as const, code: "HKG", iata: "HKG", name: "HKG", city: "Hong Kong", lat: 22.31, lng: 113.92, importance: 3, source: "test" };
    const hongqiao = { ...hkg, id: "train:SHANGHAI-HONGQIAO", mode: "train" as const, code: "SHANGHAI-HONGQIAO", iata: undefined, lat: 31.2, lng: 121.32 };
    globe["takeoff"](globe["hubPoint"](hkg), false, { leave: hkg });
    globe["land"](globe["hubPoint"](hongqiao), { arrive: hongqiao });
    const [leg] = onLand.mock.calls[0][0];
    expect(leg.snapped).toEqual({ from: false, to: true });
    expect(leg.to.id).toBe("train:SHANGHAI-HONGQIAO");
  });
  it("only publishes preview changes, clearing immediately on pointer leave", () => {
    const { globe, onPreviewChange } = engine();
    const hkg = point(22.308, 113.918);
    globe["updatePreview"](hkg, 0);
    globe["updatePreview"](hkg, 100);
    expect(onPreviewChange).toHaveBeenCalledTimes(1);
    expect(onPreviewChange.mock.calls[0][0].iata).toBe("HKG");
    expect(onPreviewChange.mock.calls[0][1]).toBe("Hong Kong");
    globe.pointerLeave();
    expect(onPreviewChange).toHaveBeenLastCalledWith(null, null);
  });
  it("clears moving preview on landing and cancellation", () => {
    const { globe, onPreviewChange } = engine();
    const hkg = point(22.308, 113.918);
    globe["takeoff"](hkg);
    globe["updatePreview"](hkg, 0);
    globe["land"](point(31.23, 121.47));
    expect(onPreviewChange).toHaveBeenLastCalledWith(null, null);
    expect(globe["destinationName"]).toBe("Shanghai");
    globe["updatePreview"](hkg, 100);
    globe.cancel();
    expect(onPreviewChange).toHaveBeenLastCalledWith(null, null);
    expect(globe.getMode()).toBe("idle");
  });
});

type Point = { x: number; y: number; z: number; vis: boolean; w?: Vec3 };
type Camera = { C: Vec3; R: Vec3; U: Vec3; F: Vec3; tan: number; shift: number };
type ArcBuffer = { points: (Point | null)[]; pool: Point[] };
type Internals = {
  gl: WebGL2RenderingContext;
  cam: Camera;
  lon0: number;
  lat0: number;
  range: number;
  rangeTarget: number;
  followRange: number;
  reduceMotion: boolean;
  tLand: number;
  lastInteract: number;
  nameT: number;
  nameSprites: Map<string, HTMLCanvasElement>;
  namesMoving: boolean;
  camera(): Camera;
  resize(): void;
  tick(t: number): void;
  drawGL(): void;
  drawHud(t: number): void;
  onFontsLoaded(): void;
  onMotionChange(e: { matches: boolean }): void;
  surfaceBounds(): [number, number, number, number];
  proj(p: Vec3): Point | null;
  pick(x: number, y: number): Vec3 | null;
  arc(a: Vec3, b: Vec3, lift: number, endAlt: number, buffer: ArcBuffer): (Point | null)[];
};

function context() {
  const methods: Record<string, unknown> = { measureText: (s: string) => ({ width: s.length * 60 }) };
  return new Proxy(methods, {
    get: (o, key: string) => o[key] ?? (o[key] = vi.fn()),
  }) as unknown as CanvasRenderingContext2D;
}

function setup(width = 2560, height = 1440, events: GlobeEvents = {}) {
  const canvas = () => ({ width: 1, height: 1, getContext: () => context() }) as unknown as HTMLCanvasElement;
  const root = {
    clientWidth: width, clientHeight: height,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: root.clientWidth, height: root.clientHeight }),
  };
  vi.stubGlobal("window", { devicePixelRatio: 2 });
  vi.stubGlobal("document", { createElement: canvas });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  const gl = canvas(), hud = canvas();
  const onFrame = vi.fn();
  const engine = new GlobeEngine(root as unknown as HTMLElement, gl, hud, "", "", "", { onFrame, ...events });
  const state = engine as unknown as Internals;
  state.gl = {} as WebGL2RenderingContext;
  state.resize();
  state.cam = state.camera();
  state.reduceMotion = true;
  const drawGL = vi.spyOn(state, "drawGL").mockImplementation(() => {});
  const drawHud = vi.spyOn(state, "drawHud");
  let time = 1000;
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) state.tick(time += 1000 / 60);
  };
  return { engine, state, root, gl, hud, drawGL, drawHud, onFrame, frames };
}

afterEach(() => vi.unstubAllGlobals());

describe("canvas invalidation", () => {
  it("retains settled canvases while multiplayer overlay callbacks keep running", () => {
    const { frames, drawGL, drawHud, onFrame } = setup();
    frames(10);
    drawGL.mockClear();
    drawHud.mockClear();
    onFrame.mockClear();
    frames(120);
    expect(drawGL).not.toHaveBeenCalled();
    expect(drawHud).not.toHaveBeenCalled();
    expect(onFrame).toHaveBeenCalledTimes(120);
  });

  it("redraws for themes, fonts, sky seeds, resize and pixel-ratio changes", () => {
    const { engine, state, root, frames, drawGL, drawHud, gl, hud } = setup();
    frames(10);
    drawGL.mockClear();
    drawHud.mockClear();
    engine.setTheme("dark");
    frames(1);
    expect(drawGL).toHaveBeenCalledTimes(1);
    expect(drawHud).toHaveBeenCalledTimes(1);
    state.onFontsLoaded();
    frames(1);
    expect(drawGL).toHaveBeenCalledTimes(1);
    expect(drawHud).toHaveBeenCalledTimes(2);
    engine.setSkySeed("new sky");
    frames(1);
    expect(drawGL).toHaveBeenCalledTimes(2);
    root.clientWidth = 1920;
    frames(1);
    expect(gl.width).toBe(3840);
    expect(hud.width).toBe(3840);
    const oldSprites = new Set(state.nameSprites.values());
    window.devicePixelRatio = 1;
    frames(1);
    expect(gl.width).toBe(1920);
    expect(hud.width).toBe(1920);
    expect([...state.nameSprites.values()].some((s) => oldSprites.has(s))).toBe(false);
    expect(drawGL).toHaveBeenCalledTimes(4);
  });

  it("updates hover without repainting GL, and clears the ring on pointer leave", () => {
    const { engine, frames, drawGL, drawHud } = setup();
    frames(10);
    drawGL.mockClear();
    drawHud.mockClear();
    engine.pointerMove({ clientX: 1280, clientY: 650 } as PointerEvent);
    frames(1);
    expect(drawGL).not.toHaveBeenCalled();
    expect(drawHud).toHaveBeenCalledTimes(1);
    frames(10);
    expect(drawHud).toHaveBeenCalledTimes(1);
    engine.pointerLeave();
    frames(1);
    expect(drawHud).toHaveBeenCalledTimes(2);
  });

  it("drops the ground ring and peels the cursor off the globe as it leaves", () => {
    const changes: GlobeCursor[] = [];
    const { engine, state, frames } = setup(2560, 1440, { onCursorChange: (c) => changes.push(c) });
    state.reduceMotion = false;
    frames(10);
    engine.pointerMove({ clientX: 1280, clientY: 650 } as PointerEvent);
    frames(5);
    expect(changes.at(-1)?.marker).not.toBeNull();
    expect(state.pick(40, 650)).toBeNull();
    engine.pointerMove({ clientX: 40, clientY: 650 } as PointerEvent);
    const before = changes.length;
    frames(10);
    const peel = changes.slice(before);
    expect(peel.every((c) => c.marker === null)).toBe(true);
    // drawn out leftward, away from the globe, as it snaps back
    expect(peel.some((c) => c.pull?.angle === 180 && c.pull.gap > 0)).toBe(true);
    frames(20);
    expect(changes.at(-1)).toEqual({ lie: { angle: 0, squash: 1 }, offset: [0, 0], marker: null, pull: null });
  });

  it("pulls the cursor off the globe like taffy, its near end stuck, and draws it back in on the way home", () => {
    const changes: GlobeCursor[] = [];
    const { engine, state, frames } = setup(2560, 1440, { onCursorChange: (c) => changes.push(c) });
    state.reduceMotion = false;
    frames(10);
    // the globe's edges along this row
    let left = 1280;
    while (state.pick(left - 1, 650)) left--;
    let right = 1280;
    while (state.pick(right + 1, 650)) right++;
    const at = (x: number, n = 5) => {
      engine.pointerMove({ clientX: x, clientY: 650 } as PointerEvent);
      frames(n);
      return changes.at(-1)!;
    };
    const rest = { lie: { angle: 0, squash: 1 }, offset: [0, 0], marker: null, pull: null };
    at(1280);
    expect(at(left + 2).lie.squash).toBeLessThan(1);
    // off the left edge it's drawn out leftward as far as the pointer has gone, still lying fairly flat
    const a = at(left - 4);
    const b = at(left - 20);
    expect(a.pull).toMatchObject({ angle: 180 });
    expect(a.pull!.gap).toBeGreaterThanOrEqual(3);
    expect(b.pull!.gap).toBeGreaterThanOrEqual(19);
    expect(b.pull!.flat).toBeLessThan(1);
    expect(b.offset).toEqual([0, 0]);
    // far enough out it tears free and snaps back under the pointer
    at(left - 40, 30);
    expect(changes.at(-1)).toEqual(rest);
    // coming back, it doesn't stick until it's on the globe again; near the edge it leans in toward it
    expect(at(left - 20)).toEqual(rest);
    const near = at(left - 3);
    expect(near.pull).toBeNull();
    expect(near.offset[0]).toBeGreaterThan(0);
    expect(near.lie.squash).toBeGreaterThan(1);
    // and on landing it settles flat onto the ground under the pointer
    const landed = at(left + 12, 30);
    expect(landed.offset).toEqual([0, 0]);
    expect(landed.marker).not.toBeNull();
    expect(landed.lie.squash).toBeLessThan(1);
    // off the right edge it's drawn out rightward
    at(right - 2);
    const off = at(right + 16).pull!;
    expect(off.angle).toBe(0);
    expect(off.gap).toBeGreaterThanOrEqual(15);
  });

  it("draws the cursor plain only where its image would cross the window's edge, where Chromium would hide it", () => {
    const changes: GlobeCursor[] = [];
    // a small window: the globe's right edge comes close to the window's
    const { engine, state, frames } = setup(300, 300, { onCursorChange: (c) => changes.push(c) });
    const sized = (w: number) => vi.stubGlobal("window", { devicePixelRatio: 2, innerWidth: w, innerHeight: 300 });
    sized(300);
    state.reduceMotion = false;
    frames(5);
    let right = 150;
    while (state.pick(right + 1, 136)) right++;
    const at = (x: number) => {
      engine.pointerMove({ clientX: x, clientY: 136 } as PointerEvent);
      frames(5);
      return changes.at(-1)!;
    };
    // on the globe near its edge it lies on the ground with its ring
    const inside = at(right - 2);
    expect(inside.marker).not.toBeNull();
    expect(inside.lie.squash).toBeLessThan(1);
    // pulled off the right side it reaches back toward the globe, hardly right of the pointer, so with the window's
    // edge 30 px away it still stretches
    expect(300 - (right + 10)).toBeGreaterThan(25);
    expect(at(right + 10).pull).not.toBeNull();
    // with the window's edge just past the globe's, all the way off it's either small enough for Chromium to show
    // anyway, or plain, or inside the window
    at(right - 2);
    const w = right + 24;
    sized(w);
    let plain = 0;
    for (let x = right + 1; x < right + 22; x++) {
      const c = at(x);
      const reach = cursorImageReach("arrow", { ...c, noShadow: true });
      expect(!reach.big || (x - reach.left >= 0 && x + reach.right <= w)).toBe(true);
      if (!c.pull) plain++;
    }
    expect(plain).toBeGreaterThan(0);
  });

  it("holds the plane to a new stop like a magnet: a small nudge lands there, a bigger move flies on", () => {
    const onLand = vi.fn();
    const { engine, state, frames } = setup(2560, 1440, { onLand });
    frames(5);
    const move = (x: number, y: number) => engine.pointerMove({ clientX: x, clientY: y, pointerId: 1, pointerType: "mouse" } as PointerEvent);
    const down = (x: number, y: number, button = 0) =>
      engine.pointerDown({ clientX: x, clientY: y, button, pointerId: 1, pointerType: "mouse" } as PointerEvent);
    const plane = () => (engine as unknown as { pl: { n: Vec3 } }).pl.n;
    (engine as unknown as { takeoff(v: Vec3): void })["takeoff"](state.pick(1080, 650)!);
    move(1280, 650);
    frames(30);
    // a right click drops the stop
    down(1280, 650, 2); // drops a stop
    const stop = state.pick(1280, 650)!;
    move(1305, 650);
    frames(5);
    // 25 px off, the plane is still at the stop, leaning only a little toward the pointer
    expect(angle(plane(), stop)).toBeLessThan(angle(state.pick(1305, 650)!, stop) * 0.3);
    down(1305, 650);
    expect(onLand).toHaveBeenCalledTimes(1);
    expect(onLand.mock.calls[0][0]).toHaveLength(1);
  });

  it("lets the plane go once the pointer pulls far enough from the stop", () => {
    const onLand = vi.fn();
    const { engine, state, frames } = setup(2560, 1440, { onLand });
    frames(5);
    const move = (x: number, y: number) => engine.pointerMove({ clientX: x, clientY: y, pointerId: 1, pointerType: "mouse" } as PointerEvent);
    const down = (x: number, y: number, button = 0) =>
      engine.pointerDown({ clientX: x, clientY: y, button, pointerId: 1, pointerType: "mouse" } as PointerEvent);
    const plane = () => (engine as unknown as { pl: { n: Vec3 } }).pl.n;
    (engine as unknown as { takeoff(v: Vec3): void })["takeoff"](state.pick(1080, 650)!);
    move(1280, 650);
    frames(30);
    // a right click drops the stop
    down(1280, 650, 2);
    const stop = state.pick(1280, 650)!;
    move(1380, 650);
    frames(5);
    // 100 px off, the plane has left the stop and is back under the pointer
    expect(angle(plane(), stop)).toBeGreaterThan(angle(state.pick(1380, 650)!, stop) * 0.9);
    down(1380, 650, 2); // another stop, not a landing
    expect(onLand).not.toHaveBeenCalled();
    expect(engine["mode"]).toBe("flying");
    // a plain click lands the trip there, with both stops
    move(1480, 650);
    frames(30);
    down(1480, 650);
    expect(onLand).toHaveBeenCalledTimes(1);
    expect(onLand.mock.calls[0][0]).toHaveLength(3);
  });

  it("lands a one-leg trip on the first click after takeoff, and ignores right clicks before it flies", () => {
    const onLand = vi.fn();
    const { engine, state, frames } = setup(2560, 1440, { onLand });
    frames(5);
    const at = { clientX: 1280, clientY: 650, pointerId: 1, pointerType: "mouse" };
    engine.pointerDown({ ...at, button: 2 } as PointerEvent);
    expect(engine["mode"]).toBe("idle");
    (engine as unknown as { takeoff(v: Vec3): void })["takeoff"](state.pick(1080, 650)!);
    engine.pointerMove({ ...at } as PointerEvent);
    frames(30);
    engine.pointerDown({ ...at, button: 0 } as PointerEvent);
    expect(onLand).toHaveBeenCalledTimes(1);
    expect(onLand.mock.calls[0][0]).toHaveLength(1);
  });

  it("follows Pip in close from the whole globe, and never pulls back out from closer", () => {
    const { engine, state } = setup(2560, 1440);
    const whole = state.rangeTarget;
    engine.setFollow(true);
    // a regional view, not halfway: Pip reads at a glance (the view eases there as it follows)
    expect(state.followRange).toBeLessThan(whole / 4);
    const regional = state.followRange;
    engine.setFollow(false);
    state.rangeTarget = regional / 2;
    engine.setFollow(true);
    expect(state.followRange).toBe(regional / 2);
  });

  it("treats a click on a saved leg's route as a route click, not a takeoff", () => {
    const onRouteClick = vi.fn();
    const { engine, state, frames } = setup(2560, 1440, { onRouteClick });
    frames(5);
    const ll = (v: Vec3) => ({ lat: Math.asin(v[1]) / D2R, lng: Math.atan2(v[0], v[2]) / D2R });
    const from = ll(state.pick(1180, 650)!);
    const to = ll(state.pick(1480, 650)!);
    engine.setRemoteFlights([{ id: "leg:1", origin: from, at: to, ahead: to, landed: true }]);
    frames(30);
    const mid = engine.routePoint(from, to)!;
    expect(mid.visible).toBe(true);
    engine.pointerDown({ clientX: mid.x, clientY: mid.y, button: 0, pointerId: 1, pointerType: "mouse" } as PointerEvent);
    engine.pointerUp({ clientX: mid.x, clientY: mid.y, button: 0, pointerId: 1, pointerType: "mouse", type: "pointerup" } as PointerEvent);
    expect(onRouteClick).toHaveBeenCalledWith("leg:1");
    expect(engine["mode"]).toBe("idle");
  });

  it("opens the landed trip from a click on its route instead of cancelling or taking off", () => {
    const onRouteClick = vi.fn();
    const onCancel = vi.fn();
    const { engine, state, frames } = setup(2560, 1440, { onRouteClick, onCancel });
    frames(5);
    const a = state.pick(1180, 650)!;
    const b = state.pick(1480, 650)!;
    (engine as unknown as { takeoff(v: Vec3): void })["takeoff"](a);
    (engine as unknown as { land(v: Vec3): void })["land"](b);
    frames(5);
    const click = (x: number, y: number) => {
      engine.pointerDown({ clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: "mouse" } as PointerEvent);
      engine.pointerUp({ clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: "mouse", type: "pointerup" } as PointerEvent);
    };
    const mid = state.proj(slerp(a, b, 0.5))!;
    click(mid.x, mid.y);
    expect(onRouteClick).toHaveBeenCalledWith(undefined);
    expect(engine["mode"]).toBe("landed");
    // well off the route, a click on the globe still takes off again
    click(mid.x, mid.y + 200);
    expect(onRouteClick).toHaveBeenCalledTimes(1);
    expect(engine["mode"]).toBe("flying");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("redraws only the HUD when the 80ms surface-hub cache catches up under a still pointer", () => {
    const { engine, state, frames, drawGL, drawHud } = setup();
    frames(10);
    const pick = vi.spyOn(state, "pick").mockReturnValue(point(22.308, 113.918));
    engine.pointerMove({ clientX: 1280, clientY: 650 } as PointerEvent);
    frames(1);
    expect(engine["hoverHub"]?.iata).toBe("HKG");
    drawGL.mockClear();
    drawHud.mockClear();
    pick.mockReturnValue(point(22.305, 114.165));
    frames(1);
    expect(engine["hoverHub"]?.iata).toBe("HKG");
    expect(drawHud).not.toHaveBeenCalled();
    frames(5);
    expect(engine["hoverHub"]?.mode).toBe("train");
    expect(drawGL).not.toHaveBeenCalled();
    expect(drawHud).toHaveBeenCalledTimes(1);
    frames(10);
    expect(drawHud).toHaveBeenCalledTimes(1);
  });

  it("keeps idle drift and zoom live, and keeps the label clock current while retained", () => {
    const { engine, state, frames, drawGL } = setup();
    frames(120);
    const nameT = state.nameT;
    frames(1);
    expect(state.nameT - nameT).toBeCloseTo(1 / 60);
    state.onMotionChange({ matches: false });
    drawGL.mockClear();
    frames(10);
    expect(drawGL).toHaveBeenCalledTimes(10);
    state.onMotionChange({ matches: true });
    engine.zoomAt(1280, 650, 0.8);
    frames(1);
    expect(state.range).toBeCloseTo(2.4 * 0.8);
    expect(drawGL).toHaveBeenCalledTimes(11);
  });

  it("redraws when remote trips arrive, move, land or leave", () => {
    const { engine, frames, drawGL } = setup();
    frames(10);
    drawGL.mockClear();
    const flight = {
      id: "friend", origin: { lat: 22, lng: 114 }, at: { lat: 30, lng: 121 },
      ahead: { lat: 31, lng: 122 }, landed: false,
    };
    engine.setRemoteFlights([flight]);
    frames(1);
    engine.setRemoteFlights([{ ...flight, at: { lat: 36, lng: 140 } }]);
    frames(1);
    engine.setRemoteFlights([{ ...flight, landed: true }]);
    frames(1);
    engine.setRemoteFlights([]);
    frames(1);
    expect(drawGL).toHaveBeenCalledTimes(4);
  });
});

describe("surface scissor", () => {
  it("contains visible surface samples at every zoom, including tilted and portrait views", () => {
    for (const [width, height] of [[2560, 1440], [1440, 2560], [800, 800]]) {
      const { state, gl } = setup(width, height);
      for (const range of [2.4, 1.6, 0.9, 0.6, 0.4, 0.2]) {
        for (const lat of [-1.25, 0, 1.25]) {
          state.range = range;
          state.lat0 = lat;
          state.cam = state.camera();
          const [x, y, w, h] = state.surfaceBounds();
          expect(x).toBeGreaterThanOrEqual(0);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(x + w).toBeLessThanOrEqual(gl.width);
          expect(y + h).toBeLessThanOrEqual(gl.height);
          for (let py = 0.5; py < height; py += height / 50) {
            for (let px = 0.5; px < width; px += width / 50) {
              if (!state.pick(px, py)) continue;
              expect(px * 2).toBeGreaterThanOrEqual(x);
              expect(px * 2).toBeLessThan(x + w);
              expect(gl.height - py * 2).toBeGreaterThanOrEqual(y);
              expect(gl.height - py * 2).toBeLessThan(y + h);
            }
          }
        }
      }
    }
  });

  it("avoids surface shading for most of a large zoomed-out window", () => {
    const { state, gl } = setup();
    const [, , w, h] = state.surfaceBounds();
    expect(w * h / (gl.width * gl.height)).toBeLessThan(0.31);
  });
});

// Independent reference for the original projection and great-circle arithmetic.
function project(p: Vec3, c: Camera, width: number, height: number): Point | null {
  const q = sub(p, c.C);
  const vz = dot(q, c.F);
  if (vz < 0.003) return null;
  const nx = dot(q, c.R) / (vz * c.tan * (width / height));
  const ny = dot(q, c.U) / (vz * c.tan) - c.shift;
  const L = len(q);
  const d = mul(q, 1 / L);
  const b = dot(c.C, d);
  const disc = b * b - (dot(c.C, c.C) - 1);
  const t = -b - Math.sqrt(disc);
  return {
    x: (nx * 0.5 + 0.5) * width, y: (0.5 - ny * 0.5) * height, z: vz,
    vis: !(disc > 0 && t > 0 && t < L - 1e-3), w: p,
  };
}

it("reuses route buffers without changing near, distant, antipodal or hidden arc points", () => {
  const { state } = setup();
  const buffer: ArcBuffer = { points: [], pool: [] };
  const origin = vecOf(0.38, 1.98);
  const ends = [origin, vecOf(0.380001, 1.980001), vecOf(0.65, 2.4), mul(origin, -1), vecOf(-0.3, -1)];
  for (const range of [2.4, 0.6, 0.2]) {
    state.range = range;
    state.cam = state.camera();
    for (const end of ends) {
      for (const lift of [0, 1]) {
        const actual = state.arc(origin, end, lift, 0.03, buffer);
        const w = angle(origin, end);
        const h = Math.min(0.32, 0.03 * (range / 2.4) + w * 0.11) * lift;
        const n = Math.max(12, Math.ceil(w / 0.015));
        expect(actual).toHaveLength(n + 1);
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const p = mul(slerp(origin, end, t), 1 + h * Math.sin(Math.PI * t) + 0.03 * t);
          expect(actual[i]).toEqual(project(p, state.cam, 2560, 1440));
        }
      }
    }
  }
  const point = buffer.pool[0];
  const world = point.w;
  state.arc(origin, ends[2], 1, 0.03, buffer);
  expect(buffer.pool[0]).toBe(point);
  expect(buffer.pool[0].w).toBe(world);
});

describe("vehicles", () => {
  type Drawn = { vehicle: string; next: string; swap: number };
  const own = (engine: unknown) => (engine as { pl: Drawn | null }).pl;
  const remote = (engine: unknown, id: string) => (engine as { remotes: Map<string, { pl: Drawn }> }).remotes.get(id)!.pl;

  it("touches down, then shrinks the plane away, and drops the trip's pins once it has gone", () => {
    const { engine, state, frames, drawGL } = setup();
    state.reduceMotion = false;
    type Pin = { h: number; t0: number; squash: number };
    const pins = () => (engine as unknown as { pins: Map<string, Pin> }).pins;
    const left = () => (engine as unknown as { planeLeft(t0: number): number }).planeLeft(state.tLand);
    frames(1);
    engine["takeoff"](point(22.3, 114.17));
    frames(30);
    engine["land"](point(31.23, 121.47));
    engine.setPins([
      { key: "sha:me", stop: "sha", at: { lat: 31.23, lng: 121.47 }, color: 0 },
      { key: "sha:ada", stop: "sha", at: { lat: 31.23, lng: 121.47 }, color: 1 },
    ]);
    frames(1);
    expect(left()).toBe(1);
    // nothing drops while the plane is still on the ground
    for (const p of pins().values()) expect(p.h).toBe(Infinity);
    frames(30); // 0.5 s: shrinking away
    expect(left()).toBeGreaterThan(0);
    expect(left()).toBeLessThan(1);
    drawGL.mockClear();
    frames(15); // the plane has gone, and the first pin is falling
    expect(left()).toBe(0);
    const [first, second] = [...pins().values()];
    expect(first.h).toBeGreaterThan(0);
    expect(first.h).toBeLessThan(4);
    // the second rider's pin follows a moment later
    expect(second.t0).toBeGreaterThan(first.t0);
    expect(drawGL.mock.calls.length).toBeGreaterThanOrEqual(10);
    frames(60);
    // in: the point sunk a little way into the ground, the spring settled
    for (const p of pins().values()) {
      expect(p.h).toBeLessThan(0);
      expect(Math.abs(p.squash)).toBeLessThan(0.01);
    }
  });

  it("drops pins at once when nothing is landing, and fans a stop's riders out from its point", () => {
    const { engine, frames } = setup();
    type Pin = { h: number; g: Vec3; fan: number };
    const pins = () => (engine as unknown as { pins: Map<string, Pin> }).pins;
    frames(1);
    const at = { lat: 35.68, lng: 139.77 };
    engine.setPins([
      { key: "a", stop: "tyo", at, color: 0 },
      { key: "b", stop: "tyo", at, color: 1 },
      { key: "c", stop: "tyo", at, color: 2 },
      { key: "d", stop: "osa", at: { lat: 34.73, lng: 135.5 }, color: 3 },
    ]);
    frames(1);
    const list = [...pins().values()];
    // reduced motion: straight in
    for (const p of list) expect(p.h).toBeLessThan(0);
    // all stuck in the stop itself, leaning left to right
    for (const p of list.slice(0, 3)) expect(angle(p.g, point(at.lat, at.lng))).toBeLessThan(1e-9);
    expect(list.slice(0, 3).map((p) => p.fan)).toEqual([-0.8, 0, 0.8]);
    // alone at its stop, a pin stands straight
    expect(list[3].fan).toBe(0);
    engine.setPins([{ key: "d", stop: "osa", at: { lat: 34.73, lng: 135.5 }, color: 3 }]);
    expect([...pins().keys()]).toEqual(["d"]);
  });

  it("leans each pin back so its needle shows from above, and casts its shadow down and to the right", () => {
    const { engine, state, frames } = setup();
    frames(1);
    engine.setPins([{ key: "a", stop: "s", at: { lat: 0, lng: 0 }, color: 0 }]);
    engine.flyTo({ lat: 0, lng: 0 }, 20);
    frames(200);
    const c = state.camera();
    const L = norm(add(add(mul(c.R, -0.5), mul(c.U, 0.55)), mul(c.F, -0.68)));
    const [f] = (engine as unknown as { pinFrames(c: unknown, L: Vec3, size: number): { tip: Vec3; Z: Vec3; shadowHead: Vec3 }[] })
      .pinFrames(c, L, 0.05);
    const tip = state.proj(f.tip)!;
    const head = state.proj(add(f.tip, f.Z))!;
    const shadow = state.proj(f.shadowHead)!;
    // the head is above its point on screen, and its shadow falls below and to the right of it
    expect(head.y).toBeLessThan(tip.y - 5);
    expect(shadow.x).toBeGreaterThan(head.x);
    expect(shadow.y).toBeGreaterThan(head.y);
  });

  it("turns into whatever the leg being drawn looks like, once the guess has held", () => {
    const { engine, state, frames } = setup();
    // all land, so the guess comes down to length
    (engine as unknown as { landAt: (v: Vec3) => boolean }).landAt = () => true;
    const move = (x: number, y: number) => engine.pointerMove({ clientX: x, clientY: y, pointerId: 1, pointerType: "mouse" } as PointerEvent);
    const o = state.pick(1280, 650)!;
    engine["takeoff"](o);
    // the first spot to the right of takeoff that's train distance away (300 to 900 km)
    let x = 1280;
    while (EARTH_RADIUS_KM * angle(o, state.pick(x, 650)!) < 300) x += 4;
    expect(EARTH_RADIUS_KM * angle(o, state.pick(x, 650)!)).toBeLessThan(900);
    move(x, 650);
    frames(6); // 0.1 s: the guess hasn't held yet
    expect(own(engine)!.next).toBe("flight");
    frames(30);
    expect(own(engine)!.next).toBe("train");
    // dragged right back beside takeoff, it keeps the train rather than flickering
    move(1281, 650);
    frames(30);
    expect(own(engine)!.next).toBe("train");
  });

  // a guess that has already held, so the plane turns into `v` on the next frame
  const want = (engine: unknown, v: string) =>
    ((engine as { want: unknown }).want = { vehicle: v, t: -Infinity, checked: Infinity });

  it("pops between vehicles over a quarter second, redrawing as it goes", () => {
    const { engine, state, frames, drawGL } = setup();
    state.reduceMotion = false;
    engine["takeoff"](point(22.3, 114.17));
    want(engine, "flight");
    frames(60);
    drawGL.mockClear();
    want(engine, "bus");
    frames(3);
    expect(own(engine)!.vehicle).toBe("flight");
    expect(own(engine)!.swap).toBeGreaterThan(0);
    frames(17);
    expect(own(engine)!.vehicle).toBe("bus");
    expect(own(engine)!.swap).toBe(0);
    expect(drawGL.mock.calls.length).toBeGreaterThanOrEqual(15);
  });

  it("turns back mid-pop without jumping to full size", () => {
    const { engine, state, frames } = setup();
    state.reduceMotion = false;
    engine["takeoff"](point(22.3, 114.17));
    want(engine, "train");
    frames(10);
    const before = own(engine)!.swap;
    expect(before).toBeGreaterThan(0.5);
    want(engine, "bus");
    frames(1);
    expect(own(engine)!.swap).toBeLessThan(0.5);
    frames(30);
    expect(own(engine)!.vehicle).toBe("bus");
  });

  it("draws other members' trips as their vehicle, in the air as well as landed, planes otherwise", () => {
    const { engine, frames } = setup();
    const base = { origin: { lat: 22, lng: 114 }, at: { lat: 31, lng: 121 }, ahead: { lat: 31.1, lng: 121.1 } };
    engine.setRemoteFlights([
      { id: "a", ...base, landed: true, vehicle: "ferry" },
      { id: "b", ...base, landed: true },
      { id: "c", ...base, landed: false, vehicle: "train" },
    ]);
    frames(1);
    expect(remote(engine, "a").vehicle).toBe("ferry");
    expect(remote(engine, "b").vehicle).toBe("flight");
    // in the air, what their globe guessed for the leg they're drawing
    expect(remote(engine, "c").vehicle).toBe("train");
    engine.setRemoteFlights([{ id: "a", ...base, landed: true, vehicle: "train" }]);
    frames(1);
    expect(remote(engine, "a").vehicle).toBe("train");
  });
});

describe("landed routes and stop tags", () => {
  type XY = { x: number; y: number };
  type Pin = { g: Vec3 };
  const spies: { mockRestore(): void }[] = [];
  const unspy = () => spies.splice(0).forEach((s) => s.mockRestore());
  afterEach(unspy);
  /** Each route stroke's last drawn point, ground track then arc for every leg, in drawing order. */
  function strokes(state: Internals) {
    const ends: (XY | null)[] = [];
    spies.push(vi.spyOn(state as unknown as { strokePts(c: unknown, pts: (Point | null)[]): void }, "strokePts")
      .mockImplementation((_c, pts) => {
        const last = [...pts].reverse().find((p) => p && p.vis);
        ends.push(last ? { x: last.x, y: last.y } : null);
      }));
    return ends;
  }
  function tags(state: Internals) {
    const out = new Map<string, XY>();
    spies.push(vi.spyOn(state as unknown as { tag(c: unknown, x: number, y: number, text: string): void }, "tag")
      .mockImplementation((_c, x, y, text) => void out.set(text, { x, y })));
    return out;
  }
  const pins = (engine: GlobeEngine) => [...(engine as unknown as { pins: Map<string, Pin> }).pins.values()];
  const gap = (a: XY | null | undefined, b: XY | null | undefined) => Math.hypot(a!.x - b!.x, a!.y - b!.y);
  const shanghai = { lat: 31.23, lng: 121.47 };

  it("brings this viewer's landed leg down to its pins' needle base once the plane has gone", () => {
    const { engine, state, frames } = setup();
    state.reduceMotion = false;
    const left = () => (engine as unknown as { planeLeft(t0: number): number }).planeLeft(state.tLand);
    frames(1);
    engine["takeoff"](point(22.3, 114.17));
    frames(30);
    engine["land"](point(shanghai.lat, shanghai.lng));
    engine.setPins([{ key: "sha:me", stop: "sha", at: shanghai, color: 0 }]);
    frames(30);
    // still shrinking away: the dashes stop short of the plane, as they do in flight
    expect(left()).toBeGreaterThan(0);
    let ends = strokes(state);
    state.drawHud(0);
    expect(gap(ends[1], state.proj(pins(engine)[0].g))).toBeGreaterThan(2);
    unspy();
    frames(120);
    expect(left()).toBe(0);
    ends = strokes(state);
    state.drawHud(0);
    const base = state.proj(pins(engine)[0].g);
    expect(base?.vis).toBe(true);
    // ground track and arc both end at the needle's base
    expect(gap(ends[0], base)).toBeLessThan(0.01);
    expect(gap(ends[1], base)).toBeLessThan(0.01);
  });

  it("brings other members' landed legs down to their pins, with no gap for a plane that isn't there", () => {
    const { engine, state, frames } = setup();
    frames(1);
    engine.setRemoteFlights([{ id: "leg:1", origin: { lat: 22.3, lng: 114.17 }, at: shanghai, ahead: shanghai, landed: true }]);
    engine.setPins([{ key: "sha:ada", stop: "sha", at: shanghai, color: 1 }]);
    frames(5);
    const ends = strokes(state);
    state.drawHud(0);
    const base = state.proj(pins(engine)[0].g);
    expect(gap(ends[0], base)).toBeLessThan(0.01);
    expect(gap(ends[1], base)).toBeLessThan(0.01);
  });

  it("keeps a landed stop's tag just under its pins at every zoom", () => {
    const { engine, state, frames } = setup();
    frames(1);
    engine.setRemoteFlights([{ id: "leg:1", origin: { lat: 22.3, lng: 114.17 }, at: shanghai, ahead: shanghai, landed: true }]);
    engine.setPins([{ key: "sha:ada", stop: "sha", at: shanghai, color: 1 }]);
    const name = (engine as unknown as { remotes: Map<string, { destinationName: string | null }> }).remotes.get("leg:1")!.destinationName!;
    expect(name).toBeTruthy();
    const offsets: number[] = [];
    for (const span of [12, 90]) {
      engine.flyTo(shanghai, span);
      frames(200);
      const placed = tags(state);
      state.drawHud(0);
      const base = state.proj(pins(engine)[0].g)!;
      const at = placed.get(name)!;
      // centred under the needle's base, its top edge a small gap below it
      expect(Math.abs(at.x - base.x)).toBeLessThan(0.5);
      const top = at.y - 21 / 2 - base.y;
      const pin = (state as unknown as { pinPx(v: Vec3): number }).pinPx(pins(engine)[0].g);
      expect(top).toBeGreaterThanOrEqual(6);
      expect(top).toBeLessThanOrEqual(Math.max(6, pin * 0.25));
      offsets.push(top);
      unspy();
    }
    // the gap shrinks with the pins as you zoom out
    expect(offsets[1]).toBeLessThanOrEqual(offsets[0]);
  });
});

describe("settled rendering", () => {
  it.each([false, true])("parks landed GL and HUD, including normal motion=%s", (reduceMotion) => {
    const { engine, state, frames, drawGL, drawHud } = setup();
    state.reduceMotion = reduceMotion;
    engine["takeoff"](point(22.3, 114.17));
    engine["pl"]!.alt = 0.03;
    engine["pl"]!.bank = 0.2;
    engine["land"](point(31.23, 121.47));
    frames(360);
    expect(engine["pl"]!.alt).toBe(0);
    expect(engine["pl"]!.bank).toBe(0);
    drawGL.mockClear();
    drawHud.mockClear();
    vi.mocked(requestAnimationFrame).mockClear();
    frames(600);
    expect(drawGL).not.toHaveBeenCalled();
    expect(drawHud).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    engine.pointerMove({ clientX: 1280, clientY: 650 } as PointerEvent);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it("draws a searched trip's routes out in turn while framing it, with no plane landing", () => {
    const { engine, state, frames } = setup();
    state.reduceMotion = false;
    // the pins go down as it lands: they must already wait for the routes reaching them
    let pinsAt = 0;
    const onLand = vi.fn(() => {
      pinsAt = engine["landingDone"](engine["dest"]!);
    });
    engine["events"].onLand = onLand;
    const hk = { lat: 22.3, lng: 114.17 }, sha = { lat: 31.23, lng: 121.47 }, tyo = { lat: 35.68, lng: 139.77 };
    engine.showTrip([hk, sha, tyo], "draw");
    expect(onLand).toHaveBeenCalledTimes(1);
    // it turns to frame the trip, and the plane is already gone
    expect(engine["turn"]).not.toBeNull();
    expect(engine["t"] - engine["tLand"]).toBeGreaterThanOrEqual(0.7 - 1e-9);
    const draws = engine["ownDraws"] as { t0: number }[];
    expect(draws).toHaveLength(2);
    expect(draws[1].t0).toBeGreaterThan(draws[0].t0);
    expect(pinsAt).toBeCloseTo(draws[1].t0 + 1.2);
    // nothing is drawn yet; a few seconds on, both legs are whole
    const legs = engine["ownLegs"]();
    expect(engine["ownDrawn"](legs[0][0], legs[0][1], engine["t"])).toBe(0);
    frames(360);
    expect(engine["ownDrawn"](legs[1][0], legs[1][1], engine["t"])).toBe(1);
  });

  it("animates only searching routes and retains label geometry during dash motion", () => {
    const { engine, state, frames, drawGL, drawHud } = setup();
    state.reduceMotion = false;
    engine.showTrip([{ lat: 22.3, lng: 114.17 }, { lat: 31.23, lng: 121.47 }], "quiet");
    frames(360);
    const names = vi.spyOn(engine, "countryNames" as never);
    const cities = vi.spyOn(engine, "cityNames" as never);
    drawGL.mockClear();
    drawHud.mockClear();
    engine.setSearching(true);
    frames(60);
    expect(drawGL).not.toHaveBeenCalled();
    expect(drawHud).toHaveBeenCalledTimes(60);
    expect(names).not.toHaveBeenCalled();
    expect(cities).not.toHaveBeenCalled();
    engine.setSearching(false);
    frames(2);
    drawHud.mockClear();
    frames(120);
    expect(drawHud).not.toHaveBeenCalled();
  });

  it.each([1, 6, 20])("masks and composites %i pinned legs once and reuses projected geometry", (count) => {
    const { engine, state } = setup();
    const layer = context();
    const canvas = { width: 1, height: 1, getContext: () => layer } as unknown as HTMLCanvasElement;
    engine["routeLayer"] = canvas;
    engine["pinCuts"] = [{ x: 100, y: 100, r: 5, bx: 100, by: 110 }];
    const flights = Array.from({ length: count }, (_, i) => ({
      id: String(i), origin: { lat: 22 + i, lng: 110 }, at: { lat: 30 + i, lng: 120 }, ahead: { lat: 31 + i, lng: 121 }, landed: true,
    }));
    engine.setRemoteFlights(flights);
    const out = context();
    const arc = vi.spyOn(state, "arc");
    engine["drawRoutes"](out, 10);
    expect(layer.clearRect).toHaveBeenCalledTimes(1);
    expect(out.drawImage).toHaveBeenCalledTimes(1);
    expect(arc).toHaveBeenCalledTimes(count * 2);
    engine["drawRoutes"](out, 11);
    expect(layer.clearRect).toHaveBeenCalledTimes(2);
    expect(out.drawImage).toHaveBeenCalledTimes(2);
    expect(arc).toHaveBeenCalledTimes(count * 2);
    state.range = 1.2;
    state.cam = state.camera();
    engine["drawRoutes"](out, 12);
    expect(arc).toHaveBeenCalledTimes(count * 4);
  });

  it("invalidates both country and city sprites when DPR changes", () => {
    const { engine, frames } = setup();
    frames(2);
    engine["nameSprites"].set("country", {} as HTMLCanvasElement);
    engine["citySprites"].set("city", {} as HTMLCanvasElement);
    window.devicePixelRatio = 1;
    frames(1);
    expect(engine["nameSprites"].has("country")).toBe(false);
    expect(engine["citySprites"].has("city")).toBe(false);
  });

  it("keeps frames alive through delayed remote cursor samples, then sleeps", () => {
    const { engine, state, frames } = setup();
    state.reduceMotion = false;
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    engine.setRemoteFlights([{ id: "stored", origin: { lat: 22, lng: 114 }, at: { lat: 30, lng: 121 }, ahead: { lat: 31, lng: 122 }, landed: true }]);
    engine.setRemoteCursors([{ id: "friend", at: { lat: 22, lng: 114 } }]);
    frames(180);
    now.mockReturnValue(4000);
    engine.setRemoteCursors([{ id: "friend", at: { lat: 25, lng: 118 } }]);
    vi.mocked(requestAnimationFrame).mockClear();
    frames(2);
    expect(requestAnimationFrame).toHaveBeenCalled();
    frames(180);
    vi.mocked(requestAnimationFrame).mockClear();
    frames(30);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    now.mockRestore();
  });
});

function gpuSetup() {
  const { engine } = setup(1440, 900);
  let id = 0;
  const calls: Record<string, unknown> = {};
  const gl = new Proxy(calls, { get(object, key: string) {
    if (key in object) return object[key];
    if (/^[A-Z_0-9]+$/.test(key)) return object[key] = ++id;
    if (key.startsWith("create")) return object[key] = vi.fn(() => ({ id: ++id }));
    if (key === "getShaderParameter") return object[key] = vi.fn(() => true);
    if (key === "getProgramParameter") return object[key] = vi.fn((_, parameter) => parameter === gl.ACTIVE_UNIFORMS ? 0 : true);
    return object[key] = vi.fn();
  } }) as unknown as WebGL2RenderingContext;
  Object.assign(engine["root"], { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  Object.assign(engine["glEl"], { getContext: () => gl, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  Object.assign(window, { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  Object.assign(document, { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("createImageBitmap", vi.fn());
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  return { engine, gl };
}

describe("GPU lifecycle", () => {
  it("balances all resource allocations and closes shaders without losing the shared canvas context", () => {
    vi.useFakeTimers();
    const { engine, gl } = gpuSetup();
    engine.start();
    engine["tick"](1000);
    vi.runOnlyPendingTimers(); // staged sky
    const signal = engine["assetAbort"]!.signal;
    engine.destroy();
    expect(signal.aborted).toBe(true);
    for (const [create, dispose] of [
      ["createBuffer", "deleteBuffer"], ["createTexture", "deleteTexture"], ["createProgram", "deleteProgram"],
      ["createShader", "deleteShader"], ["createVertexArray", "deleteVertexArray"], ["createFramebuffer", "deleteFramebuffer"],
    ] as const) {
      expect(vi.mocked(gl[dispose]).mock.calls.length, create).toBe(vi.mocked(gl[create]).mock.calls.length);
    }
    expect(gl.getExtension).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("restores rendering resources without losing a landed trip", () => {
    const { engine } = gpuSetup();
    engine.start();
    engine.showTrip([{ lat: 22.3, lng: 114.17 }, { lat: 31.23, lng: 121.47 }], "quiet");
    const destination = engine["dest"];
    const preventDefault = vi.fn();
    engine["onContextLost"]({ preventDefault } as unknown as Event);
    expect(preventDefault).toHaveBeenCalled();
    expect(engine["gl"]).toBeNull();
    engine["onContextRestored"]();
    expect(engine["gl"]).not.toBeNull();
    expect(engine.getMode()).toBe("landed");
    expect(engine["dest"]).toEqual(destination);
    engine.destroy();
  });

  it("shares the earth fetch/bitmap with CPU mask generation and always releases decoded bitmaps", async () => {
    const { engine, gl } = gpuSetup();
    const sources: { close: ReturnType<typeof vi.fn> }[] = [];
    vi.mocked(fetch).mockImplementation(async () => ({ ok: true, blob: async () => new Blob() }) as Response);
    vi.mocked(createImageBitmap).mockImplementation(async () => {
      const bitmap = { close: vi.fn() };
      sources.push(bitmap);
      return bitmap as unknown as ImageBitmap;
    });
    const land = vi.spyOn(engine as unknown as { loadLand(source: CanvasImageSource): void }, "loadLand").mockImplementation(() => {});
    engine.start();
    await vi.waitFor(() => expect(sources).toHaveLength(3));
    await vi.waitFor(() => expect(land).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(3); // earth, borders, provinces; no second earth decode
    expect(land).toHaveBeenCalledWith(sources[0]);
    expect(sources.every((s) => s.close.mock.calls.length === 1)).toBe(true);
    expect(gl.texImage2D).toHaveBeenCalled();
    engine.destroy();
  });
});
