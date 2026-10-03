"use client";

import { useSyncExternalStore } from "react";

import { isCurrency, type Currency } from "@/lib/currency";

// The display currency picked in this browser: a personal convenience, so local storage rather than the account.
// Pip is told it with each message, so its answers can use it.

const KEY = "portal-currency";
const DEFAULT: Currency = "USD";
const listeners = new Set<() => void>();

/** The picked currency, for event handlers. Storage can be blocked, so it never throws. */
export function readCurrencyPref(): Currency {
  try {
    const raw = localStorage.getItem(KEY);
    return isCurrency(raw) ? raw : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const storage = (e: StorageEvent) => e.key === KEY && onChange();
  window.addEventListener("storage", storage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", storage);
  };
}

/** The picked currency. The server and the first client render use USD. */
export function useCurrencyPref(): Currency {
  return useSyncExternalStore(subscribe, readCurrencyPref, () => DEFAULT);
}

export function setCurrencyPref(currency: Currency) {
  try {
    localStorage.setItem(KEY, currency);
  } catch {}
  for (const l of listeners) l();
}
