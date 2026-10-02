// The Trip Globe renderer and interaction model, framework-free. Ported from the Flight artboard (Paper Atlas).
// Two canvases: WebGL2 draws the printed globe and the paper plane; a 2D canvas on top draws the route, pins and tags.
import { HoverHubResolver, hubPreviewLabel, nearestPreviewHub } from "@/lib/transport/hubs/preview";
import type { Hub } from "@/lib/transport/hubs/types";
import { COUNTRY_LABELS } from "./countries";
import { COUNTRY_TYPE, HALFTONE_PITCH, PALETTES, type Palette, type ThemeId } from "./palette";
import { buildPlane } from "./plane-model";
import { FS_GLOBE, FS_PLANE, VS_PLANE, VS_QUAD } from "./shaders";
import { randomSeed, Sky, type Program } from "./sky";
import {
  add, angle, clamp, cross, D2R, dot, EARTH_RADIUS_KM, ease, len, lerp, llOf, mul, norm, rotAround, slerp, smooth,
  sub, tangent, vecOf, wrapPi, type Vec3,
} from "./vec";

export type GlobeMode = "idle" | "flying" | "landed";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface LandedTrip {
  /** Nearest local preview hub, or null outside coverage. Search still resolves pairs from the clicks. */
  from: Hub | null;
  to: Hub | null;
  /** Exact picked surface points before snapping. These are the transport-search inputs. */
  origin: LatLng;
  destination: LatLng;
  /** Great-circle distance between the actual clicked points, not a snapped route. */
  distanceKm: number;
  /** Earliest departure: tomorrow, local time. */
  departDate: Date;
}

/** A trip being flown or landed, as other people in the room see it. All places as lat/lng. */
export interface FlightState {
  /** Where the trip took off. */
  origin: LatLng;
  /** Where the plane is now. */
  at: LatLng;
  /** A point just ahead of the plane, which gives its heading. */
  ahead: LatLng;
  landed: boolean;
}

/** Another member's flight. `id` is stable while they stay in the room. */
export interface RemoteFlight extends FlightState {
  id: string;
}

export interface GlobeEvents {
  onModeChange?: (mode: GlobeMode, from: Hub | null) => void;
  /** Only when the local hover hub changes. Never triggers a provider search. */
  onPreviewChange?: (hub: Hub | null) => void;
  onLand?: (trip: LandedTrip) => void;
  onCancel?: () => void;
  /** After every frame is drawn. Overlays that track places on the globe reposition here. */
  onFrame?: () => void;
}

const DG = 3.4; // camera distance from the globe's centre, fully zoomed out
const ALT = 0.03; // flying altitude, fully zoomed out
const S_PLANE = 0.085; // plane length fully zoomed out: about the size of a cursor
const CENTRE_Y = 0.455; // globe centre, as a fraction of the screen height
const LAT_MAX = 1.25; // how far the view can turn toward a pole

// Zoom works like Google Earth: the camera orbits a target on the ground at some range, zooms toward the
// point under the cursor, and tilts toward the horizon as it gets close.
const RANGE_MAX = DG - 1; // the whole-globe view
const RANGE_MIN = 0.2; // about 1,300 km up: the 2048px earth texture still prints cleanly here
const TILT_MAX = 0.8; // radians from straight down, at RANGE_MIN
const FLY_SCROLL = 2.5; // two-finger scroll turns the globe this much faster while a route is being plotted

interface Camera {
  C: Vec3;
  F: Vec3;
  R: Vec3;
  U: Vec3;
  tan: number;
  shift: number;
}
interface ScreenPoint {
  x: number;
  y: number;
  vis: boolean;
  z: number;
  w?: Vec3;
}
interface Plane {
  n: Vec3;
  f: Vec3;
  alt: number;
  bank: number;
  pitch: number;
}
interface NameSpot {
  i: number;
  x: number;
  y: number;
  a: number;
  size: number;
  box: number[];
  fits: boolean;
  /** Set on two lines, which a long name falls back to when one line won't fit. */
  wrapped: boolean;
  facing: number;
  p: ScreenPoint;
  q: ScreenPoint;
}
interface ArcBuffer {
  points: (ScreenPoint | null)[];
  pool: ScreenPoint[];
}

const screenPoint = (): ScreenPoint => ({ x: 0, y: 0, z: 0, vis: false });

/** How much bigger than the `country` token a name grows as its country fills the screen. */
const NAME_MAX = 1.25;

const toLatLng = (v: Vec3): LatLng => {
  const { lat, lon } = llOf(v);
  return { lat: lat / D2R, lng: lon / D2R };
};

/** A long name broken at the space that best balances its two lines ("Papua New" over "Guinea"), or null. */
function wrapName(name: string): string | null {
  if (name.length < 10 || !name.includes(" ")) return null;
  let best: string | null = null;
  let longest = Infinity;
  for (let i = name.indexOf(" "); i >= 0; i = name.indexOf(" ", i + 1)) {
    const l = Math.max(i, name.length - i - 1);
    if (l < longest) {
      longest = l;
      best = `${name.slice(0, i)}\n${name.slice(i + 1)}`;
    }
  }
  return best;
}

/** Country names on the globe, with each anchor and long axis as world vectors. Biggest country first. */
const NAMES = COUNTRY_LABELS.map((l) => {
  const lat = l.lat * D2R;
  const lon = l.lng * D2R;
  const v = vecOf(lat, lon);
  const east: Vec3 = [Math.cos(lon), 0, -Math.sin(lon)];
  const north = cross(v, east);
  const a = l.axis * D2R;
  // a long thin country (Japan, Chile) runs its name along its axis; others along the parallel
  const long = l.span > 2 * l.width;
  // a scattered archipelago (Micronesia) spans far more sea than land, so its room is capped by its area
  const cap = 3 * Math.sqrt(l.area);
  const axis = add(mul(east, Math.cos(a)), mul(north, Math.sin(a)));
  return {
    name: l.name,
    wrap: wrapName(l.name),
    v,
    eastStep: norm(add(v, mul(east, 0.01))),
    axisStep: norm(add(v, mul(axis, 0.01))),
    long,
    // room for the name along the axis, or along the parallel, in radians of arc. Along the parallel, the country is
    // taken as an ellipse on its axis: a wide country tilted a little (Papua New Guinea) still has most of its length
    along: Math.min(l.span, cap) * D2R,
    across: Math.min(Math.hypot(l.span * Math.cos(a), l.width * Math.sin(a)), cap) * D2R,
  };
});

export class GlobeEngine {
  private gl: WebGL2RenderingContext | null = null;
  private hud: CanvasRenderingContext2D;
  private raf = 0;
  private pGlobe!: Program;
  private pPlane!: Program;
  private vaoQuad: WebGLVertexArrayObject | null = null;
  private vaoPlane: WebGLVertexArrayObject | null = null;
  private planeCount = 0;
  private texEarth: WebGLTexture | null = null;
  private texBorders: WebGLTexture | null = null;
  private sky: Sky | null = null;
  private skySeed: string | number = randomSeed();
  private cam: Camera | null = null;
  private P: Palette = PALETTES.light;
  private tagFont = '700 12px "Courier Prime", ui-monospace, monospace';
  private nameFamily = '"Courier Prime", ui-monospace, monospace';
  /** Each name's width at a 1px font size, letter spacing included. Cleared when fonts load. */
  private nameWidths = new Map<string, number>();
  /** Each name drawn once, halo and all, at its largest size; frames only copy these. Cleared on theme or font change. */
  private nameSprites = new Map<string, HTMLCanvasElement>();
  /** How strongly names print: full while idle, dimmed while a trip is on the globe. */
  private nameInk = 1;
  /** Per name: how far it has faded in (0–1), whether it held a place last frame, and whether it ran along its axis. */
  private nameFade = new Float32Array(COUNTRY_LABELS.length);
  private namePlaced = new Uint8Array(COUNTRY_LABELS.length);
  private nameOnAxis = new Uint8Array(COUNTRY_LABELS.length);
  private nameWrapped = new Uint8Array(COUNTRY_LABELS.length);
  /** When a name that lost its place may try again, so two names drifting past each other don't flicker. */
  private nameHold = new Float64Array(COUNTRY_LABELS.length);
  private nameT = 0;
  private nameSpots: NameSpot[] = NAMES.map((_, i) => ({
    i, x: 0, y: 0, a: 0, size: 0, box: [0, 0, 0, 0], fits: false, wrapped: false, facing: 0,
    p: screenPoint(), q: screenPoint(),
  }));
  private visibleNames: NameSpot[] = [];
  private placedNames: number[][] = [];
  private nameWon = new Uint8Array(NAMES.length);
  private namesMoving = true;
  private groundArc: ArcBuffer = { points: [], pool: [] };
  private airArc: ArcBuffer = { points: [], pool: [] };
  private glDirty = true;
  private hudDirty = true;
  private scene: number[] = [];
  private lastScene: number[] = [];
  private hudX = NaN;
  private hudY = NaN;
  private hudHover = false;
  private hudAnimated = false;
  private reduceMotion = false;
  private motionQuery: MediaQueryList | null = null;

