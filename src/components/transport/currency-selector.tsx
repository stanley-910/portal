"use client";

import { useState } from "react";
import { CURRENCIES, type Currency, type ExchangeRates } from "@/lib/currency";

export function CurrencySelector({ currency, rates, error, onChange }: {
  currency: Currency;
  rates: ExchangeRates | null;
  error: boolean;
  onChange: (currency: Currency) => void;
}) {
  const [open, setOpen] = useState(false);
  return <div className="relative">
    <button type="button" aria-label="Display currency" aria-expanded={open} aria-haspopup="listbox"
      className="type-tag min-h-11 rounded-tag border border-ink bg-paper-raised px-(--space-3) text-ink shadow-tag"
      onClick={() => setOpen((visible) => !visible)}>{currency}</button>
    {open ? <div className="absolute top-full right-0 z-10 mt-(--space-2) flex flex-col gap-(--space-1) rounded-ticket border border-ink bg-paper-raised p-(--space-2) text-ink shadow-ticket" role="listbox" aria-label="Currency">
      {CURRENCIES.map((option) => <button key={option} type="button" role="option"
        aria-selected={option === currency} disabled={option !== "USD" && !rates}
        className="type-tag min-h-11 rounded-tag px-(--space-3) text-left hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => { onChange(option); setOpen(false); }}>
        {option === "EUR" ? "EUR · Euro" : option}
      </button>)}
      {error ? <p className="type-meta w-44 px-(--space-2) pb-(--space-1) text-ink-muted">Live rates unavailable. Original fares remain visible.</p> : null}
    </div> : null}
  </div>;
}
