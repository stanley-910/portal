"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";

import { memberColor } from "@/components/paper-atlas";
import { Glyph } from "@/components/ticket-search";
import type { GlobePin, LatLng, RemoteFlight, TripGlobeHandle } from "@/components/trip-globe";
import { formatMoney, sumIn, type Currency, type ExchangeRates } from "@/lib/currency";
import { countryName } from "@/lib/nationality";
import type { Mode } from "@/lib/transport/types";
import { firstDay, isGroup, isPast, lastDay, myLegs, statsOf, type LibraryLeg, type LibraryMember, type LibraryStop, type LibraryTrip } from "@/lib/trip/library";


// My Trips as a library down the left of the globe: scroll your trips, pick one (a click, or ↑ ↓ in the list) and its
// routes and riders' pins go onto the globe at once through `draw`; pointing at another ghosts its routes over it.
// Rename the picked trip in place (its pencil, F2, or a double-click on a title). Escape lets go of the picked trip, then puts the
// library away; so does a press anywhere outside it, or the tab on its right edge. Put away, the nav bar's Trips
// button brings it back.

export interface TripLibraryProps {
  /** Null while loading (shows the skeleton); [] shows the empty state. */
  trips: LibraryTrip[] | null;
  /** Shown instead of the list when loading failed. */
  error?: string | null;
  userId: string;
  /** YYYY-MM-DD, for upcoming vs past. */
  today: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Resolves false when the rename didn't save: the old title comes back. On true, the parent updates `trips`. */
  onRename: (id: string, title: string) => Promise<boolean>;
  /** The trip's page. */
  hrefFor: (id: string) => string;
  /** Leave the picked trip; the parent confirms it and takes it off the list. Without it, there's no Leave. */
  onLeave?: (id: string) => void;
  /** Delete the picked trip for everyone, offered to its owner; the parent confirms it and takes it off the list. */
  onDelete?: (id: string) => void;
  currency: Currency;
  rates: ExchangeRates | null;
  /** Called whenever what the library wants on the globe changes: the selected trip's routes and pins, empty with nothing selected. The parent applies them. */
  draw: (overlay: { flights: RemoteFlight[]; pins: GlobePin[] }) => void;
  /** Enables the vehicle stickers at each leg's peak and the hovered trip's ghost routes, drawn over the globe. */
  globe?: RefObject<TripGlobeHandle | null>;
}

/* ---------- words and numbers ---------- */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
/** `Fri, Oct 16` */
const longDate = (iso: string) => {
  const d = day(iso);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};
/** `Nov 7 – 13`, or `Dec 26 – Jan 3` across months */
const span = (a: string | null, b: string | null) => {
  if (!a || !b) return "";
  const x = day(a);
  const y = day(b);
  if (a === b) return `${MONTHS[x.getUTCMonth()]} ${x.getUTCDate()}`;
  return x.getUTCMonth() === y.getUTCMonth() && x.getUTCFullYear() === y.getUTCFullYear()
    ? `${MONTHS[x.getUTCMonth()]} ${x.getUTCDate()} – ${y.getUTCDate()}`
    : `${MONTHS[x.getUTCMonth()]} ${x.getUTCDate()} – ${MONTHS[y.getUTCMonth()]} ${y.getUTCDate()}`;
};
const num = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;
/** Your share in the picked currency, else each in its own: "$1,240", or "¥24,000 + $412" without rates. Null when nothing is priced. */
function shareText(totals: Record<string, number>, currency: Currency, rates: ExchangeRates | null) {
  if (!Object.keys(totals).length) return null;
  const sum = sumIn(totals, currency, rates);
  return sum === null ? Object.entries(totals).map(([c, amount]) => formatMoney({ amount, currency: c })).join(" + ") : formatMoney({ amount: sum, currency });
}
const memberVar = (slot: number) => `var(--${memberColor(slot)})`;
const at = (s: LibraryStop): LatLng => ({ lat: s.lat, lng: s.lng });
const legSlot = (t: LibraryTrip, l: LibraryLeg) => (l.by ? (t.members.find((m) => m.id === l.by)?.slot ?? null) : null);
const nextLeg = (t: LibraryTrip, today: string) => t.legs.find((l) => l.date >= today) ?? null;

