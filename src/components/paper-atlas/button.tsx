import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface ButtonProps extends ComponentProps<"button"> {
  /** primary: ink fill, one per view. secondary: outlined. quiet: text only. Default primary. */
  variant?: "primary" | "secondary" | "quiet";
  /** A 16px inline stroke SVG shown before the label. */
  icon?: ReactNode;
  /** Stretch to the container's width. */
  block?: boolean;
}

/** The interface button: a verb plus its object in sentence case (`Search flights`). Needs `aria-label` without a label. */
export function Button({ variant = "primary", icon, block, type = "button", className, children, ...props }: ButtonProps) {
  return (
    <button type={type} className={cn("pa-btn", `pa-btn-${variant}`, block && "pa-btn-block", className)} {...props}>
      {icon ? (
        <span className="pa-btn-icon" aria-hidden>
          {icon}
        </span>
      ) : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}
