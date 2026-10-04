"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref, type RefObject } from "react";

import { getAway, PORTAL_MS, setAway } from "@/components/agent/pip-away";
import { PipSprite } from "@/components/agent/pip-sprite";
import type { LatLng, TripGlobeHandle } from "@/components/trip-globe";
import { SAUCER_STAY_MS, type AgentMark } from "@/lib/agent/marks";
import { AGENT_NAME } from "@/lib/agent/types";

// Pip at work on the globe: its saucer (the globe draws it, trip-globe/ufo-model.ts) flies to whatever Pip is
// looking at, and the view follows it until someone moves the globe themselves.
// Pip makes its changes one at a time (agent/tools.ts): the saucer flies to where each goes, and the change lands and
// pops up over the place like a hit in a game as it gets there. Legs Pip changes are played under it: it flies to
// where the first change starts and the trip goes down once it's there. A leg that went has its pin rise into the
// saucer, which rides its line back to its start, reeling it in, and pops "Removed"; a leg that came draws out behind
// it to its pin, which drops as the line reaches it, and pops "Added". Once Pip is done, the saucer flies off.
// Pip itself goes first: it drops through a portal at its spot in the chat (pip-away.ts), and the saucer flies in once
// it's through; the portal stays open while the saucer works, and Pip comes back out of it once the saucer has gone.
// Positions are written to the DOM every frame.

/** A pop's whole life, rising and fading (matches the CSS animation). */
const POP_MS = 2200;
/** How long the saucer stays over a change after it pops, before flying to the next: as long as Pip waits. */
const HOLD_MS = SAUCER_STAY_MS;
/** The longest it waits to reach a place before popping anyway. */
const REACH_MS = 3500;
/** The longest it waits for a leg's line to finish drawing or reeling in before popping anyway. */
const LEG_MS = 10_000;
/** How long the saucer stays out after Pip stops, so it doesn't flicker between steps. */
const LINGER_MS = 1000;
/** Pops float this far above the saucer. */
const POP_RISE = 30;

/**
 * Changes the legs on the globe once the saucer is at `from`, where the first change starts (lib/agent/marks.ts
 * changeStart).
 */
export type SaucerBuild = { from: LatLng; run: () => void };

export type PipSaucerHandle = {
  /**
   * Plays what an edit changed: the saucer visits each place in turn and pops the change there. A change to a leg
   * pops once the globe has finished reeling its line in or drawing it out, legs that went before legs that came, as
   * the globe plays them. With `build`, it first flies to where the changes start and makes them there.
   */
  play: (marks: AgentMark[], build?: SaucerBuild) => void;
};

type Step = { mark: AgentMark; build?: undefined } | { build: SaucerBuild; mark?: undefined };

type Pop = { id: number; mark: AgentMark };

type Props = {
  globe: RefObject<TripGlobeHandle | null>;
  /** Where Pip is looking now. */
  at: LatLng | null;
  /** Pip is working: the saucer stays out while this is on, at the last place it went. */
  busy: boolean;
  /** Pip has started something that goes on the globe: it heads for its portal before it knows where. */
  expect?: boolean;
  ref?: Ref<PipSaucerHandle>;
};

