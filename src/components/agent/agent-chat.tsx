"use client";

import { useRoom, useSelf, useStorage } from "@liveblocks/react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type FormEvent } from "react";

import { applyMeetup, undoAgentChange } from "@/app/t/actions";
import { useOpenAuth } from "@/components/auth/links";
import { arrival, ARRIVAL_MS, HOP_MS, PipArrival, PipHop, pipPlace, usePipCorner } from "@/components/agent/pip-arrival";
import { PipSprite, PipUfo, type PipMood } from "@/components/agent/pip-sprite";
import { Button } from "@/components/paper-atlas";
import { tripContext } from "@/lib/agent/context";
import { inOrder } from "@/lib/agent/parts";
import { showDate } from "@/lib/agent/snapshot";
import { AGENT_NAME, type MeetupLeg, type ThreadCard, type ThreadMessage } from "@/lib/agent/types";
import { SIGN_IN_TO_ASK, usePipActivity, usePipBusy, usePipReplies, useSendMessage, useThread } from "@/lib/agent/use-thread";
import { memberColor } from "@/lib/liveblocks/types";

// The trip's thread with Pip in it, rebuilt from the Pip handoff: a porthole launcher bottom-right that opens
// a chat panel. Pip's surfaces are starlight pixels; people's are Paper Atlas print (handoff: "what Pip makes").

// Pip's hello in a trip: one of these, picked at random once per page load
const NUDGES = [
  `Hi, I'm ${AGENT_NAME}. Where's everyone starting from?`,
  "Greetings, Earthlings. Need somewhere to meet?",
  `Hi, I'm ${AGENT_NAME}, galactic trip planner. Ask away.`,
];
const NUDGE_DELAY_MS = 900;
// how long the nudge stays once typed out; it shows once per page load
const NUDGE_HOLD_MS = 5000;
const nudged = new Set<string>();
// the hello each list picked this page load, so closing and reopening the chat doesn't change it
const picked = new Map<string, string>();
const TYPE_MS = 34;

export function AgentChat({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  // the thread is only read with the panel open; closed, a count of finished replies is enough for the dot
  const replies = usePipReplies();
  // replies seen when the panel last closed; whatever was there when the room loaded counts as seen
  const [seen, setSeen] = useState<number | null>(null);
  if (seen === null && replies !== null) setSeen(replies);
  const unread = !open && replies !== null && seen !== null && replies > seen;
  const toggle = (next: boolean) => {
    setOpen(next);
    setSeen(replies);
  };

  return open ? <Panel onClose={() => toggle(false)} /> : <Launcher unread={unread} onOpen={() => toggle(true)} />;
}

export function Launcher({ unread, onOpen, nudges = NUDGES }: { unread: boolean; onOpen: () => void; nudges?: readonly string[] }) {
  // the text only renders after mount (typing starts in an effect), so a random pick can't mismatch the server's
  const [nudge] = useState(() => {
    const key = nudges.join("\n");
    if (!picked.has(key)) picked.set(key, nudges[Math.floor(Math.random() * nudges.length)]);
    return picked.get(key)!;
  });
  const [hover, setHover] = useState(false);
  // the first launcher of a page load arrives, by saucer or by portal; the nudge waits for it
  const [arriving, setArriving] = useState(() => !arrival.played);
  // the arrival is this launcher's entrance, so its own zoom-in doesn't play after it
  const [entrance] = useState(arriving);
  // picked in the browser only: the server renders no entrance, so a random pick can't mismatch it
  const kind = useSyncExternalStore(noSubscribe, pickArrival, () => null);
  useEffect(() => {
    if (!arriving) return;
    arrival.played = true;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setArriving(false), still ? 0 : kind === "portal" ? HOP_MS : ARRIVAL_MS);
    return () => window.clearTimeout(timer);
  }, [arriving, kind]);
  // trip cards and panels over Pip's corner send it through a portal to the other one
  const root = useRef<HTMLDivElement>(null);
  const porthole = useRef<HTMLButtonElement>(null);
  const { side, hop } = usePipCorner(root, porthole, arriving);
  const hidden = arriving || !!hop;
  const [done, setDone] = useState(() => nudged.has(nudge));
  // the bubble's tail points right, at Pip in the right-hand corner
  const typed = useTyping(done || arriving || side !== "right" ? null : nudge);
  const finished = typed === nudge;
  useEffect(() => {
    if (!finished) return;
    nudged.add(nudge);
    const timer = window.setTimeout(() => setDone(true), NUDGE_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [finished, nudge]);
  return (
    <div ref={root} data-globe-float className={`pip-launcher${entrance ? " pip-launcher-arriving" : ""}${side === "left" ? " pip-launcher-left" : ""}`}>
      {arriving && kind ? kind === "ufo" ? <PipArrival /> : <PipHop way="arrive" side={side} /> : null}
      {hop ? <PipHop key={`${hop}-${side}`} way={hop} side={side} /> : null}
      {typed !== null && !done && !hop && side === "right" ? (
        <button type="button" className="pip-nudge" onClick={onOpen}>
          <span className="pip-nudge-inner">
            <span className="pip-nudge-text">
              <span aria-hidden className="pip-nudge-ghost">{nudge}</span>
              <span className="pip-nudge-typed">
                {typed}
                {typed.length < nudge.length ? <span className="pip-caret">▌</span> : null}
              </span>
            </span>
          </span>
          <NudgeTail />
        </button>
      ) : null}
      <button
        ref={porthole}
        type="button"
        className="pip-porthole"
        aria-label={`Open ${AGENT_NAME}`}
        onClick={onOpen}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        <PipSprite size={40} mood={hover ? "talk" : "idle"} className={hidden ? "pip-hidden" : undefined} />
        {unread ? <span aria-label="New reply" className="pip-unread" /> : null}
      </button>
    </div>
  );
}

// The speech bubble's tail: a pixel wedge from the box's bottom edge to a point at Pip. Each row of light cells runs
// from a(y) to b(y), the left edge leaning in faster than the right so it narrows to a point down and to the right;
// ink outlines it like the box. Row 0 overlaps the box's border so the two read as one shape.
const TAIL_CELL = 2;
const TAIL_LIGHT = new Set<string>();
for (let y = 0; ; y++) {
  const a = Math.round(y * 1.7);
  const b = 8 + Math.round(y * 0.9);
  if (a > b) break;
  for (let x = a; x <= b; x++) TAIL_LIGHT.add(`${x},${y}`);
}
const TAIL_INK = new Set<string>();
for (const cell of TAIL_LIGHT) {
  const [x, y] = cell.split(",").map(Number);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1]]) if (!TAIL_LIGHT.has(`${x + dx},${y + dy}`)) TAIL_INK.add(`${x + dx},${y + dy}`);
}
const tailCells = (set: Set<string>) => [...set].map((c) => c.split(",").map(Number) as [number, number]);
const TAIL_W = Math.max(...tailCells(TAIL_INK).map(([x]) => x)) + 2;
const TAIL_H = Math.max(...tailCells(TAIL_INK).map(([, y]) => y)) + 1;