  // view
  private lon0 = 108 * D2R;
  private lat0 = 20 * D2R;
  private vlon = 0;
  private vlat = 0;
  private W = 1;
  private H = 1;
  private dpr = 1;
  private asp = 1;
  private Rpx = 1; // globe radius in px when fully zoomed out
  private tan0 = 1; // tan of the vertical half field of view, fixed so the zoomed-out globe has radius Rpx
  private range = RANGE_MAX; // camera distance from its target on the ground
  private rangeTarget = RANGE_MAX;
  // the ground point that stays under the cursor while a zoom eases in
  private zoomAnchor: { p: Vec3; x: number; y: number } | null = null;
  private turn: {
    from: { lon: number; lat: number; range: number };
    to: { lon: number; lat: number; range: number };
    /** how far the camera rises mid-flight, like a fly-to */
    hop: number;
    t0: number;
    dur: number;
  } | null = null;

  // trip
  private mode: GlobeMode = "idle";
  private origin: Vec3 | null = null;
  private dest: Vec3 | null = null;
  private originHub: Hub | null = null;
  private destinationHub: Hub | null = null;
  private hoverHub: Hub | null = null;
  private hoverResolver = new HoverHubResolver();
  private pl: Plane | null = null;
  // other members' flights: where presence says they are, and where we draw them (eased toward that)
  private remotes = new Map<string, {
    o: Vec3; target: Vec3; ft: Vec3; landed: boolean; pl: Plane;
    originHub: Hub | null; destinationHub: Hub | null;
  }>();

  // input and time
  private mx = -9999;
  private my = -9999;
  private hasPointer = false;
  private hover: Vec3 | null = null;
  private down: { x: number; y: number; lx: number; ly: number; lt: number; drag: boolean; grab: Vec3 | null } | null = null;
  // touch pointers, for pinch
  private touches = new Map<number, [number, number]>();
  private pinch: { d0: number; range0: number; p: Vec3 | null } | null = null;
  private gestureScale = 1;
  private wheelAt = -99999; // timestamp (ms) of the last two-finger scroll event
  private lastInteract = -99;
  private t = 0;
  private tTake = -99;
  private tLand = -99;

  constructor(
    private root: HTMLElement,
    private glEl: HTMLCanvasElement,
    private hudEl: HTMLCanvasElement,
    private earthUrl: string,
    private bordersUrl: string,
    private events: GlobeEvents = {},
  ) {
    this.hud = hudEl.getContext("2d")!;
  }

  /** Starts rendering. Returns false when WebGL2 is unavailable. */
  start(): boolean {
    const gl = this.glEl.getContext("webgl2", { antialias: true, alpha: false, depth: true });
    if (!gl) return false;
    this.gl = gl;
    this.pGlobe = this.program(gl, VS_QUAD, FS_GLOBE, ["aPos"]);
    this.pPlane = this.program(gl, VS_PLANE, FS_PLANE, ["aPos", "aNrm", "aSm", "aPart"]);

    this.vaoQuad = gl.createVertexArray();
    gl.bindVertexArray(this.vaoQuad);
    this.attrib(gl, 0, new Float32Array([-1, -1, 3, -1, -1, 3]), 2);
    this.sky = new Sky(gl, (vs, fs, attrs) => this.program(gl, vs, fs, attrs));
    this.sky.setSeed(this.skySeed, this.vaoQuad);

    const m = buildPlane();
    this.planeCount = m.count;
    this.vaoPlane = gl.createVertexArray();
    gl.bindVertexArray(this.vaoPlane);
    this.attrib(gl, 0, m.pos, 3);
    this.attrib(gl, 1, m.nrm, 3);
    this.attrib(gl, 2, m.sm, 3);
    this.attrib(gl, 3, m.part, 1);
    gl.bindVertexArray(null);

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // all sea until the texture arrives
    this.texEarth = this.dataTexture(gl, this.earthUrl, [0, 255, 255, 255]);
    // one country, so no borders, until the texture arrives
    this.texBorders = this.dataTexture(gl, this.bordersUrl, [0, 0, 0, 255]);

    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reduceMotion = this.motionQuery.matches;
    this.motionQuery.addEventListener("change", this.onMotionChange);
    // native and non-passive, so a pinch can't zoom the page
    this.root.addEventListener("wheel", this.onWheel, { passive: false });
    this.root.addEventListener("gesturestart", this.onGesture as EventListener);
    this.root.addEventListener("gesturechange", this.onGesture as EventListener);
    document.fonts?.addEventListener("loadingdone", this.onFontsLoaded);

    this.raf = requestAnimationFrame(this.tick);
    return true;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.motionQuery?.removeEventListener("change", this.onMotionChange);
    this.root.removeEventListener("wheel", this.onWheel);
    this.root.removeEventListener("gesturestart", this.onGesture as EventListener);
    this.root.removeEventListener("gesturechange", this.onGesture as EventListener);
    document.fonts?.removeEventListener("loadingdone", this.onFontsLoaded);
    this.sky?.dispose();
    this.sky = null;
    // Not loseContext(): React Strict Mode remounts onto the same canvas, which would hand back the lost context.
    this.gl = null;
  }

  setTheme(theme: ThemeId) {
    this.P = PALETTES[theme];
    this.glDirty = this.hudDirty = true;
    this.nameSprites.clear();
    const stack = getComputedStyle(this.root).getPropertyValue("--font-typewriter").trim();
    if (stack) this.tagFont = `700 12px ${stack}`;
    if (stack && stack !== this.nameFamily) {
      this.nameFamily = stack;
      this.onFontsLoaded();
      // canvas text doesn't wait for a web font, so ask for it; loadingdone redraws
      document.fonts?.load(`${COUNTRY_TYPE.weight} ${COUNTRY_TYPE.size}px ${stack}`).catch(() => {});
    }
  }

  private onFontsLoaded = () => {
    this.nameWidths.clear();
    this.nameSprites.clear();
    this.hudDirty = true;
  };

  /** Regenerates the sky from a seed. Give everyone on a trip the same seed and they all see the same sky. */
  setSkySeed(seed: string | number) {
    if (seed === this.skySeed) return;
    this.skySeed = seed;
    this.sky?.setSeed(seed, this.vaoQuad);
    this.glDirty = true;
  }

  getMode() {
    return this.mode;
  }

  // ---------- input (wired to the root element's pointer events) ----------

  pointerDown(e: PointerEvent) {
    if (e.button !== undefined && e.button !== 0) return;
    const [x, y] = this.pos(e);
    if (e.pointerType === "touch") {
      this.touches.set(e.pointerId, [x, y]);
      if (this.touches.size === 2) {
        this.startPinch();
        return;
      }
    }
    this.mx = x;
    this.my = y;
    this.hasPointer = true;
    this.lastInteract = this.t;
    if (this.mode === "flying") {
      // clicking down picks the landing spot
      if (this.t - this.tTake < 0.25) return;
      const hit = this.pick(x, y);
      if (hit) this.land(hit);
      else this.cancel();
      return;
    }
    this.down = { x, y, lx: x, ly: y, lt: performance.now(), drag: false, grab: this.pick(x, y) };
    this.vlon = 0;
    this.vlat = 0;
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {}
  }

