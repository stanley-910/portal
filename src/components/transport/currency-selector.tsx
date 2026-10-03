"use client";

import { MenuChoices, MenuSection } from "@/components/nav-bar";
import { CURRENCIES, type Currency, type ExchangeRates } from "@/lib/currency";

// each choice shows its symbol; the name is its tooltip and what a screen reader says
const CURRENCY_SYMBOLS: Record<Currency, string> = { USD: "$", EUR: "€", CNY: "¥", HKD: "HK$", CAD: "C$" };

const CURRENCY_NAMES: Record<Currency, string> = {
  USD: "US dollar",
  EUR: "Euro",
  CNY: "Chinese yuan",
  HKD: "Hong Kong dollar",
  CAD: "Canadian dollar",
};

/** The fare currency, as a section of the profile menu. Only USD works until live rates load. */
export function CurrencySetting({ currency, rates, error, onChange }: {
  currency: Currency;
  rates: ExchangeRates | null;
  error: boolean;
  onChange: (currency: Currency) => void;
}) {
  return (
    <MenuSection title="Currency">
      <MenuChoices
        name="currency"
        label="Currency"
        value={currency}
        options={CURRENCIES.map((option) => ({
          value: option,
          label: CURRENCY_SYMBOLS[option],
          title: CURRENCY_NAMES[option],
          disabled: option !== "USD" && !rates,
        }))}
        onChange={onChange}
      />
      {error ? <p className="type-caption text-ink-muted">Live rates unavailable. Original fares remain visible.</p> : null}
    </MenuSection>
  );
}