export function PipSaucer({ globe, at, busy, expect = false, ref }: Props) {
  const [pops, setPops] = useState<Pop[]>([]);
  const [out, setOut] = useState(false);
  // the viewer moved the globe while following: offer to follow again until the saucer goes
  const [lost, setLost] = useState(false);
  const [said, setSaid] = useState("");
  const popEls = useRef(new Map<number, HTMLDivElement>());
  // the latest props, for the frame loop
  const live = useRef({ at, busy, expect, pops });
  useEffect(() => {
    live.current = { at, busy, expect, pops };
    globe.current?.requestFrame();
  }, [at, busy, expect, pops, globe]);
  const queue = useRef<Step[]>([]);

  useImperativeHandle(ref, () => ({
    play: (marks, build) => {
      // legs that went, then legs that came, in the order the globe reels them in and draws them out; then the rest
      const rank = (m: AgentMark) => (m.leg ? (m.leg.gone ? 0 : 1) : 2);
      const ordered = [...marks].sort((a, b) => rank(a) - rank(b));
      queue.current.push(...(build ? [{ build }] : []), ...ordered.map((mark) => ({ mark })));
      globe.current?.requestFrame();
    },
  }), [globe]);

  useEffect(() => {
    const handle = globe.current;
    if (!handle) return;
    let current: (Step & { since: number; popped: number | null }) | null = null;
    let place: LatLng | null = null;
    let sent = "";
    let shown = false;
    let lastBusy = -Infinity;
    let seq = 0;
    const born = new Map<number, number>();
    const send = (ll: LatLng | null) => {
      const key = ll ? `${ll.lat},${ll.lng}` : "";
      if (key === sent) return;
      sent = key;
      handle.setAgent(ll);
    };
    const follow = () => {
      setLost(false);
      handle.followAgent(true, () => setLost(true));
    };
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stop = handle.onFrame(() => {
      const t = performance.now();
      const { at, busy, expect, pops } = live.current;
      if (!current && queue.current.length) current = { ...queue.current.shift()!, since: t, popped: null };
      if (current || busy) lastBusy = t;
      place = current?.build?.from ?? current?.mark?.at ?? (current ? place : at) ?? place;
      const wanted = (!!place && t - lastBusy < LINGER_MS) || expect;
      // Pip goes through its portal before the saucer comes out, and comes back once the saucer has gone
      const away = getAway();
      if (still) setAway("home");
      else if (away.phase === "home" && wanted) setAway("leaving");
      else if (away.phase === "leaving" && t - away.since >= PORTAL_MS) setAway("away");
      else if (away.phase === "away" && !wanted && !shown && !handle.agentSpot()) setAway("returning");
      else if (away.phase === "returning" && t - away.since >= PORTAL_MS) setAway(wanted ? "leaving" : "home");
      const nowOut = !!place && t - lastBusy < LINGER_MS && (still || getAway().phase === "away");
      if (nowOut !== shown) {
        shown = nowOut;
        setOut(nowOut);
        if (nowOut) {
          if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setLost(true);
          else follow();
        }
        else {
          handle.followAgent(false);
          setLost(false);
          place = null;
        }
      }
      send(shown ? place : null);

      const spot = shown ? handle.agentSpot() : null;
      // the time to reach a place counts from when the saucer is out
      if (current && !shown) current.since = t;
      // there to build: the legs go down, and the saucer rides them out
      if (current?.build && (spot?.arrived || t - current.since > REACH_MS)) {
        current.build.run();
        current = null;
      }
      // a leg it's reeling in or drawing out pops once its line is done; anything else once the saucer's there
      const leg = current?.mark?.leg;
      const ready = leg
        ? handle.legState(leg.from, leg.to) === (leg.gone ? "gone" : "shown") || t - current!.since > LEG_MS
        : !current?.mark?.at || spot?.arrived || (!!current && t - current.since > REACH_MS);
      if (current?.mark && current.popped === null && ready) {
        current.popped = t;
        const pop = { id: ++seq, mark: current.mark };
        born.set(pop.id, t);
        setPops((list) => [...list, pop]);
        setSaid(current.mark.text);
      }
      if (current?.popped != null && t - current.popped > HOLD_MS) current = null;

      // each pop rides on its place, as high over it as the saucer hovers
      const hover = spot ? spot.ground.y - spot.y : 0;
      let expired = false;
      for (const p of pops) {
        const el = popEls.current.get(p.id);
        if (t - (born.get(p.id) ?? t) > POP_MS) expired = true;
        if (!el) continue;
        const where = p.mark.at ? handle.project(p.mark.at) : spot && { x: spot.ground.x, y: spot.ground.y, visible: spot.visible };
        el.style.opacity = where?.visible ? "1" : "0";
        if (where) el.style.transform = `translate(${Math.round(where.x)}px, ${Math.round(where.y - hover - POP_RISE)}px)`;
      }
      if (current || queue.current.length || pops.length || (shown && t - lastBusy < LINGER_MS) || expect || getAway().phase !== "home") handle.requestFrame();
      if (expired) {
        const gone = new Set(pops.filter((p) => t - (born.get(p.id) ?? t) > POP_MS).map((p) => p.id));
        for (const id of gone) born.delete(id);
        setPops((list) => list.filter((p) => !gone.has(p.id)));
      }
    });
    return () => {
      stop();
      handle.setAgent(null);
      handle.followAgent(false);
      setAway("home");
    };
  }, [globe]);

  return (
    <>
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {pops.map((p) => (
          <div
            key={p.id}
            ref={(el) => {
              if (el) popEls.current.set(p.id, el);
              else popEls.current.delete(p.id);
            }}
            className="pip-pop"
            style={{ opacity: 0 }}
          >
            <span className="pip-pop-inner">{p.mark.text}</span>
          </div>
        ))}
      </div>
      {out && lost ? (
        <button
          type="button"
          className="pip-follow"
          onClick={() => {
            setLost(false);
            globe.current?.followAgent(true, () => setLost(true));
          }}
        >
          <PipSprite size={20} mood="idle" />
          Follow {AGENT_NAME}
        </button>
      ) : null}
      <output aria-live="polite" className="sr-only">
        {said}
      </output>
    </>
  );
}
