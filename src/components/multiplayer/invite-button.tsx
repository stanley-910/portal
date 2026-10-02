"use client";

import { useState } from "react";

/** Copies the trip's URL, which is its invite (M7). */
export function InviteButton() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(window.location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="type-tag h-9 rounded-tag border-(length:--line-hair) border-ink bg-paper-raised px-(--space-3) shadow-tag"
    >
      <span aria-live="polite">{copied ? "Link copied" : "Copy invite link"}</span>
    </button>
  );
}
