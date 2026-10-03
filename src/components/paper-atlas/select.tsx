"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

// A drop-down in Paper Atlas print, in place of the browser's own select. The list opens in a layer over the page, so
// a card that clips or scrolls can't cut it off. It takes part in forms like a select: `name` posts its value, and
// `required` stops a submit with nothing picked.

export type SelectOption = { value: string; label: string; icon?: ReactNode };

export interface SelectProps {
  options: readonly SelectOption[];
  /** Controlled value. Leave it out and use `defaultValue` inside a form that reads FormData. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Shown while nothing is picked. */
  placeholder?: string;
  name?: string;
  required?: boolean;
  /** A filter box at the top of the list, for long lists such as countries. */
  searchable?: boolean;
  disabled?: boolean;
  className?: string;
  /** Drawn as a card field instead (ticket-search's `.ts-field`): this small label over the value. */
  label?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
}

/** Keep the list at least this far from the window's edges. */
const EDGE = 8;
const LIST_MAX = 260;

export function Select({
  options,
  value,
  defaultValue = "",
  onChange,
  placeholder = "Pick",
  name,
  required,
  searchable = false,
  disabled,
  className,
  label,
  ...aria
}: SelectProps) {
  const [own, setOwn] = useState(defaultValue);
  const current = value ?? own;
  const picked = options.find((o) => o.value === current);
  const [open, setOpen] = useState(false);
  // a required field left empty when the form was sent, until something is picked
  const [missing, setMissing] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [frame, setFrame] = useState<CSSProperties | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();

  const shown = query ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase())) : options;

  const choose = (next: string) => {
    if (value === undefined) setOwn(next);
    setMissing(false);
    onChange?.(next);
    setOpen(false);
    button.current?.focus();
  };

  const show = () => {
    if (disabled) return;
    setQuery("");
    setActive(Math.max(0, options.findIndex((o) => o.value === current)));
    setOpen(true);
  };

  // below the button, or above it when there's more room there; it follows the button while the page scrolls
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = button.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - EDGE;
      const above = r.top - EDGE;
      const up = below < 160 && above > below;
      const width = Math.max(r.width, 160);
      setFrame({
        left: Math.min(Math.max(EDGE, r.left), window.innerWidth - width - EDGE),
        width,
        maxHeight: Math.min(LIST_MAX, up ? above - 4 : below - 4),
        ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (searchable) search.current?.focus();
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, searchable]);

  // the active option stays in view as the arrows move it
  useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const keys = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "Escape") {
      // the list closes, not whatever card it's in
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(shown.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[active]) choose(shown[active].value);
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (!searchable && e.key.length === 1) {
      // type a few letters to jump to an option, as a select does
      const now = Date.now();
      typed.current = { text: now - typed.current.at > 700 ? e.key : typed.current.text + e.key, at: now };
      const hit = shown.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text.toLowerCase()));
      if (hit >= 0) setActive(hit);
    }
  };

  return (
    <span className={cn("pa-select", className)}>
      <button
        ref={button}
        type="button"
        className={label ? "pa-select-button ts-field pa-select-field" : "pa-select-button"}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={aria["aria-label"] ?? (label ? `${label}: ${picked?.label ?? placeholder}` : undefined)}
        aria-invalid={aria["aria-invalid"] || missing || undefined}
        aria-activedescendant={open && !searchable && shown[active] ? `${listId}-${active}` : undefined}
        disabled={disabled}
        data-empty={!picked?.value || undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={keys}
      >
        {label ? <span className="ts-field-label">{label}</span> : null}
        {picked?.icon ? <span className="pa-select-icon">{picked.icon}</span> : null}
        <span className={label ? "pa-select-value ts-field-value" : "pa-select-value"}>{picked?.label ?? placeholder}</span>
        <svg className="pa-select-chevron" width={10} height={10} viewBox="0 0 10 10" aria-hidden>
          <path d={open ? "M2 6.5 5 3.5 8 6.5" : "M2 3.5 5 6.5 8 3.5"} />
        </svg>
      </button>
      {/* what the form posts and checks; unseen. A failed check marks the button instead of the browser's bubble,
          which would vanish as focus moves to it */}
      {name ? (
        <input
          className="pa-select-native"
          tabIndex={-1}
          aria-hidden
          name={name}
          value={current}
          required={required}
          onChange={() => {}}
          onFocus={() => button.current?.focus()}
          onInvalid={(e) => {
            e.preventDefault();
            setMissing(true);
            button.current?.focus();
          }}
        />
      ) : null}
      {open && frame
        ? createPortal(
            <div ref={list} className="pa-select-list" style={frame} onKeyDown={keys}>
              {searchable ? (
                <input
                  ref={search}
                  className="pa-select-search"
                  value={query}
                  placeholder="Search"
                  aria-label="Search"
                  aria-controls={listId}
                  aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                />
              ) : null}
              <div id={listId} role="listbox" aria-label={aria["aria-label"] ?? label} className="pa-select-options">
                {shown.map((o, i) => (
                  <div
                    key={o.value}
                    role="option"
                    id={`${listId}-${i}`}
                    aria-selected={o.value === current}
                    data-index={i}
                    data-active={i === active || undefined}
                    className="pa-select-option"
                    onPointerEnter={() => setActive(i)}
                    onClick={() => choose(o.value)}
                  >
                    {o.icon ? <span className="pa-select-icon">{o.icon}</span> : null}
                    <span className="pa-select-label">{o.label}</span>
                    {o.value === current ? (
                      <svg className="pa-select-check" width={12} height={12} viewBox="0 0 16 16" aria-hidden>
                        <path d="M3 8.4l3.2 3.1L13 4.6" />
                      </svg>
                    ) : null}
                  </div>
                ))}
                {shown.length ? null : <p className="pa-select-empty">Nothing matches “{query}”</p>}
              </div>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
