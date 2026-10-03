import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface RoundButtonProps {
  /** Accessible name, e.g. "Cancel trip". Default "Close". */
  label?: string;
  /** A 16px inline stroke SVG in place of the close glyph. */
  icon?: ReactNode;
  /** "float" (default): a raised, bordered disc for controls over the globe. "quiet": the bare glyph, for a panel's own corner. */
  variant?: "float" | "quiet";
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
}

/** A 44px round icon button, mostly close. Floats over the globe, or sits quietly in a panel's corner. */
export function RoundButton({ label = "Close", icon, variant = "float", onClick, className, style }: RoundButtonProps) {
  return (
    <button type="button" className={cn("pa-round", variant === "quiet" && "pa-round-quiet", className)} aria-label={label} title={icon ? label : undefined} onClick={onClick} style={style}>
      {icon ?? (
        <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden>
          <path d="M2 2 L12 12 M12 2 L2 12" />
        </svg>
      )}
    </button>
  );
}