function NudgeTail() {
  return (
    <svg
      aria-hidden
      className="pip-nudge-tail"
      width={TAIL_W * TAIL_CELL}
      height={TAIL_H * TAIL_CELL}
      viewBox={`-1 0 ${TAIL_W} ${TAIL_H}`}
      shapeRendering="crispEdges"
    >
      {tailCells(TAIL_INK).map(([x, y]) => <rect key={`k${x},${y}`} x={x} y={y} width={1} height={1} className="pip-nudge-tail-ink" />)}
      {tailCells(TAIL_LIGHT).map(([x, y]) => <rect key={`l${x},${y}`} x={x} y={y} width={1} height={1} className="pip-nudge-tail-light" />)}
    </svg>
  );
}

const noSubscribe = () => () => {};
const pickArrival = () => (arrival.kind ??= Math.random() < 0.5 ? "ufo" : "portal");

/** Types `text` out a character at a time after a short wait; the whole text at once under reduced motion. */
function useTyping(text: string | null): string | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (text === null) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let i = 0;
    let timer: number;
    const start = window.setTimeout(() => {
      if (still) return setN(text.length);
      timer = window.setInterval(() => {
        i++;
        setN(i);
        if (i >= text.length) window.clearInterval(timer);
      }, TYPE_MS);
    }, still ? 0 : NUDGE_DELAY_MS);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer);
    };
  }, [text]);
  return n === null || text === null ? null : text.slice(0, n);
}

