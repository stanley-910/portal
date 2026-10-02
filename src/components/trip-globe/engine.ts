// The Trip Globe renderer and interaction model, framework-free. Ported from the Flight artboard (Paper Atlas).
// Two canvases: WebGL2 draws the printed globe and the paper plane; a 2D canvas on top draws the route, pins and tags.
import { nearestAirport, type Airport } from "./airports";
import { PALETTES, type Palette, type ThemeId } from "./palette";
import { buildPlane } from "./plane-model";
import { FS_GLOBE, FS_PLANE, VS_PLANE, VS_QUAD } from "./shaders";
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
  from: Airport;
  to: Airport;
  /** Where the trip was started and landed, before snapping to airports. */
  origin: LatLng;
  destination: LatLng;
  /** Great-circle distance between the two airports. */
  distanceKm: number;
  /** Earliest departure: tomorrow, local time. */
  departDate: Date;
}

export interface GlobeEvents {
  onModeChange?: (mode: GlobeMode, from: Airport | null) => void;
  onLand?: (trip: LandedTrip) => void;
  onCancel?: () => void;
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
interface Program {
  p: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}
interface Snap {
  airport: Airport;
  v: Vec3;
}

const toLatLng = (v: Vec3): LatLng => {
  const { lat, lon } = llOf(v);
  return { lat: lat / D2R, lng: lon / D2R };
};

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
  private cam: Camera | null = null;
  private P: Palette = PALETTES.light;
  private tagFont = '700 12px "Courier Prime", ui-monospace, monospace';
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
  private oAir: Snap | null = null;
  private dAir: Snap | null = null;
  private curAir: Snap | null = null;
  private pl: Plane | null = null;

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
    private events: GlobeEvents = {},
  ) {
    this.hud = hudEl.getContext("2d")!;
  }

  /** Starts rendering. Returns false when WebGL2 is unavailable. */
  start(): boolean {
    const gl = this.glEl.getContext("webgl2", { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: true });
    if (!gl) return false;
    this.gl = gl;
    this.pGlobe = this.program(gl, VS_QUAD, FS_GLOBE, ["aPos"]);
    this.pPlane = this.program(gl, VS_PLANE, FS_PLANE, ["aPos", "aNrm", "aSm", "aPart"]);

    this.vaoQuad = gl.createVertexArray();
    gl.bindVertexArray(this.vaoQuad);
    this.attrib(gl, 0, new Float32Array([-1, -1, 3, -1, -1, 3]), 2);

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
    this.texEarth = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texEarth);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // all sea until the texture arrives
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 255, 255, 255]));
    this.loadEarth();

    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reduceMotion = this.motionQuery.matches;
    this.motionQuery.addEventListener("change", this.onMotionChange);
    // native and non-passive, so a pinch can't zoom the page
    this.root.addEventListener("wheel", this.onWheel, { passive: false });
    this.root.addEventListener("gesturestart", this.onGesture as EventListener);
    this.root.addEventListener("gesturechange", this.onGesture as EventListener);

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
    // Not loseContext(): React Strict Mode remounts onto the same canvas, which would hand back the lost context.
    this.gl = null;
  }

  setTheme(theme: ThemeId) {
    this.P = PALETTES[theme];
    const stack = getComputedStyle(this.root).getPropertyValue("--font-typewriter").trim();
    if (stack) this.tagFont = `700 12px ${stack}`;
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

  /** 1 while the whole globe is in view, fading to 0 as it overflows the screen. */
  private get globeAmt() {
    return smooth(1.2, 2.0, this.range);
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
    this.lastInteract = this.t;
    this.events.onModeChange?.("idle", null);
    if (wasActive) this.events.onCancel?.();
  }

  private takeoff(o: Vec3) {
    const cam = this.cam ?? this.camera();
    this.mode = "flying";
    this.origin = o;
    this.dest = null;
    this.dAir = null;
    this.oAir = nearestAirport(o);
    this.curAir = this.oAir;
    this.pl = { n: o, f: tangent(cam.U, o), alt: 0, bank: 0, pitch: 0 };
    this.tTake = this.t;
    this.vlon = 0;
    this.vlat = 0;
    this.turn = null;
    this.events.onModeChange?.("flying", this.oAir.airport);
  }

  private land(v: Vec3) {
    const pl = this.pl!;
    const origin = this.origin!;
    const oAir = this.oAir!;
    this.mode = "landed";
    this.tLand = this.t;
    this.dest = v;
    pl.n = v;
    pl.f = tangent(pl.f, v);
    this.dAir = nearestAirport(v);
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
    this.events.onModeChange?.("landed", oAir.airport);
    this.events.onLand?.({
      from: oAir.airport,
      to: this.dAir.airport,
      origin: toLatLng(origin),
      destination: toLatLng(v),
      distanceKm: Math.round(EARTH_RADIUS_KM * angle(oAir.v, this.dAir.v)),
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

  // The texture is data, not a picture: r = land mask, g = distance from the coast, b = relief.
  // It must be uploaded without colour-space conversion or premultiplication.
  private loadEarth() {
    const gl = this.gl!;
    const put = (src: TexImageSource) => {
      if (this.gl !== gl) return;
      gl.bindTexture(gl.TEXTURE_2D, this.texEarth);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    };
    const viaImg = () => {
      const im = new Image();
      im.onload = () => put(im);
      im.src = this.earthUrl;
    };
    if (typeof createImageBitmap === "function") {
      fetch(this.earthUrl)
        .then((r) => r.blob())
        .then((b) => createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" }))
        .then(put)
        .catch(viaImg);
    } else viaImg();
  }

  private onMotionChange = (e: MediaQueryListEvent) => {
    this.reduceMotion = e.matches;
  };

  private resize() {
    const W = this.root.clientWidth || 1;
    const H = this.root.clientHeight || 1;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (W !== this.W || H !== this.H || dpr !== this.dpr) {
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
  private proj(p: Vec3): ScreenPoint | null {
    const c = this.cam!;
    const q = sub(p, c.C);
    const vz = dot(q, c.F);
    if (vz < 0.003) return null;
    const nx = dot(q, c.R) / (vz * c.tan * this.asp);
    const ny = dot(q, c.U) / (vz * c.tan) - c.shift;
    const L = len(q);
    const d = mul(q, 1 / L);
    const b = dot(c.C, d);
    const disc = b * b - (dot(c.C, c.C) - 1);
    let vis = true;
    if (disc > 0) {
      const t1 = -b - Math.sqrt(disc);
      if (t1 > 0 && t1 < L - 1e-3) vis = false;
    }
    return { x: (nx * 0.5 + 0.5) * this.W, y: (0.5 - ny * 0.5) * this.H, vis, z: vz };
  }

  private pos(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.root.getBoundingClientRect();
    return [(e.clientX - r.left) * (this.W / (r.width || 1)), (e.clientY - r.top) * (this.H / (r.height || 1))];
  }

  // ---------- simulation ----------

  private sim(dt: number, t: number) {
    const k = (r: number) => 1 - Math.exp(-dt * r);
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
      this.curAir = nearestAirport(pl.n);
    } else if (this.mode === "landed") {
      // touchdown: the plane settles onto its shadow
      pl.alt += (0 - pl.alt) * k(8);
      pl.bank += (0 - pl.bank) * k(8);
    }
  }

  // ---------- loop ----------

  private tick = (ts: number) => {
    if (!this.gl) return;
    this.raf = requestAnimationFrame(this.tick);
    const t = ts / 1000;
    const dt = this.t ? clamp(t - this.t, 0, 0.05) : 0.016;
    this.t = t;
    this.resize();
    this.sim(dt, t);
    this.cam = this.camera();
    this.hover = this.hasPointer && !this.down?.drag ? this.pick(this.mx, this.my) : null;
    this.drawGL();
    this.drawHud(t);
  };

  private planeBasis(S: number) {
    const pl = this.pl!;
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
    if (pp) {
      const ld = mul(L, -1);
      const b = dot(pp, ld);
      const disc = b * b - (dot(pp, pp) - 1);
      if (disc > 0) shP = norm(add(pp, mul(ld, -b - Math.sqrt(disc))));
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
      gl.uniform1f(u.uPer, 4.5 * dpr); // halftone-pitch
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
    gl.uniform2f(u.uRes, cw, ch);
    gl.uniform1f(u.uDpr, dpr);
    setCam(u);
    gl.uniform1f(u.uGlobe, this.globeAmt); // the ring and cut-out shadow only make sense around the whole globe
    gl.uniform1f(u.uDark, th.dark);
    for (const [key, value] of Object.entries(th.gl)) gl.uniform3fv(u[key], value);
    gl.uniform3fv(u.uShP, shP);
    gl.uniform1f(u.uShR, S * 0.42);
    gl.uniform1f(u.uShA, pl && showPlane ? 0.95 - 0.4 * smooth(0, ALT * this.planeScale, pl.alt) : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (!pp) return;
    const pv = this.proj(pp);
    if (!pv || !pv.vis) return;
    const B = this.planeBasis(S);
    P = this.pPlane;
    u = P.u;
    gl.useProgram(P.p);
    gl.bindVertexArray(this.vaoPlane);
    setCam(u);
    gl.uniform3fv(u.uPP, pp);
    gl.uniform3fv(u.uPX, B.X);
    gl.uniform3fv(u.uPY, B.Y);
    gl.uniform3fv(u.uPZ, B.Z);
    gl.uniform2f(u.uRes, cw, ch);
    gl.uniform3fv(u.uFill, th.stickerGL.fill);
    gl.uniform3fv(u.uInkS, th.stickerGL.ink);
    gl.uniform3fv(u.uRoundel, th.stickerGL.roundel);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    // 1: the ink outline, which also draws inner edges
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.uniform1f(u.uMode, 2);
    gl.uniform1f(u.uHull, 1.1 * dpr);
    gl.drawArrays(gl.TRIANGLES, 0, this.planeCount);
    // 2: the paper body
    gl.uniform1f(u.uMode, 0);
    gl.uniform1f(u.uHull, 0);
    gl.drawArrays(gl.TRIANGLES, 0, this.planeCount);
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
    const w = Math.ceil(ctx.measureText(text).width) + 14;
    const h = 21;
    const lx = x - w / 2;
    const ly = y - h / 2;
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

  private star(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, rot: number) {
    const { sticker, stickerShadow } = this.P;
    const dpr = this.dpr;
    const path = () => {
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = rot + (i * Math.PI) / 8 - Math.PI / 2;
        const r = i % 2 === 0 ? R : R * 0.34;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
    };
    ctx.save();
    ctx.lineJoin = "round";
    path();
    // a pin sits on the ground, so its shadow falls close, down and right along the light
    ctx.shadowColor = stickerShadow;
    ctx.shadowOffsetX = 1.5 * dpr;
    ctx.shadowOffsetY = 2 * dpr;
    ctx.shadowBlur = 1.5 * dpr;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, sticker.starLight);
    g.addColorStop(1, sticker.starEdge);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = sticker.ink;
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
  private arc(a: Vec3, b: Vec3, lift: number, endAlt: number) {
    const w = angle(a, b);
    // short hops still get a visible arc; that minimum lift shrinks with zoom so it stays on screen
    const h = Math.min(0.32, 0.03 * this.zoomScale + w * 0.11) * lift;
    const n = Math.max(12, Math.ceil(w / 0.015));
    const out: (ScreenPoint | null)[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = mul(slerp(a, b, t), 1 + h * Math.sin(Math.PI * t) + endAlt * t);
      const q = this.proj(p);
      if (q) q.w = p;
      out.push(q);
    }
    return out;
  }

  private drawHud(t: number) {
    const ctx = this.hud;
    const P = this.P;
    const dpr = this.hudEl.width / this.W;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.hudEl.width, this.hudEl.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // collage stars around the globe, lifted away as soon as you zoom in
    const stars = smooth(1.9, 2.35, this.range);
    const cx = this.W / 2;
    const cy = this.H * CENTRE_Y;
    ctx.save();
    ctx.globalAlpha = stars;
    for (const [a, rf, r, rot] of stars > 0.01 ? [
      [-2.35, 1.34, 24, 0.15],
      [0.62, 1.3, 16, -0.2],
      [-0.72, 1.42, 10, 0.3],
    ] : []) {
      const x = cx + Math.cos(a) * this.Rpx * rf;
      const y = cy + Math.sin(a) * this.Rpx * rf;
      if (x > r && y > r && x < this.W - r && y < this.H - r) this.star(ctx, x, y, r, rot);
    }
    ctx.restore();

    if (this.mode !== "flying" && this.hover && !this.down?.drag) this.ring(ctx, this.mx, this.my, t);
    const pl = this.pl;
    const origin = this.origin;
    if (!origin || !pl || this.mode === "idle") return;

    // the route: a great-circle arc that lifts off the surface, and its dotted ground track
    const end = pl.n;
    const ground = this.arc(origin, end, 0, 0);
    const air = this.arc(origin, end, 1, pl.alt);
    // stop the dashes just short of the plane
    const cut = S_PLANE * this.planeScale * 0.45;
    const tip = mul(end, 1 + pl.alt);
    for (let i = air.length - 1; i >= 0; i--) {
      const w = air[i]?.w;
      if (!w || len(sub(w, tip)) >= cut) break;
      air[i] = null;
    }
    ctx.save();
    ctx.lineCap = "round";
    ctx.setLineDash([0.1, 6]); // dash-ground
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = `rgba(${P.inkRGB},0.3)`;
    this.strokePts(ctx, ground);
    ctx.setLineDash([7, 6]); // dash-route; marches while the search runs
    ctx.lineDashOffset = this.mode === "landed" && !this.reduceMotion ? -t * 22 : 0;
    ctx.lineWidth = 2; // line-route
    ctx.strokeStyle = P.ink;
    this.strokePts(ctx, air);
    ctx.restore();

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
    // overshooting pop for the star pin
    const pop = (k: number) => {
      if (this.reduceMotion) return 1;
      k = clamp(k, 0, 1);
      const c = 1.7;
      return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
    };

    const op = this.proj(origin);
    ripple(op, this.tTake);
    if (op && op.vis && this.oAir) {
      const s = pop((t - this.tTake) / 0.45);
      if (s > 0.05) this.star(ctx, op.x, op.y, 13 * s, 0.2);
      this.tag(ctx, op.x, op.y + 30, this.oAir.airport.code);
    }

    const pp = this.proj(mul(pl.n, 1 + pl.alt));
    if (this.mode === "flying") {
      if (pp && pp.vis && this.curAir) this.tag(ctx, pp.x + 24, pp.y + 20, this.curAir.airport.code);
    } else if (this.mode === "landed") {
      ripple(pp, this.tLand);
      if (pp && pp.vis && this.dAir) this.tag(ctx, pp.x + 24, pp.y + 20, this.dAir.airport.code);
    }
  }
}
