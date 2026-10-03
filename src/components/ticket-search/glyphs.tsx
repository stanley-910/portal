import type { Mode } from "@/lib/transport/types";

import { cn } from "@/lib/utils";

// Solid travel glyphs, drawn on a 16 px grid with even-odd holes for windows. Solid rather than the 1.6 px stroke
// glyphs because they have to read at 12–14 px: on a trip tag (filled in the member's colour inside an ink outline,
// like the plane sticker), on the mode tabs and in a result's timeline.
export type GlyphKind = Mode | "hotel";

export const GLYPH: Record<GlyphKind, string> = {
  // seen from above, nose to the right
  flight:
    "M15 8c0-.6-.5-1-1.2-1H10L6.6 2.2H5.2L7 7H3.6L2.2 5.2H1l.9 2.8L1 10.8h1.2L3.6 9H7l-1.8 4.8h1.4L10 9h3.8c.7 0 1.2-.4 1.2-1z",
  // front on: windscreen, two lamps, and the bogies under it
  train:
    "M4.5 1h7A2.5 2.5 0 0 1 14 3.5V10a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 10V3.5A2.5 2.5 0 0 1 4.5 1z" +
    "M4 3.5h8v3.5H4z" +
    "M5.3 8.6a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM10.7 8.6a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" +
    "M4.6 13.2h1.8L5.4 15H3.6zM9.6 13.2h1.8l1 1.8h-1.8z",
  // from the side, so it never reads as the train
  bus:
    "M2.2 2.5h10.3c.5 0 .9.3 1.1.7l1.6 3.4c.1.2.1.4.1.6v4.8c0 .6-.4 1-1 1H2.2c-.7 0-1.2-.5-1.2-1.2V3.7c0-.7.5-1.2 1.2-1.2z" +
    "M2.6 4h2.6v2.6H2.6zM6.4 4H9v2.6H6.4zM10.2 4h2.1l1.2 2.6h-3.3z" +
    "M4.5 11.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zM11.5 11.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z",
  // a hull, a cabin with portholes, and a funnel
  ferry:
    "M6.2 2h2.4v3H6.2z" +
    "M3.8 5.2h7.8l1 3.6H2.8z" +
    "M5 6.4h1.4v1.2H5zM7.3 6.4h1.4v1.2H7.3zM9.6 6.4H11v1.2H9.6z" +
    "M.8 9.6h14.4l-2.4 4.4H3.2z",
  // a headboard, a pillow and the mattress
  hotel:
    "M1 3h1.8v6.2H15V14h-1.8v-2H2.8v2H1z" +
    "M4.6 5.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z" +
    "M7 5.6h5.5A2.5 2.5 0 0 1 15 8.1v.3H7z",
};

/** A travel glyph. `sticker` fills it in the member's colour inside an ink outline; otherwise it's solid ink. */
export function Glyph({ kind, size = 14, sticker = false, className }: { kind: GlyphKind; size?: number; sticker?: boolean; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={cn("ts-glyph", sticker && "ts-glyph-sticker", className)} aria-hidden>
      <path d={GLYPH[kind]} fillRule="evenodd" />
    </svg>
  );
}
