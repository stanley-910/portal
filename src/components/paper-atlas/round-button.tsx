import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

export interface RoundButtonProps {
  /** Accessible name, e.g. "Cancel trip". Default "Close". */
  label?: string;
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
}

/** A 44px paper disc with an ink border, carrying the close glyph. Pin it to the corner of what it acts on. */
export function RoundButton({ label = "Close", onClick, className, style }: RoundButtonProps) {
  return (
    <button type="button" className={cn("pa-round", className)} aria-label={label} onClick={onClick} style={style}>
      <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden>
        <path d="M2 2 L12 12 M12 2 L2 12" />
      </svg>
    </button>
  );
}
