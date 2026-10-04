"use client";

import { useRoom, useSelf, useStorage } from "@liveblocks/react";
import { Activity, createContext, memo, use, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type FormEvent, type ReactNode } from "react";

import { applyMeetup, undoAgentChange } from "@/app/t/actions";
import dynamic from "next/dynamic";
const CheckoutCard = dynamic(() => import("@/components/agent/checkout-card").then((m) => m.CheckoutCard), { loading: () => <p className="pip-caption" role="status">Loading checkout…</p> });
import { useOpenAuth } from "@/components/auth/links";
import { arrival, ARRIVAL_MS, HOP_MS, PipArrival, PipHop, pipPlace, usePipCorner } from "@/components/agent/pip-arrival";
import { usePipFrame } from "@/components/agent/pip-frame";
import { AlienText, useTranslated } from "@/components/agent/alien-text";
import { PipSprite, PipUfo, type PipMood } from "@/components/agent/pip-sprite";
import { Button, PixelIcon } from "@/components/paper-atlas";
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
  const [visited, setVisited] = useState(initialOpen);
  // the thread is only read with the panel open; closed, a count of finished replies is enough for the dot
  const replies = usePipReplies();
  // replies seen when the panel last closed; whatever was there when the room loaded counts as seen
  const [seen, setSeen] = useState<number | null>(null);
  if (seen === null && replies !== null) setSeen(replies);
  const unread = !open && replies !== null && seen !== null && replies > seen;
  const toggle = (next: boolean) => {
    setOpen(next);
    if (next) setVisited(true);
    setSeen(replies);
  };

  return <>
    {visited ? <Activity mode={open ? "visible" : "hidden"}><Panel onClose={() => toggle(false)} /></Activity> : null}
    {!open ? <Launcher unread={unread} onOpen={() => toggle(true)} /> : null}
  </>;
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
  // a launcher after the first is Pip coming back from the chat: it rises out of a portal
  const [returning] = useState(() => arrival.played);
  // the arrival or the portal is this launcher's entrance, so its own zoom-in doesn't play
  const [entrance] = useState(arriving || returning);
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
  const { side, hop } = usePipCorner(root, porthole, arriving, returning ? "arrive" : null);
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
        <PipSprite size={40} mood={hover ? "talk" : "idle"} className={hidden ? "pip-hidden" : undefined} portal />
        {unread ? <span aria-label="New reply" className="pip-unread" /> : null}
      </button>
    </div>
  );
}

// The speech bubble's tail: a short, straight pixel wedge from under the bubble's right end to Pip's antenna, in 2px
// cells. Row 0 sits over the bubble's bottom border, on its straight part clear of the stepped corner, so the two
// read as one shape. K ink · L paper
const TAIL = [
  "KLLLLLK......",
  ".KKLLLLK.....",
  "...KKLLLK....",
  ".....KKLLK...",
  ".......KKLLK.",
  ".........KKKK",
];

