"use client";

import { useState } from "react";

import { NAV_ICONS, NavButton } from "@/components/nav-bar";

/** Copies the trip's URL, which is its invite (M7). */
export function InviteButton() {
  const [copied, setCopied] = useState(false);
  return (
    <NavButton
      icon={copied ? NAV_ICONS.check : NAV_ICONS.link}
      label={copied ? "Link copied" : "Copy invite link"}
      aria-live="polite"
      onClick={async () => {
        await navigator.clipboard.writeText(window.location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    />
  );
}
