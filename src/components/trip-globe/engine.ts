// The Portal globe renderer and interaction model, framework-free. Ported from the Flight artboard (Paper Atlas).
// Two canvases: WebGL2 draws the printed globe and the paper plane; a 2D canvas on top draws the route, pins and tags.
import { recordTiming } from "@/lib/performance";
import { cursorLieMatrix, cursorOutline, type CursorLie, type CursorShape } from "@/components/paper-atlas/cursor";
import { HoverHubResolver, nearestPreviewHub } from "@/lib/transport/hubs/preview";
import type { Hub } from "@/lib/transport/hubs/types";
import { CITY_LABELS } from "./cities";
import { COUNTRY_LABELS } from "./countries";
import { COUNTRY_TYPE, HALFTONE_PITCH, PALETTES, type Palette, type ThemeId } from "./palette";
import { placeName } from "./place-name";
import { chooseVehicle, landMask, type LandAt } from "./vehicle-choice";
import { buildVehicle, VEHICLE_LENGTH, VEHICLES, type Vehicle } from "./vehicle-models";
import { buildPin, PIN_HEAD_R, PIN_HEAD_Z } from "./pin-model";
import { buildUfo } from "./ufo-model";
import { FS_GLOBE, FS_PLANE, MAX_PIN_SHADOWS, VS_PLANE, VS_QUAD } from "./shaders";
import { randomSeed, Sky, type Program } from "./sky";
import { Track } from "./track";
import {
  add, angle, clamp, cross, D2R, dot, EARTH_RADIUS_KM, ease, len, lerp, llOf, mul, norm, rotAround, slerp, smooth,
  sub, tangent, vecOf, wrapPi, type Vec3,
} from "./vec";

export type GlobeMode = "idle" | "flying" | "landed";

/**
 * The viewer's own pointer: how it lies on the globe, how far its image is held back from the pointer while
 * it peels off, and how the ring marking the ground under it lies, or null for no ring. The ring goes in the
 * cursor image so it never lags the pointer; the overlay draws the shadow, which trails it on purpose.
 */
export interface GlobeCursor {
  lie: CursorLie;
  offset: [number, number];
  marker: CursorLie | null;
}
const FLAT: CursorLie = { angle: 0, squash: 1 };

export interface LatLng {
  lat: number;
  lng: number;
}

/** One leg of a landed trip. A trip with stops lands as several, in order, each starting where the last ended. */
export interface LandedTrip {
  /** Nearest local preview hub, or null outside coverage. Search still resolves pairs from the clicks. */
  from: Hub | null;
  to: Hub | null;
  /** Exact picked surface points before snapping. These are the transport-search inputs. */
  origin: LatLng;
  destination: LatLng;
  /** Great-circle distance between the actual clicked points, not a snapped route. */
  distanceKm: number;
  /** Earliest departure, local time: tomorrow for the first leg, a day later for each leg after. */
  departDate: Date;
}

/** The leg being flown or landed, as other people in the room see it. All places as lat/lng. */
export interface FlightState {
  /** Where this leg took off. */
  origin: LatLng;
  /** Where the plane is now. */
  at: LatLng;
  /** A point just ahead of the plane, which gives its heading. */
  ahead: LatLng;
  landed: boolean;
  /** What it's riding: the globe's guess from the shape of the leg being drawn. */
  vehicle?: Vehicle;
}

/** Another member's flight. `id` is stable while they stay in the room. */
export interface RemoteFlight extends FlightState {
  id: string;
  /** Their member colour slot (0 for `member-1`), which tints the route. Unset draws it in ink. */
  color?: number | null;
}

/**
 * A pin at a stop: one rider arriving there, in their member colour slot (0 for `member-1`; null for sticker paper).
 * Pins with the same `stop` stand together. A new key drops in; once this viewer's plane is landing, after it lands.
 */
export interface GlobePin {
  key: string;
  stop: string;
  at: LatLng;
  color: number | null;
}

export interface GlobeEvents {
  onModeChange?: (mode: GlobeMode, from: Hub | null) => void;
  /** Only when the local hover hub changes. Never triggers a provider search. */
  /** The hub in range of the pointer, and the city the label names. */
  onPreviewChange?: (hub: Hub | null, name: string | null) => void;
  /** The trip's legs, in order: one per click while flying, ended by clicking the last stop again. */
  onLand?: (legs: LandedTrip[]) => void;
  onCancel?: () => void;
  /** A click on the landed trip's route, which doesn't take off or cancel. */
  /** `id` is the remote flight's whose route it was (a stored leg's `leg:<id>`), or undefined for this viewer's own trip. */
  onRouteClick?: (id?: string) => void;
  /** When the pointer's lie on the ground under it changes, so it can be drawn flat on the globe. */
  onCursorChange?: (cursor: GlobeCursor) => void;
  /** After every frame is drawn. Overlays that track places on the globe reposition here. */
  onFrame?: () => void;
  /**
   * The part of the globe's box the page leaves open, in CSS px. A landed route or a searched place is framed
   * there instead of the middle of the screen. Asked once per turn, as it starts, so panels that open on landing count.
   */
  freeArea?: () => FreeArea | null;
  /** When the view stops following Pip's saucer because someone moved the globe themselves. */
  onFollowEnd?: () => void;
}

/** Where Pip's saucer is on screen: its body, the ground under it, and whether it has reached its place. */
export type AgentSpot = { x: number; y: number; ground: { x: number; y: number }; visible: boolean; arrived: boolean };

export type FreeArea = { x: number; y: number; w: number; h: number };

/** What `onRoute` answers for this viewer's own landed trip. */
const OWN_ROUTE = "\u0000own";
const DG = 3.4; // camera distance from the globe's centre, fully zoomed out
const ALT = 0.03; // flying altitude, fully zoomed out
// The pointer's shadow falls toward the globe's middle: CURSOR_SHADOW px to the side at the left and right
// edges, from CURSOR_DROP + CURSOR_SHADOW below at the top edge to CURSOR_SHADOW - CURSOR_DROP above at the bottom.
const CURSOR_SHADOW = 8;
const CURSOR_DROP = 4;
const CURSOR_CHASE = 0.035; // s for the shadow to close most of the gap when the pointer moves
// Leaving the globe, the pointer peels off it: it springs back to full width past flat, is held up to
// CURSOR_PULL px back toward the globe before it lets go, and its shadow springs out CURSOR_FLOAT and fades.
const CURSOR_PEEL = 0.32; // s
const CURSOR_PULL = 8;
const CURSOR_FLOAT = { x: 6, y: 8 };
const FIT = 0.9; // share of the view a framed route spans
const ROUTE_HIT = 10; // px from a landed route that a click counts as on it
const CURSOR_SQUASH = 0.4; // the pointer flattens no further than this at the horizon, so it stays readable
const S_PLANE = 0.085; // plane length fully zoomed out: about the size of a cursor
/** Two tags with the same name for places closer than this on screen, in px, name one place. */
const TAG_SAME = 40;
const TAG_H = 21; // a name tag's height, px
// A stop's tag keeps TAG_GAP of a pin's size on screen clear of the stop's pins or start ring, and never less than
// TAG_GAP_MIN px, so it stays by its stop as you zoom out without touching the pin.
const TAG_GAP = 0.2;
const TAG_GAP_MIN = 6;
const RING_R = 4.5; // the start ring's radius, px
const ROUTE_CUT = 0.45; // how far short of a vehicle its route stops, in vehicle lengths
const SWAP = 0.25; // seconds for one vehicle to shrink away and the next to grow in
// While you draw a leg, the vehicle follows a guess from its length, water and hubs (vehicle-choice.ts). A new guess
// has to hold for VEHICLE_HOLD s before the vehicle changes, so sweeping past a coast doesn't flicker; it's checked
// every VEHICLE_CHECK s. Ground vehicles fly GROUND_LIFT of the plane's height: low, but clear of the route's dots.
const VEHICLE_HOLD = 0.3;
// Landing: the plane settles onto the ground over TOUCHDOWN s, then shrinks away over VANISH s, and the trip's pins
// drop in where it stood. Pins are PIN_SCALE of the plane's size and lean back PIN_LEAN rad from upright, so the
// needle shows from above. One falls PIN_FALL of its size over PIN_DROP s, sinks its point PIN_SINK into the ground
// and springs back over PIN_SETTLE s. Pins dropped together land PIN_STAGGER s apart. Several riders' pins at one
// stop share its point and fan out sideways like a bunch, PIN_FAN rad apart and no wider than PIN_FAN_MAX across;
// the further out a pin fans, the further over it leans, by PIN_SPLAY of its fan.
const TOUCHDOWN = 0.45;
const VANISH = 0.25;
const PIN_SCALE = 1.1;
/** The paper kept clear round a pin where a route passes under it, in px either side of its head and needle. */
const PIN_CUT = 1.5;
const PIN_LEAN = 0.62;
const PIN_FALL = 1.5;
const PIN_DROP = 0.3;
const PIN_SINK = 0.05;
const PIN_SETTLE = 0.5;
/** A stop's pins picked up to drag hang this far up, in pin sizes, and rise to it at this rate. */
const PIN_LIFT = 0.9;
const PIN_LIFT_RATE = 12;
/** How much of a raised pin's height the routes into its stop rise with it. */
const ROUTE_LIFT = 0.35;
const PIN_STAGGER = 0.09;
const PIN_FAN = 0.8;
const PIN_FAN_MAX = 2.4;
const PIN_SPLAY = 0.25;
const VEHICLE_CHECK = 0.1;
// Pip's saucer: its size against the plane, how high it hovers in plane heights, how fast it glides (a share of
// the way per second, plus radians per second so the last stretch doesn't crawl), and how close it has to be to count
// as there. Following it, the view eases this fast and closes in to frame FOLLOW_SPAN around the saucer.
const UFO_SCALE = 1; // the same size as the plane and the ground vehicles
const UFO_TIP = 0.95; // radians it tips toward the viewer, like a pin leans, so its dome and Pip's face show
const UFO_HOVER = 1.8;
const UFO_GLIDE = 3;
const UFO_CRUISE = 0.08;
const UFO_THERE = 0.003;
// It flies in from the top of the screen, coming down over UFO_ENTER seconds, and leaves the same way: climbing
// away toward the top, faster and faster, gone after UFO_EXIT seconds.
const UFO_ENTER = 1.1;
const UFO_EXIT = 1.4;
const UFO_EXIT_ARC = 0.9; // radians over the globe it comes from and heads off
// A removed leg's route reels in: it pulls off its start toward its end, where Pip's saucer is, over REEL seconds.
// One Pip adds draws out from its start behind the saucer over DRAW seconds, and the pins at its end drop after.
const REEL = 0.9;
const DRAW = 1.2;
/** How `showTrip` puts a trip down: see there. */
export type ShowTrip = "land" | "quiet" | "draw";
const FOLLOW_EASE = 2.4;
// close enough that Pip reads at a glance: about the view from Hong Kong to Taipei, a city or two either side
const FOLLOW_SPAN = 9 * D2R;
const GROUND_LIFT = 0.35;
// The land mask's size, sampled once from the earth texture for the vehicle guess.
const LAND_W = 1024;
const LAND_H = 512;
const CENTRE_Y = 0.455; // globe centre, as a fraction of the screen height
const LAT_MAX = 1.25; // how far the view can turn toward a pole

// Zoom works like Google Earth: the camera orbits a target on the ground at some range, zooms toward the
// point under the cursor, and tilts toward the horizon as it gets close.
const RANGE_MAX = DG - 1; // the whole-globe view
const RANGE_MIN = 0.2; // about 1,300 km up: the 2048px earth texture still prints cleanly here
const TILT_MAX = 0.8; // radians from straight down, at RANGE_MIN
const STOP_HIT = 16; // px: a click this close to the stop the plane just left ends the trip there
// After a stop, the plane sticks to it like a magnet, so a second click lands there even if the pointer wandered a
// little. It lets go past MAGNET_RELEASE px, and catches again inside MAGNET_CATCH. While held it leans
// MAGNET_LEAN of the way toward the pointer; for MAGNET_EASE s after either change it glides instead of jumping.
const MAGNET_CATCH = 18;
const MAGNET_RELEASE = 40;
const MAGNET_LEAN = 0.15;
const MAGNET_EASE = 0.18;
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
  /** What's drawn, what it's turning into, and how far through that pop it is (0 to 1; 0.5 is the vanishing point). */
  vehicle: Vehicle;
  next: Vehicle;
  swap: number;
}

const parked = (v: Vehicle): Pick<Plane, "vehicle" | "next" | "swap"> => ({ vehicle: v, next: v, swap: 0 });

/** How high a vehicle flies, as a share of the plane's height: ground vehicles skim along low. */
const lift = (pl: Plane) => (pl.next === "flight" ? 1 : GROUND_LIFT);

