"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { countryName, flagEmoji, MAX_NATIONALITIES, searchCountries } from "@/lib/nationality";

/**
 * The passports you hold: chips for the ones picked, and a search box that fuzzy-finds countries and ticks them on
 * and off, several at a time. Arrow keys move through the list, Enter ticks, Backspace in an empty box drops the
 * last chip, Escape closes the list.
 */
export function PassportPicker({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // a click anywhere outside the picker closes the list, once that click has landed. Not on blur or pointerdown:
  // closing then would shift the menu up under a click that's already on its way somewhere else
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("click", away);
    return () => document.removeEventListener("click", away);
  }, [open]);
  const listId = useId();
  const full = value.length >= MAX_NATIONALITIES;
  const results = open ? searchCountries(query).slice(0, 60) : [];

  const remove = (code: string) => onChange(value.filter((c) => c !== code));
  const toggle = (code: string) => {
    if (value.includes(code)) remove(code);
    else if (!full) onChange([...value, code]);
    input.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => Math.max(0, Math.min(results.length - 1, i + step)));
    } else if (e.key === "Enter" && open && results[active]) {
      e.preventDefault();
      toggle(results[active].code);
    } else if (e.key === "Escape" && open) {
      // the list closes first; the menu only on a second Escape
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "Backspace" && !query && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div ref={root} className="pn-pp">
      {value.length ? (
        <ul className="pn-pp-chips" aria-label="Your passports">
          {value.map((code) => (
            <li key={code} className="pn-pp-chip">
              <span aria-hidden>{flagEmoji(code)}</span>
              <span>{countryName(code)}</span>
              <button type="button" className="pn-pp-remove" aria-label={`Remove ${countryName(code)}`} onClick={() => remove(code)}>
                <svg width={10} height={10} viewBox="0 0 12 12" aria-hidden>
                  <path d="M3 3l6 6M9 3l-6 6" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="pn-pp-field">
        <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden className="pn-pp-search">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14" />
        </svg>
        <input
          ref={input}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && results[active] ? `${listId}-${results[active].code}` : undefined}
          aria-label="Search countries to add a passport"
          placeholder={value.length ? "Add another country" : "Search countries"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
        />
        {open ? (
          <button type="button" className="pn-pp-done" onClick={() => setOpen(false)}>
            Done
          </button>
        ) : null}
      </div>
      {open ? (
        <ul id={listId} role="listbox" aria-multiselectable="true" aria-label="Countries" className="pn-pp-list">
          {results.length ? (
            results.map((c, i) => {
              const on = value.includes(c.code);
              return (
                <li
                  key={c.code}
                  id={`${listId}-${c.code}`}
                  role="option"
                  aria-selected={on}
                  aria-disabled={!on && full}
                  data-active={i === active || undefined}
                  className="pn-pp-option"
                  onMouseEnter={() => setActive(i)}
                  // keep focus in the box, so the list stays open while ticking several
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggle(c.code)}
                >
                  <span className="pn-pp-check" aria-hidden>
                    {on ? (
                      <svg width={10} height={10} viewBox="0 0 12 12">
                        <path d="M2.5 6.2 5 8.6 9.6 3.6" />
                      </svg>
                    ) : null}
                  </span>
                  <span aria-hidden>{flagEmoji(c.code)}</span>
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                </li>
              );
            })
          ) : (
            <li className="pn-pp-empty">No country matches “{query}”</li>
          )}
        </ul>
      ) : null}
      {full && open ? <p className="type-meta text-ink-muted">Up to {MAX_NATIONALITIES} passports.</p> : null}
    </div>
  );
}
