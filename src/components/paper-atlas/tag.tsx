import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface TagProps {
  /** The three-letter airport code. Nothing else goes in a tag. */
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** A small printed label naming the airport at a point on the globe. */
export function Tag({ children, className, style }: TagProps) {
  return (
    <span className={cn("pa-tag", className)} style={style}>
      {children}
    </span>
  );
}