function NudgeTail() {
  return (
    <svg aria-hidden className="pip-nudge-tail" width={TAIL[0].length * 2} height={TAIL.length * 2} viewBox={`0 0 ${TAIL[0].length} ${TAIL.length}`} shapeRendering="crispEdges">
      {TAIL.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === "." ? null : <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} className={c === "K" ? "pip-nudge-tail-ink" : "pip-nudge-tail-light"} />,
        ),
      )}
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
  // moved by its header, sized from its corner
  const { panel: framed, style: frameStyle, placed, onMove, onSize } = usePipFrame();
  // a trip that opens with the chat showing has no entrance to play when it's closed
  useEffect(() => {
    arrival.played = true;
  }, []);
  const members = useStorage((root) => root.members);
  const me = useSelf((s) => s.id) ?? undefined;
  const activity = usePipActivity();
  const busy = usePipBusy();
  const post = useSendMessage();
  // your message shows the moment you send it, until the room has it
  const [pending, setPending] = useState<ThreadMessage[]>([]);
  const send = async (text: string) => {
    const local: ThreadMessage = { id: `local-${Date.now()}`, at: Date.now(), author: { kind: "member", id: me ?? "" }, text, state: "done", cards: [] };
    setPending((p) => [...p, local]);
    try {
      const id = await post(text);
      setPending((p) => p.map((m) => (m === local ? { ...m, id } : m)));
    } catch (error) {
      setPending((p) => p.filter((m) => m !== local));
      throw error;
    }
  };
  const shown = useMemo(() => {
    const live = pending.filter((m) => !thread.some((t) => t.id === m.id));
    return live.length ? [...thread, ...live] : thread;
  }, [thread, pending]);
  const tripId = useRoom().id.slice("trip:".length);
  const actions = useMemo<CardActions>(
    () => ({
      apply: (messageId, option) => applyMeetup(tripId, messageId, option),
      undo: (messageId, changesetId) => undoAgentChange(tripId, messageId, changesetId),
      checkout: (legId) => <CheckoutCard legId={legId} />,
    }),
    [tripId],
  );
  const streaming = thread.find((m) => m.state === "streaming");
  const mood: PipMood = streaming?.text ? "talk" : busy || activity ? "think" : "idle";
  const stops = useStorage((root) => root.stops);
  const legs = useStorage((root) => root.legs);
  const context = useMemo(() => tripContext({ members, stops, legs }, me), [members, stops, legs, me]);
  const composer = useComposer(send);

  return (
    <section ref={framed} style={frameStyle} data-placed={placed || undefined} data-globe-obstacle className={`pip-panel${pipPlace.side === "left" ? " pip-panel-left" : ""}`} aria-label={`Trip chat with ${AGENT_NAME}`}>
      <header className="pip-head" data-draggable="" onPointerDown={onMove}>
        <PipSprite size={32} mood={mood} portal />
        <div className="min-w-0 flex-1">
          <p className="pip-head-name">{AGENT_NAME}</p>
          <p className="pip-head-sub">{context.line}</p>
        </div>
        <PipClose onClick={onClose} />
      </header>

      <CardActionsContext value={actions}>
        <ThreadLog thread={shown} me={me} members={members ?? NO_MEMBERS} activity={activity} footer={<Suggestions composer={composer} chips={context.chips} />}>
          <p className="pip-empty">Ask {AGENT_NAME} how to get somewhere, or where everyone should meet. Everyone in the trip sees the chat.</p>
        </ThreadLog>
      </CardActionsContext>

      <Composer composer={composer} />
      {/* drag to resize */}
      <span className="pip-grip" aria-hidden onPointerDown={onSize} />
    </section>
  );
}

/**
 * What a card's buttons do. In a trip room they change the room's plan; on the home globe, the legs on that globe.
 * `undo` is absent where there's nothing to undo.
 */
export type CardActions = {
  apply: (messageId: string, option: string) => Promise<unknown> | void;
  undo?: (messageId: string, changesetId: string) => Promise<unknown> | void;
  /** The meet-up button's label. Default "Add to trip". */
  applyLabel?: string;
  retry?: (messageId: string) => void;
  appliedReplies?: ReadonlySet<string>;
  /** A leg's checkout, where there's a trip to book in. */
  checkout?: (legId: string) => ReactNode;
};
export const CardActionsContext = createContext<CardActions>({ apply: () => {} });

/**
 * The conversation, scrolled to the latest message before it paints and following new text while you're at the
 * bottom, so reading back isn't yanked down every token. `children` shows when it's empty.
 */
export function ThreadLog({ thread, me, members, activity, footer, children }: { thread: ThreadMessage[]; me: string | undefined; members: Members; activity: string | null; footer?: React.ReactNode; children?: React.ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [thread, activity]);
  return (
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
      {/* the thread sits at the bottom, over the suggestions, so it settles onto the box when they go */}
      <div className="pip-thread">
        {thread.length === 0 ? children : null}
        {thread.map((m) => (
          <Message key={m.id} message={m} me={me} members={members} activity={m.state === "streaming" ? activity : null} />
        ))}
      </div>
      {footer}
    </div>
  );
}

