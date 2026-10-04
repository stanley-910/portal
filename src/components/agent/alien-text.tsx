"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useAlienPref } from "@/lib/alien-pref";

// Alien mode: a reply streams in as alien glyphs, character by character like any reply, and translates into English
// a few characters behind the stream, so you read it barely later than it arrives. The glyphs about to translate
// scramble, and each flips to its English letter in a stepped flash. Off in settings, under reduced motion, and for
// replies that were already written when they came into view.

/** How far the translation trails the stream, in characters. */
const LAG = 10;
/** A stream quiet this long (Pip off doing something, or a slow connection) translates the rest rather than stall. */
const IDLE_MS = 400;
/** How fast it translates at least, in characters a second, so it never stalls behind a burst. */
const MIN_RATE = 45;
/** How fast it closes the gap: the share of it closed in a second, as an exponential rate. */
const CATCH_UP = 7;
/** How many characters at the edge scramble before they settle, and how many times each changes as it nears. */
const EDGE = 3;
const SCRAMBLES = 4;
/** How many just-translated characters are still flipping (agent.css .pip-alien-flip). */
const FLIP = 8;

const REDUCE = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (onChange: () => void) => {
  const mq = window.matchMedia(REDUCE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};

// a glyph for each letter, so a word keeps its shape until it translates; anything else scrambles through the pool
const LETTERS = Array.from("ᔑʖᓵ↸ᒷ⎓⊣⍑╎⋮ꖌꖎᒲリᘉ¡ᑑ∷ᓭℸ⚍⍊∴⨳⋎⨅");
const POOL = Array.from("⏃⏚☊⎅⟒⎎☌⊑⟟⟊☍⌰⋔⋏⍜⌿⍾⍀⌇⏁⎍⎐⍙⌖⊬⋉⌬⟁⌘⍟◊✦⍉⎈");

const hash = (n: number) => {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  return Math.abs(Math.imul(h, 0xc2b2ae35) ^ (h >>> 16));
};

function glyph(c: string, i: number, scramble: number | null) {
  if (scramble !== null) return POOL[hash(i * 131 + scramble) % POOL.length];
  const letter = c.toLowerCase().charCodeAt(0) - 97;
  return letter >= 0 && letter < 26 ? LETTERS[letter] : POOL[hash(i) % POOL.length];
}

/**
 * How many of a reply's characters have translated, fractions included. All of them unless it's streaming in alien
 * mode; once its stream ends, the translation catches up.
 */
export function useTranslated(length: number, streaming: boolean, agent: boolean) {
  const on = useAlienPref() && agent;
  // only a reply seen streaming translates; one that was already done shows as it is
  const [streamed] = useState(streaming);
  const [n, setN] = useState(0);
  const at = useRef(0);
  const live = useRef({ length, streaming, grew: 0 });
  useEffect(() => {
    live.current = { length, streaming, grew: performance.now() };
  }, [length, streaming]);

  const still = useSyncExternalStore(subscribeMotion, () => window.matchMedia(REDUCE).matches, () => false);
  const active = on && streamed && !still;
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { length, streaming, grew } = live.current;
      const target = streaming && now - grew < IDLE_MS ? Math.max(0, length - LAG) : length;
      const gap = target - at.current;
      if (gap > 0) {
        at.current = Math.min(target, at.current + Math.max(gap * (1 - Math.exp(-CATCH_UP * dt)), MIN_RATE * dt));
        setN(at.current);
      }
      // streaming, it keeps watching for the stream to go quiet
      if (streaming || at.current < length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, length, streaming]);
  return active ? n : Infinity;
}

/**
 * Text whose first `translated` characters read in English and the rest in alien glyphs. `translated` is counted
 * from the start of the text, and may be negative or fractional.
 */
export function AlienText({ text, translated, className }: { text: string; translated: number; className?: string }) {
  if (translated >= text.length + FLIP) return <p className={className}>{text}</p>;
  const cut = Math.min(text.length, Math.max(0, Math.floor(translated)));
  const settled = Math.max(0, cut - FLIP);
  // the edge changes glyph as the translation moves along
  const tick = Math.floor(translated * SCRAMBLES);
  const flipping = Array.from(text.slice(settled, cut));
  const tail = Array.from(text.slice(cut));
  return (
    <p className={className}>
      {text.slice(0, settled)}
      {/* each just-translated letter mounts once, so its flip plays once */}
      {flipping.map((c, i) => (/\s/.test(c) ? c : <span key={settled + i} className="pip-alien-flip">{c}</span>))}
      {/* each letter keeps its own place, hidden under its glyph, so the text never reflows as it translates */}
      {tail.map((c, i) =>
        /\s/.test(c) ? c : <span key={cut + i} className="pip-alien" data-glyph={glyph(c, cut + i, i < EDGE ? tick + i : null)}>{c}</span>,
      )}
    </p>
  );
}
