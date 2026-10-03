import { useCallback, useEffect, useRef, type RefObject } from "react";

import type { LatLng, TripGlobeHandle } from "@/components/trip-globe";

/** Keep at least this far from the viewport's edges. */
const EDGE = 24;
/** Clearance between the card and the route's ends, wide enough to clear the hub tags. */
const GAP = 56;
/** Clearance kept above Pip's launcher and the bill. */
const PIP_GAP = 8;

type Side = "right" | "left" | "under" | "pinned";

/**
 * Keeps a card beside a route as the globe turns: on the side of the points with the most free space (right, left or
 * under), sticking with a side while it still fits, and pinned to the left edge when nothing fits. It stays below the
 * nav bar and above Pip and anything marked `data-anchor-avoid`, and sets `--anchor-max-h` to the height left between
 * them, so a tall card scrolls instead.
 *
 * `moveTo` puts the card where someone dragged it instead (top-left, in the card's frame): from then on it stays there,
 * kept on screen and clear of the nav bar and Pip, until the card mounts again. `at` is where it is now.
 */
export function useAnchor(globe: RefObject<TripGlobeHandle | null>, points: LatLng[], onPlaced: (anchor: HTMLDivElement) => void) {
  const root = useRef<HTMLDivElement>(null);
  const at = useRef<{ x: number; y: number } | null>(null);
  const manual = useRef<{ x: number; y: number } | null>(null);
  const placeNow = useRef<() => void>(() => {});
  const placed = useRef(false);
  const placedCb = useRef(onPlaced);
  const pointsRef = useRef(points);
  useEffect(() => {
    placedCb.current = onPlaced;
    pointsRef.current = points;
  });
  const key = points.map((p) => `${p.lat},${p.lng}`).join(";");

  useEffect(() => {
    const g = globe.current;
    if (!g) return;
    let side: Side | null = null;
    const place = () => {
      const el = root.current;
      const box = el?.offsetParent as HTMLElement | null;
      const projected = pointsRef.current.map((p) => g.project(p)).filter((p) => !!p);
      if (!el || !box || (!projected.length && !manual.current)) return;
      const W = box.clientWidth;
      const H = box.clientHeight;
      const w = el.offsetWidth;
      const frame = box.getBoundingClientRect();
      const nav = document.querySelector(".pn-bar")?.getBoundingClientRect().bottom ?? 0;
      const top = Math.max(EDGE, nav - frame.top + 8);
      const xs = projected.map((p) => p.x);
      const ys = projected.map((p) => p.y);
      const minX = Math.min(...xs) - GAP;
      const maxX = Math.max(...xs) + GAP;
      const minY = Math.min(...ys) - GAP;
      const maxY = Math.max(...ys) + GAP;
      // the bottom the card may reach at x: above Pip, or anything marked to avoid, where the card would cross it
      const below = [...document.querySelectorAll(".pip-launcher, [data-anchor-avoid]")].map((e) => e.getBoundingClientRect());
      const floor = (x: number) =>
        below.reduce((bottom, r) => (x < r.right - frame.left && x + w > r.left - frame.left ? Math.min(bottom, r.top - frame.top - PIP_GAP) : bottom), H - EDGE);
      const fit = (x: number) => {
        const bottom = floor(x);
        el.style.setProperty("--anchor-max-h", `${Math.max(120, bottom - top)}px`);
        return bottom;
      };
      const clampX = (x: number) => Math.min(Math.max(x, EDGE), Math.max(EDGE, W - w - EDGE));
      const put = (x: number, y: number) => {
        at.current = { x, y };
        el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      };
      if (manual.current) {
        // where it was dragged, kept on screen and clear of the nav bar and Pip
        const x = clampX(manual.current.x);
        const bottom = fit(x);
        put(x, Math.min(Math.max(manual.current.y, top), Math.max(top, bottom - el.offsetHeight)));
        return;
      }
      const h = el.offsetHeight;
      const room = { right: W - maxX - EDGE, left: minX - EDGE, under: H - maxY - EDGE };
      const fits = { right: room.right >= w, left: room.left >= w, under: room.under >= Math.min(h, 240), pinned: true };
      if (!side || !fits[side]) {
        side =
          fits.right || fits.left
            ? room.right >= room.left && fits.right
              ? "right"
              : fits.left
                ? "left"
                : "right"
            : fits.under
              ? "under"
              : "pinned";
      }
      const x =
        side === "right" ? maxX : side === "left" ? minX - w : side === "under" ? clampX((minX + maxX) / 2 - w / 2) : EDGE;
      const bottom = fit(x);
      const height = el.offsetHeight;
      const clampY = (y: number) => Math.min(Math.max(y, top), Math.max(top, bottom - height));
      const y = side === "under" ? clampY(maxY) : side === "pinned" ? top : clampY((minY + maxY) / 2 - height / 2);
      put(x, y);
      if (!placed.current) {
        placed.current = true;
        el.style.visibility = "visible";
        placedCb.current(el);
      }
    };
    placeNow.current = place;
    place();
    const off = g.onFrame(place);
    const resize = new ResizeObserver(place);
    if (root.current) resize.observe(root.current);
    return () => {
      off();
      resize.disconnect();
    };
  }, [globe, key]);
  const moveTo = useCallback((x: number, y: number) => {
    manual.current = { x, y };
    placeNow.current();
  }, []);
  return { root, at, moveTo };
}

/** Clip-reveal from the top plus an 8 px drop. Skipped under reduced motion. */
export function reveal(card: HTMLElement | null) {
  if (!card || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  card.animate(
    [
      { clipPath: "inset(-30px -30px 100% -30px)", transform: "translateY(-8px)" },
      { clipPath: "inset(-30px -30px -30px -30px)", transform: "none" },
    ],
    { duration: 540, easing: "cubic-bezier(.2,.75,.25,1)" },
  );
}