const list = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

export type Members = Record<string, { name: string; color: number }>;
const NO_MEMBERS: Members = {};

// Memoised: a streamed token changes only the streaming message, so the rest of the thread doesn't re-render.
const Message = memo(function Message({ message: m, me, members, activity }: { message: ThreadMessage; me: string | undefined; members: Members; activity: string | null }) {
  // in alien mode, how much of a streaming reply has translated
  const translated = useTranslated(m.text.length, m.state === "streaming", m.author.kind === "agent");
  if (m.author.kind === "agent") {
    const streaming = m.state === "streaming";
    const all = inOrder(m.text, m.cards);
    // the step lines Pip starts with, before any words or other card, share the thinking saucer's slot
    const lead = all.findIndex((p) => p.kind !== "card" || p.card.type !== "status");
    const steps = all.slice(0, lead < 0 ? all.length : lead);
    const parts = all.slice(steps.length);
    const part = (p: (typeof all)[number]) =>
      p.kind === "text" ? (
        <AlienText key={`t${p.at}`} className="pip-text" text={p.text} translated={translated - p.at} />
      ) : (
        <Card key={p.index} card={p.card} messageId={m.id} members={members} activity={activity} />
      );
    return (
      <div className="pip-msg-agent">
        <div className="pip-msg-agent-body">
          <span className="pip-label">{AGENT_NAME}</span>
          {/* before its first tool or word, the saucer and what Pip's doing; then its first steps, centred in the
              same slot, so the reply doesn't shrink as they take over */}
          {steps.length ? (
            <div className="pip-thinking pip-thinking-steps">{steps.map(part)}</div>
          ) : streaming && !parts.length ? (
            <div className="pip-thinking">
              <PipUfo size={44} />
              {activity ? <Step label={activity} running /> : null}
            </div>
          ) : null}
          {parts.map(part)}
          {m.state === "failed" ? <FailedReply messageId={m.id} /> : null}
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

function FailedReply({ messageId }: { messageId: string }) {
  const actions = use(CardActionsContext);
  if (actions.appliedReplies?.has(messageId)) return <p className="pip-caption" role="status">Trip updated. Send a follow-up to continue the interrupted reply.</p>;
  return <p className="pip-caption" role="status">Reply interrupted.{actions.retry ? <> <button type="button" className="pip-action" onClick={() => actions.retry?.(messageId)}>Try again</button></> : " Send a follow-up to continue."}</p>;
}

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
  if (card.type === "checkout") return <CheckoutSlot legId={card.legId} />;
  return <Step label={card.label} running={!card.done} detail={card.done ? null : activity} />;
}

function CheckoutSlot({ legId }: { legId: string }) {
  const actions = use(CardActionsContext);
  return actions.checkout ? actions.checkout(legId) : null;
}

function MeetupCard({ card, messageId, members }: { card: Extract<ThreadCard, { type: "meetup" }>; messageId: string; members: Members }) {
  const actions = use(CardActionsContext);
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
                onClick={() => start(async () => void (await actions.apply(messageId, o.id)))}
              >
                {actions.applyLabel ?? "Add to trip"}
              </Button>
            )}
          </div>
          {i === 0 && !applied ? <span className="pip-stamp pip-stamp-corner">Pip&apos;s pick</span> : null}
        </div>
      ))}
      {applied && card.changesetId && actions.undo ? (
        <button type="button" className="pip-undo" aria-label="Undo this meet-up" title="Undo" disabled={pending} onClick={() => start(async () => void (await actions.undo!(messageId, card.changesetId!)))}>
          <PixelIcon rows={REWIND} scale={2} />
        </button>
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

// Undo's glyph: rewind, at 2 px a cell
const REWIND = ["  #  #", " ## ##", "######", " ## ##", "  #  #"];

function ChangesCard({ card, messageId }: { card: Extract<ThreadCard, { type: "changes" }>; messageId: string }) {
  const actions = use(CardActionsContext);
  const [pending, start] = useTransition();
  return (
    <div className={`pip-changes${card.undone ? " pip-changes-undone" : ""}`}>
      <ul>
        {card.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {card.undone ? (
        <span className="pip-changes-note">Undone</span>
      ) : actions.undo ? (
        <button
          type="button"
          className="pip-undo"
          aria-label="Undo these changes"
          title="Undo"
          disabled={pending}
          onClick={() => start(async () => void (await actions.undo!(messageId, card.changesetId)))}
        >
          <PixelIcon rows={REWIND} scale={2} />
        </button>
      ) : null}
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
/**
 * The message box's state, shared by the box and the suggestions at the end of the thread. The box clears the moment
 * a message goes and gets the text back if sending fails.
 */
export function useComposer(send: (text: string) => Promise<void>) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<"failed" | "sign-in" | null>(null);
  const [pending, setPending] = useState(false);
  // Not a transition: the message has to show the moment it's sent, and a transition holds every update back until
  // the request finishes.
  const submit = async (text: string) => {
    const t = text.trim();
    if (!t || pending) return;
    setError(null);
    setDraft("");
    setPending(true);
    try {
      await send(t);
    } catch (e) {
      setDraft(t);
      setError(e instanceof Error && e.message === SIGN_IN_TO_ASK ? "sign-in" : "failed");
    } finally {
      setPending(false);
    }
  };
  return { draft, setDraft, error, pending, submit };
}

export type ComposerState = ReturnType<typeof useComposer>;

/** Suggested messages, last in the thread so they scroll away with it. They go while you type. */
/**
 * The suggestion over the message box: only the first of `chips`, so the thread's bottom stays one row tall and doesn't
 * jump when the suggestions change as a reply comes in.
 */
export function Suggestions({ composer, chips }: { composer: ComposerState; chips: string[] }) {
  if (!chips.length || composer.draft) return null;
  return (
    <div className="pip-suggest" role="menu" aria-label="Suggested messages">
      {chips.slice(0, 1).map((chip, i) => (
        <button
          key={chip}
          type="button"
          role="menuitem"
          className="pip-suggestion"
          style={{ animationDelay: `${i * 40}ms` }}
          disabled={composer.pending}
          onClick={() => void composer.submit(chip)}
        >
          <span className="pip-px">{chip}</span>
        </button>
      ))}
    </div>
  );
}

/** The message box. With `onStop`, a reply is coming in, and its button stops the reply instead of sending. */
export function Composer({ composer, placeholder = `Message ${AGENT_NAME}`, onStop }: { composer: ComposerState; placeholder?: string; onStop?: () => void }) {
  const { draft, setDraft, error, pending, submit } = composer;
  const openAuth = useOpenAuth();
  return (
    <form
      className="pip-composer"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void submit(draft);
      }}
    >
      {error === "failed" ? <p className="pip-caption" role="alert">That didn&apos;t send. Try again.</p> : null}
      {error === "sign-in" ? (
        <p className="pip-caption" role="alert">
          <button type="button" className="ts-oneway" onClick={() => openAuth("signin")}>
            Sign in
          </button>{" "}
          to talk to {AGENT_NAME}.
        </p>
      ) : null}
      <label className="pip-input-row">
        <span className="pip-input-frame">
          <input
            className="pip-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            aria-label="Message"
            maxLength={2000}
          />
        </span>
        {onStop ? (
          <button type="button" className="pip-send" aria-label="Stop reply" onClick={onStop}>
            <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
              <rect x={4.5} y={4.5} width={7} height={7} fill="currentColor" />
            </svg>
          </button>
        ) : (
          <button type="submit" className="pip-send" aria-label="Send" disabled={pending || !draft.trim()}>
            <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
              <path d="M3 8 H13 M9 4 L13 8 L9 12" />
            </svg>
          </button>
        )}
      </label>
    </form>
  );
}

const hours = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m`;
const money = (amount: number, currency: string) => `${currency} ${Math.round(amount).toLocaleString("en-GB")}`;

