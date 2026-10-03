"use client";

import { useEffect, useState } from "react";

import { CURRENCIES, type ExchangeRates } from "@/lib/currency";

/** Today's rates from `/api/exchange-rates`, for converting prices to the picked currency. Null until loaded or if they fail. */
export function useExchangeRates(): ExchangeRates | null {
  const [rates, setRates] = useState<ExchangeRates | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/exchange-rates", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const result = (await response.json()) as { rates?: ExchangeRates };
        const valid = CURRENCIES.every((c) => Number.isFinite(result.rates?.[c]) && result.rates![c] > 0);
        if (valid && !controller.signal.aborted) setRates(result.rates!);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return rates;
}