// a change mid-pop that is already growing back turns it round at the same size, so it never jumps
function retarget(pl: Plane, v: Vehicle) {
  if (v === pl.next) return;
  pl.next = v;
  if (pl.swap > 0.5) pl.swap = 1 - pl.swap;
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
/** Where a route's arc ends: the point under it, the altitude it ends at, and how far short of that it stops. */
interface RouteEnd {
  v: Vec3;
  alt: number;
  cut: number;
}

const screenPoint = (): ScreenPoint => ({ x: 0, y: 0, z: 0, vis: false });

/** How much bigger than the `country` token a name grows as its country fills the screen. */
const NAME_MAX = 1.4;
// province and state borders print in between these zoom levels (0 whole globe, 1 closest)
const PROVINCES_FROM = 0.3;
const PROVINCES_FULL = 0.6;
// the zoom level each city rank starts to print at: world cities first, towns only close in
const CITY_FROM = [0.1, 0.2, 0.32, 0.45, 0.58, 0.66, 0.8, 0.94];
/** At most this many city names on screen at once, biggest first, so the map never fills up. */
const CITY_MAX = 40;
const CITY_FADE = 0.1; // zoom over which a rank fades in, from nothing to fully printed
/**
 * City names in px by rank, in four steps so the places people travel between stand out: world cities (Tokyo,
 * Taipei) well above the `city` token, regional cities at it, towns below it. The `city` face has one weight, so size
 * and ink carry the difference.
 */
const CITY_SIZE = [17, 17, 14, 14, 13, 13, 12, 12];

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

const CITIES = CITY_LABELS.map(([name, lat, lng, rank, capital]) => ({ name, v: vecOf(lat * D2R, lng * D2R), rank, capital }));

export class GlobeEngine {
  private gl: WebGL2RenderingContext | null = null;
  private hud: CanvasRenderingContext2D;
  private raf = 0;
  private pGlobe!: Program;
  private pPlane!: Program;
  private vaoQuad: WebGLVertexArrayObject | null = null;
  private vaoVehicle = new Map<Vehicle, { vao: WebGLVertexArrayObject; count: number }>();
  private vaoPin: { vao: WebGLVertexArrayObject; count: number } | null = null;
  private vaoUfo: { vao: WebGLVertexArrayObject; count: number } | null = null;
  /** Standing pins on screen: head centre and radius, and where the needle meets the ground, in CSS px. */
  private pinCuts: { x: number; y: number; r: number; bx: number; by: number }[] = [];
  /** Where a route is drawn when pins stand, so they can be cut out of it. */
  private routeLayer: HTMLCanvasElement | null = null;
  private texSkyFallback: WebGLTexture | null = null;
  private texEarth: WebGLTexture | null = null;
  private texBorders: WebGLTexture | null = null;
  private texProvinces: WebGLTexture | null = null;
  private sky: Sky | null = null;
  private buffers: WebGLBuffer[] = [];
  private assetAbort: AbortController | null = null;
  private assetImages = new Set<HTMLImageElement>();
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private startupPending = false;
  private started = false;
  private readyRecorded = false;
  private earthReady = false;
  private sleeping = true;
  private skySeed: string | number = randomSeed();
  private cam: Camera | null = null;
  private P: Palette = PALETTES.light;
  private tagFont = '700 12px "Courier Prime", ui-monospace, monospace';
  private nameFamily = '"Courier Prime", ui-monospace, monospace';
  /** Each name's width at a 1px font size, letter spacing included. Cleared when fonts load. */
  private nameWidths = new Map<string, number>();
  /** Each name drawn, halo and all, per half-px size; frames only copy these. Cleared on theme or font change. */
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
  private cityFamily = '"IM Fell English", Georgia, serif';
  /** Each city name's width at a 1px font size, and its sprite per size. Cleared with the country names'. */
  private cityWidths = new Map<string, number>();
  private citySprites = new Map<string, HTMLCanvasElement>();
  /** Per city: how far it has faded in, whether it held a place last frame, which side its name sat, and its box. */
  private cityFade = new Float32Array(CITIES.length);
  private cityPlaced = new Uint8Array(CITIES.length);
  private cityLeft = new Uint8Array(CITIES.length);
  private cityHold = new Float64Array(CITIES.length);
  private cityX = new Float32Array(CITIES.length);
  private cityY = new Float32Array(CITIES.length);
  private cityFacing = new Float32Array(CITIES.length);
  private cityShown = false;
  private cityT = 0;
  private cityCandidates: number[] = [];
  private cityBoxes: number[][] = [];
  private cityPoint = screenPoint();
  private placedNames: number[][] = [];
  private nameWon = new Uint8Array(NAMES.length);
  private namesMoving = true;
  private groundArc: ArcBuffer = { points: [], pool: [] };
  private airArc: ArcBuffer = { points: [], pool: [] };
  private hitArc: ArcBuffer = { points: [], pool: [] };
  private _glDirty = true;
  private _hudDirty = true;
  private get glDirty() { return this._glDirty; }
  private set glDirty(value: boolean) { this._glDirty = value; if (value) this.requestFrame(); }
  private get hudDirty() { return this._hudDirty; }
  private set hudDirty(value: boolean) { this._hudDirty = value; if (value) this.requestFrame(); }
  private inFrame = false;
  private obscured = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private searching = false;
  private labelsLayer: HTMLCanvasElement | null = null;
  private labelsKey = "";
  private labelsDirty = true;
  private routeGeometry = new Map<string, { ground: (ScreenPoint | null)[]; air: (ScreenPoint | null)[] }>();
  private routeView = "";
  private pinShadowA = new Float32Array(MAX_PIN_SHADOWS * 4);
  private pinShadowB = new Float32Array(MAX_PIN_SHADOWS * 4);
  private cityWon = new Uint8Array(CITIES.length);
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
    /** What to frame, worked out as the turn starts: ground point p, w radians of arc, no closer than minRange. */
    frame?: { p: Vec3; w: number; minRange: number };
  } | null = null;
  // The landed route, kept framed in the open part of the screen as panels open and grow, until someone moves the
  // globe themselves. `area` is the open area it was last framed in.
  private autoFrame: { p: Vec3; w: number; minRange: number } | null = null;
  private frameArea: FreeArea | null = null;

  // trip
  private mode: GlobeMode = "idle";
  private origin: Vec3 | null = null;
  private dest: Vec3 | null = null;
  private originHub: Hub | null = null;
  private destinationHub: Hub | null = null;
  /** Stops before `origin`, from takeoff on: each click while flying ends a leg there and starts the next. */
  private via: { v: Vec3; hub: Hub | null; name: string | null }[] = [];
  // the plane is held at the stop it just left (only after a stop, not at takeoff), and when that last changed
  private magnet = false;
  private magnetT = -Infinity;
  /** The cities the labels name: where the trip starts, where it landed, and what's under the pointer or plane. */
  private originName: string | null = null;
  private destinationName: string | null = null;
  private hoverName: string | null = null;
  private hoverNameAt = -Infinity;
  private hoverNamePoint: Vec3 | null = null;
  private hoverHub: Hub | null = null;
  // the land mask for guessing a leg's vehicle, and the guess waiting to hold
  private landAt: LandAt | null = null;
  private want: { vehicle: Vehicle; t: number; checked: number } = { vehicle: "flight", t: 0, checked: -Infinity };
  private hoverResolver = new HoverHubResolver();
  /** How lit up the landed country's outline is (0–1), and where it was landed, kept while it fades out. */
  private hi = 0;
  private hiP: Vec3 = [0, 1, 0];
  private pl: Plane | null = null;
  /** This viewer's member colour slot, which tints their own route. Null draws it in ink. */
  private color: number | null = null;
  // other members' flights: where presence says they are, and where we draw them (a moment behind, track.ts)
  private remotes = new Map<string, {
    o: Vec3; target: Vec3; track: Track; ft: Vec3; landed: boolean; pl: Plane; color: number | null;
    originHub: Hub | null; destinationHub: Hub | null;
    originName: string | null; destinationName: string | null;
    /** When Pip's saucer started drawing it out; -Infinity for a route that was simply there. */
    drawn: number;
  }>();

  // planes that just left the room's flights (someone landed, or stopped): each settles and shrinks away from t0
  private ghosts: { pl: Plane; t0: number }[] = [];
  // the pins at the trip's stops. `fan` is how far a pin leans to the side among its stop's bunch, in radians,
  // easing to `to`; `h` and `squash` are how high it is and how squashed, worked out every frame. `head` is where
  // its head was last drawn, for hit testing and keeping tags clear.
  private pins = new Map<string, {
    stop: string; g: Vec3; color: number | null; t0: number;
    fan: number; to: number; h: number; squash: number; head: Vec3 | null;
  }>();
  private pinsMoving = false;
  /**
   * A stop whose pins are being dragged: where they stood, the pointer (CSS px) their heads stay under, and the ground
   * below them, where they'd land.
   */
  private lift: { stop: string; from: Vec3; x: number; y: number; at: Vec3 } | null = null;

  // other members' pointers: drawn a moment behind their presence, flat on the ground with a shadow like ours
  /** Tags placed on the overlay this frame, so a place is named once and names don't pile up. */
  private tagBoxes: { text: string; at: { x: number; y: number }; l: number; t: number; r: number; b: number }[] = [];
  /** A place searched for: marked on the ground with its name until the next click on the globe. */
  private placeMark: { v: Vec3; name: string } | null = null;
  private cursors = new Map<string, { track: Track; x: number; y: number; visible: boolean; lie: CursorLie; shadow: { x: number; y: number } | null; shape: CursorShape }>();
  // Pip's saucer while Pip works: where it's drawn and headed, how it banks into the way it's going, how far grown
  // in (0 to 1), how far round its rim lights have chased, and, once `on` is off, how long it has been flying away
  private agent: { n: Vec3; target: Vec3; alt: number; bank: number; size: number; on: boolean; spin: number; away: number; coming: number } | null = null;
  // removed legs' routes reeling in, from when each started
  private reels: { o: Vec3; target: Vec3; color: number | null; t0: number }[] = [];
  // legs of this viewer's own trip that Pip's saucer is drawing out (showTrip), from when each started
  private ownDraws: { a: Vec3; b: Vec3; t0: number }[] = [];
  // the view following the saucer, and where on screen it keeps it: the middle of the open area, asked now and then
  private follow = false;
  private followSpot: { x: number; y: number; t: number } | null = null;

  // input and time
  private mx = -9999;
  private my = -9999;
  private hasPointer = false;
  private hover: Vec3 | null = null;
  private cursorLie: CursorLie = FLAT;
  private cursorMarker: CursorLie | null = null;
  private shadowAlpha = 1;
  private cursorOffset: [number, number] = [0, 0];
  // while the pointer peels off the globe: when it left, how it lay, its shadow's stuck spot and the way back to the globe
  private peel: { t0: number; lie: CursorLie; from: { x: number; y: number }; back: [number, number] } | null = null;
  // where the pointer's shadow is drawn, easing after the pointer; null when the overlay isn't drawing it
  private shadowAt: { x: number; y: number } | null = null;
  // the viewer's cursor shape, whose outline the shadow is cut from
  private cursorShape: CursorShape = "arrow";
  private shadowPaths = new Map<CursorShape, { path: Path2D; rotate: number }>();
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
    private provincesUrl: string,
    private events: GlobeEvents = {},
  ) {
    this.hud = hudEl.getContext("2d")!;
  }

  /** Starts rendering. Returns false when WebGL2 is unavailable. */
  start(): boolean {
    const gl = this.glEl.getContext("webgl2", { antialias: true, alpha: false, depth: true });
    if (!gl) return false;
    this.gl = gl;
    this.started = true;
    this.assetAbort = new AbortController();
    this.glEl.addEventListener("webglcontextlost", this.onContextLost);
    this.glEl.addEventListener("webglcontextrestored", this.onContextRestored);
    this.pGlobe = this.program(gl, VS_QUAD, FS_GLOBE, ["aPos"]);
    this.pPlane = this.program(gl, VS_PLANE, FS_PLANE, ["aPos", "aNrm", "aSm", "aPart"]);

    this.vaoQuad = gl.createVertexArray();
    gl.bindVertexArray(this.vaoQuad);
    this.attrib(gl, 0, new Float32Array([-1, -1, 3, -1, -1, 3]), 2);
    // The optional procedural sky is prepared after the first usable frame.
    this.startupPending = true;

    for (const v of VEHICLES) {
      const m = buildVehicle(v);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      this.attrib(gl, 0, m.pos, 3);
      this.attrib(gl, 1, m.nrm, 3);
      this.attrib(gl, 2, m.sm, 3);
      this.attrib(gl, 3, m.part, 1);
      this.vaoVehicle.set(v, { vao, count: m.count });
    }
    {
      const m = buildPin();
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      this.attrib(gl, 0, m.pos, 3);
      this.attrib(gl, 1, m.nrm, 3);
      this.attrib(gl, 2, m.sm, 3);
      this.attrib(gl, 3, m.part, 1);
      this.vaoPin = vao && { vao, count: m.count };
    }
    {
      const m = buildUfo();
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      this.attrib(gl, 0, m.pos, 3);
      this.attrib(gl, 1, m.nrm, 3);
      this.attrib(gl, 2, m.sm, 3);
      this.attrib(gl, 3, m.part, 1);
      this.vaoUfo = vao && { vao, count: m.count };
    }
    gl.bindVertexArray(null);

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.texSkyFallback = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texSkyFallback);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    // all sea until the texture arrives
    this.earthReady = false;
    this.texEarth = this.dataTexture(gl, this.earthUrl, [0, 255, 255, 255], (source) => { this.earthReady = true; this.loadLand(source); });
    // one country, so no borders, until the texture arrives
    this.texBorders = this.dataTexture(gl, this.bordersUrl, [0, 0, 0, 255]);
    // one province, so no lines, until it arrives
    this.texProvinces = this.dataTexture(gl, this.provincesUrl, [0, 0, 0, 255]);

    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reduceMotion = this.motionQuery.matches;
    this.motionQuery.addEventListener("change", this.onMotionChange);
    // native and non-passive, so a pinch can't zoom the page
    this.root.addEventListener("wheel", this.onWheel, { passive: false });
    this.root.addEventListener("gesturestart", this.onGesture as EventListener);
    this.root.addEventListener("gesturechange", this.onGesture as EventListener);
    document.fonts?.addEventListener("loadingdone", this.onFontsLoaded);

    this.resize();
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(this.root);
    }
    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.requestFrame();
    return true;
  }

  destroy() {
    this.started = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.motionQuery?.removeEventListener("change", this.onMotionChange);
    this.root.removeEventListener("wheel", this.onWheel);
    this.root.removeEventListener("gesturestart", this.onGesture as EventListener);
    this.root.removeEventListener("gesturechange", this.onGesture as EventListener);
    document.fonts?.removeEventListener("loadingdone", this.onFontsLoaded);
    this.glEl.removeEventListener("webglcontextlost", this.onContextLost);
    this.glEl.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.releaseGL();
    // Not loseContext(): React Strict Mode remounts onto the same canvas, which would hand back the lost context.
    this.gl = null;
  }

  private releaseGL() {
    this.assetAbort?.abort();
    this.assetAbort = null;
    for (const image of this.assetImages) { image.onload = null; image.src = ""; }
    this.assetImages.clear();
    if (this.startupTimer !== null) clearTimeout(this.startupTimer);
    this.startupTimer = null;
    this.startupPending = false;
    const gl = this.gl;
    this.sky?.dispose();
    this.sky = null;
    if (gl) {
      for (const texture of [this.texEarth, this.texBorders, this.texProvinces, this.texSkyFallback]) gl.deleteTexture(texture);
      for (const buffer of this.buffers) gl.deleteBuffer(buffer);
      for (const vao of [this.vaoQuad, this.vaoPin?.vao, this.vaoUfo?.vao, ...[...this.vaoVehicle.values()].map((v) => v.vao)]) {
        if (vao) gl.deleteVertexArray(vao);
      }
      if (this.pGlobe) gl.deleteProgram(this.pGlobe.p);
      if (this.pPlane) gl.deleteProgram(this.pPlane.p);
    }
    this.buffers = [];
    this.vaoVehicle.clear();
    this.vaoQuad = null;
    this.vaoPin = this.vaoUfo = null;
    this.texEarth = this.texBorders = this.texProvinces = this.texSkyFallback = null;
  }

  private onContextLost = (event: Event) => {
    event.preventDefault();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.releaseGL();
    this.gl = null;
  };

  private onContextRestored = () => {
    // Reuse scene, route, presence and camera state; replace only browser resources.
    this.destroy();
    this._glDirty = this._hudDirty = this.labelsDirty = true;
    this.start();
  };

  setTheme(theme: ThemeId) {
    this.P = PALETTES[theme];
    this.glDirty = this.hudDirty = true;
    this.nameSprites.clear();
    this.citySprites.clear();
    this.labelsDirty = true;
    const fell = getComputedStyle(this.root).getPropertyValue("--font-fell").trim();
    if (fell && fell !== this.cityFamily) {
      this.cityFamily = fell;
      this.onFontsLoaded();
      document.fonts?.load(`italic 400 15px ${fell}`).catch(() => {});
    }
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
    this.cityWidths.clear();
    this.citySprites.clear();
    this.labelsDirty = true;
    this.hudDirty = true;
  };

  /** Regenerates the sky from a seed. Give everyone on a trip the same seed and they all see the same sky. */
  setSkySeed(seed: string | number) {
    if (seed === this.skySeed) return;
    this.skySeed = seed;
    this.sky?.setSeed(seed, this.vaoQuad);
    this.glDirty = true;
  }

  setSearching(searching: boolean) {
    if (this.searching === searching) return;
    this.searching = searching;
    this.hudDirty = true;
  }

  /** Request one update; the loop continues only while the scene is changing. */
  requestFrame = () => {
    if (!this.gl || this.raf || this.inFrame || this.obscured ||
        (typeof document !== "undefined" && document.visibilityState === "hidden")) return;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.started && this.sleeping) this.t = performance.now() / 1000;
    this.sleeping = false;
    this.raf = requestAnimationFrame(this.tick);
  };

  setObscured(obscured: boolean) {
    this.obscured = obscured;
    this.onVisibility();
  }

  private onVisibility = () => {
    if (this.obscured || document.visibilityState === "hidden") {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.sleeping = true;
      if (this.idleTimer !== null) clearTimeout(this.idleTimer);
      this.idleTimer = null;
    } else this.requestFrame();
  };

  private onResize = () => {
    this.resize();
    this.requestFrame();
  };

  getMode() {
    return this.mode;
  }

  // ---------- input (wired to the root element's pointer events) ----------

  pointerDown(e: PointerEvent) {
    this.requestFrame();
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
    if (this.placeMark) {
      this.placeMark = null;
      this.hudDirty = true;
    }
    if (this.mode === "flying") {
      // clicking the stop the plane just left (a double click, or a second click later) lands the trip there
      if (this.nearOrigin(x, y)) {
        if (this.via.length) this.finish();
        return;
      }
      if (this.t - this.tTake < 0.25) return;
      // any other click ends a leg and flies on; off the globe, it lands at the last stop, or cancels without one
      const hit = this.pick(x, y);
      if (hit) this.addStop(hit);
      else if (this.via.length) this.finish();
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
    this.requestFrame();
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
    if (!d.drag && Math.hypot(x - d.x, y - d.y) > 6) {
      d.drag = true;
      this.endFollow();
    }
    if (d.drag) {
      this.autoFrame = null;
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
    this.requestFrame();
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
    const route = this.onRoute(x, y);
    if (route) {
      this.events.onRouteClick?.(route === OWN_ROUTE ? undefined : route);
      return;
    }
    const hit = this.pick(x, y);
    if (hit) this.takeoff(hit);
    else if (this.mode === "landed") this.cancel();
  }

  /**
   * The landed route within ROUTE_HIT px of a screen point, or null: this viewer's landed trip (OWN_ROUTE), or anyone's
   * stored or landed leg (its remote flight's id). Arcs and their ground tracks both count.
   */
  private onRoute(x: number, y: number): string | null {
    const legs: [Vec3, Vec3, number, string][] = [];
    const origin = this.origin;
    const pl = this.pl;
    if (this.mode === "landed" && origin && pl) {
      const end = this.ownEnd(pl);
      const stops = [...this.via.map((s) => s.v), origin, end.v];
      for (let i = 0; i < stops.length - 1; i++) legs.push([stops[i], stops[i + 1], i === stops.length - 2 ? end.alt : 0, OWN_ROUTE]);
    }
    // landed routes end at their stop, as drawn
    for (const [id, r] of this.remotes) if (r.landed) legs.push([r.o, this.groundEnd(r.target), 0, id]);
    for (const [from, to, alt, id] of legs) {
      for (const lift of [1, 0]) {
        const pts = this.arc(from, to, lift, lift ? alt : 0, this.hitArc);
        for (let j = 1; j < pts.length; j++) {
          const a = pts[j - 1];
          const b = pts[j];
          if (!a?.vis || !b?.vis) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const k = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
          if (Math.hypot(x - a.x - dx * k, y - a.y - dy * k) <= ROUTE_HIT) return id;
        }
      }
    }
    return null;
  }

  pointerLeave() {
    this.requestFrame();
    this.hasPointer = false;
    this.updatePreview(null, this.t * 1000);
  }

  // ---------- zoom ----------

  /** Zooms by a factor (below 1 zooms in) toward screen point (x, y), easing in. */
  zoomAt(x: number, y: number, factor: number) {
    this.requestFrame();
    this.turn = null;
    this.autoFrame = null;
    this.lastInteract = this.t;
    this.rangeTarget = clamp(this.rangeTarget * factor, RANGE_MIN, RANGE_MAX);
    const p = this.pick(x, y);
    this.zoomAnchor = p ? { p, x, y } : null;
  }

  private onWheel = (e: WheelEvent) => {
    this.requestFrame();
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
    this.endFollow();
    this.turn = null;
    this.autoFrame = null;
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
    this.requestFrame();
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
    this.autoFrame = null;
    this.endFollow();
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

  /** The camera range that fits a route of angular length w comfortably on screen, or in `area` of it. */
  private fitRange(w: number, area?: FreeArea) {
    const fx = area ? area.w / this.W : 1;
    const fy = area ? area.h / this.H : 1;
    // the route spans FIT of the view's half-angle: close enough to read, with room for its end tags
    const half = Math.atan(this.tan0 * Math.min(this.asp * fx, fy)) * FIT;
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
    this.requestFrame();
    const wasActive = this.mode !== "idle";
    this.mode = "idle";
    this.autoFrame = null;
    this.origin = null;
    this.dest = null;
    this.via = [];
    this.pl = null;
    this.turn = null;
    this.originHub = this.destinationHub = null;
    this.originName = this.destinationName = null;
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
    this.via = [];
    this.magnet = false;
    this.destinationHub = null;
    this.originHub = nearestPreviewHub(toLatLng(o));
    this.originName = this.originHub && placeName(toLatLng(o), this.originHub);
    this.pl = { n: o, f: tangent(cam.U, o), alt: 0, bank: 0, pitch: 0, ...parked("flight") };
    this.want = { vehicle: "flight", t: this.t, checked: -Infinity };
    this.tTake = this.t;
    this.endFollow();
    this.vlon = 0;
    this.vlat = 0;
    this.turn = null;
    this.events.onModeChange?.("flying", this.originHub);
  }

  /** Whether screen point (x, y) is on the stop the plane is flying from, or the plane is still held there. */
  private nearOrigin(x: number, y: number) {
    if (this.magnet) return true;
    const p = this.origin && this.proj(this.origin);
    return !!p && p.vis && Math.hypot(p.x - x, p.y - y) < STOP_HIT;
  }

  /** Ends the leg being flown at v, and takes off again from there. */
  private addStop(v: Vec3) {
    this.via.push({ v: this.origin!, hub: this.originHub, name: this.originName });
    this.origin = v;
    this.originHub = nearestPreviewHub(toLatLng(v));
    this.originName = this.originHub && placeName(toLatLng(v), this.originHub);
    // the plane touches down and lifts off again, with the takeoff ripple, held to the stop by the magnet
    this.tTake = this.t;
    this.magnet = true;
    this.magnetT = this.t;
  }

  /**
   * Lands a whole trip at once, as if it had been flown: the stops in order, at least two. Replaces any trip on the
   * globe and reports it through onLand like a flown one. Pip uses it to put a planned trip on the home globe.
   * `how`: "land" brings the plane down at the end and turns to frame the trip; "quiet" moves the trip where it is,
   * with no landing (a stop dragged to a new place); "draw" turns to frame it and draws its routes out instead, with
   * no plane, the pins dropping once each is drawn (the From and To search).
   */
  showTrip(points: LatLng[], how: ShowTrip = "land") {
    this.requestFrame();
    if (points.length < 2) return;
    const vs = points.map((p) => vecOf(p.lat * D2R, p.lng * D2R));
    const before = this.ownLegs();
    if (this.mode !== "idle") this.cancel();
    this.takeoff(vs[0]);
    for (const v of vs.slice(1, -1)) this.addStop(v);
    this.magnet = false;
    this.land(vs[vs.length - 1]);
    // While Pip's saucer is out it builds the trip itself: no plane lands and the view stays with the saucer. Legs
    // that are new draw out behind it, and legs that went reel in. A quiet one (a stop dragged to a new place) only
    // moves the trip, where it is.
    const pip = !!this.agent?.on && !this.reduceMotion;
    if (!pip && how === "land") return;
    const t = this.t;
    if (pip) {
      const after = this.ownLegs();
      const same = (x: [Vec3, Vec3], y: [Vec3, Vec3]) => angle(x[0], y[0]) < 1e-6 && angle(x[1], y[1]) < 1e-6;
      for (const leg of after) if (!before.some((b) => same(b, leg))) this.ownDraws.push({ a: leg[0], b: leg[1], t0: t });
      for (const leg of before) if (!after.some((a) => same(a, leg))) this.reels.push({ o: leg[0], target: leg[1], color: this.color, t0: t });
    }
    this.tLand = t - TOUCHDOWN - VANISH;
    if (how === "draw" && !pip) {
      // the view keeps its turn to frame the trip; each leg draws out in turn once the turn is well under way
      if (!this.reduceMotion) {
        const start = (this.turn?.t0 ?? t) + (this.turn?.dur ?? 0) * 0.4;
        this.ownLegs().forEach((leg, i) => this.ownDraws.push({ a: leg[0], b: leg[1], t0: start + i * DRAW * 0.6 }));
      }
      return;
    }
    this.turn = null;
    this.autoFrame = null;
  }

  /** This viewer's landed trip as its legs, each from a stop to the next. */
  private ownLegs(): [Vec3, Vec3][] {
    if (this.mode !== "landed" || !this.origin || !this.dest) return [];
    const stops = [...this.via.map((s) => s.v), this.origin, this.dest];
    return stops.slice(1).map((b, i) => [stops[i], b]);
  }

  /** How far Pip's saucer has drawn out this viewer's own leg from a to b: 1 when it's whole. */
  private ownDrawn(a: Vec3, b: Vec3, t: number) {
    const d = this.ownDraws.find((d) => angle(d.a, a) < 1e-6 && angle(d.b, b) < 1e-6);
    return d ? ease(clamp((t - d.t0) / DRAW, 0, 1)) : 1;
  }

  /** Lands the trip at the last stop, which ends the leg flown into it. */
  private finish() {
    const end = this.origin!;
    const last = this.via.pop()!;
    this.origin = last.v;
    this.originHub = last.hub;
    this.originName = last.name;
    this.land(end);
  }

  private land(v: Vec3) {
    const pl = this.pl!;
    const origin = this.origin!;
    const stops = [...this.via.map((s) => s.v), origin, v];
    this.mode = "landed";
    this.tLand = this.t;
    this.dest = v;
    pl.n = v;
    pl.f = tangent(pl.f, v);
    this.destinationHub = nearestPreviewHub(toLatLng(v));
    this.destinationName = this.destinationHub && placeName(toLatLng(v), this.destinationHub);
    this.updatePreview(null, this.t * 1000);
    // light up the destination hub's country, or where the plane landed when no hub resolves
    const hub = this.destinationHub;
    this.hiP = hub ? vecOf(hub.lat * D2R, hub.lng * D2R) : v;
    // turn the globe to frame the whole route
    // and back out if the whole route doesn't fit, rising mid-way like a fly-to
    let span = 0;
    for (const a of stops) for (const b of stops) span = Math.max(span, angle(a, b));
    const midV = stops.length === 2 ? slerp(origin, v, 0.5) : norm(stops.reduce((a, b) => add(a, b)));
    const mid = llOf(midV);
    const range = Math.max(this.range, this.fitRange(span));
    this.zoomAnchor = null;
    this.turn = {
      from: { lon: this.lon0, lat: this.lat0, range: this.range },
      to: { lon: mid.lon, lat: clamp(mid.lat, -1, 1), range },
      hop: this.range < 1.2 && !this.reduceMotion ? Math.min(0.5, 0.25 * span + 0.08) : 0,
      t0: this.t + (this.reduceMotion ? 0 : 0.5),
      dur: this.reduceMotion ? 0.001 : 1.5,
      // the trip's panel opens as the plane lands; by the time the turn starts it's there to frame around
      // zooms in to fit the route in the open space, so a short trip fills it rather than sitting on a far-off globe
      frame: { p: midV, w: span, minRange: RANGE_MIN },
    };
    this.autoFrame = { ...this.turn.frame! };
    const hubs = [...this.via.map((s) => s.hub), this.originHub, this.destinationHub];
    this.events.onModeChange?.("landed", hubs[0]);
    this.events.onLand?.(stops.slice(1).map((b, i) => {
      const a = stops[i];
      const depart = new Date();
      depart.setDate(depart.getDate() + 1 + i);
      return {
        from: hubs[i],
        to: hubs[i + 1],
        origin: toLatLng(a),
        destination: toLatLng(b),
        distanceKm: Math.round(EARTH_RADIUS_KM * angle(a, b)),
        departDate: depart,
      };
    }));
  }

  // ---------- GL setup ----------

  private attrib(gl: WebGL2RenderingContext, loc: number, data: Float32Array, size: number) {
    const b = gl.createBuffer();
    if (b) this.buffers.push(b);
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
    const vertex = sh(gl.VERTEX_SHADER, vs);
    const fragment = sh(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, vertex);
    gl.attachShader(p, fragment);
    attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    gl.detachShader(p, vertex);
    gl.detachShader(p, fragment);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
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
  private dataTexture(gl: WebGL2RenderingContext, url: string, until: number[], consume?: (source: CanvasImageSource) => void) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(until));
    const signal = this.assetAbort!.signal;
    const put = (src: TexImageSource & CanvasImageSource) => {
      if (signal.aborted || this.gl !== gl) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      try { consume?.(src); } catch { /* The optional CPU mask must not prevent the texture from drawing. */ }
      this.glDirty = true;
    };
    const viaImg = () => {
      if (signal.aborted) return;
      const im = new Image();
      this.assetImages.add(im);
      im.onload = () => { this.assetImages.delete(im); put(im); };
      im.onerror = () => this.assetImages.delete(im);
      im.src = url;
    };
    if (typeof createImageBitmap === "function") {
      fetch(url, { signal })
        .then((r) => { if (!r.ok) throw new Error(`Texture ${r.status}`); return r.blob(); })
        .then((b) => createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" }))
        .then((bitmap) => {
          try { put(bitmap); } finally { bitmap.close(); }
        })
        .catch(viaImg);
    } else viaImg();
    return tex;
  }

  /** The same decoded data texture feeds the GPU and the small CPU vehicle mask. */
  private loadLand(source: CanvasImageSource) {
    if (this.landAt) return;
    const canvas = document.createElement("canvas");
    canvas.width = LAND_W;
    canvas.height = LAND_H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, LAND_W, LAND_H);
    this.landAt = landMask(ctx.getImageData(0, 0, LAND_W, LAND_H).data, LAND_W, LAND_H);
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
      if (dpr !== this.dpr) {
        this.nameSprites.clear();
        this.citySprites.clear();
      }
      this.labelsDirty = true;
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

  /**
   * Lays the pointer flat on the ground under it, like the hover ring, in steps coarse enough to cache,
   * and eases its shadow after it. The shadow falls toward the globe's middle. Leaving the globe, it peels
   * off. True when the shadow needs redrawing.
   */
  private updateCursor(dt: number, t: number) {
    const before = this.shadowAt && { ...this.shadowAt };
    let lie = FLAT;
    let offset: [number, number] = [0, 0];
    let marker: CursorLie | null = null;
    const hover = this.mode !== "flying" ? this.hover : null;
    if (hover) this.peel = null;
    this.shadowAlpha = 1;
    if (hover) {
      // the ring flattens all the way to the horizon, as the route's ground marks do
      const { rot, minor } = this.groundTilt(hover);
      const squash = Math.round(minor * 20) / 20;
      const angle = ((Math.round((rot / D2R) / 5) * 5) % 180 + 180) % 180;
      marker = squash < 1 ? { angle, squash } : FLAT;
    }
    if (hover && !this.reduceMotion) {
      const { rot, minor } = this.groundTilt(hover);
      const squash = Math.round(Math.max(CURSOR_SQUASH, minor) * 20) / 20;
      // the long axis is a line, so 0° and 180° are the same lie
      const angle = ((Math.round((rot / D2R) / 5) * 5) % 180 + 180) % 180;
      if (squash < 1) lie = { angle, squash };
    }
    if (hover) {
      const d = this.disc();
      const sx = clamp((this.mx - d.x) / d.r, -1, 1);
      const sy = clamp((this.my - d.y) / d.r, -1, 1);
      const x = this.mx - CURSOR_SHADOW * sx;
      const y = this.my + CURSOR_DROP - CURSOR_SHADOW * sy;
      if (!this.shadowAt || this.reduceMotion) this.shadowAt = { x, y };
      else {
        const k = 1 - Math.exp(-dt / CURSOR_CHASE);
        this.shadowAt.x += (x - this.shadowAt.x) * k;
        this.shadowAt.y += (y - this.shadowAt.y) * k;
      }
    } else if (this.shadowAt && this.hasPointer && this.mode !== "flying" && !this.down?.drag && !this.pinch &&
        !this.reduceMotion) {
      if (!this.peel) {
        const d = this.disc();
        const bx = d.x - this.mx, by = d.y - this.my;
        const l = Math.hypot(bx, by) || 1;
        this.peel = { t0: t, lie: this.cursorLie, from: { ...this.shadowAt }, back: [bx / l, by / l] };
      }
      const p = this.peel;
      const k = (t - p.t0) / CURSOR_PEEL;
      if (k >= 1) {
        this.peel = null;
        this.shadowAt = null;
      } else {
        // a damped spring from the squash it had on the globe, through flat and past it
        const spring = Math.exp(-5 * k) * Math.cos(3 * Math.PI * k);
        const squash = Math.round(clamp(1 + (p.lie.squash - 1) * spring, CURSOR_SQUASH, 1.3) * 20) / 20;
        if (squash !== 1) lie = { angle: p.lie.angle, squash };
        // held back toward the globe, then let go
        const pull = CURSOR_PULL * Math.sin(Math.PI * k) * (1 - k);
        offset = [Math.round(p.back[0] * pull), Math.round(p.back[1] * pull)];
        // the shadow springs out from where it was stuck, overshooting a little, and fades as the pointer lifts away
        const e = 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2;
        this.shadowAlpha = 1 - k * k;
        this.shadowAt = {
          x: p.from.x + (this.mx + CURSOR_FLOAT.x - p.from.x) * e,
          y: p.from.y + (this.my + CURSOR_FLOAT.y - p.from.y) * e,
        };
      }
    } else {
      this.peel = null;
      this.shadowAt = null;
    }

    const now = this.shadowAt;
    let redraw = !before || !now ? before !== now : Math.abs(now.x - before.x) + Math.abs(now.y - before.y) > 0.02;
    const same = (a: CursorLie | null, b: CursorLie | null) =>
      a === b || (!!a && !!b && a.angle === b.angle && a.squash === b.squash);
    if (!same(lie, this.cursorLie) || !same(marker, this.cursorMarker) ||
        offset[0] !== this.cursorOffset[0] || offset[1] !== this.cursorOffset[1]) {
      this.cursorLie = lie;
      this.cursorMarker = marker;
      this.cursorOffset = offset;
      this.events.onCursorChange?.({ lie, offset, marker });
      redraw = true;
    }
    return redraw;
  }

  /**
   * Moves other members' pointers along their tracks and lays them on the ground the way updateCursor lays ours,
   * shadow and all (no peel: their pointer leaving the globe just fades). True when a shadow needs redrawing.
   */
  private updateRemoteCursors(dt: number, t: number) {
    let moved = false;
    const d = this.cursors.size ? this.disc() : null;
    for (const r of this.cursors.values()) {
      const n = this.reduceMotion ? r.track.latest() : r.track.at(t);
      const p = n && this.proj(n);
      if (!n || !p || !p.vis) {
        if (r.visible) moved = true;
        r.visible = false;
        r.shadow = null;
        continue;
      }
      r.visible = true;
      r.x = p.x;
      r.y = p.y;
      const { rot, minor } = this.groundTilt(n);
      const squash = this.reduceMotion ? 1 : Math.max(CURSOR_SQUASH, minor);
      r.lie = squash < 1 ? { angle: ((rot / D2R) % 180 + 180) % 180, squash } : FLAT;
      const sx = clamp((p.x - d!.x) / d!.r, -1, 1);
      const sy = clamp((p.y - d!.y) / d!.r, -1, 1);
      const x = p.x - CURSOR_SHADOW * sx;
      const y = p.y + CURSOR_DROP - CURSOR_SHADOW * sy;
      const before = r.shadow;
      if (!before || this.reduceMotion) r.shadow = { x, y };
      else {
        const k = 1 - Math.exp(-dt / CURSOR_CHASE);
        r.shadow = { x: before.x + (x - before.x) * k, y: before.y + (y - before.y) * k };
      }
      if (!before || Math.abs(r.shadow.x - before.x) + Math.abs(r.shadow.y - before.y) > 0.02) moved = true;
    }
    return moved;
  }

  /** Pointer shadows, on top of the overlay: ours and other members'. The cursor images themselves have none. */
  private cursorShadow() {
    if (typeof Path2D === "undefined") return;
    if (this.shadowAt) {
      this.dropShadow(this.shadowAt.x + this.cursorOffset[0], this.shadowAt.y + this.cursorOffset[1], this.cursorLie, this.shadowAlpha, this.cursorShape);
    }
    // other members' in the shape each picked
    for (const r of this.cursors.values()) if (r.shadow) this.dropShadow(r.shadow.x, r.shadow.y, r.lie, 1, r.shape);
  }

  /** A cursor's shadow at x, y, in the cursor's shape, lying on the ground as `lie` says. */
  private dropShadow(x: number, y: number, lie: CursorLie, alpha: number, kind: CursorShape) {
    const ctx = this.hud;
    const dpr = this.hudEl.width / this.W;
    const [a, b, c, d] = cursorLieMatrix(lie);
    let shape = this.shadowPaths.get(kind);
    if (!shape) {
      const { d: outline, rotate } = cursorOutline(kind);
      this.shadowPaths.set(kind, (shape = { path: new Path2D(outline), rotate }));
    }
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(x, y);
    ctx.transform(a, b, c, d, 0, 0);
    ctx.rotate(shape.rotate * D2R);
    ctx.filter = "blur(1.2px)";
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.P.cursorShadow;
    ctx.fill(shape.path);
    ctx.restore();
  }

  private pos(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.root.getBoundingClientRect();
    return [(e.clientX - r.left) * (this.W / (r.width || 1)), (e.clientY - r.top) * (this.H / (r.height || 1))];
  }

  // ---------- places on screen ----------

  /** The place under the pointer, or null when the pointer is off the globe or has left it. */
  /** The ground under a screen point (CSS px), its nearest hub and the name the globe prints there; null off the globe. */
  placeAt(x: number, y: number): { at: LatLng; hub: Hub | null; name: string | null } | null {
    const p = this.cam ? this.pick(x, y) : null;
    if (!p) return null;
    const at = toLatLng(p);
    const hub = nearestPreviewHub(at);
    return { at, hub, name: hub && placeName(at, hub) };
  }

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
      vehicle: pl.next,
    };
  }

  /**
   * Picks up a stop's pins by their heads at screen point (x, y), CSS px, and carries them there: they rise off the
   * ground, casting their shadows, with their heads kept under the pointer, and the routes into and out of the stop
   * follow them. Call again as the pointer moves. Returns where they'd land, or null off the globe.
   */
  liftStop(stop: string, x: number, y: number): { at: LatLng; hub: Hub | null; name: string | null } | null {
    if (this.lift?.stop !== stop) {
      const pin = [...this.pins.values()].find((p) => p.stop === stop && p.h !== Infinity);
      if (!pin) return null;
      this.lift = { stop, from: pin.g, x, y, at: pin.g };
    }
    Object.assign(this.lift, { x, y });
    this.aimLift();
    this.glDirty = true;
    this.hudDirty = true;
    return this.landing(stop);
  }

  /** Where a lifted stop's pins would land now: the ground under them, its nearest hub and name. */
  landing(stop: string): { at: LatLng; hub: Hub | null; name: string | null } | null {
    if (this.lift?.stop !== stop) return null;
    const at = toLatLng(this.lift.at);
    const hub = nearestPreviewHub(at);
    return { at, hub, name: hub && placeName(at, hub) };
  }

  /**
   * Lets go of a lifted stop's pins: they fall from where they hang onto `at`, or back where they stood when it's
   * null (a cancelled or refused move), sinking in and springing back like a landing.
   */
  dropStop(stop: string, at: LatLng | null) {
    const lift = this.lift;
    if (!lift || lift.stop !== stop) return;
    const land = at ? vecOf(at.lat * D2R, at.lng * D2R) : lift.from;
    for (const p of this.pins.values()) {
      if (p.stop !== stop) continue;
      // carry on the drop from the height they're held at: h = FALL·(1−q) − SINK·q with q = (u/DROP)²
      const q = clamp((PIN_FALL - Math.max(p.h, 0)) / (PIN_FALL + PIN_SINK), 0, 1);
      p.t0 = this.t - (this.reduceMotion ? Infinity : PIN_DROP * Math.sqrt(q));
      p.g = land;
    }
    this.lift = null;
    this.glDirty = true;
    this.hudDirty = true;
  }

  /**
   * Puts a lifted stop's pins on the ground point whose pins' heads, at their current height, sit under the pointer:
   * start under the pointer, then step back by how far the head stands off its ground point on screen.
   */
  private aimLift() {
    const lift = this.lift;
    const c = this.cam;
    if (!lift || !c) return;
    const pin = [...this.pins.values()].find((p) => p.stop === lift.stop);
    const h = Math.max(pin?.h ?? 0, 0);
    const size = S_PLANE * this.planeScale * PIN_SCALE;
    let g = this.pick(lift.x, lift.y);
    for (let i = 0; g && i < 3; i++) {
      const axis = norm(add(mul(g, Math.cos(PIN_LEAN)), mul(tangent(c.U, g), Math.sin(PIN_LEAN))));
      const head = this.proj(add(g, mul(axis, (h + PIN_HEAD_Z) * size)));
      const foot = this.proj(g);
      if (!head || !foot) break;
      g = this.pick(lift.x - (head.x - foot.x), lift.y - (head.y - foot.y)) ?? g;
    }
    if (g) lift.at = g;
  }

  /** Where a route end at v is drawn: under a lifted stop's pins while they're carried, else v. */
  private lifted(v: Vec3): Vec3 {
    return this.lift && angle(v, this.lift.from) < 1e-6 ? this.lift.at : v;
  }

  /** How high a route end at v reaches: a little way up a raised pin's needle there, lifted or dropping, else the ground. */
  private liftAlt(v: Vec3): number {
    for (const p of this.pins.values()) {
      if (p.h === Infinity || p.h <= 0 || angle(p.g, v) >= 1e-6) continue;
      return p.h * S_PLANE * this.planeScale * PIN_SCALE * Math.cos(PIN_LEAN) * ROUTE_LIFT;
    }
    return 0;
  }

  /**
   * Replaces the pins at the trip's stops. New ones drop in, one after another in list order; while this viewer's
   * plane is landing, they wait until it has gone. Pins sharing a stop stand in a ring round it.
   */
  setPins(list: GlobePin[]) {
    this.requestFrame();
    const t = this.t;
    const seen = new Set<string>();
    const stops = new Map<string, GlobePin[]>();
    for (const p of list) {
      const group = stops.get(p.stop);
      if (group) group.push(p);
      else stops.set(p.stop, [p]);
    }
    let fresh = 0;
    for (const p of list) {
      if (seen.has(p.key)) continue;
      seen.add(p.key);
      const group = stops.get(p.stop)!;
      // the first rider leans furthest left, the last furthest right
      const step = group.length > 1 ? Math.min(PIN_FAN, PIN_FAN_MAX / (group.length - 1)) : 0;
      const to = (group.indexOf(p) - (group.length - 1) / 2) * step;
      const g = vecOf(p.at.lat * D2R, p.at.lng * D2R);
      const old = this.pins.get(p.key);
      if (old) {
        // pins being carried stay with the pointer; the stop's new place arrives once they're dropped
        Object.assign(old, { stop: p.stop, g: this.lift?.stop === p.stop ? old.g : g, color: p.color, to });
        continue;
      }
      const t0 = this.reduceMotion ? -Infinity : Math.max(t, this.landingDone(g)) + PIN_STAGGER * fresh++;
      this.pins.set(p.key, { stop: p.stop, g, color: p.color, t0, fan: to, to, h: -PIN_SINK, squash: 0, head: null });
    }
    for (const key of this.pins.keys()) if (!seen.has(key)) this.pins.delete(key);
    this.glDirty = true;
    this.hudDirty = true;
  }

  /** Whether a route Pip added is still drawing out. */
  private drawing(t: number) {
    this.ownDraws = this.ownDraws.filter((d) => t - d.t0 < DRAW);
    for (const r of this.remotes.values()) if (t - r.drawn < DRAW) return true;
    return this.ownDraws.length > 0;
  }

  /** When a landing at or near v is over and its plane has gone: now or earlier when there's none. */
  private landingDone(v: Vec3) {
    let at = -Infinity;
    // this viewer's own landing holds every pin it brings, so a trip's stops all drop once the plane has gone
    if (this.mode === "landed") at = this.tLand + TOUCHDOWN + VANISH;
    for (const g of this.ghosts) if (angle(g.pl.n, v) < 0.01) at = Math.max(at, g.t0 + TOUCHDOWN + VANISH);
    // a route Pip is drawing out to here
    for (const r of this.remotes.values()) if (angle(r.target, v) < 0.01) at = Math.max(at, r.drawn + DRAW);
    for (const d of this.ownDraws) if (angle(d.b, v) < 0.01) at = Math.max(at, d.t0 + DRAW);
    return at;
  }

  /** Where the pins at a stop stand on screen: the middle of their heads, and how far round it they reach. */
  pinSpot(stop: string): { x: number; y: number; r: number } | null {
    const heads: ScreenPoint[] = [];
    for (const p of this.pins.values()) {
      if (p.stop !== stop || !p.head || this.t < p.t0) continue;
      const q = this.proj(p.head);
      if (q && q.vis) heads.push(q);
    }
    if (!heads.length) return null;
    const x = heads.reduce((s, q) => s + q.x, 0) / heads.length;
    const y = heads.reduce((s, q) => s + q.y, 0) / heads.length;
    const r = Math.max(...heads.map((q) => Math.hypot(q.x - x, q.y - y)));
    return { x, y, r: r + 10 };
  }

  /** The viewer's cursor shape, so the shadow the globe draws for it matches. */
  setCursorShape(shape: CursorShape) {
    if (shape === this.cursorShape) return;
    this.cursorShape = shape;
    this.hudDirty = true;
  }

  /** Sets the member colour slot this viewer's own route is drawn in; null for ink. */
  setColor(slot: number | null) {
    this.color = slot;
    this.hudDirty = true;
  }

  /** A member's route colour for a slot, wrapping past the last like `memberColor`; ink when there's no slot. */
  private routeColor(slot: number | null) {
    const c = this.P.memberRoutes;
    return slot === null || !c.length ? this.P.ink : c[((Math.trunc(slot) % c.length) + c.length) % c.length];
  }

  /** Replaces the other members' flights. Planes move steadily between updates rather than jumping. */
  setRemoteFlights(flights: RemoteFlight[]) {
    this.requestFrame();
    const now = performance.now() / 1000;
    const seen = new Set<string>();
    for (const f of flights) {
      const vehicle = f.vehicle ?? "flight";
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
      const originName = originHub && (r?.originHub === originHub ? r.originName : placeName(f.origin, originHub));
      const destinationName = destinationHub &&
        (r?.destinationHub === destinationHub ? r.destinationName : placeName(f.at, destinationHub));
      const color = f.color ?? null;
      if (r) {
        Object.assign(r, { o, target, ft, landed: f.landed, color, originHub, destinationHub, originName, destinationName });
        r.track.push(target, now);
        retarget(r.pl, vehicle);
      } else {
        const track = new Track();
        track.push(target, now);
        // a leg Pip adds while its saucer is out is drawn out behind it, and the pins at its end wait for it
        const drawn = f.landed && this.agent?.on && !this.reduceMotion ? now : -Infinity;
        if (drawn > -Infinity) {
          for (const p of this.pins.values()) if (angle(p.g, target) < 0.01 && p.t0 > now - 0.3) p.t0 = Math.max(p.t0, now + DRAW);
        }
        this.remotes.set(f.id, {
          o, target, track, ft, landed: f.landed, color, originHub, destinationHub, originName, destinationName, drawn,
          pl: { n: target, f: ft, alt: 0, bank: 0, pitch: 0, ...parked(vehicle) },
        });
      }
    }
    for (const [id, r] of this.remotes) {
      if (seen.has(id)) continue;
      // a plane still in the air settles and shrinks away rather than vanishing; a landed leg's route reels in
      if (!r.landed && !this.reduceMotion) this.ghosts.push({ pl: { ...r.pl }, t0: performance.now() / 1000 });
      if (r.landed && !this.reduceMotion) this.reels.push({ o: r.o, target: r.target, color: r.color, t0: performance.now() / 1000 });
      this.remotes.delete(id);
    }
  }

  /** Replaces the other members' pointers; null `at` hides one. They move steadily between updates. */
  setRemoteCursors(list: { id: string; at: LatLng | null; shape?: CursorShape }[]) {
    const now = performance.now() / 1000;
    const seen = new Set<string>();
    for (const c of list) {
      if (!c.at) continue;
      seen.add(c.id);
      let r = this.cursors.get(c.id);
      if (!r) this.cursors.set(c.id, (r = { track: new Track(), x: 0, y: 0, visible: false, lie: FLAT, shadow: null, shape: "arrow" }));
      r.shape = c.shape ?? "arrow";
      r.track.push(vecOf(c.at.lat * D2R, c.at.lng * D2R), now);
    }
    for (const id of this.cursors.keys()) if (!seen.has(id)) this.cursors.delete(id);
    this.hudDirty = true;
  }

  /**
   * Where another member's pointer is on screen and how it lies on the ground there, as the 2D matrix [a, b, c, d]
   * to squash it by. Null when it's hidden or round the back of the globe. Its shadow is drawn on the overlay.
   */
  remoteCursor(id: string): { x: number; y: number; lie: [number, number, number, number] } | null {
    const r = this.cursors.get(id);
    return r?.visible ? { x: r.x, y: r.y, lie: cursorLieMatrix(r.lie) } : null;
  }

  /** Where another member's plane is on screen, for their name label. Null if they aren't flying or it's hidden. */
  remotePlane(id: string): { x: number; y: number } | null {
    const r = this.remotes.get(id);
    const p = r && this.cam ? this.proj(mul(r.pl.n, 1 + r.pl.alt)) : null;
    return p && p.vis ? { x: p.x, y: p.y } : null;
  }

  /**
   * Shows Pip's saucer gliding to a place, or sends it away (null). It grows in where it's first sent, then glides
   * along the great circle to each new place, facing where it's going. Sent away, it flies off the top of the screen.
   */
  setAgent(at: LatLng | null) {
    this.requestFrame();
    const a = this.agent;
    if (!at) {
      if (a?.on) {
        a.on = false;
        a.away = 0;
        const up = this.cam ? tangent(this.cam.U, a.n) : null;
        if (up && Number.isFinite(up[0])) a.target = norm(add(mul(a.n, Math.cos(UFO_EXIT_ARC)), mul(up, Math.sin(UFO_EXIT_ARC))));
      }
      return;
    }
    const target = vecOf(at.lat * D2R, at.lng * D2R);
    if (a) return void Object.assign(a, { target, on: true, away: 0 });
    // it flies in from above the top of the screen; with reduced motion, or before the first frame, it grows in there
    const up = this.cam && !this.reduceMotion ? tangent(this.cam.U, target) : null;
    if (up && Number.isFinite(up[0])) {
      const from = norm(add(mul(target, Math.cos(UFO_EXIT_ARC)), mul(up, Math.sin(UFO_EXIT_ARC))));
      this.agent = { n: from, target, alt: 0, bank: 0, size: 1, on: true, spin: 0, away: 0, coming: UFO_ENTER };
    } else this.agent = { n: target, target, alt: 0, bank: 0, size: 0, on: true, spin: 0, away: 0, coming: 0 };
  }

  /** Where Pip's saucer is on screen, for its label and what it pops up. Null when it isn't out. */
  agentSpot(): AgentSpot | null {
    const a = this.agent;
    if (!a || !this.cam) return null;
    const body = this.proj(mul(a.n, 1 + a.alt));
    const ground = this.proj(a.n);
    if (!body || !ground) return null;
    return { x: body.x, y: body.y, ground: { x: ground.x, y: ground.y }, visible: body.vis, arrived: angle(a.n, a.target) < UFO_THERE };
  }

  /**
   * Turns the view to follow Pip's saucer, closing in to a regional view around it, until someone drags, scrolls
   * or pinches the globe, or takes off (onFollowEnd). Zooming keeps following.
   */
  setFollow(on: boolean) {
    this.requestFrame();
    if (on === this.follow) return;
    this.follow = on;
    this.followSpot = null;
    if (!on) return;
    this.autoFrame = null;
    this.vlon = this.vlat = 0;
    // closes in from wherever the view is, never pulls back out from closer
    this.rangeTarget = Math.min(this.rangeTarget, this.fitRange(FOLLOW_SPAN));
  }

  private endFollow() {
    if (!this.follow) return;
    this.follow = false;
    this.events.onFollowEnd?.();
  }

  /** The view (lon0, lat0) that puts ground point p at the middle of the open area, or centred when it can't. */
  private followView(p: Vec3, t: number) {
    if (!this.followSpot || t - this.followSpot.t > 1) {
      const area = this.events.freeArea?.() ?? null;
      this.followSpot = { x: area ? area.x + area.w / 2 : this.W / 2, y: area ? area.y + area.h / 2 : this.H / 2, t };
    }
    const ll = llOf(p);
    const keep = { lon0: this.lon0, lat0: this.lat0 };
    this.anchor(p, this.followSpot.x, this.followSpot.y);
    const at = this.proj(p);
    const reached = !!at && at.vis && Math.hypot(at.x - this.followSpot.x, at.y - this.followSpot.y) < 24;
    const want = reached ? { lon: this.lon0, lat: this.lat0 } : { lon: ll.lon, lat: ll.lat };
    Object.assign(this, keep);
    this.cam = this.camera();
    return want;
  }

  private stepAgent(dt: number, t: number, k: (r: number) => number) {
    const a = this.agent;
    if (!a) return;
    const still = this.reduceMotion;
    if (!a.on) a.away += dt;
    a.coming = Math.max(0, a.coming - dt);
    // it grows in where it first comes; it leaves whole, flying off (or at once, with reduced motion)
    if (a.on) a.size += (1 - a.size) * (still ? 1 : k(6));
    if (!a.on && (still || a.away > UFO_EXIT)) {
      this.agent = null;
      return;
    }
    // drawing a route out, it rides the route's end as it goes
    if (a.on) {
      const draws = [...[...this.remotes.values()].map((r) => ({ a: r.o, b: r.target, t0: r.drawn })), ...this.ownDraws];
      for (const d of draws) {
        const k = (t - d.t0) / DRAW;
        if (k >= 0 && k < 1) a.target = slerp(d.a, d.b, ease(k));
        else if (k >= 1 && k < 1.2) a.target = d.b;
      }
    }
    const gap = angle(a.n, a.target);
    let bank = 0;
    if (gap > 1e-6) {
      const step = still ? gap : Math.min(gap, gap * k(UFO_GLIDE) + UFO_CRUISE * this.zoomScale * dt);
      // it banks toward the side of the screen it's heading for
      if (gap > UFO_THERE && this.cam) bank = -clamp(dot(tangent(sub(a.target, a.n), a.n), this.cam.R) * gap * 8, -0.35, 0.35);
      a.n = slerp(a.n, a.target, step / gap);
    }
    a.bank += (bank - a.bank) * (still ? 1 : k(5));
    a.spin = still ? 0 : (a.spin + dt * 0.6) % 1;
    // it hovers, bobbing, and comes down from higher up as it grows in
    const bob = still ? 0 : Math.sin(t * 2.4) * 0.2;
    a.alt = ALT * this.planeScale * (UFO_HOVER + bob + (1 - a.size) * 3 + a.away * a.away * 14 + a.coming * a.coming * 14);
  }

  /** Where a place is on screen, in CSS px, and whether the globe hides it. Null before the first frame. */
  /**
   * Where a route's arc is on screen at fraction `t` from `from` to `to` (0.5 is its peak): the same lifted curve
   * the globe draws, so a tag placed here sits on the line. Not visible until a route drawing out has reached it.
   */
  routePoint(from: LatLng, to: LatLng, t = 0.5): { x: number; y: number; visible: boolean } | null {
    if (!this.cam) return null;
    const a = vecOf(from.lat * D2R, from.lng * D2R);
    const b = vecOf(to.lat * D2R, to.lng * D2R);
    const w = angle(a, b);
    const h = Math.min(0.32, 0.03 * this.zoomScale + w * 0.11);
    const p = this.proj(mul(slerp(a, b, t), 1 + h * Math.sin(Math.PI * t)));
    // a route still drawing out hasn't reached a point past its pen yet, so whatever sits there waits for it
    const drawn = this.ownDraws.length ? this.ownDrawn(a, b, this.t) : 1;
    return p ? { x: p.x, y: p.y, visible: p.vis && drawn >= t } : null;
  }

  project(ll: LatLng): { x: number; y: number; visible: boolean } | null {
    if (!this.cam) return null;
    const p = this.proj(vecOf(ll.lat * D2R, ll.lng * D2R));
    return p ? { x: p.x, y: p.y, visible: p.vis } : null;
  }

  /**
   * Turns the globe to centre a place, framing `spanDeg` of arc around it; small spans zoom right in. With a `name`,
   * the place is marked on the ground and named, whether or not the map prints it, until the next click on the globe.
   */
  flyTo(ll: LatLng, spanDeg: number, name?: string) {
    this.requestFrame();
    this.placeMark = name ? { v: vecOf(ll.lat * D2R, ll.lng * D2R), name } : null;
    this.hudDirty = true;
    const to = { lon: ll.lng * D2R, lat: clamp(ll.lat * D2R, -LAT_MAX, LAT_MAX), range: this.fitRange(spanDeg * D2R) };
    const far = angle(vecOf(this.lat0, this.lon0), vecOf(to.lat, to.lon));
    const dur = this.reduceMotion ? 0.001 : clamp(0.9 + far * 0.5, 0.9, 2);
    this.zoomAnchor = null;
    this.vlon = this.vlat = 0;
    this.turn = {
      from: { lon: this.lon0, lat: this.lat0, range: this.range },
      to,
      hop: this.reduceMotion ? 0 : Math.max(0, Math.min(0.6, 0.35 * far) - (this.range - Math.min(this.range, to.range)) * 0.5),
      t0: this.t,
      dur,
      frame: { p: vecOf(to.lat, to.lon), w: spanDeg * D2R, minRange: RANGE_MIN },
    };
    // hold the idle drift until well after it arrives
    this.lastInteract = this.t + dur;
  }

  /**
   * Where the camera should end up to show ground point p and w radians around it in the open part of the screen:
   * zoomed to fit the open area, and turned so p sits at its middle. With no panels in the way, p is centred as before.
   */
  private framed({ p, w, minRange }: { p: Vec3; w: number; minRange: number }) {
    const ll = llOf(p);
    const centred = { lon: ll.lon, lat: clamp(ll.lat, -LAT_MAX, LAT_MAX) };
    const area = this.events.freeArea?.() ?? null;
    this.frameArea = area;
    if (!area || (area.w >= this.W - 1 && area.h >= this.H - 1)) {
      return { ...centred, range: Math.max(minRange, this.fitRange(w)) };
    }
    const keep = { lon: this.lon0, lat: this.lat0, range: this.range };
    const x = area.x + area.w / 2;
    const y = area.y + area.h / 2;
    // Zoomed out, the globe can only turn, not slide, so the open area's middle may be off the disc or near its
    // edge, where a route would sit foreshortened at the horizon. Zoom in until the disc reaches it comfortably;
    // a route too long to fit that close is centred on the whole screen instead.
    const fit = this.fitRange(w, area);
    let range = Math.max(minRange, fit);
    let reached = false;
    for (let i = 0; i < 12 && range >= RANGE_MIN && range >= fit * 0.6; i++) {
      Object.assign(this, { lon0: centred.lon, lat0: centred.lat, range });
      this.cam = this.camera();
      const c = this.disc();
      // past the screen's size the globe fills the view, so it reaches anywhere
      if (c.r >= Math.min(this.W, this.H) / 2 || Math.hypot(x - c.x, y - c.y) <= c.r * 0.6) {
        reached = true;
        break;
      }
      range *= 0.85;
    }
    let to = { ...centred, range: Math.max(keep.range, this.fitRange(w)) };
    if (reached) {
      this.anchor(p, x, y);
      to = { lon: this.lon0, lat: this.lat0, range: this.range };
    }
    Object.assign(this, keep);
    this.cam = this.camera();
    return to;
  }

  /**
   * Frames the landed route again when the open part of the screen has changed, say a panel grew once its results
   * came in. Does nothing once someone has moved the globe since landing.
   */
  reframe() {
    this.requestFrame();
    const f = this.autoFrame;
    if (!f || this.mode !== "landed" || this.turn?.frame) return;
    const area = this.events.freeArea?.() ?? null;
    const was = this.frameArea;
    // only a real change in the open space, a tenth of the screen or more, moves the globe again
    const near = (a: number, b: number, size: number) => Math.abs(a - b) < size * 0.1;
    const same = area && was && near(area.x, was.x, this.W) && near(area.w, was.w, this.W) && near(area.y, was.y, this.H) &&
      near(area.h, was.h, this.H);
    if (area === was || same) return;
    const dur = this.reduceMotion ? 0.001 : 0.8;
    const here = { lon: this.lon0, lat: this.lat0, range: this.range };
    this.zoomAnchor = null;
    this.vlon = this.vlat = 0;
    this.turn = { from: here, to: here, hop: 0, t0: this.t, dur, frame: { ...f } };
    this.lastInteract = this.t + dur;
  }

  /** How far the view is zoomed in: 0 for the whole globe, 1 at the closest range, even in log steps. */
  zoom(): number {
    return Math.log(RANGE_MAX / this.range) / Math.log(RANGE_MAX / RANGE_MIN);
  }

  // ---------- simulation ----------

  private sim(dt: number, t: number) {
    const k = (r: number) => 1 - Math.exp(-dt * r);
    const nameTarget = this.mode === "idle" ? 1 : 0.7;
    this.nameInk = this.reduceMotion || Math.abs(nameTarget - this.nameInk) < 0.001
      ? nameTarget : this.nameInk + (nameTarget - this.nameInk) * k(6);
    // the landed country lights up as the plane touches down, and goes dark with the trip
    const hiTo = this.mode === "landed" && t - this.tLand > 0.3 ? 1 : 0;
    this.hi = this.reduceMotion || Math.abs(hiTo - this.hi) < 0.002 ? hiTo : this.hi + (hiTo - this.hi) * k(5);
    this.ghosts = this.ghosts.filter((g) => t - g.t0 < TOUCHDOWN + VANISH);
    for (const g of this.ghosts) {
      g.pl.alt += (0 - g.pl.alt) * k(8);
      g.pl.bank += (0 - g.pl.bank) * k(8);
    }
    this.stepPins(t, k);
    this.stepAgent(dt, t, k);
    for (const r of this.remotes.values()) {
      const pl = r.pl;
      const a = this.reduceMotion ? 1 : k(14);
      pl.n = this.reduceMotion ? r.target : (r.track.at(t) ?? r.target);
      const heading = tangent(r.ft, pl.n);
      pl.f = r.landed || angle(pl.f, heading) < 1e-5 ? heading : tangent(lerp(pl.f, r.ft, a), pl.n);
      const altitude = r.landed ? 0 : ALT * this.planeScale * lift(pl);
      pl.alt = r.landed || Math.abs(altitude - pl.alt) < 1e-5 ? altitude : pl.alt + (altitude - pl.alt) * k(8);
      if (r.landed) pl.bank = 0;
      this.stepSwap(pl, dt);
    }
    if (this.turn) {
      // fly the view to frame a finished route
      const tr = this.turn;
      if (tr.frame && t >= tr.t0) {
        tr.to = this.framed(tr.frame);
        tr.frame = undefined;
      }
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
    if (this.follow && this.agent?.on && !this.turn && !this.down?.drag && !this.pinch && this.mode !== "flying") {
      // keep Pip's saucer in the open part of the screen
      this.zoomAnchor = null;
      this.vlon = this.vlat = 0;
      // flying in, the view waits where it's coming down rather than chase it in from off the screen
      const want = this.followView(this.agent.coming > 0 ? this.agent.target : this.agent.n, t);
      const e = this.reduceMotion ? 1 : k(FOLLOW_EASE);
      this.lon0 += wrapPi(want.lon - this.lon0) * e;
      this.lat0 += (clamp(want.lat, -LAT_MAX, LAT_MAX) - this.lat0) * e;
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
      // drift slowly when left alone, but never away from a trip: once legs or pins are on the globe it stays put
      if (this.mode === "idle" && !this.reduceMotion && t - this.lastInteract > 2 && this.pins.size === 0 && this.remotes.size === 0 && !this.agent) {
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
    this.stepSwap(pl, dt);

    if (this.mode === "flying") {
      // the plane sits under the cursor and points along the great circle from the origin
      this.guessVehicle(pl, t);
      pl.alt += (ALT * this.planeScale * lift(pl) * smooth(0, 0.5, t - this.tTake) - pl.alt) * k(10);
      const hit = this.hasPointer ? this.pickClamp(this.mx, this.my, 1 + pl.alt) : null;
      if (hit) {
        const origin = this.origin!;
        const fPrev = pl.f;
        const fT = angle(origin, hit) > 0.01 ? tangent(sub(hit, slerp(origin, hit, 0.97)), hit) : tangent(pl.f, hit);
        let at = hit;
        if (this.via.length) {
          const p = this.proj(origin);
          const d = p && p.vis ? Math.hypot(p.x - this.mx, p.y - this.my) : Infinity;
          const held = this.magnet ? d <= MAGNET_RELEASE : d < MAGNET_CATCH;
          if (held !== this.magnet) {
            this.magnet = held;
            this.magnetT = t;
          }
          if (held) at = slerp(origin, hit, MAGNET_LEAN);
        }
        // glide for a moment after the magnet catches or lets go, rather than jumping
        pl.n = t - this.magnetT < MAGNET_EASE && !this.reduceMotion ? slerp(pl.n, at, k(30)) : at;
        pl.f = tangent(lerp(tangent(pl.f, hit), fT, k(14)), hit);
        const turn = Math.atan2(dot(cross(fPrev, pl.f), hit), dot(fPrev, pl.f)) / Math.max(dt, 1e-3);
        pl.bank += (clamp(-turn * 0.08, -0.6, 0.6) - pl.bank) * k(6);
      }
    } else if (this.mode === "landed") {
      // touchdown: the plane settles onto its shadow
      const settled = this.reduceMotion || this.planeLeft(this.tLand) === 0;
      pl.alt = settled ? 0 : pl.alt + (0 - pl.alt) * k(8);
      pl.bank = settled ? 0 : pl.bank + (0 - pl.bank) * k(8);
    }
  }

  // ---------- loop ----------

  /** Compare the scene using reusable buffers. Time alone doesn't change the globe or a settled HUD. */
  private sceneChanged() {
    const state = this.scene;
    state.length = 0;
    state.push(this.lon0, this.lat0, this.range, this.mode === "idle" ? 0 : this.mode === "flying" ? 1 : 2, this.hi);
    const plane = (pl: Plane) => state.push(...pl.n, ...pl.f, pl.alt, pl.bank, pl.pitch, VEHICLES.indexOf(pl.vehicle), pl.swap);
    if (this.pl && (this.mode === "flying" || this.planeLeft(this.tLand) > 0)) plane(this.pl);
    if (this.origin) state.push(...this.origin);
    if (this.dest) state.push(...this.dest);
    for (const s of this.via) state.push(...s.v);
    for (const r of this.remotes.values()) {
      state.push(...r.o, Number(r.landed), r.color ?? -1);
      if (!r.landed) plane(r.pl);
      else state.push(...r.target);
    }
    state.push(this.planeLeft(this.tLand), this.ghosts.length);
    for (const g of this.ghosts) state.push(this.planeLeft(g.t0), ...g.pl.n, g.pl.alt);
    for (const p of this.pins.values()) state.push(...p.g, p.fan, p.h === Infinity ? -1 : p.h, p.squash, p.color ?? -1);
    const a = this.agent;
    if (a) state.push(...a.n, a.alt, a.bank, a.size, a.spin);
    const changed = state.length !== this.lastScene.length || state.some((v, i) => v !== this.lastScene[i]);
    this.scene = this.lastScene;
    this.lastScene = state;
    return changed;
  }

  private tick = (ts: number) => {
    if (!this.gl) return;
    this.raf = 0;
    this.inFrame = true;
    const t = ts / 1000;
    const dt = this.t ? clamp(t - this.t, 0, 0.05) : 0.016;
    this.t = t;
    if (!this.resizeObserver) this.resize();
    const nameInk = this.nameInk;
    this.sim(dt, t);
    this.cam = this.camera();
    this.hover = this.hasPointer && !this.down?.drag && !this.pinch ? this.pick(this.mx, this.my) : null;
    // Use the surface raycast after the camera moves, not the elevated plane's
    // normal or a clamped horizon point. Pan/zoom under a still cursor also updates.
    this.updatePreview(this.mode === "landed" ? null : this.hover, ts);
    const ownMoved = this.updateCursor(dt, t);
    const shadowMoved = this.updateRemoteCursors(dt, t) || ownMoved;
    const changed = this.sceneChanged();
    if (changed) this.glDirty = true;
    const hover = !!this.hover && this.mode !== "flying";
    const animated = !this.reduceMotion && ((this.mode === "landed" && (this.searching || t - this.tLand < TOUCHDOWN + VANISH)) || this.pinsMoving || this.reels.length > 0 || this.drawing(t) ||
      (this.mode === "flying" && t - this.tTake <= 0.7));
    if (this.glDirty || nameInk !== this.nameInk || this.namesMoving || animated || this.hudAnimated || shadowMoved ||
        hover !== this.hudHover || (hover && (this.mx !== this.hudX || this.my !== this.hudY))) this.hudDirty = true;
    if (this.glDirty) {
      this.drawGL();
      if (this.started && this.earthReady && !this.readyRecorded) { this.readyRecorded = true; recordTiming("globe-ready"); }
      this.glDirty = false;
    }
    const painted = this.glDirty || this.hudDirty;
    if (this.hudDirty) {
      this.drawHud(t);
      this.cursorShadow();
      this.hudDirty = false;
      this.hudHover = hover;
      this.hudAnimated = animated;
      this.hudX = this.mx;
      this.hudY = this.my;
    } else this.nameT = t;
    // Overlay callbacks run with active scene/input frames and can wake us when new work arrives.
    this.events.onFrame?.();
    this.inFrame = false;
    if (this.startupPending) {
      this.startupPending = false;
      const gl = this.gl;
      this.startupTimer = setTimeout(() => {
        this.startupTimer = null;
        if (!gl || this.gl !== gl) return;
        this.sky = new Sky(gl, (vs, fs, attrs) => this.program(gl, vs, fs, attrs));
        this.sky.setSeed(this.skySeed, this.vaoQuad);
        this.glDirty = true;
      }, 0);
    }
    const drifting = this.mode === "idle" && !this.reduceMotion && this.pins.size === 0 && this.remotes.size === 0 && !this.agent;
    const tracksMoving = !this.reduceMotion && ([...this.cursors.values()].some((r) => r.track.active(t)) ||
      [...this.remotes.values()].some((r) => !r.landed && r.track.active(t)));
    if (this.glDirty || this.hudDirty || changed || painted || animated || shadowMoved || this.namesMoving || tracksMoving || this.turn || this.mode === "flying" || this.agent) {
      this.requestFrame();
    } else {
      this.sleeping = true;
      if (drifting || [...this.pins.values()].some((p) => p.t0 > t)) {
        const nextPin = Math.min(...[...this.pins.values()].filter((p) => p.t0 > t).map((p) => p.t0));
        const next = Math.min(nextPin, drifting ? this.lastInteract + 2 : Infinity);
        const wait = Math.max(1, (next - t) * 1000);
        this.idleTimer = setTimeout(this.requestFrame, wait);
      }
    }
  };

  private updatePreview(point: Vec3 | null, nowMs: number) {
    const ll = point ? toLatLng(point) : null;
    const next = this.hoverResolver.resolve(ll, nowMs);
    // the label names the city, not the hub, so it can change while the hub stays; look it up as often as the hub
    let name = this.hoverName;
    if (!ll || !next) name = null;
    else if (next.id !== this.hoverHub?.id || (nowMs - this.hoverNameAt >= 80 &&
      (!this.hoverNamePoint || point!.some((v, i) => v !== this.hoverNamePoint![i])))) {
      this.hoverNamePoint = point && [...point];
      name = placeName(ll, next);
      this.hoverNameAt = nowMs;
    }
    if (next?.id === this.hoverHub?.id && name === this.hoverName) return;
    this.hoverHub = next;
    this.hoverName = name;
    this.hudDirty = true;
    this.events.onPreviewChange?.(next, name);
  }

  /** Whether pins stand at v. */
  private pinned(v: Vec3) {
    for (const p of this.pins.values()) if (p.head && angle(p.g, v) < 1e-4) return true;
    return false;
  }

  /** Where a route into stop v meets the ground: the base of the needles of the pins there, or v itself. */
  private groundEnd(v: Vec3): Vec3 {
    for (const p of this.pins.values()) if (angle(p.g, v) < 1e-4) return p.g;
    return v;
  }

  /**
   * Where this viewer's last leg ends: just short of the plane while it flies, lands and shrinks away (the gap
   * shrinking with it), then down on the ground at its stop's pins once it has gone.
   */
  private ownEnd(pl: Plane): RouteEnd {
    const left = this.mode === "landed" ? this.planeLeft(this.tLand) : 1;
    // landed, it ends at the last stop's pins, carried with them when they're lifted
    if (left <= 0) {
      const end = this.lifted(pl.n);
      return { v: this.groundEnd(end), alt: this.liftAlt(end), cut: 0 };
    }
    return { v: pl.n, alt: pl.alt, cut: S_PLANE * this.planeScale * ROUTE_CUT * left };
  }

  /** How long a pin is on screen at v, in px: the size pins are drawn at, measured across the view there. */
  private pinPx(v: Vec3) {
    const q = this.proj(v);
    const r = this.cam && this.proj(add(v, mul(this.cam.U, S_PLANE * this.planeScale * PIN_SCALE)));
    return q && r ? Math.hypot(r.x - q.x, r.y - q.y) : 0;
  }

  /** The room a stop's tag leaves between itself and the stop's pins or ring, in px: it shrinks with the pins. */
  private tagGap(v: Vec3) {
    return Math.max(TAG_GAP_MIN, TAG_GAP * this.pinPx(v));
  }

  /** How high above a stop at screen point (x, y) its tag goes: clear above its start ring, or the heads of pins there. */
  private tagAbove(v: Vec3, y: number) {
    const gap = this.tagGap(v);
    let top = y - RING_R - gap - TAG_H / 2;
    for (const p of this.pins.values()) {
      if (!p.head || angle(p.g, v) >= 1e-4) continue;
      const q = this.proj(p.head);
      if (!q || !q.vis || !this.cam) continue;
      // the head's radius on screen, then a gap
      const rim = this.proj(add(p.head, mul(this.cam.U, PIN_HEAD_R * S_PLANE * this.planeScale * PIN_SCALE)));
      top = Math.min(top, q.y - (rim?.vis ? Math.hypot(rim.x - q.x, rim.y - q.y) : 8) - gap - TAG_H / 2);
    }
    return top;
  }

  /**
   * Where a landed stop's tag goes: centred under the base of its pins, a gap that shrinks with them below. While a
   * plane is still there (`left` of it, 1 to 0), it starts under the plane and rises to the pins as it shrinks away.
   */
  private tagBelow(v: Vec3, plane?: { pl: Plane; p: ScreenPoint; left: number }): { x: number; y: number } | null {
    const g = this.groundEnd(v);
    const q = this.proj(g);
    if (!q || !q.vis) return null;
    const at = { x: q.x, y: q.y + this.tagGap(g) + TAG_H / 2 };
    if (!plane || plane.left <= 0) return at;
    const under = this.underPlane(plane.pl, plane.p);
    const k = plane.left;
    return { x: at.x + (under.x - at.x) * k, y: at.y + (under.y - at.y) * k };
  }

  /** How much of a landing plane is left, 1 to 0: it touches down, then shrinks away. */
  private planeLeft(t0: number) {
    return this.reduceMotion ? 0 : 1 - ease(smooth(TOUCHDOWN, TOUCHDOWN + VANISH, this.t - t0));
  }

  /** Where a label under a plane goes: centred below it, clear of its wings whichever way it points. */
  private underPlane(pl: Plane, p: ScreenPoint): { x: number; y: number } {
    const nose = this.proj(mul(norm(add(pl.n, mul(pl.f, S_PLANE * this.planeScale * VEHICLE_LENGTH[pl.vehicle] * 0.5))), 1 + pl.alt));
    const half = nose ? Math.hypot(nose.x - p.x, nose.y - p.y) : 20;
    // half the plane, its shadow falling down and to the right, a gap, then half the tag
    return { x: p.x, y: p.y + half + 8 + 6 + 12 };
  }

  /**
   * Turns this viewer's plane into whatever the leg being drawn looks like: a train over land, a ferry over a short
   * stretch of sea, a plane for anything long. A new guess must hold for VEHICLE_HOLD s first.
   */
  private guessVehicle(pl: Plane, t: number) {
    const w = this.want;
    if (t - w.checked >= VEHICLE_CHECK && this.origin) {
      w.checked = t;
      const guess = chooseVehicle({
        from: this.origin,
        to: pl.n,
        landAt: this.landAt,
        fromHub: this.originHub?.mode,
        toHub: this.hoverHub?.mode,
        current: pl.next,
      });
      if (guess !== w.vehicle) Object.assign(w, { vehicle: guess, t });
    }
    if (w.vehicle !== pl.next && t - w.t >= VEHICLE_HOLD) retarget(pl, w.vehicle);
  }

  /**
   * Leans each pin to its place in its stop's bunch, and takes it through its drop: it falls, its point sinks into
   * the ground, and it squashes and springs back.
   */
  private stepPins(t: number, k: (r: number) => number) {
    let moving = false;
    // pins being carried rise, so keep their heads under the pointer as they do
    this.aimLift();
    for (const p of this.pins.values()) {
      p.fan = this.reduceMotion || Math.abs(p.to - p.fan) < 1e-3 ? p.to : p.fan + (p.to - p.fan) * k(8);
      if (this.lift?.stop === p.stop && p.h !== Infinity) {
        p.g = this.lift.at;
        p.squash = 0;
        p.h = this.reduceMotion ? PIN_LIFT : p.h + (PIN_LIFT - p.h) * k(PIN_LIFT_RATE);
        moving = true;
        continue;
      }
      const u = t - p.t0;
      p.squash = 0;
      if (u < 0) p.h = Infinity;
      else if (u < PIN_DROP) {
        const q = (u / PIN_DROP) ** 2;
        p.h = PIN_FALL * (1 - q) - PIN_SINK * q;
      } else {
        p.h = -PIN_SINK;
        const v = (u - PIN_DROP) / PIN_SETTLE;
        if (v < 1) p.squash = Math.exp(-5 * v) * Math.cos(v * Math.PI * 3) * 0.3;
      }
      if (u > -0.1 && u < PIN_DROP + 0.8) moving = true;
    }
    this.pinsMoving = moving;
  }

  private stepSwap(pl: Plane, dt: number) {
    if (pl.vehicle === pl.next && pl.swap === 0) return;
    if (this.reduceMotion) {
      Object.assign(pl, parked(pl.next));
      return;
    }
    pl.swap = Math.min(1, pl.swap + dt / SWAP);
    if (pl.swap >= 0.5) pl.vehicle = pl.next;
    if (pl.swap >= 1) pl.swap = 0;
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

  /**
   * Each pin that has started to drop and faces the camera, farthest first: where its point is, its axes (x and y
   * across, z up the needle, each scaled to its size and squash), and where its point and head fall in shadow.
   */
  private pinFrames(c: Camera, L: Vec3, size: number) {
    const ld = mul(L, -1);
    // where the light through w lands on the ground, or w itself once it's in the ground
    const shadowOf = (w: Vec3) => {
      if (dot(w, w) <= 1) return norm(w);
      const b = dot(w, ld);
      const disc = b * b - (dot(w, w) - 1);
      const t = -b - Math.sqrt(Math.max(disc, 0));
      return disc > 0 && t > 0 ? norm(add(w, mul(ld, t))) : norm(w);
    };
    const out: {
      tip: Vec3; X: Vec3; Y: Vec3; Z: Vec3; color: number | null; depth: number;
      shadowTip: Vec3; shadowHead: Vec3; shadowA: number;
    }[] = [];
    for (const p of this.pins.values()) {
      p.head = null;
      if (p.h === Infinity) continue;
      const g = p.g;
      if (dot(g, sub(c.C, g)) <= 0) continue;
      // lean back along the screen's up, so the needle stands out from the head seen from above, and out to the
      // side by the pin's place in its bunch
      const up = tangent(c.U, g);
      const side = tangent(c.R, g);
      const lean = norm(add(mul(up, Math.cos(p.fan)), mul(side, Math.sin(p.fan))));
      const tilt = PIN_LEAN + PIN_SPLAY * Math.abs(p.fan);
      const axis = norm(add(mul(g, Math.cos(tilt)), mul(lean, Math.sin(tilt))));
      const across = tangent(c.R, axis);
      const tall = size * (1 - p.squash);
      const wide = size * (1 + p.squash * 0.6);
      const tip = add(g, mul(axis, p.h * size));
      const head = add(tip, mul(axis, PIN_HEAD_Z * tall));
      p.head = head;
      out.push({
        tip,
        X: mul(across, wide),
        Y: mul(cross(axis, across), wide),
        Z: mul(axis, tall),
        color: p.color,
        depth: dot(sub(tip, c.C), c.F),
        shadowTip: shadowOf(tip),
        shadowHead: shadowOf(head),
        // fainter while it's high
        shadowA: 0.9 - 0.6 * clamp(p.h / PIN_FALL, 0, 1),
      });
    }
    return out.sort((a, b) => b.depth - a.depth);
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
    // a landed plane touches down, then shrinks away and leaves its pins
    const left = this.mode === "landed" ? this.planeLeft(this.tLand) : 1;
    const showPlane = !!pl && this.mode !== "idle" && left > 0;
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
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.texProvinces);
    gl.uniform1i(u.uProvinces, 3);
    gl.uniform1f(u.uProv, smooth(PROVINCES_FROM, PROVINCES_FULL, this.zoom()));
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.sky?.texture ?? this.texSkyFallback);
    gl.uniform1i(u.uSky, 1);
    gl.uniform1f(u.uSkyInk, th.skyInk);
    gl.uniform2f(u.uRes, cw, ch);
    gl.uniform1f(u.uDpr, dpr);
    setCam(u);
    gl.uniform1f(u.uDark, th.dark);
    for (const [key, value] of Object.entries(th.gl)) gl.uniform3fv(u[key], value);
    gl.uniform3fv(u.uShP, shP);
    gl.uniform3fv(u.uHiP, this.hiP);
    gl.uniform1f(u.uHi, this.hi);
    gl.uniform1f(u.uShR, S * 0.42);
    gl.uniform1f(u.uShA, pl && shadow ? (0.95 - 0.4 * smooth(0, ALT * this.planeScale, pl.alt)) * left : 0);
    // the pins' shadows, nearest the camera first
    const pins = this.pinFrames(c, L, S * PIN_SCALE);
    const pinA = this.pinShadowA;
    const pinB = this.pinShadowB;
    pinA.fill(0);
    pinB.fill(0);
    // Pip's saucer casts a round shadow in a pin's slot: a head with no needle
    const agent = this.agent;
    const ufo = agent ? { at: mul(agent.n, 1 + agent.alt), S: S * UFO_SCALE * agent.size } : null;
    const cast = pins.slice(-(MAX_PIN_SHADOWS - (ufo ? 1 : 0)));
    cast.forEach((f, i) => {
      pinA.set([...f.shadowTip, f.shadowA], i * 4);
      pinB.set([...f.shadowHead, PIN_HEAD_R * S * PIN_SCALE], i * 4);
    });
    let shadows = cast.length;
    if (ufo && agent) {
      const ld = mul(L, -1);
      const b = dot(ufo.at, ld);
      const disc = b * b - (dot(ufo.at, ufo.at) - 1);
      const t = -b - Math.sqrt(Math.max(disc, 0));
      if (disc > 0 && t > 0) {
        const g = norm(add(ufo.at, mul(ld, t)));
        // the shadow fades as it climbs away
        const high = Math.max(agent.away / (UFO_EXIT * 0.6), agent.coming / (UFO_ENTER * 0.6));
        pinA.set([...g, 0.55 * agent.size * Math.max(0, 1 - high)], shadows * 4);
        pinB.set([...g, ufo.S * 0.42], shadows * 4);
        shadows++;
      }
    }
    gl.uniform4fv(u["uPinA[0]"], pinA);
    gl.uniform4fv(u["uPinB[0]"], pinB);
    gl.uniform1i(u.uPinN, shadows);
    gl.uniform1f(u.uPinW, 0.016 * S * PIN_SCALE);
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

    // pins first, under the planes; then other members' planes, so this viewer's own plane sits on top. A landed
    // leg has no plane: its pins mark it.
    const planes: { pl: Plane; pp: Vec3; left: number }[] = [];
    for (const r of this.remotes.values()) {
      if (!r.landed) planes.push({ pl: r.pl, pp: mul(r.pl.n, 1 + r.pl.alt + 0.09 * S), left: 1 });
    }
    for (const g of this.ghosts) planes.push({ pl: g.pl, pp: mul(g.pl.n, 1 + g.pl.alt + 0.09 * S), left: this.planeLeft(g.t0) });
    if (pl && pp) planes.push({ pl, pp, left });
    const shown = planes.filter(({ pp, left }) => left > 0 && this.proj(pp)?.vis);
    const ufoShown = !!ufo && ufo.S > 1e-4 && !!this.proj(ufo.at)?.vis;
    if (!shown.length && !pins.length && !ufoShown) return;

    P = this.pPlane;
    u = P.u;
    gl.useProgram(P.p);
    setCam(u);
    gl.uniform2f(u.uRes, cw, ch);
    gl.uniform3fv(u.uFill, th.stickerGL.fill);
    gl.uniform3fv(u.uInkS, th.stickerGL.ink);
    gl.uniform3fv(u.uRoundel, th.stickerGL.roundel);
    for (const [key, value] of Object.entries(th.pipGL)) gl.uniform3fv(u[key], value);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    const sticker = (count: number) => {
      // each sticker covers an earlier one wholly
      gl.clear(gl.DEPTH_BUFFER_BIT);
      // 1: the ink outline, which also draws inner edges
      gl.uniform1f(u.uMode, 2);
      gl.uniform1f(u.uHull, 1.1 * dpr);
      gl.drawArrays(gl.TRIANGLES, 0, count);
      // 2: the paper body
      gl.uniform1f(u.uMode, 0);
      gl.uniform1f(u.uHull, 0);
      gl.drawArrays(gl.TRIANGLES, 0, count);
    };
    if (this.vaoPin && pins.length) {
      gl.bindVertexArray(this.vaoPin.vao);
      gl.uniform1i(u.uVehicle, 4);
      const members = th.memberGL;
      for (const f of pins) {
        const slot = f.color === null || !members.length ? null : ((Math.trunc(f.color) % members.length) + members.length) % members.length;
        gl.uniform3fv(u.uPin, slot === null ? th.stickerGL.fill : members[slot]);
        gl.uniform3fv(u.uPP, f.tip);
        gl.uniform3fv(u.uPX, f.X);
        gl.uniform3fv(u.uPY, f.Y);
        gl.uniform3fv(u.uPZ, f.Z);
        sticker(this.vaoPin.count);
      }
    }
    for (const { pl, pp, left } of shown) {
      const mesh = this.vaoVehicle.get(pl.vehicle);
      const s = S * (1 - Math.sin(Math.PI * pl.swap)) * left;
      if (!mesh || s < 1e-4) continue;
      const B = this.planeBasis(pl, s);
      gl.bindVertexArray(mesh.vao);
      gl.uniform1i(u.uVehicle, VEHICLES.indexOf(pl.vehicle));
      gl.uniform3fv(u.uPP, pp);
      gl.uniform3fv(u.uPX, B.X);
      gl.uniform3fv(u.uPY, B.Y);
      gl.uniform3fv(u.uPZ, B.Z);
      sticker(mesh.count);
    }
    // Pip's saucer last, over everything: it hovers higher than any plane
    if (this.vaoUfo && ufo && agent && ufoShown) {
      // tipped back along the screen's up so it's seen from the side a little, its face (z) toward the viewer
      // the view already leans when zoomed in, so it tips less there
      const lean = Math.max(0, UFO_TIP - this.tilt * 0.7);
      const tip = add(mul(agent.n, Math.cos(lean)), mul(tangent(c.U, agent.n), Math.sin(lean)));
      const across = tangent(c.R, tip);
      const up = norm(add(mul(tip, Math.cos(agent.bank)), mul(across, Math.sin(agent.bank))));
      const right = tangent(across, up);
      const B = { X: mul(right, ufo.S), Y: mul(up, ufo.S), Z: mul(cross(right, up), ufo.S) };
      gl.bindVertexArray(this.vaoUfo.vao);
      gl.uniform1i(u.uVehicle, 5);
      gl.uniform1f(u.uSpin, agent.spin);
      gl.uniform3fv(u.uPP, ufo.at);
      gl.uniform3fv(u.uPX, B.X);
      gl.uniform3fv(u.uPY, B.Y);
      gl.uniform3fv(u.uPZ, B.Z);
      sticker(this.vaoUfo.count);
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

  /** A name tag centred at x, y, for the place at `at` on screen (default x, y). */
  private tag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, at: { x: number; y: number } = { x, y }) {
    const P = this.P;
    ctx.save();
    ctx.font = this.tagFont;
    const maxTextWidth = Math.max(1, this.W - 30);
    if (ctx.measureText(text).width > maxTextWidth) {
      while (text.length > 1 && ctx.measureText(`${text}…`).width > maxTextWidth) text = text.slice(0, -1);
      text += "…";
    }
    const w = Math.ceil(ctx.measureText(text).width) + 14;
    const h = TAG_H;
    const lx = clamp(x - w / 2, 8, Math.max(8, this.W - w - 8));
    const ly0 = clamp(y - h / 2, 8, Math.max(8, this.H - h - 8));
    // one tag per place: a stop where one leg ends and the next starts, or two friends' legs meet, is named once
    if (this.tagBoxes.some((o) => o.text === text && Math.hypot(o.at.x - at.x, o.at.y - at.y) < TAG_SAME)) {
      ctx.restore();
      return;
    }
    // a different name in the way: step below it, then above, a tag at a time
    const hits = (top: number) => this.tagBoxes.some((o) => lx < o.r + 4 && lx + w > o.l - 4 && top < o.b + 3 && top + h > o.t - 3);
    const ly = [0, 1, -1, 2, -2].map((k) => clamp(ly0 + k * (h + 4), 8, Math.max(8, this.H - h - 8))).find((top) => !hits(top)) ?? ly0;
    this.tagBoxes.push({ text, at, l: lx, t: ly, r: lx + w, b: ly + h });
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

  /**
   * A name drawn at `size` (snapped to a half px) and the screen's pixel ratio, with its halo, centred. Drawing near the
   * size it shows at keeps the strokes crisp; shrinking one big sprite thins and blurs them.
   */
  private nameSprite(name: string, size: number, dpr: number) {
    const key = `${size}|${name}`;
    let c = this.nameSprites.get(key);
    if (c) return c;
    const P = this.P;
    const px = size * dpr;
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
    g.globalAlpha = 0.9;
    g.lineWidth = px * 0.22;
    lines.forEach((line, i) => g.strokeText(line, x, y + i * lh));
    g.globalAlpha = 1;
    g.fillStyle = P.ink;
    lines.forEach((line, i) => g.fillText(line, x, y + i * lh));
    if (this.nameSprites.size >= 512) this.nameSprites.delete(this.nameSprites.keys().next().value!);
    this.nameSprites.set(key, c);
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
      this.placedNames.length = 0;
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
      const snapped = Math.round(sp.size * 2) / 2;
      const img = this.nameSprite(sp.wrapped && n.wrap ? n.wrap : n.name, snapped, dpr);
      const k = sp.size / (snapped * dpr);
      const c = Math.cos(sp.a) * k;
      const si = Math.sin(sp.a) * k;
      ctx.globalAlpha = alpha;
      ctx.setTransform(dpr * c, dpr * si, -dpr * si, dpr * c, dpr * sp.x, dpr * sp.y);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
    }
    ctx.restore();
  }

  /** A city name's width at a 1px font size, in the italic `city` face. */
  private cityWidth(ctx: CanvasRenderingContext2D, name: string): number {
    let w = this.cityWidths.get(name);
    if (w === undefined) {
      ctx.font = `italic 400 100px ${this.cityFamily}`;
      ctx.letterSpacing = "0px";
      w = ctx.measureText(name).width / 100;
      this.cityWidths.set(name, w);
    }
    return w;
  }

  /** A city name drawn at `size` and the screen's pixel ratio with a paper halo, its left edge at x = pad. */
  private citySprite(name: string, size: number, dpr: number) {
    const key = `${size}|${name}`;
    let c = this.citySprites.get(key);
    if (c) return c;
    const P = this.P;
    const px = size * dpr;
    const pad = Math.ceil(px * 0.3);
    c = document.createElement("canvas");
    c.width = Math.ceil(this.cityWidth(this.hud, name) * px) + pad * 2;
    c.height = Math.ceil(px * 1.3) + pad * 2;
    const g = c.getContext("2d")!;
    g.font = `italic 400 ${px}px ${this.cityFamily}`;
    g.textBaseline = "middle";
    g.lineJoin = "round";
    g.strokeStyle = P.paper;
    g.globalAlpha = 0.75;
    g.lineWidth = px * 0.24;
    g.strokeText(name, pad, c.height / 2);
    g.globalAlpha = 1;
    g.fillStyle = P.ink;
    g.fillText(name, pad, c.height / 2);
    if (this.citySprites.size >= 512) this.citySprites.delete(this.citySprites.keys().next().value!);
    this.citySprites.set(key, c);
    return c;
  }

  /**
   * City names in the italic `city` face, each beside a small ink dot (a ring for a capital). Bigger cities print in
   * first as you zoom in. A city gives way to country names, planes and bigger cities, and tries its name on the left
   * when the right is taken.
   */
  private cityNames(ctx: CanvasRenderingContext2D, keepClear: { x: number; y: number }[], t: number) {
    const zoom = this.zoom();
    if (zoom < CITY_FROM[0]) {
      if (this.cityShown) {
        this.cityFade.fill(0);
        this.cityPlaced.fill(0);
        this.cityShown = false;
      }
      return;
    }
    this.cityShown = true;
    const C = this.cam!.C;
    const dpr = this.hudEl.width / this.W;
    const dt = this.cityT ? clamp(t - this.cityT, 0, 0.1) : 0;
    this.cityT = t;
    const ease = this.reduceMotion ? 1 : 1 - Math.exp(-dt * 14);

    // 1. cities big enough for this zoom, facing us and on screen
    const cands = this.cityCandidates;
    cands.length = 0;
    for (let i = 0; i < CITIES.length; i++) {
      const c = CITIES[i];
      if (zoom < CITY_FROM[c.rank]) {
        // the list is biggest first, so every city after this one is too small as well
        for (let j = i; j < CITIES.length; j++) this.cityFade[j] = this.cityPlaced[j] = 0;
        break;
      }
      const x = C[0] - c.v[0], y = C[1] - c.v[1], z = C[2] - c.v[2];
      const facing = (c.v[0] * x + c.v[1] * y + c.v[2] * z) / Math.hypot(x, y, z);
      const p = facing > 0.22 ? this.proj(c.v, this.cityPoint) : null;
      if (!p || !p.vis || p.x < -40 || p.y < -20 || p.x > this.W + 40 || p.y > this.H + 20) {
        this.cityFade[i] = this.cityPlaced[i] = 0;
        continue;
      }
      this.cityX[i] = p.x;
      this.cityY[i] = p.y;
      this.cityFacing[i] = facing;
      cands.push(i);
    }

    // 2. place them biggest first, so a city always outranks a smaller neighbour that got there first; each against
    // country names, planes and the cities already placed
    const boxes = this.cityBoxes;
    boxes.length = 0;
    const countries = this.placedNames;
    // names on neighbouring lines need less air than names side by side, which would read as one
    const hits = (b: number[], gap: number) =>
      countries.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) ||
      boxes.some((o) => b[0] - gap < o[2] && b[2] + gap > o[0] && b[1] - gap / 2 < o[3] && b[3] + gap / 2 > o[1]) ||
      keepClear.some((c) => c.x > b[0] - 24 && c.x < b[2] + 24 && c.y > b[1] - 18 && c.y < b[3] + 28);
    const won = this.cityWon;
    won.fill(0, 0, cands.length);
    cands.forEach((i, k) => {
      if (boxes.length >= CITY_MAX) return;
      const showing = this.cityPlaced[i];
      // a name that just lost its place waits a moment before trying again, so two names don't flicker
      if (!showing && t < this.cityHold[i]) return;
      const c = CITIES[i];
      const size = CITY_SIZE[c.rank];
      const w = this.cityWidth(ctx, c.name) * size;
      const x = this.cityX[i];
      const y = this.cityY[i];
      const hh = size * 0.6;
      // a little air between city names; a name already showing may sit a touch closer before it gives way
      const gap = showing ? 8 : 14;
      for (const left of this.cityLeft[i] ? [1, 0] : [0, 1]) {
        const b = left ? [x - w - 9, y - hh, x + 4, y + hh] : [x - 4, y - hh, x + w + 9, y + hh];
        if (hits(b, gap)) continue;
        boxes.push(b);
        this.cityLeft[i] = left;
        won[k] = 1;
        break;
      }
    });

    // 3. fade toward the outcome and draw: dot first, then the name beside it. Every name is the same ink, the small
    // ones smaller, each fading in from nothing to fully printed as you zoom; they don't dim for a trip
    const P = this.P;
    ctx.save();
    ctx.imageSmoothingQuality = "high";
    cands.forEach((i, k) => {
      const on = !!won[k];
      if (!on && this.cityPlaced[i]) this.cityHold[i] = t + 0.6;
      this.cityPlaced[i] = on ? 1 : 0;
      const prev = this.cityFade[i];
      const f = (this.cityFade[i] += ((on ? 1 : 0) - prev) * ease);
      if (t < this.cityHold[i] || (!dt && f !== Number(on)) || (this.cityFade[i] !== prev && Math.max(prev, f) >= 0.01)) this.namesMoving = true;
      const c = CITIES[i];
      const alpha = f * smooth(0.22, 0.4, this.cityFacing[i]) * smooth(CITY_FROM[c.rank], Math.min(1, CITY_FROM[c.rank] + CITY_FADE), zoom);
      if (alpha < 0.01) return;
      const x = this.cityX[i];
      const y = this.cityY[i];
      ctx.globalAlpha = alpha;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // world cities get a bigger dot, as they get a bigger name
      const big = c.rank < 2 ? 0.6 : 0;
      ctx.beginPath();
      ctx.arc(x, y, (c.capital ? 3.4 : 2.4) + big, 0, Math.PI * 2);
      ctx.fillStyle = P.paper;
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = P.ink;
      ctx.stroke();
      if (c.capital) {
        ctx.beginPath();
        ctx.arc(x, y, 1.3 + big / 2, 0, Math.PI * 2);
        ctx.fillStyle = P.ink;
        ctx.fill();
      }
      const size = CITY_SIZE[c.rank];
      const img = this.citySprite(c.name, size, dpr);
      const pad = Math.ceil(size * dpr * 0.3);
      const left = this.cityLeft[i];
      const tx = left ? x - 7 - (img.width - pad) / dpr : x + 7 - pad / dpr;
      // the sprite is in device px
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(img, Math.round(tx * dpr), Math.round(y * dpr - img.height / 2));
    });
    ctx.restore();
  }

  /**
   * How a small circle lying flat on the ground at n looks on screen: an ellipse whose
   * short axis points at the globe's centre and shrinks toward the horizon.
   */
  private groundTilt(n: Vec3) {
    const c = this.cam!;
    let e1 = cross(sub(n, c.C), n);
    e1 = len(e1) < 1e-6 ? tangent(c.R, n) : norm(e1);
    const e2 = cross(n, e1);
    const eps = 1e-3;
    const p0 = this.proj(n);
    const p1 = this.proj(add(n, mul(e1, eps)));
    const p2 = this.proj(add(n, mul(e2, eps)));
    if (!p0 || !p1 || !p2) return { rot: 0, minor: 1 };
    const ax = p1.x - p0.x, ay = p1.y - p0.y;
    const s = Math.hypot(ax, ay) || 1;
    // the part of e2's screen step across the long axis
    const minor = Math.abs((p2.x - p0.x) * -ay + (p2.y - p0.y) * ax) / (s * s);
    return { rot: Math.atan2(ay, ax), minor: Math.max(0.12, Math.min(1, minor)) };
  }

  /** Adds a circle of radius r px lying on the ground at n, centred on its screen point x, y. */
  private groundCircle(ctx: CanvasRenderingContext2D, n: Vec3, x: number, y: number, r: number) {
    const { rot, minor } = this.groundTilt(n);
    ctx.ellipse(x, y, r, r * minor, rot, 0, Math.PI * 2);
  }

  /** The route's start: a small ring at the foot of the line. */
  private startMark(ctx: CanvasRenderingContext2D, n: Vec3, x: number, y: number, stroke: string) {
    const P = this.P;
    ctx.save();
    ctx.beginPath();
    this.groundCircle(ctx, n, x, y, 4.5);
    ctx.fillStyle = P.raised;
    ctx.fill();
    ctx.lineWidth = 2; // line-route
    ctx.strokeStyle = stroke;
    ctx.stroke();
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

  /**
   * A leg's route: a great-circle arc that lifts off the surface, and its dotted ground track. With a vehicle at the
   * end, the arc rises to its altitude and stops `cut` short of it; a landed leg comes down to its stop.
   */
  private route(
    ctx: CanvasRenderingContext2D, origin: Vec3, { v: end, alt, cut }: RouteEnd, stroke: string, marching: boolean, t = 0, gone = 0, upTo = 1,
  ) {
    const P = this.P;
    const view = `${this.lon0},${this.lat0},${this.range},${this.W},${this.H}`;
    if (view !== this.routeView) { this.routeView = view; this.routeGeometry.clear(); }
    const key = `${origin}|${end}|${alt}`;
    let geometry = this.routeGeometry.get(key);
    if (!geometry) {
      const copy = (points: (ScreenPoint | null)[]) => points.map((p) => p && ({ ...p, w: p.w && [...p.w] as Vec3 }));
      geometry = { ground: copy(this.arc(origin, end, 0, 0, this.groundArc)), air: copy(this.arc(origin, end, 1, alt, this.airArc)) };
      if (this.routeGeometry.size >= 128) this.routeGeometry.delete(this.routeGeometry.keys().next().value!);
      this.routeGeometry.set(key, geometry);
    }
    const ground = geometry.ground.slice();
    const air = geometry.air.slice();
    // reeling in: the first `gone` of the way is already pulled off
    if (gone > 0) for (const pts of [ground, air]) pts.fill(null, 0, Math.floor(gone * pts.length));
    // drawing out: only the first `upTo` of the way is there yet
    if (upTo < 1) for (const pts of [ground, air]) pts.fill(null, Math.ceil(upTo * pts.length));
    // stop the dashes just short of the vehicle
    const tip = mul(end, 1 + alt);
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
    // a paper halo under each dash, as country names get, so the route holds up over green land and blue sea alike
    ctx.lineWidth = 5;
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = P.paper;
    this.strokePts(ctx, air);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2; // line-route
    ctx.strokeStyle = stroke;
    this.strokePts(ctx, air);
    ctx.restore();
  }

  /** Routes share one transparent layer and one pin mask, regardless of leg count. */
  private drawRoutes(out: CanvasRenderingContext2D, t: number) {
    let ctx = out;
    const cuts = this.pinCuts;
    if (cuts.length) {
      const layer = this.routeLayer ??= document.createElement("canvas");
      if (layer.width !== this.hudEl.width || layer.height !== this.hudEl.height) {
        layer.width = this.hudEl.width;
        layer.height = this.hudEl.height;
      }
      ctx = layer.getContext("2d")!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, layer.width, layer.height);
      ctx.setTransform(out.getTransform());
    }
    this.reels = this.reels.filter((r) => t - r.t0 < REEL);
    for (const r of this.reels) {
      const k = (t - r.t0) / REEL;
      this.route(ctx, r.o, { v: this.groundEnd(r.target), alt: 0, cut: 0 }, this.routeColor(r.color), true, t * 3, k * k);
    }
    for (const r of this.remotes.values()) {
      const target = this.lifted(r.target);
      const end: RouteEnd = r.landed
        ? { v: this.groundEnd(target), alt: this.liftAlt(target), cut: 0 }
        : { v: r.pl.n, alt: r.pl.alt, cut: S_PLANE * this.planeScale * ROUTE_CUT };
      const k = (t - r.drawn) / DRAW;
      this.route(ctx, this.lifted(r.o), end, this.routeColor(r.color), k < 1, t * 3, 0, k < 1 ? ease(Math.max(0, k)) : 1);
    }
    const pl = this.pl, origin = this.origin;
    if (origin && pl && this.mode !== "idle") {
      const marching = this.mode === "landed" && this.searching && !this.reduceMotion;
      const stroke = this.routeColor(this.color);
      this.via.forEach((s, i) => {
        const raw = this.via[i + 1]?.v ?? origin;
        const next = this.lifted(raw);
        const upTo = this.ownDrawn(s.v, raw, t);
        this.route(ctx, this.lifted(s.v), { v: this.groundEnd(next), alt: this.liftAlt(next), cut: 0 }, stroke, marching || upTo < 1, t, 0, upTo);
      });
      const upTo = this.dest ? this.ownDrawn(origin, this.dest, t) : 1;
      this.route(ctx, this.lifted(origin), this.ownEnd(pl), stroke, marching || upTo < 1, t, 0, upTo);
    }
    if (ctx === out) return;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineCap = "round";
    for (const c of cuts) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r + PIN_CUT, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.bx, c.by);
      ctx.lineWidth = PIN_CUT * 2;
      ctx.stroke();
    }
    ctx.restore();
    out.save();
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.drawImage(ctx.canvas, 0, 0);
    out.restore();
  }

  /** Where each standing pin is on screen, head and needle, for routes to pass under (`route`). */
  private measurePins() {
    this.pinCuts.length = 0;
    const c = this.cam;
    if (!c) return;
    for (const p of this.pins.values()) {
      if (!p.head) continue;
      const q = this.proj(p.head);
      const base = this.proj(p.g);
      if (!q || !q.vis || !base) continue;
      const rim = this.proj(add(p.head, mul(c.U, PIN_HEAD_R * S_PLANE * this.planeScale * PIN_SCALE)));
      this.pinCuts.push({ x: q.x, y: q.y, r: rim?.vis ? Math.hypot(rim.x - q.x, rim.y - q.y) : 4, bx: base.x, by: base.y });
    }
  }

  private drawHud(t: number) {
    const ctx = this.hud;
    const P = this.P;
    const dpr = this.hudEl.width / this.W;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.hudEl.width, this.hudEl.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.tagBoxes.length = 0;
    this.measurePins();

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
    mark(this.placeMark?.v);
    if (this.mode !== "idle" && this.pl) {
      for (const s of this.via) mark(s.v);
      mark(this.origin);
      mark(mul(this.pl.n, 1 + this.pl.alt));
    }
    const labels = this.labelsLayer ??= document.createElement("canvas");
    const labelKey = `${this.lon0},${this.lat0},${this.range},${this.nameInk}|${clear.map((p) => `${p.x},${p.y}`).join(";")}`;
    if (labels.width !== this.hudEl.width || labels.height !== this.hudEl.height) {
      labels.width = this.hudEl.width;
      labels.height = this.hudEl.height;
      this.labelsDirty = true;
    }
    if (this.labelsDirty || this.namesMoving || this.labelsKey !== labelKey) {
      const layer = labels.getContext("2d")!;
      layer.setTransform(1, 0, 0, 1, 0, 0);
      layer.clearRect(0, 0, labels.width, labels.height);
      layer.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.countryNames(layer, clear, t);
      this.cityNames(layer, clear, t);
      this.labelsKey = labelKey;
      this.labelsDirty = false;
    } else { this.nameT = this.cityT = t; }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(labels, 0, 0);
    ctx.restore();
    this.drawRoutes(ctx, t);


    // the searched place first, so it keeps its spot and the hover tag gives way to it
    const pm = this.placeMark && this.proj(this.placeMark.v);
    if (this.placeMark && pm && pm.vis) {
      this.startMark(ctx, this.placeMark.v, pm.x, pm.y, P.ink);
      this.tag(ctx, pm.x, pm.y - 30, this.placeMark.name, pm);
    }
    if (this.mode === "idle" && this.hoverName) this.tag(ctx, this.mx, this.my + 30, this.hoverName);

    // other members' trips, under this viewer's own: their route, start ring and local hub labels
    for (const r of this.remotes.values()) {
      const stroke = this.routeColor(r.color);
      // a landed route parks no vehicle: it comes down at its stop's pins, not where the plane is easing to it
      // a stop whose pins are being carried takes its routes' ends with it, up to the pins' points
      const o = this.lifted(r.o);
      const target = this.lifted(r.target);
      const op = this.proj(o);
      if (op && op.vis) {
        if (!this.pinned(o)) this.startMark(ctx, o, op.x, op.y, stroke);
        if (r.originName) this.tag(ctx, op.x, this.tagAbove(o, op.y), r.originName, op);
      }
      const at = r.landed && r.destinationName ? this.tagBelow(target) : null;
      // named for the stop, under its pins
      if (at && r.destinationName) this.tag(ctx, at.x, at.y, r.destinationName, this.proj(target) ?? at);
    }

    // where carried pins will land: the ring that marks the ground under a flight's pointer
    const aim = this.lift && this.proj(this.lift.at);
    if (this.lift && aim && aim.vis) {
      ctx.save();
      ctx.beginPath();
      this.groundCircle(ctx, this.lift.at, aim.x, aim.y, 8);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = `rgba(${P.inkRGB},0.7)`;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(aim.x, aim.y, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = P.ink;
      ctx.fill();
      ctx.restore();
    }

    // a ring spreads on the ground from each pin as its point goes in
    if (!this.reduceMotion) {
      for (const p of this.pins.values()) {
        const k = (t - p.t0 - PIN_DROP) / 0.6;
        const q = k >= 0 && k <= 1 ? this.proj(p.g) : null;
        if (!q || !q.vis) continue;
        ctx.save();
        ctx.beginPath();
        this.groundCircle(ctx, p.g, q.x, q.y, 4 + k * 22);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `rgba(${P.inkRGB},${(0.5 * (1 - k)).toFixed(3)})`;
        ctx.stroke();
        ctx.restore();
      }
    }

    const pl = this.pl;
    const origin = this.origin;
    if (!origin || !pl || this.mode === "idle") return;
    const stroke = this.routeColor(this.color);

    const ripple = (n: Vec3, p: ScreenPoint | null, t0: number) => {
      const k = (t - t0) / 0.7;
      if (this.reduceMotion || !p || !p.vis || k < 0 || k > 1) return;
      ctx.save();
      ctx.beginPath();
      this.groundCircle(ctx, n, p.x, p.y, 6 + k * 34);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(${P.inkRGB},${(0.6 * (1 - k)).toFixed(3)})`;
      ctx.stroke();
      ctx.restore();
    };
    for (const s of this.via) {
      const sp = this.proj(s.v);
      if (!sp || !sp.vis) continue;
      if (!this.pinned(s.v)) this.startMark(ctx, s.v, sp.x, sp.y, stroke);
      if (s.name) this.tag(ctx, sp.x, this.tagAbove(s.v, sp.y), s.name, sp);
    }
    const op = this.proj(origin);
    ripple(origin, op, this.tTake);
    if (op && op.vis) {
      if (!this.pinned(origin)) this.startMark(ctx, origin, op.x, op.y, stroke);
      // Keep the origin label above its pin; the moving/landing preview is below
      // the plane, so short hops do not immediately stack the longer hub names.
      if (this.originName) this.tag(ctx, op.x, this.tagAbove(origin, op.y), this.originName, op);
    }

    const pp = this.proj(mul(pl.n, 1 + pl.alt));
    if (this.mode === "flying") {
      if (pp && pp.vis && this.hoverName) {
        const at = this.underPlane(pl, pp);
        this.tag(ctx, at.x, at.y, this.hoverName);
      }
    } else if (this.mode === "landed") {
      ripple(pl.n, pp, this.tLand);
      const left = this.planeLeft(this.tLand);
      const at = this.destinationName && this.tagBelow(pl.n, pp && pp.vis ? { pl, p: pp, left } : undefined);
      if (at && this.destinationName) this.tag(ctx, at.x, at.y, this.destinationName, this.proj(pl.n) ?? at);
    }
  }
}
