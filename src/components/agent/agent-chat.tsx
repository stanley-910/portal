"use client";

import { useRoom, useSelf, useStorage } from "@liveblocks/react";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { applyMeetup, undoAgentChange } from "@/app/t/actions";
import { useOpenAuth } from "@/components/auth/links";
import { PipSprite, type PipMood } from "@/components/agent/pip-sprite";
import { Button, RoundButton } from "@/components/paper-atlas";
import { showDate } from "@/lib/agent/snapshot";
import { AGENT_NAME, type MeetupLeg, type ThreadCard, type ThreadMessage } from "@/lib/agent/types";
import { SIGN_IN_TO_ASK, usePipActivity, usePipBusy, useSendMessage, useThread } from "@/lib/agent/use-thread";
import { memberColor } from "@/lib/liveblocks/types";

// The trip's thread with Pip in it, rebuilt from the Pip handoff: a porthole launcher bottom-right that opens
// a chat panel. Pip's surfaces are starlight pixels; people's are Paper Atlas print (handoff: "what Pip makes").

const CHIPS = ["@Pip where should we meet?", "@Pip somewhere fair in the middle", "@Pip what's on the trip so far?"];
const NUDGE = `Hi, I'm ${AGENT_NAME}. Tell me where everyone's starting from and I'll find where to meet.`;
const NUDGE_DELAY_MS = 900;
// how long the nudge stays once typed out; it shows once per page load
const NUDGE_HOLD_MS = 5000;
const nudged = new Set<string>();
const TYPE_MS = 34;

export function AgentChat({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const thread = useThread();
  // messages read up to when the panel last closed
  const [seen, setSeen] = useState(0);
  const unread = !open && thread.slice(seen).some((m) => m.author.kind === "agent");
  const toggle = (next: boolean) => {
    setOpen(next);
    setSeen(thread.length);
  };

  return open ? <Panel thread={thread} onClose={() => toggle(false)} /> : <Launcher unread={unread} onOpen={() => toggle(true)} />;
}

export function Launcher({ unread, onOpen, nudge = NUDGE }: { unread: boolean; onOpen: () => void; nudge?: string }) {
  const [hover, setHover] = useState(false);
  const [done, setDone] = useState(() => nudged.has(nudge));
  const typed = useTyping(done ? null : nudge);
  const finished = typed === nudge;
  useEffect(() => {
    if (!finished) return;
    nudged.add(nudge);
    const timer = window.setTimeout(() => setDone(true), NUDGE_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [finished, nudge]);
  return (
    <div className="pip-launcher">
      {typed !== null && !done ? (
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
          <span aria-hidden className="pip-nudge-tail" />
        </button>
      ) : null}
      <button
        type="button"
        className="pip-porthole"
        aria-label={`Open ${AGENT_NAME}`}
        onClick={onOpen}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        <PipSprite size={40} mood={hover ? "talk" : "idle"} />
        {unread ? <span aria-label="New reply" className="pip-unread" /> : null}
      </button>
    </div>
  );
}

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

function Panel({ thread, onClose }: { thread: ThreadMessage[]; onClose: () => void }) {
  const members = useStorage((root) => root.members);
  const me = useSelf((s) => s.id) ?? undefined;
  const activity = usePipActivity();
  const busy = usePipBusy();
  const scroller = useRef<HTMLDivElement>(null);
  const send = useSendMessage();
  const streaming = thread.find((m) => m.state === "streaming");
  const mood: PipMood = streaming?.text ? "talk" : busy || activity ? "think" : "idle";
  const others = Object.entries(members ?? {}).filter(([id]) => id !== me).map(([, m]) => m.name);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [thread, activity]);

  return (
    <section className="pip-panel" aria-label={`Trip chat with ${AGENT_NAME}`}>
      <header className="pip-head">
        <PipSprite size={40} mood={mood} />
        <div className="min-w-0 flex-1">
          <p className="pip-head-name">{AGENT_NAME}</p>
          <p className="pip-head-sub">{others.length ? `This trip · with ${list(others)}` : "This trip · just you so far"}</p>
        </div>
        <RoundButton label="Minimise chat" onClick={onClose} />
      </header>

      <div ref={scroller} className="pip-messages" role="log" aria-live="polite">
        {thread.length === 0 ? (
          <p className="pip-empty">Ask {AGENT_NAME} with @{AGENT_NAME}, or talk to the group.</p>
        ) : null}
        {thread.map((m) => (
          <Message key={m.id} message={m} me={me} members={members ?? {}} activity={m.state === "streaming" ? activity : null} />
        ))}
      </div>

      <Composer send={send} />
    </section>
  );
}

const list = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

type Members = Record<string, { name: string; color: number }>;

function Message({ message: m, me, members, activity }: { message: ThreadMessage; me: string | undefined; members: Members; activity: string | null }) {
  if (m.author.kind === "agent") {
    return (
      <div className="pip-msg-agent">
        <PipSprite size={30} mood={m.state === "streaming" ? (m.text ? "talk" : "think") : "idle"} />
        <div className="pip-msg-agent-body">
          <span className="pip-label">{AGENT_NAME}</span>
          {m.text ? <p className="pip-text">{m.text}</p> : null}
          {m.state === "streaming" && !m.text ? (
            activity ? <Status label={activity} /> : <span className="pa-dots" aria-label="Pip is thinking"><span /><span /><span /></span>
          ) : null}
          {m.state === "streaming" && m.text && activity ? <Status label={activity} /> : null}
          {m.cards.map((card, i) => (
            <Card key={i} card={card} messageId={m.id} members={members} />
          ))}
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
}

function Status({ label }: { label: string }) {
  return (
    <div className="pip-status" role="status">
      <span className="pip-status-label">{label}</span>
      <span aria-hidden className="pip-status-bar">
        <span />
      </span>
    </div>
  );
}

function Card({ card, messageId, members }: { card: ThreadCard; messageId: string; members: Members }) {
  if (card.type === "meetup") return <MeetupCard card={card} messageId={messageId} members={members} />;
  if (card.type === "changes") return <ChangesCard card={card} messageId={messageId} />;
  return <Status label={card.label} />;
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

/** The message box and chips. `send` posts to a trip, or (on the home globe) starts one. */
export function Composer({ send, chips = CHIPS, placeholder = `Message the group, or ask @${AGENT_NAME}` }: { send: (text: string) => Promise<void>; chips?: string[]; placeholder?: string }) {
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
            {chip.replace(/^@Pip /, "")}
          </button>
        ))}
      </div>
      {error === "failed" ? <p className="pip-caption" role="alert">That didn&apos;t send. Try again.</p> : null}
      {error === "sign-in" ? (
        <p className="pip-caption" role="alert">
          <button type="button" className="underline" onClick={() => openAuth("signin")}>
            Sign in
          </button>{" "}
          to ask {AGENT_NAME}.
        </p>
      ) : null}
      <div className="pip-input-row">
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
      </div>
    </form>
  );
}

const hours = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m`;
const money = (amount: number, currency: string) => `${currency} ${Math.round(amount).toLocaleString("en-GB")}`;