  pointerMove(e: PointerEvent) {
    const [x, y] = this.pos(e);
    if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, [x, y]);
    if (this.pinch) {
      this.movePinch();
      return;
    }
    this.mx = x;
    this.my = y;
    this.hasPointer = true;
    this.lastInteract = this.t;
    const d = this.down;
    if (!d || this.mode === "flying" || this.turn) return;
    if (!d.drag && Math.hypot(x - d.x, y - d.y) > 6) d.drag = true;
    if (d.drag) {
      const now = performance.now();
      const lon = this.lon0;
      const lat = this.lat0;
      if (d.grab) {
        // the ground you grabbed stays under the pointer, at any zoom
        this.anchor(d.grab, x, y);
      } else {
        const k = this.range / RANGE_MAX;
        this.lon0 = wrapPi(this.lon0 - ((x - d.lx) / this.Rpx) * k);
        this.lat0 = clamp(this.lat0 + ((y - d.ly) / this.Rpx) * k, -LAT_MAX, LAT_MAX);
      }
      const dl = wrapPi(this.lon0 - lon);
      const dp = this.lat0 - lat;
      const dts = Math.max(0.008, (now - d.lt) / 1000);
      this.vlon = clamp(this.vlon * 0.5 + (dl / dts) * 0.5, -5, 5);
      this.vlat = clamp(this.vlat * 0.5 + (dp / dts) * 0.5, -5, 5);
      d.lx = x;
      d.ly = y;
      d.lt = now;
    }
  }

  pointerUp(e: PointerEvent) {
    this.touches.delete(e.pointerId);
    if (this.pinch) {
      // the gesture ends when the last finger lifts; a leftover finger never takes off
      if (this.touches.size === 0) this.pinch = null;
      return;
    }
    const d = this.down;
    this.down = null;
    if (!d || e.type === "pointercancel" || this.mode === "flying") return;
    if (d.drag) {
      // a drag that stopped before release doesn't fling
      if (performance.now() - d.lt > 80) {
        this.vlon = 0;
        this.vlat = 0;
      }
      return;
    }
    const [x, y] = this.pos(e);
    const hit = this.pick(x, y);
    if (hit) this.takeoff(hit);
    else if (this.mode === "landed") this.cancel();
  }

  pointerLeave() {
    this.hasPointer = false;
    this.updatePreview(null, this.t * 1000);
  }

  // ---------- zoom ----------

  /** Zooms by a factor (below 1 zooms in) toward screen point (x, y), easing in. */
  zoomAt(x: number, y: number, factor: number) {
    this.turn = null;
    this.lastInteract = this.t;
    this.rangeTarget = clamp(this.rangeTarget * factor, RANGE_MIN, RANGE_MAX);
    const p = this.pick(x, y);
    this.zoomAnchor = p ? { p, x, y } : null;
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const [x, y] = this.pos(e);
    this.mx = x;
    this.my = y;
    this.hasPointer = true;
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.H : 1);
    // a trackpad pinch arrives as ctrl+wheel; a line-based wheel is a mouse wheel
    if (e.ctrlKey || e.metaKey || e.deltaMode !== 0) this.zoomAt(x, y, Math.exp(dy * (e.ctrlKey ? 0.012 : 0.003)));
    else this.scrollPan(e);
  };

  /**
   * A two-finger scroll turns the globe like a drag: the ground follows the fingers, at any zoom.
   * It moves the ground at the centre of the view by the scroll delta, and faster while flying so a route can cross oceans.
   */
  private scrollPan(e: WheelEvent) {
    this.turn = null;
    this.zoomAnchor = null;
    this.lastInteract = this.t;
    this.cam = this.camera();
    const c = this.disc();
    const now = performance.now();
    const g = this.mode === "flying" ? FLY_SCROLL : 1;
    // the ground at c + delta comes to the centre, which moves the ground by -delta
    const q = this.pickClamp(c.x + e.deltaX * g, c.y + e.deltaY * g, 1);
    if (!q) return;
    const lon = this.lon0;
    const lat = this.lat0;
    this.anchor(q, c.x, c.y);
    // glide on after the fingers stop. Trackpads send their own momentum events, so this stays gentle:
    // it only softens a hard stop instead of stacking a second fling on top
    const dts = Math.max(0.008, (now - this.wheelAt) / 1000);
    const live = dts < 0.1;
    this.vlon = live ? clamp(this.vlon * 0.5 + ((wrapPi(this.lon0 - lon) / dts) * 0.35) * 0.5, -2, 2) : 0;
    this.vlat = live ? clamp(this.vlat * 0.5 + (((this.lat0 - lat) / dts) * 0.35) * 0.5, -2, 2) : 0;
    this.wheelAt = now;
  }

  // Safari reports trackpad pinches as gesture events instead of ctrl+wheel
  private onGesture = (e: Event & { scale: number; clientX: number; clientY: number }) => {
    e.preventDefault();
    if (e.type === "gesturestart") this.gestureScale = 1;
    const [x, y] = this.pos(e);
    this.zoomAt(x, y, this.gestureScale / e.scale);
    this.gestureScale = e.scale;
  };

  private startPinch() {
    const [[ax, ay], [bx, by]] = [...this.touches.values()];
    const x = (ax + bx) / 2;
    const y = (ay + by) / 2;
    this.down = null;
    this.turn = null;
    this.pinch = { d0: Math.hypot(ax - bx, ay - by) || 1, range0: this.range, p: this.pick(x, y) };
  }

  private movePinch() {
    const pinch = this.pinch!;
    if (this.touches.size < 2) return;
    const [[ax, ay], [bx, by]] = [...this.touches.values()];
    this.range = this.rangeTarget = clamp(pinch.range0 * (pinch.d0 / (Math.hypot(ax - bx, ay - by) || 1)), RANGE_MIN, RANGE_MAX);
    this.zoomAnchor = null;
    // the ground you pinched stays under the fingers' midpoint, so two fingers zoom and pan together
    if (pinch.p) this.anchor(pinch.p, (ax + bx) / 2, (ay + by) / 2);
    this.lastInteract = this.t;
  }

  /** Turns the view so the ground point p sits under screen point (x, y). */
  private anchor(p: Vec3, x: number, y: number) {
    for (let i = 0; i < 4; i++) {
      this.cam = this.camera();
      const q = this.pick(x, y);
      if (!q) return;
      const a = angle(q, p);
      if (a < 1e-7) return;
      // turning the camera rig by the rotation that takes q to p puts p under the pointer;
      // the rig keeps north up, so repeat a few times to absorb the roll
      const target = llOf(rotAround(vecOf(this.lat0, this.lon0), norm(cross(q, p)), a));
      this.lat0 = clamp(target.lat, -LAT_MAX, LAT_MAX);
      this.lon0 = target.lon;
    }
    this.cam = this.camera();
  }

  /** The camera range that fits a route of angular length w comfortably on screen. */
  private fitRange(w: number) {
    const half = Math.atan(this.tan0 * Math.min(1, this.asp)) * 0.6;
    const a = w / 2 + 0.03;
    return clamp(Math.sin(a) / Math.tan(half) + Math.cos(a) - 1, RANGE_MIN, RANGE_MAX);
  }

  /** The plane's world scale: a touch less than zoomScale, so on screen it grows to about 1.5x as you zoom right in. */
  private get planeScale() {
    return Math.pow(this.zoomScale, 0.85);
  }

  /** 1 when fully zoomed out, smaller when zoomed in. */
  private get zoomScale() {
    return this.range / RANGE_MAX;
  }

  // ---------- trip ----------

  cancel() {
    const wasActive = this.mode !== "idle";
    this.mode = "idle";
    this.origin = null;
    this.dest = null;
    this.pl = null;
    this.turn = null;
    this.originHub = this.destinationHub = null;
    this.updatePreview(null, this.t * 1000);
    this.lastInteract = this.t;
    this.events.onModeChange?.("idle", null);
    if (wasActive) this.events.onCancel?.();
  }

  private takeoff(o: Vec3) {
    const cam = this.cam ?? this.camera();
    this.mode = "flying";
    this.origin = o;
    this.dest = null;
    this.destinationHub = null;
    this.originHub = nearestPreviewHub(toLatLng(o));
    this.pl = { n: o, f: tangent(cam.U, o), alt: 0, bank: 0, pitch: 0 };
    this.tTake = this.t;
    this.vlon = 0;
    this.vlat = 0;
    this.turn = null;
    this.events.onModeChange?.("flying", this.originHub);
  }

  private land(v: Vec3) {
    const pl = this.pl!;
    const origin = this.origin!;
    this.mode = "landed";
    this.tLand = this.t;
    this.dest = v;
    pl.n = v;
    pl.f = tangent(pl.f, v);
    this.destinationHub = nearestPreviewHub(toLatLng(v));
    this.updatePreview(null, this.t * 1000);
    // turn the globe to frame the whole route
    // and back out if the whole route doesn't fit, rising mid-way like a fly-to
    const mid = llOf(slerp(origin, v, 0.5));
    const range = Math.max(this.range, this.fitRange(angle(origin, v)));
    this.zoomAnchor = null;
    this.turn = {
      from: { lon: this.lon0, lat: this.lat0, range: this.range },
      to: { lon: mid.lon, lat: clamp(mid.lat, -1, 1), range },
      hop: this.range < 1.2 && !this.reduceMotion ? Math.min(0.5, 0.25 * angle(origin, v) + 0.08) : 0,
      t0: this.t + (this.reduceMotion ? 0 : 0.5),
      dur: this.reduceMotion ? 0.001 : 1.5,
    };
    const depart = new Date();
    depart.setDate(depart.getDate() + 1);
    this.events.onModeChange?.("landed", this.originHub);
    this.events.onLand?.({
      from: this.originHub,
      to: this.destinationHub,
      origin: toLatLng(origin),
      destination: toLatLng(v),
      distanceKm: Math.round(EARTH_RADIUS_KM * angle(origin, v)),
      departDate: depart,
    });
  }

  // ---------- GL setup ----------

  private attrib(gl: WebGL2RenderingContext, loc: number, data: Float32Array, size: number) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }

  private program(gl: WebGL2RenderingContext, vs: string, fs: string, attrs: string[]): Program {
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error("[trip-globe] shader", gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error("[trip-globe] link", gl.getProgramInfoLog(p));
    const u: Program["u"] = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i)!;
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  // The textures are data, not pictures. Earth: r = land mask, g = distance from the coast, b = relief.
  // Borders: each country's 3-bit code, one bit per channel (see scripts/build-borders.mts).
  // They must be uploaded without colour-space conversion or premultiplication.
  private dataTexture(gl: WebGL2RenderingContext, url: string, until: number[]) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(until));
    const put = (src: TexImageSource) => {
      if (this.gl !== gl) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      this.glDirty = true;
    };
    const viaImg = () => {
      const im = new Image();
      im.onload = () => put(im);
      im.src = url;
    };
    if (typeof createImageBitmap === "function") {
      fetch(url)
        .then((r) => r.blob())
        .then((b) => createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" }))
        .then((bitmap) => {
          put(bitmap);
          bitmap.close();
        })
        .catch(viaImg);
    } else viaImg();
    return tex;
  }

  private onMotionChange = (e: MediaQueryListEvent) => {
    this.reduceMotion = e.matches;
    this.hudDirty = true;
  };

  private resize() {
    const W = this.root.clientWidth || 1;
    const H = this.root.clientHeight || 1;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (W !== this.W || H !== this.H || dpr !== this.dpr) {
      if (dpr !== this.dpr) this.nameSprites.clear();
      this.glDirty = this.hudDirty = true;
      this.W = W;
      this.H = H;
      this.dpr = dpr;
      this.asp = W / H;
      this.Rpx = Math.min(W * 0.4, H * 0.37);
      this.tan0 = (Math.tan(Math.asin(1 / DG)) * (H / 2)) / this.Rpx;
      const cw = Math.round(W * dpr);
      const ch = Math.round(H * dpr);
      this.glEl.width = cw;
      this.glEl.height = ch;
      this.hudEl.width = cw;
      this.hudEl.height = ch;
    }
  }

  // ---------- camera and picking ----------

  /** How far the camera leans from straight down: none when zoomed out, up to TILT_MAX near the ground. */
  private get tilt() {
    return TILT_MAX * (1 - smooth(RANGE_MIN, 0.9, this.range));
  }

  /** The camera orbits its target on the ground (lat0, lon0) at `range`, north up, leaning back to the south. */
  private camera(): Camera {
    const T = vecOf(this.lat0, this.lon0);
    const R: Vec3 = [Math.cos(this.lon0), 0, -Math.sin(this.lon0)]; // east
    const north = cross(T, R);
    const tilt = this.tilt;
    const C = add(T, mul(add(mul(T, Math.cos(tilt)), mul(north, -Math.sin(tilt))), this.range));
    const F = norm(sub(T, C));
    return { C, F, R, U: cross(R, F), tan: this.tan0, shift: -0.09 };
  }

  /** The globe's centre and radius on screen, or the viewport once the globe overflows it. */
  private disc() {
    const r = (this.H / 2) * (Math.tan(Math.asin(1 / len(this.cam!.C))) / this.tan0);
    const fit = Math.min(this.W, this.H) / 2;
    return r < fit ? { x: this.W / 2, y: this.H * CENTRE_Y, r } : { x: this.W / 2, y: this.H / 2, r: fit };
  }

  private rayAt(x: number, y: number, c: Camera) {
    const nx = (x / this.W) * 2 - 1;
    const ny = 1 - (y / this.H) * 2;
    return norm(add(c.F, add(mul(c.R, nx * c.tan * this.asp), mul(c.U, (ny + c.shift) * c.tan))));
  }

  /** The ground direction under a screen point, hitting a sphere of radius r (1 = the surface). */
  private pick(x: number, y: number, r = 1): Vec3 | null {
    const c = this.cam;
    if (!c) return null;
    const d = this.rayAt(x, y, c);
    const b = dot(c.C, d);
    const disc = b * b - (dot(c.C, c.C) - r * r);
    if (disc < 0 || b > 0) return null;
    return norm(add(c.C, mul(d, -b - Math.sqrt(disc))));
  }

  /** A point on the globe under the cursor; off the globe, the nearest point on its edge. */
  private pickClamp(x: number, y: number, r: number) {
    const hit = this.pick(x, y, r);
    if (hit) return hit;
    // walk from the globe's centre toward the pointer and keep the last point still on the globe
    const c = this.proj([0, 0, 0]);
    if (!c) return null;
    let best: Vec3 | null = null;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 14; i++) {
      const m = (lo + hi) / 2;
      const p = this.pick(c.x + (x - c.x) * m * 0.995, c.y + (y - c.y) * m * 0.995);
      if (p) {
        best = p;
        lo = m;
      } else hi = m;
    }
    return best;
  }

  /** Screen position of a world point, and whether the globe hides it. */
  private proj(p: Vec3, out = screenPoint()): ScreenPoint | null {
    const c = this.cam!;
    const x = p[0] - c.C[0], y = p[1] - c.C[1], z = p[2] - c.C[2];
    const vz = x * c.F[0] + y * c.F[1] + z * c.F[2];
    if (vz < 0.003) return null;
    const nx = (x * c.R[0] + y * c.R[1] + z * c.R[2]) / (vz * c.tan * this.asp);
    const ny = (x * c.U[0] + y * c.U[1] + z * c.U[2]) / (vz * c.tan) - c.shift;
    const L = Math.hypot(x, y, z);
    const inv = 1 / L;
    const b = c.C[0] * (x * inv) + c.C[1] * (y * inv) + c.C[2] * (z * inv);
    const disc = b * b - (dot(c.C, c.C) - 1);
    let vis = true;
    if (disc > 0) {
      const t1 = -b - Math.sqrt(disc);
      if (t1 > 0 && t1 < L - 1e-3) vis = false;
    }
    out.x = (nx * 0.5 + 0.5) * this.W;
    out.y = (0.5 - ny * 0.5) * this.H;
    out.vis = vis;
    out.z = vz;
    return out;
  }

  private pos(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.root.getBoundingClientRect();
    return [(e.clientX - r.left) * (this.W / (r.width || 1)), (e.clientY - r.top) * (this.H / (r.height || 1))];
  }

  // ---------- places on screen ----------

  /** The place under the pointer, or null when the pointer is off the globe or has left it. */
  pointerLatLng(): LatLng | null {
    const p = this.hasPointer && this.cam ? this.pick(this.mx, this.my) : null;
    return p ? toLatLng(p) : null;
  }

  /** This viewer's trip, for sharing with the room. Null while idle. */
  flight(): FlightState | null {
    const pl = this.pl;
    if (this.mode === "idle" || !pl || !this.origin) return null;
    return {
      origin: toLatLng(this.origin),
      at: toLatLng(pl.n),
      ahead: toLatLng(norm(add(pl.n, mul(pl.f, 0.02)))),
      landed: this.mode === "landed",
    };
  }

  /** Replaces the other members' flights. Planes ease toward each update rather than jumping. */
  setRemoteFlights(flights: RemoteFlight[]) {
    const seen = new Set<string>();
    for (const f of flights) {
      seen.add(f.id);
      const target = vecOf(f.at.lat * D2R, f.at.lng * D2R);
      const ahead = vecOf(f.ahead.lat * D2R, f.ahead.lng * D2R);
      const ft = tangent(sub(ahead, target), target);
      const o = vecOf(f.origin.lat * D2R, f.origin.lng * D2R);
      const r = this.remotes.get(f.id);
      // Resolve fixed endpoint labels only when presence changes them, never in the draw loop.
      // Null is a valid cached result for points outside local hub coverage.
      const originHub = r && o.every((v, i) => v === r.o[i])
        ? r.originHub : nearestPreviewHub(f.origin);
      const destinationHub = !f.landed ? null
        : r?.landed && target.every((v, i) => v === r.target[i])
          ? r.destinationHub : nearestPreviewHub(f.at);
      if (r) Object.assign(r, { o, target, ft, landed: f.landed, originHub, destinationHub });
      else this.remotes.set(f.id, {
        o, target, ft, landed: f.landed, originHub, destinationHub,
        pl: { n: target, f: ft, alt: 0, bank: 0, pitch: 0 },
      });
    }
    for (const id of this.remotes.keys()) if (!seen.has(id)) this.remotes.delete(id);
  }

  /** Where another member's plane is on screen, for their name label. Null if they aren't flying or it's hidden. */
  remotePlane(id: string): { x: number; y: number } | null {
    const r = this.remotes.get(id);
    const p = r && this.cam ? this.proj(mul(r.pl.n, 1 + r.pl.alt)) : null;
    return p && p.vis ? { x: p.x, y: p.y } : null;
  }

  /** Where a place is on screen, in CSS px, and whether the globe hides it. Null before the first frame. */
  project(ll: LatLng): { x: number; y: number; visible: boolean } | null {
    if (!this.cam) return null;
    const p = this.proj(vecOf(ll.lat * D2R, ll.lng * D2R));
    return p ? { x: p.x, y: p.y, visible: p.vis } : null;
  }

  /** How far the view is zoomed in: 0 for the whole globe, 1 at the closest range, even in log steps. */
  zoom(): number {
    return Math.log(RANGE_MAX / this.range) / Math.log(RANGE_MAX / RANGE_MIN);
  }

  // ---------- simulation ----------

  private sim(dt: number, t: number) {
    const k = (r: number) => 1 - Math.exp(-dt * r);
    this.nameInk += ((this.mode === "idle" ? 1 : 0.7) - this.nameInk) * (this.reduceMotion ? 1 : k(6));
    for (const r of this.remotes.values()) {
      const pl = r.pl;
      const a = this.reduceMotion ? 1 : k(14);
      pl.n = norm(slerp(pl.n, r.target, a));
      pl.f = tangent(lerp(pl.f, r.ft, a), pl.n);
      pl.alt += ((r.landed ? 0 : ALT * this.planeScale) - pl.alt) * k(8);
    }
    if (this.turn) {
      // fly the view to frame a finished route
      const tr = this.turn;
      const e = ease((t - tr.t0) / tr.dur);
      this.lon0 = tr.from.lon + wrapPi(tr.to.lon - tr.from.lon) * e;
      this.lat0 = tr.from.lat + (tr.to.lat - tr.from.lat) * e;
      this.range = this.rangeTarget = tr.from.range + (tr.to.range - tr.from.range) * e + tr.hop * Math.sin(Math.PI * e);
      if (t - tr.t0 >= tr.dur) this.turn = null;
    } else if (!this.pinch && Math.abs(Math.log(this.rangeTarget / this.range)) > 1e-4) {
      // zoom: ease the range in log space, keeping the anchored ground point under the pointer
      const e = this.reduceMotion ? 1 : k(12);
      this.range = Math.exp(Math.log(this.range) + (Math.log(this.rangeTarget) - Math.log(this.range)) * e);
      if (this.zoomAnchor) this.anchor(this.zoomAnchor.p, this.zoomAnchor.x, this.zoomAnchor.y);
    } else if (!this.pinch) {
      this.range = this.rangeTarget;
      this.zoomAnchor = null;
    }
    if (!this.turn && !this.down?.drag && !this.pinch) {
      // the glide waits while scroll events are still moving the globe themselves
      if (performance.now() - this.wheelAt > 100) {
        this.lon0 += this.vlon * dt;
        this.lat0 += this.vlat * dt;
        const damp = Math.exp(-dt * 2.6);
        this.vlon *= damp;
        this.vlat *= damp;
      }
      // drift slowly when left alone
      if (this.mode === "idle" && !this.reduceMotion && t - this.lastInteract > 2) {
        this.lon0 += 0.06 * this.zoomScale * dt * Math.min(1, (t - this.lastInteract - 2) / 2);
      }
      if (this.mode === "flying" && this.hasPointer && !this.dest) {
        // near the edge, the globe turns so the plane can keep going
        const disc = this.disc();
        const dx = (this.mx - disc.x) / disc.r;
        const dy = (this.my - disc.y) / disc.r;
        const rho = Math.hypot(dx, dy);
        if (rho > 0.6) {
          const s = Math.min(1, (rho - 0.6) / 0.55);
          const sp = 1.1 * s * s * Math.max(0.05, this.zoomScale);
          this.lon0 += ((dx / rho) * sp * dt) / Math.max(0.4, Math.cos(this.lat0));
          this.lat0 -= (dy / rho) * sp * dt;
        }
      }
    }
    this.lat0 = clamp(this.lat0, -LAT_MAX, LAT_MAX);
    this.lon0 = wrapPi(this.lon0);
    const pl = this.pl;
    if (!pl || this.mode === "idle") return;

    if (this.mode === "flying") {
      // the plane sits under the cursor and points along the great circle from the origin
      pl.alt += (ALT * this.planeScale * smooth(0, 0.5, t - this.tTake) - pl.alt) * k(10);
      const hit = this.hasPointer ? this.pickClamp(this.mx, this.my, 1 + pl.alt) : null;
      if (hit) {
        const origin = this.origin!;
        const fPrev = pl.f;
        const fT = angle(origin, hit) > 0.01 ? tangent(sub(hit, slerp(origin, hit, 0.97)), hit) : tangent(pl.f, hit);
        pl.n = hit;
        pl.f = tangent(lerp(tangent(pl.f, hit), fT, k(14)), hit);
        const turn = Math.atan2(dot(cross(fPrev, pl.f), hit), dot(fPrev, pl.f)) / Math.max(dt, 1e-3);
        pl.bank += (clamp(-turn * 0.08, -0.6, 0.6) - pl.bank) * k(6);
      }
    } else if (this.mode === "landed") {
      // touchdown: the plane settles onto its shadow
      pl.alt += (0 - pl.alt) * k(8);
      pl.bank += (0 - pl.bank) * k(8);
    }
  }

  // ---------- loop ----------

  /** Compare the scene using reusable buffers. Time alone doesn't change the globe or a settled HUD. */
  private sceneChanged() {
    const state = this.scene;
    state.length = 0;
    state.push(this.lon0, this.lat0, this.range, this.mode === "idle" ? 0 : this.mode === "flying" ? 1 : 2);
    const plane = (pl: Plane) => state.push(...pl.n, ...pl.f, pl.alt, pl.bank, pl.pitch);
    if (this.pl) plane(this.pl);
    if (this.origin) state.push(...this.origin);
    for (const r of this.remotes.values()) {
      state.push(...r.o, Number(r.landed));
      plane(r.pl);
    }
    const changed = state.length !== this.lastScene.length || state.some((v, i) => v !== this.lastScene[i]);
    this.scene = this.lastScene;
    this.lastScene = state;
    return changed;
  }

  private tick = (ts: number) => {
    if (!this.gl) return;
    this.raf = requestAnimationFrame(this.tick);
    const t = ts / 1000;
    const dt = this.t ? clamp(t - this.t, 0, 0.05) : 0.016;
    this.t = t;
    this.resize();
    const nameInk = this.nameInk;
    this.sim(dt, t);
    this.cam = this.camera();
    this.hover = this.hasPointer && !this.down?.drag && !this.pinch ? this.pick(this.mx, this.my) : null;
    // Use the surface raycast after the camera moves, not the elevated plane's
    // normal or a clamped horizon point. Pan/zoom under a still cursor also updates.
    this.updatePreview(this.mode === "landed" ? null : this.hover, ts);
    if (this.sceneChanged()) this.glDirty = true;
    const hover = !!this.hover && this.mode !== "flying";
    const animated = !this.reduceMotion && (hover || this.mode === "landed" ||
      (this.mode === "flying" && t - this.tTake <= 0.7));
    if (this.glDirty || nameInk !== this.nameInk || this.namesMoving || animated || this.hudAnimated ||
        hover !== this.hudHover || (hover && (this.mx !== this.hudX || this.my !== this.hudY))) this.hudDirty = true;
    if (this.glDirty) {
      this.drawGL();
      this.glDirty = false;
    }
    if (this.hudDirty) {
      this.drawHud(t);
      this.hudDirty = false;
      this.hudHover = hover;
      this.hudAnimated = animated;
      this.hudX = this.mx;
      this.hudY = this.my;
    } else this.nameT = t;
    // Remote DOM cursors ease independently of the canvases, so keep their frame callbacks running.
    this.events.onFrame?.();
  };

  private updatePreview(point: Vec3 | null, nowMs: number) {
    const next = this.hoverResolver.resolve(point ? toLatLng(point) : null, nowMs);
    if (next?.id === this.hoverHub?.id) return;
    this.hoverHub = next;
    this.hudDirty = true;
    this.events.onPreviewChange?.(next);
  }

  private planeBasis(pl: Plane, S: number) {
    let up = pl.n;
    let fwd = pl.f;
    const right = cross(fwd, up);
    const cp = Math.cos(pl.pitch);
    const sp = Math.sin(pl.pitch);
    const fwd2 = add(mul(fwd, cp), mul(up, sp));
    up = sub(mul(up, cp), mul(fwd, sp));
    fwd = fwd2;
    const cb = Math.cos(pl.bank);
    const sb = Math.sin(pl.bank);
    const up3 = add(mul(up, cb), mul(right, sb));
    const right3 = sub(mul(right, cb), mul(up, sb));
    return { X: mul(right3, S), Y: mul(up3, S), Z: mul(fwd, S) };
  }

  /** Device-pixel bounds of the sphere's tangent rays, in GL's bottom-up coordinates. */
  private surfaceBounds(): [number, number, number, number] {
    const c = this.cam!;
    const w = this.glEl.width, h = this.glEl.height;
    const z = -dot(c.C, c.F);
    // Close, tilted views can cross the sphere's tangent plane: keep the full draw in that case.
    if (z <= 1) return [0, 0, w, h];
    const bounds = (v: number, scale: number, shift: number, size: number) => {
      const r = Math.sqrt(v * v + z * z - 1);
      const lo = ((v * z - r) / (z * z - 1) / scale - shift) * 0.5 + 0.5;
      const hi = ((v * z + r) / (z * z - 1) / scale - shift) * 0.5 + 0.5;
      // Round outwards with room for float precision and derivative helpers.
      return [clamp(Math.floor(lo * size) - 2, 0, size), clamp(Math.ceil(hi * size) + 2, 0, size)];
    };
    const [x0, x1] = bounds(-dot(c.C, c.R), c.tan * this.asp, 0, w);
    const [y0, y1] = bounds(-dot(c.C, c.U), c.tan, c.shift, h);
    return [x0, y0, x1 - x0, y1 - y0];
  }

  private drawGL() {
    const gl = this.gl!;
    const c = this.cam!;
    const th = this.P;
    const cw = this.glEl.width;
    const ch = this.glEl.height;
    const dpr = cw / this.W;
    // lit from the upper left
    const L = norm(add(add(mul(c.R, -0.5), mul(c.U, 0.55)), mul(c.F, -0.68)));
    const pl = this.pl;
    const showPlane = !!pl && this.mode !== "idle";
    const S = S_PLANE * this.planeScale;
    const pp = pl && showPlane ? mul(pl.n, 1 + pl.alt + 0.09 * S) : null;
    // the plane's shadow falls along the light onto the ground
    let shP: Vec3 = pl && showPlane ? pl.n : [0, 1, 0];
    let shadow = !!pp;
    if (pp) {
      const ld = mul(L, -1);
      const b = dot(pp, ld);
      const disc = b * b - (dot(pp, pp) - 1);
      const t = -b - Math.sqrt(Math.max(disc, 0));
      // t <= 0: the globe sits between the light and the plane (it's round the far side), so it casts no shadow.
      // Taking that hit anyway put the shadow on the near face.
      if (disc > 0) {
        if (t > 0) shP = norm(add(pp, mul(ld, t)));
        else shadow = false;
      }
    }
    const setCam = (u: Program["u"]) => {
      gl.uniform3fv(u.uC, c.C);
      gl.uniform3fv(u.uRr, c.R);
      gl.uniform3fv(u.uUu, c.U);
      gl.uniform3fv(u.uFf, c.F);
      gl.uniform1f(u.uTan, c.tan);
      gl.uniform1f(u.uAsp, this.asp);
      gl.uniform1f(u.uShift, c.shift);
      gl.uniform3fv(u.uL, L);
      gl.uniform1f(u.uPer, HALFTONE_PITCH * dpr);
    };

    gl.viewport(0, 0, cw, ch);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    let P = this.pGlobe;
    let u = P.u;
    gl.useProgram(P.p);
    gl.bindVertexArray(this.vaoQuad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texEarth);
    gl.uniform1i(u.uEarth, 0);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.texBorders);
    gl.uniform1i(u.uBorders, 2);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.sky?.texture ?? null);
    gl.uniform1i(u.uSky, 1);
    gl.uniform1f(u.uSkyInk, th.skyInk);
    gl.uniform2f(u.uRes, cw, ch);
    gl.uniform1f(u.uDpr, dpr);
    setCam(u);
    gl.uniform1f(u.uDark, th.dark);
    for (const [key, value] of Object.entries(th.gl)) gl.uniform3fv(u[key], value);
    gl.uniform3fv(u.uShP, shP);
    gl.uniform1f(u.uShR, S * 0.42);
    gl.uniform1f(u.uShA, pl && shadow ? 0.95 - 0.4 * smooth(0, ALT * this.planeScale, pl.alt) : 0);
    const [x, y, w, h] = this.surfaceBounds();
    if (w === cw && h === ch) {
      gl.uniform1i(u.uSurface, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      const rect = (x: number, y: number, w: number, h: number) => {
        if (w <= 0 || h <= 0) return;
        gl.scissor(x, y, w, h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      gl.enable(gl.SCISSOR_TEST);
      gl.uniform1i(u.uSurface, 0);
      rect(0, 0, x, ch);
      rect(x + w, 0, cw - x - w, ch);
      rect(x, 0, w, y);
      rect(x, y + h, w, ch - y - h);
      gl.uniform1i(u.uSurface, 1);
      rect(x, y, w, h);
      gl.disable(gl.SCISSOR_TEST);
    }
    this.sky?.draw(setCam, [cw, ch], dpr, th.gl.uInk, th.skyInk, 1);

    // other members' planes first, so this viewer's own plane sits on top
    const planes: { pl: Plane; pp: Vec3 }[] = [];
    for (const r of this.remotes.values()) planes.push({ pl: r.pl, pp: mul(r.pl.n, 1 + r.pl.alt + 0.09 * S) });
    if (pl && pp) planes.push({ pl, pp });
    const shown = planes.filter(({ pp }) => this.proj(pp)?.vis);
    if (!shown.length) return;

    P = this.pPlane;
    u = P.u;
    gl.useProgram(P.p);
    gl.bindVertexArray(this.vaoPlane);
    setCam(u);
    gl.uniform2f(u.uRes, cw, ch);
    gl.uniform3fv(u.uFill, th.stickerGL.fill);
    gl.uniform3fv(u.uInkS, th.stickerGL.ink);
    gl.uniform3fv(u.uRoundel, th.stickerGL.roundel);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    for (const { pl, pp } of shown) {
      const B = this.planeBasis(pl, S);
      gl.uniform3fv(u.uPP, pp);
      gl.uniform3fv(u.uPX, B.X);
      gl.uniform3fv(u.uPY, B.Y);
      gl.uniform3fv(u.uPZ, B.Z);
      // each plane is its own sticker: a later one covers an earlier one wholly
      gl.clear(gl.DEPTH_BUFFER_BIT);
      // 1: the ink outline, which also draws inner edges
      gl.uniform1f(u.uMode, 2);
      gl.uniform1f(u.uHull, 1.1 * dpr);
      gl.drawArrays(gl.TRIANGLES, 0, this.planeCount);
      // 2: the paper body
      gl.uniform1f(u.uMode, 0);
      gl.uniform1f(u.uHull, 0);
      gl.drawArrays(gl.TRIANGLES, 0, this.planeCount);
    }
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
  }

  // ---------- overlay ----------

  private strokePts(ctx: CanvasRenderingContext2D, pts: (ScreenPoint | null)[]) {
    ctx.beginPath();
    let pen = false;
    for (const p of pts) {
      if (p && p.vis) {
        if (pen) ctx.lineTo(p.x, p.y);
        else {
          ctx.moveTo(p.x, p.y);
          pen = true;
        }
      } else pen = false;
    }
    ctx.stroke();
  }

  private tag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
    const P = this.P;
    ctx.save();
    ctx.font = this.tagFont;
    const maxTextWidth = Math.max(1, this.W - 30);
    if (ctx.measureText(text).width > maxTextWidth) {
      while (text.length > 1 && ctx.measureText(`${text}…`).width > maxTextWidth) text = text.slice(0, -1);
      text += "…";
    }
    const w = Math.ceil(ctx.measureText(text).width) + 14;
    const h = 21;
    const lx = clamp(x - w / 2, 8, Math.max(8, this.W - w - 8));
    const ly = clamp(y - h / 2, 8, Math.max(8, this.H - h - 8));
    ctx.beginPath();
    ctx.roundRect(lx + 2, ly + 2, w, h, 4);
    ctx.fillStyle = P.tagShadow;
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(lx, ly, w, h, 4);
    ctx.fillStyle = P.raised;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = P.ink;
    ctx.stroke();
    ctx.fillStyle = P.ink;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(text, lx + 7, ly + h / 2 + 0.5);
    ctx.restore();
  }

  /** A name's width at a 1px font size, with the token's letter spacing. Names are set in capitals. */
  private nameWidth(ctx: CanvasRenderingContext2D, name: string): number {
    let w = this.nameWidths.get(name);
    if (w === undefined && name.includes("\n")) {
      // a wrapped name is as wide as its longer line
      w = Math.max(...name.split("\n").map((line) => this.nameWidth(ctx, line)));
      this.nameWidths.set(name, w);
    }
    if (w === undefined) {
      ctx.font = `${COUNTRY_TYPE.weight} 100px ${this.nameFamily}`;
      ctx.letterSpacing = "0px";
      w = ctx.measureText(name.toUpperCase()).width / 100 + COUNTRY_TYPE.spacing * (name.length - 1);
      this.nameWidths.set(name, w);
    }
    return w;
  }

  /** A name drawn at NAME_MAX × the token size and the screen's pixel ratio, with its halo, centred. */
  private nameSprite(name: string, dpr: number) {
    let c = this.nameSprites.get(name);
    if (c) return c;
    const P = this.P;
    const px = COUNTRY_TYPE.size * NAME_MAX * dpr;
    const ls = COUNTRY_TYPE.spacing * px;
    const pad = Math.ceil(px * 0.3);
    c = document.createElement("canvas");
    c.width = Math.ceil(this.nameWidth(this.hud, name) * px) + pad * 2;
    const lines = name.toUpperCase().split("\n");
    const lh = px * 1.15;
    c.height = Math.ceil(px * 1.2 + lh * (lines.length - 1)) + pad * 2;
    const g = c.getContext("2d")!;
    g.font = `${COUNTRY_TYPE.weight} ${px}px ${this.nameFamily}`;
    g.letterSpacing = `${ls}px`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    // canvas adds the spacing after the last letter too; shift back by half of it to stay centred
    const x = c.width / 2 + ls / 2;
    const y = c.height / 2 + px * 0.05 - (lh * (lines.length - 1)) / 2;
    // a soft paper halo lifts the letters off the halftone without boxing them in
    g.strokeStyle = P.paper;
    g.globalAlpha = 0.7;
    g.lineWidth = px * 0.22;
    lines.forEach((line, i) => g.strokeText(line, x, y + i * lh));
    g.globalAlpha = 1;
    g.fillStyle = P.ink;
    lines.forEach((line, i) => g.fillText(line, x, y + i * lh));
    this.nameSprites.set(name, c);
    return c;
  }

  /**
   * Country names, set in capitals in the typewriter face. A name shows once the country is big enough on screen to
   * hold it, fading in as it gets room; long thin countries run their name along their axis. Bigger countries win
   * when names collide, and none sits on a plane or an airport tag.
   */
  private countryNames(ctx: CanvasRenderingContext2D, keepClear: { x: number; y: number }[], t: number) {
    const C = this.cam!.C;
    const dpr = this.hudEl.width / this.W;
    const base = COUNTRY_TYPE.size;
    const dt = this.nameT ? clamp(t - this.nameT, 0, 0.1) : 0;
    this.nameT = t;
    // names fade over about 0.2s rather than popping; under reduced motion they switch
    const ease = this.reduceMotion ? 1 : 1 - Math.exp(-dt * 14);
    this.namesMoving = false;
    // the whole globe carries no names: they print in as you zoom in, following the zoom rather than popping
    const zoomInk = 1 - smooth(RANGE_MAX * 0.8, RANGE_MAX * 0.95, this.range);
    if (zoomInk <= 0) {
      this.nameFade.fill(0);
      this.namePlaced.fill(0);
      return;
    }

    // 1. where each name would go this frame, and whether it has room there
    const spots = this.visibleNames;
    spots.length = 0;
    for (let i = 0; i < NAMES.length; i++) {
      const n = NAMES[i];
      const sp = this.nameSpots[i];
      // most names are on the far side or near the limb: reject them before any projection
      const x = C[0] - n.v[0], y = C[1] - n.v[1], z = C[2] - n.v[2];
      const facing = (n.v[0] * x + n.v[1] * y + n.v[2] * z) / Math.hypot(x, y, z);
      const p = facing > 0.22 ? this.proj(n.v, sp.p) : null;
      if (!p || !p.vis) {
        this.nameFade[i] = 0;
        this.namePlaced[i] = 0;
        continue;
      }
      // which way the axis (or the parallel) runs on screen, and how many px a radian of it covers there
      const step = (point: Vec3) => {
        const q = this.proj(point, sp.q);
        if (!q) return null;
        let a = Math.atan2(q.y - p.y, q.x - p.x);
        if (a > Math.PI / 2) a -= Math.PI;
        else if (a < -Math.PI / 2) a += Math.PI;
        return { a, px: Math.hypot(q.x - p.x, q.y - p.y) / 0.01 };
      };
      let s = n.long ? step(n.axisStep) : null;
      let room = 0;
      // keep text within 60° of level (66° once it runs that way, so it doesn't flip back and forth);
      // steeper countries (Vietnam, Chile) are named across instead
      const steep = ((this.nameOnAxis[i] ? 66 : 60) * Math.PI) / 180;
      if (s && Math.abs(s.a) < steep) {
        room = n.along * s.px;
        this.nameOnAxis[i] = 1;
      } else {
        this.nameOnAxis[i] = 0;
        if ((s = step(n.eastStep))) room = n.across * s.px;
      }
      if (!s) continue;
      const size = clamp(room * 0.05, base, base * NAME_MAX);
      // names may run a little past a small country's edges, as on a printed map.
      // A name on screen keeps its place until it is clearly out of room; a new one waits until it clearly has room
      const need = this.namePlaced[i] ? 0.95 : 1.1;
      const fitOf = (text: string) => (room * 0.9 + 28) / (this.nameWidth(ctx, text) * size);
      let fit = fitOf(n.name);
      // a long name that won't fit on one line goes on two; it comes back to one line only with room to spare
      const wrapped = !!n.wrap && fit < (this.nameWrapped[i] ? 1.25 : need);
      this.nameWrapped[i] = wrapped ? 1 : 0;
      if (wrapped) fit = fitOf(n.wrap!);
      const w = this.nameWidth(ctx, wrapped ? n.wrap! : n.name) * size;
      const cos = Math.abs(Math.cos(s.a));
      const sin = Math.abs(Math.sin(s.a));
      const hw = w / 2 + 6;
      const hh = size * (wrapped ? 1.35 : 0.75);
      const ex = cos * hw + sin * hh;
      const ey = sin * hw + cos * hh;
      sp.x = p.x;
      sp.y = p.y;
      sp.a = s.a;
      sp.size = size;
      sp.facing = facing;
      sp.box[0] = p.x - ex;
      sp.box[1] = p.y - ey;
      sp.box[2] = p.x + ex;
      sp.box[3] = p.y + ey;
      sp.wrapped = wrapped;
      sp.fits = fit >= need;
      spots.push(sp);
    }

    // 2. place them: names already showing first, so a newcomer never knocks one off; then biggest country first
    const placed = this.placedNames;
    placed.length = 0;
    const won = this.nameWon;
    won.fill(0);
    // Spots are already in country-size order; two passes preserve the priority without sorting.
    for (let priority = 1; priority >= 0; priority--) {
      for (const sp of spots) {
        if (!sp.fits || this.namePlaced[sp.i] !== priority || (!priority && t < this.nameHold[sp.i])) continue;
        const box = sp.box;
        // a name already showing gets a few px of slack before a neighbour counts as a collision
        const slack = priority ? 4 : 0;
        if (placed.some((b) => box[0] + slack < b[2] && box[2] - slack > b[0] && box[1] + slack < b[3] && box[3] - slack > b[1])) continue;
        if (keepClear.some((c) => c.x > box[0] - 30 && c.x < box[2] + 30 && c.y > box[1] - 22 && c.y < box[3] + 34)) continue;
        placed.push(box);
        won[sp.i] = 1;
      }
    }

    // 3. fade toward the outcome, and draw anything still visible (a losing name fades out where it was)
    ctx.save();
    ctx.imageSmoothingQuality = "high";
    for (const sp of spots) {
      const on = !!won[sp.i];
      if (!on && this.namePlaced[sp.i]) this.nameHold[sp.i] = t + 0.6;
      this.namePlaced[sp.i] = on ? 1 : 0;
      const prev = this.nameFade[sp.i];
      const f = (this.nameFade[sp.i] += ((on ? 1 : 0) - prev) * ease);
      if (t < this.nameHold[sp.i] || (!dt && f !== Number(on)) ||
          (this.nameFade[sp.i] !== prev && Math.max(prev, f) >= 0.01)) this.namesMoving = true;
      const alpha = f * smooth(0.22, 0.4, sp.facing) * this.nameInk * zoomInk;
      if (alpha < 0.01) continue;
      const n = NAMES[sp.i];
      const img = this.nameSprite(sp.wrapped && n.wrap ? n.wrap : n.name, dpr);
      const k = sp.size / (base * NAME_MAX * dpr);
      const c = Math.cos(sp.a) * k;
      const si = Math.sin(sp.a) * k;
      ctx.globalAlpha = alpha;
      ctx.setTransform(dpr * c, dpr * si, -dpr * si, dpr * c, dpr * sp.x, dpr * sp.y);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
    }
    ctx.restore();
  }

  /** The route's start: a small ring at the foot of the line. */
  private startMark(ctx: CanvasRenderingContext2D, x: number, y: number) {
    const P = this.P;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = P.raised;
    ctx.fill();
    ctx.lineWidth = 2; // line-route
    ctx.strokeStyle = P.ink;
    ctx.stroke();
    ctx.restore();
  }

  private ring(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
    const P = this.P;
    const r = this.reduceMotion ? 8 : 8 + Math.sin(t * 4) * 1.5;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = `rgba(${P.inkRGB},0.7)`;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 1.6, 0, Math.PI * 2);
    ctx.fillStyle = P.ink;
    ctx.fill();
    ctx.restore();
  }

  /** Points along the great circle from a to b, lifted into an arc (lift 1) or on the ground (lift 0). */
  private arc(a: Vec3, b: Vec3, lift: number, endAlt: number, buffer: ArcBuffer) {
    const w = angle(a, b);
    const sin = Math.sin(w);
    // short hops still get a visible arc; that minimum lift shrinks with zoom so it stays on screen
    const h = Math.min(0.32, 0.03 * this.zoomScale + w * 0.11) * lift;
    const n = Math.max(12, Math.ceil(w / 0.015));
    const out = buffer.points;
    out.length = n + 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const q = buffer.pool[i] ?? (buffer.pool[i] = { ...screenPoint(), w: [0, 0, 0] });
      const p = q.w!;
      if (sin < 1e-5) {
        p[0] = a[0] + (b[0] - a[0]) * t;
        p[1] = a[1] + (b[1] - a[1]) * t;
        p[2] = a[2] + (b[2] - a[2]) * t;
        const l = len(p) || 1;
        p[0] /= l;
        p[1] /= l;
        p[2] /= l;
      } else {
        const ka = Math.sin((1 - t) * w) / sin;
        const kb = Math.sin(t * w) / sin;
        p[0] = a[0] * ka + b[0] * kb;
        p[1] = a[1] * ka + b[1] * kb;
        p[2] = a[2] * ka + b[2] * kb;
      }
      const r = 1 + h * Math.sin(Math.PI * t) + endAlt * t;
      p[0] *= r;
      p[1] *= r;
      p[2] *= r;
      out[i] = this.proj(p, q);
    }
    return out;
  }

  /** A trip's route: a great-circle arc that lifts off the surface, and its dotted ground track. */
  private route(ctx: CanvasRenderingContext2D, origin: Vec3, pl: Plane, marching: boolean, t = 0) {
    const P = this.P;
    const end = pl.n;
    const ground = this.arc(origin, end, 0, 0, this.groundArc);
    const air = this.arc(origin, end, 1, pl.alt, this.airArc);
    // stop the dashes just short of the plane
    const cut = S_PLANE * this.planeScale * 0.45;
    const tip = mul(end, 1 + pl.alt);
    for (let i = air.length - 1; i >= 0; i--) {
      const w = air[i]?.w;
      if (!w || Math.hypot(w[0] - tip[0], w[1] - tip[1], w[2] - tip[2]) >= cut) break;
      air[i] = null;
    }
    ctx.save();
    ctx.lineCap = "round";
    ctx.setLineDash([0.1, 6]); // dash-ground
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = `rgba(${P.inkRGB},0.3)`;
    this.strokePts(ctx, ground);
    ctx.setLineDash([7, 6]); // dash-route; marches while the search runs
    ctx.lineDashOffset = marching ? -t * 22 : 0;
    ctx.lineWidth = 2; // line-route
    ctx.strokeStyle = P.ink;
    this.strokePts(ctx, air);
    ctx.restore();
  }

  private drawHud(t: number) {
    const ctx = this.hud;
    const P = this.P;
    const dpr = this.hudEl.width / this.W;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.hudEl.width, this.hudEl.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // names go under everything else on the overlay, and keep clear of planes and airport tags
    const clear: { x: number; y: number }[] = [];
    const mark = (v: Vec3 | null | undefined) => {
      const q = v && this.proj(v);
      if (q && q.vis) clear.push({ x: q.x, y: q.y });
    };
    for (const r of this.remotes.values()) {
      mark(r.o);
      mark(mul(r.pl.n, 1 + r.pl.alt));
    }
    if (this.mode !== "idle" && this.pl) {
      mark(this.origin);
      mark(mul(this.pl.n, 1 + this.pl.alt));
    }
    this.countryNames(ctx, clear, t);

    if (this.mode !== "flying" && this.hover && !this.down?.drag) this.ring(ctx, this.mx, this.my, t);

    if (this.mode === "idle" && this.hoverHub) this.tag(ctx, this.mx, this.my + 30, hubPreviewLabel(this.hoverHub));

    // other members' trips, under this viewer's own: their route, start ring and local hub labels
    for (const r of this.remotes.values()) {
      this.route(ctx, r.o, r.pl, false);
      const op = this.proj(r.o);
      if (op && op.vis) {
        this.startMark(ctx, op.x, op.y);
        if (r.originHub) this.tag(ctx, op.x, op.y - 30, hubPreviewLabel(r.originHub));
      }
      const rp = r.landed ? this.proj(mul(r.pl.n, 1 + r.pl.alt)) : null;
      if (rp && rp.vis && r.destinationHub) this.tag(ctx, rp.x + 24, rp.y + 20, hubPreviewLabel(r.destinationHub));
    }

    const pl = this.pl;
    const origin = this.origin;
    if (!origin || !pl || this.mode === "idle") return;
    this.route(ctx, origin, pl, this.mode === "landed" && !this.reduceMotion, t);

    const ripple = (p: ScreenPoint | null, t0: number) => {
      const k = (t - t0) / 0.7;
      if (this.reduceMotion || !p || !p.vis || k < 0 || k > 1) return;
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 + k * 34, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(${P.inkRGB},${(0.6 * (1 - k)).toFixed(3)})`;
      ctx.stroke();
      ctx.restore();
    };
    const op = this.proj(origin);
    ripple(op, this.tTake);
    if (op && op.vis) {
      this.startMark(ctx, op.x, op.y);
      // Keep the origin label above its pin; the moving/landing preview is below
      // the plane, so short hops do not immediately stack the longer hub names.
      if (this.originHub) this.tag(ctx, op.x, op.y - 30, hubPreviewLabel(this.originHub));
    }

    const pp = this.proj(mul(pl.n, 1 + pl.alt));
    if (this.mode === "flying") {
      if (pp && pp.vis && this.hoverHub) this.tag(ctx, pp.x + 24, pp.y + 20, hubPreviewLabel(this.hoverHub));
    } else if (this.mode === "landed") {
      ripple(pp, this.tLand);
      if (pp && pp.vis && this.destinationHub) this.tag(ctx, pp.x + 24, pp.y + 20, hubPreviewLabel(this.destinationHub));
    }
  }
}
