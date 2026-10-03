"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

// Panels that open beside the plan card rather than inside it: the bill, a leg's hotel search. One at a time, on
// whichever side of the card has room, so the card itself never grows or scrolls to fit them.

/** Keep at least this far from the screen's edges. */
const EDGE = 24;
/** Below this, a panel moves up rather than scroll in a sliver. */
const MIN_HEIGHT = 320;

type Side = { slot: HTMLElement | null; open: string | null; setOpen: (key: string | null) => void };
const SideContext = createContext<Side>({ slot: null, open: null, setOpen: () => {} });

/**
 * Wraps a card (the plan, or the home fare card): `.tp-wrap`, the positioned box the panels sit against, with a slot
 * they render into. Opening a panel closes whichever was open. The plan's bill keeps its open state with the caller
 * (`bill`), so it lasts while the card is minimised to its dock and back.
 */
export function BesideProvider({ bill, children }: { bill?: { open: boolean; set: (open: boolean) => void }; children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [other, setOther] = useState<string | null>(null);
  const open = bill?.open ? "bill" : other;
  const setOpen = (key: string | null) => {
    bill?.set(key === "bill");
    setOther(key === "bill" && bill ? null : key);
  };
  return (
    <SideContext.Provider value={{ slot, open, setOpen }}>
      <div className="tp-wrap">
        {children}
        <div ref={setSlot} />
      </div>
    </SideContext.Provider>
  );
}

/** Whether the panel `key` is open, and a toggle for it that closes any other. */
export function useBeside(key: string) {
  const { open, setOpen } = useContext(SideContext);
  return { open: open === key, toggle: () => setOpen(open === key ? null : key), close: () => open === key && setOpen(null) };
}

/**
 * A panel beside the plan card, on the right or on the left when the right runs off the screen. Its top lines up with
 * `align` (the control that opened it), or with the card's bottom when there's none; it then stays put, so whatever
 * opens inside grows it downward, and it scrolls past the screen's bottom. Escape closes it, and so does a click
 * outside it and `trigger` unless it `stays` open until its button closes it.
 */
export function BesidePanel({
  id,
  label,
  align = null,
  trigger,
  onClose,
  stays = false,
  children,
}: {
  id: string;
  label: string;
  align?: RefObject<HTMLElement | null> | null;
  trigger: RefObject<HTMLElement | null>;
  onClose: () => void;
  stays?: boolean;
  children: ReactNode;
}) {
  const { slot } = useContext(SideContext);
  const card = useRef<HTMLElement>(null);
  const [frame, setFrame] = useState<{ side: "right" | "left"; top: number; maxHeight: number } | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useLayoutEffect(() => {
    const place = () => {
      const box = slot?.parentElement?.getBoundingClientRect();
      const el = card.current;
      if (!box || !el) return;
      const w = el.offsetWidth;
      const side = box.right + w + EDGE <= window.innerWidth || box.left - w - EDGE < 0 ? "right" : "left";
      const at = align?.current ? align.current.getBoundingClientRect().top - box.top : box.height - el.offsetHeight;
      const floor = window.innerHeight - EDGE - box.top;
      // up from the control only as far as it takes to show a usable panel, never above the screen
      let top = Math.max(EDGE - box.top, at);
      if (floor - top < MIN_HEIGHT) top = Math.max(EDGE - box.top, floor - MIN_HEIGHT);
      setFrame({ side, top, maxHeight: floor - top });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [slot, align]);

  useEffect(() => {
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      // a drop-down opened from inside the panel lists its options in a layer over the page: picking one isn't leaving
      if ((target as Element).closest?.(".pa-select-list")) return;
      if (!stays && !card.current?.contains(target) && !trigger.current?.contains(target)) closeRef.current();
    };
    const escape = (event: KeyboardEvent) => {
      // something inside it (an open drop-down) already took this Escape
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // and the card it sits beside doesn't take it too
      event.preventDefault();
      closeRef.current();
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [trigger, stays]);

  if (!slot) return null;
  return createPortal(
    <section
      ref={card}
      id={id}
      aria-label={label}
      className="ts pa-cast tp-beside"
      data-side={frame?.side ?? "right"}
      style={frame ? { top: frame.top, maxHeight: frame.maxHeight } : { visibility: "hidden" }}
    >
      {children}
    </section>,
    slot,
  );
}
