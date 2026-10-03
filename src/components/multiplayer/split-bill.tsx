"use client";

import { useSelf } from "@liveblocks/react";
import { forwardRef, useRef } from "react";

import { BesidePanel, useBeside } from "@/components/multiplayer/beside";
import { PixelIcon } from "@/components/paper-atlas";
import { TripSplit } from "@/components/multiplayer/trip-split";
import { formatMoney, sumIn, type Currency, type ExchangeRates } from "@/lib/currency";
import { useCurrencyPref } from "@/lib/currency-pref";
import { useExchangeRates } from "@/lib/exchange-rates";
import { usePlanLegs, usePlanMembers, usePlanStays, useSplit } from "@/lib/trip/plan";

// The bill: who owes what. Its button sits beside the plan's expand or minimise button, in the card's header or the
// dock it folds into, and the bill opens from it: beside the card (`CardBill`), or down from under the dock.

/** A member's totals in the picked currency, else each in its own: "$1,240", or "¥24,000 + $412" without rates. */
const shareText = (totals: Record<string, number>, currency: Currency, rates: ExchangeRates | null) => {
  const sum = sumIn(totals, currency, rates);
  return sum === null ? Object.entries(totals).map(([c, amount]) => formatMoney({ amount, currency: c })).join(" + ") : formatMoney({ amount: sum, currency });
};

/** Your share of the trip in the picked currency, or null with nothing priced yet. */
export function useMyShare(): string | null {
  const me = useSelf((s) => s.id);
  const split = useSplit();
  const currency = useCurrencyPref();
  const rates = useExchangeRates();
  const mine = me ? split?.members[me]?.totals : null;
  return mine && Object.keys(mine).length ? shareText(mine, currency, rates) : null;
}

/** Your share, then everyone's totals opening to their fares and nights. Null until the plan has loaded. */
export function BillContent() {
  const me = useSelf((s) => s.id);
  const legs = usePlanLegs();
  const split = useSplit();
  const members = usePlanMembers();
  const stays = usePlanStays();
  const currency = useCurrencyPref();
  const rates = useExchangeRates();
  if (!legs?.length || !split || !members) return null;
  const mine = me ? split.members[me]?.totals : null;
  return (
    <>
      {mine && Object.keys(mine).length ? <div className="tp-total">Your share: {shareText(mine, currency, rates)}</div> : null}
      <TripSplit split={split} legs={legs} members={members} stays={stays ?? []} me={me ?? null} currency={currency} rates={rates} />
    </>
  );
}

/** The bill's button: a receipt, pressed while the bill is open. */
// The bill in Pip's pixels, like the passport beside each leg: a solid slip with its lines cut out and a torn foot.
const RECEIPT = [
  "###########",
  "###########",
  "##ooooooo##",
  "###########",
  "##ooooooo##",
  "###########",
  "##oooo#####",
  "###########",
  "#####ooo###",
  "###########",
  "###########",
  "## ## ## ##",
  "#  #  #  # ",
];

export const BillButton = forwardRef<HTMLButtonElement, { open: boolean; onToggle: () => void; controls: string }>(function BillButton(
  { open, onToggle, controls },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className="tp-dock-btn sb-button"
      aria-label="Split"
      title="Split"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
<PixelIcon rows={RECEIPT} />
    </button>
  );
});

/** The bill in the plan card's header: its button, and the bill beside the card, level with it, until it's closed. */
export function CardBill() {
  const { open, toggle, close } = useBeside("bill");
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <BillButton ref={button} open={open} onToggle={toggle} controls="split-bill" />
      {open ? (
        <BesidePanel id="split-bill" label="Split" align={button} trigger={button} onClose={close} stays>
          <BillContent />
        </BesidePanel>
      ) : null}
    </>
  );
}
