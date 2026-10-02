"use client";

import { useState } from "react";

export function DatePicker({ value, min, onChange }: {
  value: string; min: string; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return <div className="fixed right-(--space-4) bottom-(--space-4) z-10 flex flex-col items-end gap-(--space-2)">
    {open ? <div className="rounded-ticket border border-ink bg-paper-raised p-(--space-3) shadow-ticket">
      <label className="flex flex-col gap-(--space-2)">
        <span className="type-tag text-ink">Departure date</span>
        <input type="date" value={value} min={min}
          onChange={(event) => { if (event.target.value) onChange(event.target.value); }}
          className="type-stamp min-h-11 rounded-tag border border-ink bg-paper px-(--space-2) text-ink focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-(--focus)" />
      </label>
    </div> : null}
    <button type="button" aria-expanded={open}
      aria-label={open ? "Close departure date picker" : "Choose departure date"}
      onClick={() => setOpen((visible) => !visible)} className="pa-round type-stamp px-2">
      <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
        <rect x="2" y="3.5" width="12" height="10" rx="1" />
        <path d="M5 2v3M11 2v3M2 6.5h12" />
      </svg>
      <span className="sr-only">{value}</span>
    </button>
  </div>;
}
