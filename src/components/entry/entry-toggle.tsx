"use client";

import { useRef } from "react";

import { BesidePanel, useBeside } from "@/components/multiplayer/beside";
import type { LegEntryInput } from "@/lib/entry";

import { EntryPanel, PassportIcon, type EntryRider } from "./entry-panel";

/**
 * The passport button on a leg, and the riders' entry rules beside the card it's in, like the bill. Needs a
 * `BesideProvider` round the card. `id` keeps one leg's panel apart from another's.
 */
export function EntryToggle({ id, leg, riders, label, className }: { id: string; leg: LegEntryInput; riders: EntryRider[]; label?: string; className?: string }) {
  const { open, toggle, close } = useBeside(`entry:${id}`);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        className={className ?? "en-btn"}
        aria-label={label ? undefined : "Entry requirements"}
        title="Entry requirements"
        aria-expanded={open}
        aria-controls={`entry-${id}`}
        onClick={toggle}
      >
        <PassportIcon />
        {label ? <span>{label}</span> : null}
      </button>
      {open ? (
        <BesidePanel id={`entry-${id}`} label="Entry requirements" align={button} trigger={button} onClose={close}>
          <EntryPanel leg={leg} riders={riders} />
        </BesidePanel>
      ) : null}
    </>
  );
}