function Panel({ onClose }: { onClose: () => void }) {
  const thread = useThread();
  // a trip that opens with the chat showing has no entrance to play when it's closed
  useEffect(() => {
    arrival.played = true;
  }, []);
  const members = useStorage((root) => root.members);
  const me = useSelf((s) => s.id) ?? undefined;
  const activity = usePipActivity();
  const busy = usePipBusy();
  const scroller = useRef<HTMLDivElement>(null);
  // follows new text only while you're at the bottom, so reading back isn't yanked down every token
  const stuck = useRef(true);
  const send = useSendMessage();
  const streaming = thread.find((m) => m.state === "streaming");
  const mood: PipMood = streaming?.text ? "talk" : busy || activity ? "think" : "idle";
  const stops = useStorage((root) => root.stops);
  const legs = useStorage((root) => root.legs);
  const context = useMemo(() => tripContext({ members, stops, legs }, me), [members, stops, legs, me]);

  // before paint, so the panel opens at the latest message instead of jumping there
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [thread, activity]);

  return (
    <section className={`pip-panel${pipPlace.side === "left" ? " pip-panel-left" : ""}`} aria-label={`Trip chat with ${AGENT_NAME}`}>
      <header className="pip-head">
        <PipSprite size={32} mood={mood} />
        <div className="min-w-0 flex-1">
          <p className="pip-head-name">{AGENT_NAME}</p>
          <p className="pip-head-sub">{context.line}</p>
        </div>
        <PipClose onClick={onClose} />
      </header>

      <div
        ref={scroller}
        className="pip-messages"
        role="log"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {thread.length === 0 ? (
          <p className="pip-empty">Ask {AGENT_NAME} how to get somewhere, or where everyone should meet. Everyone in the trip sees the chat.</p>
        ) : null}
        {thread.map((m) => (
          <Message key={m.id} message={m} me={me} members={members ?? NO_MEMBERS} activity={m.state === "streaming" ? activity : null} />
        ))}
      </div>

      <Composer send={send} chips={context.chips} />
    </section>
  );
}

const list = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

type Members = Record<string, { name: string; color: number }>;
const NO_MEMBERS: Members = {};

// Memoised: a streamed token changes only the streaming message, so the rest of the thread doesn't re-render.
const Message = memo(function Message({ message: m, me, members, activity }: { message: ThreadMessage; me: string | undefined; members: Members; activity: string | null }) {
  if (m.author.kind === "agent") {
    const streaming = m.state === "streaming";
    const parts = inOrder(m.text, m.cards);
    const working = m.cards.some((c) => c.type === "status" && !c.done);
    return (
      <div className="pip-msg-agent">
        <div className="pip-msg-agent-body">
          <span className="pip-label">{AGENT_NAME}</span>
          {parts.map((part) =>
            part.kind === "text" ? (
              <p key={`t${part.at}`} className="pip-text">{part.text}</p>
            ) : (
              <Card key={part.index} card={part.card} messageId={m.id} members={members} activity={activity} />
            ),
          )}
          {/* before its first tool or word: the saucer, and what Pip is doing once it says */}
          {streaming && !working && !parts.length ? (
            <div className="pip-thinking">
              <PipUfo size={44} />
              {activity ? <Step label={activity} running /> : null}
            </div>
          ) : null}
          {m.state === "queued" ? <Step label="Next in line" /> : null}
        </div>
      </div>
    );
  }
  const mine = m.author.id === me;
  const author = members[m.author.id];
  return (
    <div className={mine ? "pip-msg-you" : "pip-msg-member"}>
      <span className="pip-member-label" style={{ background: memberColor(author?.color ?? 1) }}>
        {mine ? "You" : author?.name ?? "Someone"}
      </span>
      <p className="pip-bubble">{m.text}</p>
    </div>
  );
});

/** One thing Pip did with a tool. While it runs, what it's doing right now follows the label. */
function Step({ label, running = false, detail = null }: { label: string; running?: boolean; detail?: string | null }) {
  return (
    <p className={`pip-step${running ? " pip-step-running" : ""}`} role={running ? "status" : undefined}>
      <span aria-hidden className="pip-step-mark" />
      <span>{label}</span>
      {detail && detail.toLowerCase() !== label.toLowerCase() ? <span className="pip-step-detail">· {detail}</span> : null}
    </p>
  );
}

function Card({ card, messageId, members, activity }: { card: ThreadCard; messageId: string; members: Members; activity: string | null }) {
  if (card.type === "meetup") return <MeetupCard card={card} messageId={messageId} members={members} />;
  if (card.type === "changes") return <ChangesCard card={card} messageId={messageId} />;
  return <Step label={card.label} running={!card.done} detail={card.done ? null : activity} />;
}

function useTripId() {
  return useRoom().id.slice("trip:".length);
}

function MeetupCard({ card, messageId, members }: { card: Extract<ThreadCard, { type: "meetup" }>; messageId: string; members: Members }) {
  const tripId = useTripId();
  const [pending, start] = useTransition();
  const applied = card.applied && !card.undone ? card.applied : null;
  const date = card.options[0]?.date;
  return (
    <div className="pip-options">
      <p className="pip-caption">
        {card.title}
        {date ? ` · ${showDate(date)}` : ""}
      </p>
      {card.options.map((o, i) => (
        <div key={o.id} className={`pip-option${i === 0 ? " pip-option-lead" : ""}${applied === o.id ? " pip-option-applied" : ""}`}>
          <div className="pip-option-main">
            <p className="pip-option-place">
              {o.place.name}
              {o.place.code ? <span className="pip-option-code">{o.place.code}</span> : null}
            </p>
            {o.legs.map((leg) => (
              <LegLine key={leg.from.name} leg={leg} members={members} />
            ))}
          </div>
          <div className="pip-option-stub">
            <span className="pip-option-total">{o.total ? `≈ ${money(o.total.amount, o.total.currency)}` : "—"}</span>
            <span className="pip-option-each">for everyone</span>
            {applied === o.id ? (
              <span className="pip-stamp">On the trip</span>
            ) : (
              <Button
                variant="secondary"
                disabled={pending || !!applied}
                onClick={() => start(() => applyMeetup(tripId, messageId, o.id))}
              >
                Add to trip
              </Button>
            )}
          </div>
          {i === 0 && !applied ? <span className="pip-stamp pip-stamp-corner">Pip&apos;s pick</span> : null}
        </div>
      ))}
      {applied && card.changesetId ? (
        <Button variant="quiet" disabled={pending} onClick={() => start(() => undoAgentChange(tripId, messageId, card.changesetId!))}>
          Undo
        </Button>
      ) : null}
    </div>
  );
}

