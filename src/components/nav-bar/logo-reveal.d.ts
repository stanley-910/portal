import type { DetailedHTMLProps, HTMLAttributes } from "react";

// <portal-logo-reveal>, defined by design-system/paper-atlas/components/LogoReveal/logo-reveal.js.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "portal-logo-reveal": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        theme?: "day" | "night";
        duration?: string;
        grain?: string;
        swing?: "false";
        "replay-on-click"?: "false";
      };
    }
  }
}
