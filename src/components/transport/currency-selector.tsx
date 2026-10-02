"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/paper-atlas";
import { NAV_ICONS } from "@/components/nav-bar";
import { CURRENCIES, type Currency, type ExchangeRates } from "@/lib/currency";

const CURRENCY_NAMES: Record<Currency, { name: string; symbol: string }> = {
  USD: { name: "US dollar", symbol: "$" },
  EUR: { name: "Euro", symbol: "€" },
  CNY: { name: "Chinese yuan", symbol: "¥" },
  HKD: { name: "Hong Kong dollar", symbol: "HK$" },
};

/** Main's navbar currency menu, shared with the click-to-hub results. */
export function CurrencySelector({ currency, rates, error, onChange }: {
  currency: Currency;
  rates: ExchangeRates | null;
  error: boolean;
  onChange: (currency: Currency) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return <div ref={root} className="relative">
    <button type="button" className="pa-round pn-currency"
      data-long={CURRENCY_NAMES[currency].symbol.length > 1 || undefined}
      aria-label={`Currency: ${currency}`} title={CURRENCY_NAMES[currency].name}
      aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((visible) => !visible)}>
      {CURRENCY_NAMES[currency].symbol}
    </button>
    {open ? <div className="pn-menu" role="listbox" aria-label="Currency">
      {CURRENCIES.map((option) => <Button key={option} variant="quiet" block role="option"
        aria-selected={option === currency} disabled={option !== "USD" && !rates}
        onClick={() => { onChange(option); setOpen(false); }}>
        <span className="pn-menu-symbol" aria-hidden>{CURRENCY_NAMES[option].symbol}</span>
        <span className="pn-menu-text"><span>{option}</span><span className="pn-menu-detail">{CURRENCY_NAMES[option].name}</span></span>
        {option === currency ? <svg className="pn-menu-check" width={16} height={16} viewBox="0 0 16 16" aria-hidden>{NAV_ICONS.check}</svg> : null}
      </Button>)}
      {error ? <p className="type-caption max-w-44 px-(--space-2) pb-(--space-1) text-ink-muted">Live rates unavailable. Original fares remain visible.</p> : null}
    </div> : null}
  </div>;
}
