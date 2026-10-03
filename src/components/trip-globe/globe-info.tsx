"use client";

import { Popover } from "@base-ui/react/popover";
import type { PointerEvent } from "react";

const stop = (event: PointerEvent) => event.stopPropagation();

const SOURCES = [
  { label: "OurAirports", href: "https://ourairports.com/data/" },
  { label: "Wikidata", href: "https://www.wikidata.org/" },
  { label: "© OpenStreetMap contributors", href: "https://www.openstreetmap.org/copyright" },
];

/** Credits stay out of the globe until requested. */
export function GlobeInfo() {
  return (
    <div
      className="absolute bottom-(--space-3) left-(--space-3)"
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      <Popover.Root>
        <Popover.Trigger className="pa-round pa-round-sm" aria-label="About" title="About">
          <svg width="14" height="14" viewBox="0 0 18 18" aria-hidden="true">
            <circle cx="9" cy="4.6" r="1.1" fill="currentColor" stroke="none" />
            <path d="M7.4 7.8H9v6.4M7 14.2h4" strokeLinejoin="round" />
          </svg>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="top" align="start" sideOffset={8} className="z-50">
            <Popover.Popup className="w-[min(14rem,calc(100vw-2*var(--space-3)))] rounded-control border border-line bg-paper-raised px-(--space-gap) py-(--space-2) text-ink shadow-float">
              <Popover.Title className="type-label">Trip Globe</Popover.Title>
              <Popover.Description className="type-caption text-ink-muted">
                HKU Hackathon 2026
              </Popover.Description>
              <p className="type-caption mt-(--space-2)">Stanley Wang, Ahmet Sukru Kilic, Andrei Catalin Petre</p>
              <div className="mt-(--space-2) border-t border-line pt-(--space-2)">
                <p className="type-caption text-ink-muted">Hub data</p>
                <ul className="type-caption flex flex-wrap gap-x-(--space-gap) gap-y-(--space-1)">
                  {SOURCES.map((source) => (
                    <li key={source.href}>
                      <a
                        className="underline decoration-line underline-offset-2 hover:decoration-ink"
                        href={source.href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {source.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
