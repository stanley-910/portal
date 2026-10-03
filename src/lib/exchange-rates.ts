"use client";

import { useEffect, useState } from "react";

import { CURRENCIES, type ExchangeRates } from "@/lib/currency";

/** Today's rates from `/api/exchange-rates`, for converting prices to the picked currency. Null until loaded or if they fail. */
/** One request per page load, shared by every price on it. A failed one is dropped so the next mount tries again. */
let pending: Promise<ExchangeRates | null> | null = null;
let loaded: ExchangeRates | null = null;

function load() {
  pending ??= fetch("/api/exchange-rates")
    .then(async (response) => {
      if (!response.ok) return null;
      const result = (await response.json()) as { rates?: ExchangeRates };
      const valid = CURRENCIES.every((c) => Number.isFinite(result.rates?.[c]) && result.rates![c] > 0);
      return valid ? (loaded = result.rates!) : null;
    })
    .catch(() => null)
    .then((rates) => {
      if (!rates) pending = null;
      return rates;
    });
  return pending;
}

export function useExchangeRates(): ExchangeRates | null {
  const [rates, setRates] = useState<ExchangeRates | null>(loaded);
  useEffect(() => {
    let live = true;
    load().then((r) => live && r && setRates(r));
    return () => {
      live = false;
    };
  }, []);
  return rates;
}