type Hop = { stops: LibraryStop[]; mode: Mode | null };
const MAX_ONE_LINE = 5; // stop codes that fit one line of a card; one fewer beside others' discs

/**
 * Your legs as one chain of stops (HKG → SHA → TYO → HKG). Where friends start elsewhere and meet you at your first
 * stop, their starts join yours (HKG · ICN → SHA → …), if that still fits on one line.
 */
function pathOf(t: LibraryTrip, userId: string): Hop[] {
  const legs = myLegs(t, userId);
  if (!legs.length) return [];
  const yours: Hop[] = [{ stops: [legs[0].from], mode: null }, ...legs.map((l) => ({ stops: [l.to], mode: l.mode as Mode | null }))];
  const meet = legs[0].to.id;
  const others = new Map<string, LibraryStop>();
  for (const l of t.legs) if (!l.riders.includes(userId) && l.to.id === meet && l.from.id !== legs[0].from.id) others.set(l.from.id, l.from);
  if (!others.size || yours.length + others.size > MAX_ONE_LINE - (isGroup(t) ? 1 : 0)) return yours;
  return [{ stops: [legs[0].from, ...others.values()], mode: null }, ...yours.slice(1)];
}

/** The trip's legs and riders, as the globe draws them: each leg in the colour of who drew it, a pin per rider at each stop. */
function overlayOf(trip: LibraryTrip | null): { flights: RemoteFlight[]; pins: GlobePin[] } {
  if (!trip) return { flights: [], pins: [] };
  const flights: RemoteFlight[] = trip.legs.map((l) => ({
    id: `lib:${trip.id}:${l.id}`,
    origin: at(l.from),
    at: at(l.to),
    ahead: at(l.to),
    landed: true,
    color: legSlot(trip, l),
  }));
  const pins = new Map<string, GlobePin>();
  for (const l of trip.legs) {
    for (const id of l.riders) {
      const m = trip.members.find((x) => x.id === id);
      const key = `lib:${trip.id}:${l.to.id}:${id}`;
      if (m && !pins.has(key)) pins.set(key, { key, stop: `stop:${l.to.id}`, at: at(l.to), color: m.slot });
    }
  }
  return { flights, pins: [...pins.values()] };
}

/* ---------- the library ---------- */