function LegLine({ leg, members }: { leg: MeetupLeg; members: Members }) {
  const who = leg.members.map((id) => members[id]?.name).filter(Boolean);
  return (
    <p className="pip-option-leg">
      <span>
        {who.length ? list(who) : leg.from.name} · {leg.mode}
        {leg.carrier ? ` · ${leg.carrier}` : ""} · {hours(leg.durationMin)}
        {leg.price ? ` · ${money(leg.price.amount, leg.price.currency)} each` : ""}
      </span>
      <span className={`pip-kind${leg.kind === "estimated" ? " pip-kind-estimated" : ""}`}>{KIND[leg.kind]}</span>
    </p>
  );
}

const KIND: Record<MeetupLeg["kind"], string> = { live: "live", cached: "cached fare", timetable: "timetable", estimated: "estimated" };

function ChangesCard({ card, messageId }: { card: Extract<ThreadCard, { type: "changes" }>; messageId: string }) {
  const tripId = useTripId();
  const [pending, start] = useTransition();
  return (
    <div className={`pip-changes${card.undone ? " pip-changes-undone" : ""}`}>
      <ul>
        {card.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {card.undone ? (
        <span className="pip-caption">Undone</span>
      ) : (
        <Button variant="quiet" disabled={pending} onClick={() => start(() => undoAgentChange(tripId, messageId, card.changesetId))}>
          Undo
        </Button>
      )}
    </div>
  );
}

/** Minimises the chat back to the launcher: a pixel cross, in Pip's style rather than Paper Atlas's round button. */
export function PipClose({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="pip-close" aria-label="Minimise chat" onClick={onClick}>
      <svg width={14} height={14} viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden>
        <path d="M0 0h1v1H0zM1 1h1v1H1zM2 2h1v1H2zM3 3h1v1H3zM4 4h1v1H4zM5 5h1v1H5zM6 6h1v1H6zM6 0h1v1H6zM5 1h1v1H5zM4 2h1v1H4zM2 4h1v1H2zM1 5h1v1H1zM0 6h1v1H0z" />
      </svg>
    </button>
  );
}

/** The message box and chips. `send` posts to a trip, or (on the home globe) starts one. */
export function Composer({ send, chips, placeholder = `Message ${AGENT_NAME}` }: { send: (text: string) => Promise<void>; chips: string[]; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<"failed" | "sign-in" | null>(null);
  const [pending, start] = useTransition();
  const openAuth = useOpenAuth();
  const submit = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setError(null);
    start(async () => {
      try {
        await send(t);
        setDraft("");
      } catch (e) {
        setError(e instanceof Error && e.message === SIGN_IN_TO_ASK ? "sign-in" : "failed");
      }
    });
  };
  return (
    <form
      className="pip-composer"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit(draft);
      }}
    >
      <div className="pip-chips">
        {chips.map((chip) => (
          <button key={chip} type="button" className="pip-chip" disabled={pending} onClick={() => submit(chip)}>
            {chip}
          </button>
        ))}
      </div>
      {error === "failed" ? <p className="pip-caption" role="alert">That didn&apos;t send. Try again.</p> : null}
      {error === "sign-in" ? (
        <p className="pip-caption" role="alert">
          <button type="button" className="underline" onClick={() => openAuth("signin")}>
            Sign in
          </button>{" "}
          to talk to {AGENT_NAME}.
        </p>
      ) : null}
      <label className="pip-input-row">
        <input
          className="pip-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          aria-label="Message"
          maxLength={2000}
        />
        <button type="submit" className="pip-send" aria-label="Send" disabled={pending || !draft.trim()}>
          <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
            <path d="M3 8 H13 M9 4 L13 8 L9 12" />
          </svg>
        </button>
      </label>
    </form>
  );
}

const hours = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m`;
const money = (amount: number, currency: string) => `${currency} ${Math.round(amount).toLocaleString("en-GB")}`;

