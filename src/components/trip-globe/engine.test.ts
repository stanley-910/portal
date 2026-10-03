import { afterEach, describe, expect, it, vi } from "vitest";
import { GlobeEngine } from "./engine";
import { angle, D2R, dot, len, mul, slerp, sub, vecOf, type Vec3 } from "./vec";

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
    expect(onLand).toHaveBeenCalledWith(expect.objectContaining({ from: null, to: null }));
    const trip = onLand.mock.calls[0][0];
    expect(trip.origin.lng).toBeCloseTo(-140);
    expect(trip.destination.lat).toBeCloseTo(5);
    expect(trip.distanceKm).toBeGreaterThan(550);
  });
  it("preserves precise click points even when a nearby surface hub is previewed", () => {
    const { globe, onLand } = engine();
    globe["takeoff"](point(22.305, 114.165));
    globe["land"](point(31.23, 121.47));
    const trip = onLand.mock.calls[0][0];
    expect(trip.from.mode).toBe("train");
    expect(trip.origin.lat).toBeCloseTo(22.305);
    expect(trip.destination.lng).toBeCloseTo(121.47);
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
  reduceMotion: boolean;
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

function setup(width = 2560, height = 1440) {
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
  const engine = new GlobeEngine(root as unknown as HTMLElement, gl, hud, "", "", "", { onFrame });
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

  it("parks the picked vehicle once landed, keeps the plane in the air, and resets on takeoff", () => {
    const { engine, frames } = setup();
    engine["takeoff"](point(22.3, 114.17));
    engine.setVehicle("train");
    frames(1);
    expect(own(engine)!.vehicle).toBe("flight");
    engine["land"](point(31.23, 121.47));
    engine.setVehicle("train");
    frames(1);
    expect(own(engine)!.vehicle).toBe("train");
    engine.setVehicle("flight");
    frames(1);
    expect(own(engine)!.vehicle).toBe("flight");
    engine.setVehicle("ferry");
    engine.cancel();
    engine["takeoff"](point(22.3, 114.17));
    expect(own(engine)!.vehicle).toBe("flight");
  });

  it("pops between vehicles over a quarter second, redrawing as it goes", () => {
    const { engine, state, frames, drawGL } = setup();
    state.reduceMotion = false;
    engine["takeoff"](point(22.3, 114.17));
    engine["land"](point(31.23, 121.47));
    frames(120);
    drawGL.mockClear();
    engine.setVehicle("bus");
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
    engine["land"](point(31.23, 121.47));
    engine.setVehicle("train");
    frames(10);
    const before = own(engine)!.swap;
    expect(before).toBeGreaterThan(0.5);
    engine.setVehicle("bus");
    expect(own(engine)!.swap).toBeCloseTo(1 - before);
    frames(30);
    expect(own(engine)!.vehicle).toBe("bus");
  });

  it("parks other members' landed trips as their vehicle, planes otherwise", () => {
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
    expect(remote(engine, "c").vehicle).toBe("flight");
    engine.setRemoteFlights([{ id: "a", ...base, landed: true, vehicle: "train" }]);
    frames(1);
    expect(remote(engine, "a").vehicle).toBe("train");
  });
});