export function TripLibrary({ trips, error, userId, today, open, onOpenChange, selected, onSelect, onRename, hrefFor, onLeave, onDelete, currency, rates, draw, globe }: TripLibraryProps) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  /** Titles saving right now, shown in place of the old ones until the save settles. */
  const [pending, setPending] = useState<Record<string, string>>({});
  /** A trip whose rename just failed, for a moment. */
  const [failed, setFailed] = useState<string | null>(null);
  /** The trip whose title is being edited. */
  const [editing, setEditing] = useState<string | null>(null);

  const ready = !error && trips !== null;
  const all = useMemo(() => (trips ?? NO_TRIPS).map((t) => (pending[t.id] ? { ...t, title: pending[t.id] } : t)), [trips, pending]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((t) => {
      const words = [t.title, ...t.members.map((m) => m.name), ...t.legs.flatMap((l) => [l.from, l.to]).flatMap((s) => [s.code, s.name, s.country ? countryName(s.country) : ""])];
      return words.some((w) => w.toLowerCase().includes(q));
    });
  }, [all, query]);
  const byStart = (a: LibraryTrip, b: LibraryTrip) => (firstDay(a) ?? "").localeCompare(firstDay(b) ?? "");
  const upcoming = visible.filter((t) => !isPast(t, today)).sort(byStart);
  const past = visible.filter((t) => isPast(t, today)).sort((a, b) => byStart(b, a));
  const order = [...upcoming, ...past];
  const trip = all.find((t) => t.id === selected) ?? null;
  const ghost = open && hovered && hovered !== selected ? (all.find((t) => t.id === hovered) ?? null) : null;

  // the picked trip onto the globe whenever it changes, and off it when nothing is picked. It stays with the library put away.
  const drawn = (trips ?? NO_TRIPS).find((t) => t.id === selected) ?? null;
  const overlay = useMemo(() => overlayOf(drawn), [drawn]);
  const onDraw = useEffectEvent((o: { flights: RemoteFlight[]; pins: GlobePin[] }) => draw(o));
  useEffect(() => {
    onDraw(overlay);
  }, [overlay]);

  // a press anywhere outside puts the library away. The press still reaches whatever it was on (the globe, say).
  const wrap = useRef<HTMLDivElement>(null);
  const onOutside = useEffectEvent((e: PointerEvent) => {
    const t = e.target as Element | null;
    if (!t || wrap.current?.contains(t) || t.closest(KEEP_OPEN)) return;
    onOpenChange(false);
  });
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => onOutside(e);
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [open]);

  useEffect(() => {
    if (!failed) return;
    const t = window.setTimeout(() => setFailed(null), 2400);
    return () => window.clearTimeout(t);
  }, [failed]);

  const list = useRef<HTMLDivElement>(null);
  const pick = (id: string) => {
    onSelect(id);
    list.current?.querySelector(`[data-trip="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return; // typing in a title
    if (e.key === "F2" && trip) {
      e.preventDefault();
      setEditing(trip.id);
      return;
    }
    // the first Escape lets go of the picked trip, showing the whole list; the next puts the library away
    if (e.key === "Escape") {
      if (selected) onSelect(null);
      else onOpenChange(false);
      return;
    }
    if (!order.length) return;
    const i = order.findIndex((t) => t.id === selected);
    const to =
      e.key === "ArrowDown" ? Math.min(order.length - 1, i + 1)
      : e.key === "ArrowUp" ? Math.max(0, i < 0 ? 0 : i - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? order.length - 1
      : null;
    if (to === null) return;
    e.preventDefault();
    pick(order[to].id);
  };
  const rename = (id: string, title: string) => {
    setEditing(null);
    list.current?.focus({ preventScroll: true });
    const next = title.trim();
    const old = trips?.find((t) => t.id === id)?.title;
    if (!next || next === old) return;
    setPending((p) => ({ ...p, [id]: next }));
    const settle = (ok: boolean) => {
      setPending((p) => {
        const rest = { ...p };
        delete rest[id];
        return rest;
      });
      if (!ok) setFailed(id);
    };
    onRename(id, next).then(settle, () => settle(false));
  };
  const cancelEdit = () => {
    setEditing(null);
    list.current?.focus({ preventScroll: true });
  };
  const edit: Edit = { editing, setEditing, rename, cancelEdit, failed };
  const closeSearch = () => {
    setQuery("");
    setSearching(false);
  };
  const card = (t: LibraryTrip) => (
    <TripCard
      key={t.id}
      trip={t}
      userId={userId}
      past={isPast(t, today)}
      selected={t.id === selected}
      onPick={() => (t.id === selected ? onSelect(null) : pick(t.id))}
      onHover={() => setHovered(t.id)}
      edit={edit}
    />
  );

  return (
    <>
      {globe ? <RouteOverlay globe={globe} trip={drawn} ghost={ghost} /> : null}

      <div ref={wrap} className="lib-wrap" data-open={open || undefined} data-anchor-wall={open || undefined} inert={!open}>
        <aside className="lib" aria-label="Your trips">
          <header className="lib-head">
            {searching ? (
              <input
                className="lib-search"
                type="search"
                placeholder="Search trips, cities, people"
                aria-label="Search trips"
                value={query}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    closeSearch();
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    list.current?.focus();
                  }
                }}
                onBlur={() => {
                  if (!query.trim()) closeSearch();
                }}
              />
            ) : (
              <>
                <h2 className="lib-title">Your trips</h2>
                {ready && all.length ? (
                  <button type="button" className="lib-search-btn" aria-label="Search trips" title="Search" onClick={() => setSearching(true)}>
                    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
                      <circle cx="7" cy="7" r="4.6" />
                      <path d="M10.4 10.4L14 14" />
                    </svg>
                  </button>
                ) : null}
              </>
            )}
          </header>

          {error ? (
            <Note title="Couldn’t load your trips" body={error} alert />
          ) : trips === null ? (
            <Skeleton />
          ) : !all.length ? (
            <Note title="No trips yet" body="Trips you save or join show up here." />
          ) : (
            <div
              ref={list}
              className="lib-list"
              role="listbox"
              tabIndex={0}
              aria-label="Trips"
              aria-activedescendant={trip && order.includes(trip) ? optionId(trip.id) : undefined}
              onKeyDown={onKey}
              onMouseLeave={() => setHovered(null)}
            >
              {order.length === 0 ? <p className="lib-none">No trips match.</p> : null}
              {upcoming.map(card)}
              {past.length ? (
                <div className="lib-past" role="presentation">
                  Past
                </div>
              ) : null}
              {past.map(card)}
            </div>
          )}

          {ready && trip ? <Summary trip={trip} userId={userId} today={today} share={shareText(trip.share, currency, rates)} href={hrefFor(trip.id)}
            onLeave={onLeave && (() => onLeave(trip.id))} onDelete={onDelete && trip.owner ? () => onDelete(trip.id) : undefined} /> : null}
        </aside>
        {/* a slim tab on the panel's right edge: peeks out on hover or focus, and puts the library away */}
        <button type="button" className="lib-handle" aria-label="Hide trips" title="Hide trips" onClick={() => onOpenChange(false)}>
          <svg width={10} height={16} viewBox="0 0 10 16" aria-hidden>
            <path d="M6.5 4L2.5 8l4 4" />
          </svg>
        </button>
      </div>
    </>
  );
}

/** Presses on these don't put the library away: the nav bar (whose Trips button toggles it), menus, and anything marked. */
const KEEP_OPEN = ".pn-bar, [data-radix-popper-content-wrapper], [data-library-keep]";
const optionId = (id: string) => `lib-trip-${id}`;

/* ---------- renaming ---------- */

type Edit = { editing: string | null; setEditing: (id: string | null) => void; rename: (id: string, title: string) => void; cancelEdit: () => void; failed: string | null };

/** A trip's title, renamed in place: Enter or leaving the field saves, Esc puts the old one back. The pencil shows only on the picked trip. */
function Title({ trip, selected, edit }: { trip: LibraryTrip; selected: boolean; edit: Edit }) {
  const done = useRef(false);
  if (edit.editing === trip.id) {
    return (
      <input
        className="lib-rename"
        defaultValue={trip.title}
        aria-label="Trip name"
        maxLength={80}
        autoFocus
        onFocus={(e) => {
          done.current = false;
          e.currentTarget.select();
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            done.current = true;
            edit.rename(trip.id, e.currentTarget.value);
          } else if (e.key === "Escape") {
            done.current = true;
            edit.cancelEdit();
          }
        }}
        onBlur={(e) => {
          if (!done.current) edit.rename(trip.id, e.currentTarget.value);
        }}
      />
    );
  }
  return (
    <>
      <span className="lib-card-title" onDoubleClick={() => edit.setEditing(trip.id)}>
        {trip.title}
      </span>
      {edit.failed === trip.id ? (
        <span className="lib-failed" role="status">
          Not saved
        </span>
      ) : selected ? (
        <button
          type="button"
          className="lib-pencil"
          tabIndex={-1}
          aria-label="Rename trip"
          title="Rename"
          onClick={(e) => {
            e.stopPropagation();
            edit.setEditing(trip.id);
          }}
        >
          <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden>
            <path d="M10.6 2.6l2.8 2.8-7.8 7.8-3.4.6.6-3.4z" />
            <path d="M9.2 4l2.8 2.8" />
          </svg>
        </button>
      ) : null}
    </>
  );
}

/* ---------- a trip in the list ---------- */

const MAX_DISCS = 3;

function TripCard({ trip, userId, past, selected, onPick, onHover, edit }: { trip: LibraryTrip; userId: string; past: boolean; selected: boolean; onPick: () => void; onHover: () => void; edit: Edit }) {
  const path = pathOf(trip, userId);
  const others = trip.members.filter((m) => !m.you);
  const long = path.reduce((n, p) => n + p.stops.length, 0) > MAX_ONE_LINE - (others.length ? 1 : 0);
  return (
    <div id={optionId(trip.id)} data-trip={trip.id} role="option" aria-selected={selected} className="lib-card" data-past={past || undefined} onClick={onPick} onMouseEnter={onHover}>
      <div className="lib-row">
        <Title trip={trip} selected={selected} edit={edit} />
        <span className="lib-dates">{span(firstDay(trip), lastDay(trip))}</span>
      </div>
      <div className="lib-row">
        <span className="lib-path" data-long={long || undefined} aria-label={path.map((p) => p.stops.map((s) => s.code).join(" and ")).join(" to ")}>
          {path.map((p, i) => (
            <span key={i} className="lib-hop">
              {p.mode ? <Glyph kind={p.mode} size={12} className="lib-hop-glyph" /> : null}
              {p.stops.map((s, j) => (
                <span key={s.id} className="lib-code" data-other={j > 0 || undefined}>
                  {j > 0 ? <span className="lib-code-sep">·</span> : null}
                  {s.code}
                </span>
              ))}
            </span>
          ))}
        </span>
        {/* who else is on it: their discs say it's a group trip, none says it's yours alone */}
        {others.length ? <Avatars members={others.slice(0, MAX_DISCS)} more={others.length - MAX_DISCS} /> : null}
      </div>
    </div>
  );
}

/** Member discs: a coloured sticker for whoever is in the trip now, a dashed outline for whoever isn't. */
function Avatars({ members, more }: { members: LibraryMember[]; more: number }) {
  return (
    <ul className="lib-avs" aria-label={`With ${members.map((m) => m.name).join(", ")}${more > 0 ? ` and ${more} more` : ""}`}>
      {members.map((m) => (
        <li
          key={m.id}
          className="lib-av"
          data-present={m.present || undefined}
          style={{ "--m": memberVar(m.slot) } as CSSProperties}
          title={`${m.name} · ${m.present ? "here" : "away"}`}
        >
          {m.name.slice(0, 1).toUpperCase()}
        </li>
      ))}
    </ul>
  );
}

/* ---------- the picked trip ---------- */

function Summary({ trip, userId, today, share, href, onLeave, onDelete }: { trip: LibraryTrip; userId: string; today: string; share: string | null; href: string; onLeave?: () => void; onDelete?: () => void }) {
  const past = isPast(trip, today);
  // a past trip shows its last leg; an upcoming one, its next
  const shown = (past ? null : nextLeg(trip, today)) ?? trip.legs.at(-1) ?? null;
  const s = statsOf(trip, userId);
  return (
    <footer className="lib-foot">
      {s.legs ? (
        <p className="lib-stats">
          {num(s.km)} km · {plural(s.legs, "leg", "legs")} · {plural(s.nights, "night", "nights")} · ≈ {s.hours} h in transit, estimated
        </p>
      ) : null}
      {shown || share ? (
        <div className="lib-facts">
          {shown ? (
            <p className="lib-next" aria-label={`${past ? "Last leg" : "Next"}: ${shown.from.code} to ${shown.to.code}, ${longDate(shown.date)}`}>
              <Glyph kind={shown.mode} size={13} />
              <span className="lib-code">
                {shown.from.code} → {shown.to.code}
              </span>
              <span className="lib-stamp">· {longDate(shown.date)}</span>
            </p>
          ) : (
            <span />
          )}
          {share ? (
            <p className="lib-money">
              <span className="lib-money-n">{share}</span>
              <span className="lib-money-l">{past ? "paid" : "your share"}</span>
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="lib-foot-actions">
        {onLeave ? (
          <button type="button" className="lib-action" onClick={onLeave}>
            <svg width={13} height={13} viewBox="0 0 16 16" aria-hidden>
              <path d="M9.5 2.5h3.5v11H9.5M2.5 8h7.5M5.5 5l-3 3 3 3" />
            </svg>
            <span>Leave</span>
          </button>
        ) : null}
        {onDelete ? (
          <button type="button" className="lib-action" onClick={onDelete}>
            <svg width={13} height={13} viewBox="0 0 16 16" aria-hidden>
              <path d="M2.5 4.5h11M6.5 4.5V2.8h3v1.7M4.2 4.5l.7 9h6.2l.7-9M6.8 7v4M9.2 7v4" />
            </svg>
            <span>Delete</span>
          </button>
        ) : null}
        <a className="pa-btn pa-btn-primary lib-open" href={href}>
          <span>Open trip</span>
        </a>
      </div>
    </footer>
  );
}

function Skeleton() {
  return (
    <div className="lib-list lib-skeleton" aria-busy="true" aria-label="Loading trips">
      {[0, 1, 2].map((i) => (
        <div key={i} className="lib-card lib-card-ghost" aria-hidden>
          <span className="lib-row">
            <span className="lib-bone" style={{ width: "55%" }} />
            <span className="lib-bone lib-bone-sm" style={{ width: "20%" }} />
          </span>
          <span className="lib-row">
            <span className="lib-bone" style={{ width: "70%" }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** The empty and failed states: a route not yet drawn (a start ring, a dotted ground track), a title and a line. */
function Note({ title, body, alert }: { title: string; body: string; alert?: boolean }) {
  return (
    <div className="lib-note" role={alert ? "alert" : undefined}>
      <svg className="lib-note-mark" width={48} height={14} viewBox="0 0 48 14" aria-hidden>
        <path className="lib-note-track" d="M13 7H46" />
        <circle className="lib-note-ring" cx="7" cy="7" r="3.5" />
      </svg>
      <p className="lib-note-title">{title}</p>
      <p className="lib-note-body">{body}</p>
    </div>
  );
}

/* ---------- over the globe ---------- */

/**
 * A vehicle sticker at the peak of each leg of the picked trip, and the trip under the pointer drawn faintly. Follows
 * the globe each frame through its handle. Sits in the library's positioned parent, which must be the globe's box.
 */
function RouteOverlay({ globe, trip, ghost }: { globe: RefObject<TripGlobeHandle | null>; trip: LibraryTrip | null; ghost: LibraryTrip | null }) {
  const vehicles = useRef<(HTMLSpanElement | null)[]>([]);
  const ghosts = useRef<(SVGPathElement | null)[]>([]);
  const legs = trip?.legs ?? NO_LEGS;
  const ghostLegs = ghost?.legs ?? NO_LEGS;

  useEffect(() => {
    const g = globe.current;
    if (!g) return;
    const paint = () => {
      legs.forEach((l, i) => {
        const el = vehicles.current[i];
        if (!el) return;
        const a = at(l.from);
        const b = at(l.to);
        const p = g.routePoint(a, b, 0.5);
        if (!p?.visible) {
          el.style.visibility = "hidden";
          return;
        }
        const before = g.routePoint(a, b, 0.46);
        const after = g.routePoint(a, b, 0.54);
        el.style.visibility = "";
        // the flight glyph points east (0deg); turn it along the route
        const deg = before && after ? (Math.atan2(after.y - before.y, after.x - before.x) * 180) / Math.PI : 0;
        el.style.transform = `translate(${p.x}px, ${p.y}px)`;
        el.style.setProperty("--turn", l.mode === "flight" ? `${deg}deg` : "0deg");
      });
      ghostLegs.forEach((l, i) => {
        const el = ghosts.current[i];
        if (!el) return;
        let d = "";
        for (let s = 0; s <= 24; s++) {
          const p = g.routePoint(at(l.from), at(l.to), s / 24);
          if (!p?.visible) continue;
          d += `${d ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
        }
        el.setAttribute("d", d);
      });
    };
    paint();
    return g.onFrame(paint);
  }, [globe, legs, ghostLegs]);

  return (
    <div className="lib-overlay" aria-hidden>
      <svg className="lib-ghosts">
        {ghostLegs.map((l, i) => (
          <path
            key={`${ghost!.id}:${l.id}`}
            ref={(el) => {
              ghosts.current[i] = el;
            }}
          />
        ))}
      </svg>
      {trip
        ? legs.map((l, i) => {
            const slot = legSlot(trip, l);
            return (
              <span
                key={`${trip.id}:${l.id}`}
                ref={(el) => {
                  vehicles.current[i] = el;
                }}
                className="lib-vehicle"
                style={{ "--m": slot === null ? "var(--sticker-fill)" : memberVar(slot) } as CSSProperties}
              >
                <span className="lib-vehicle-in pa-cast">
                  <Glyph kind={l.mode} size={18} sticker />
                </span>
              </span>
            );
          })
        : null}
    </div>
  );
}

const NO_LEGS: LibraryLeg[] = [];
const NO_TRIPS: LibraryTrip[] = [];
