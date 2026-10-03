import type { SoloCheckoutActions } from "@/components/ticket-search/solo-checkout";

// Book on the playground's home globe: checkout's own states in turn, with no trip, seat or payment behind them. The
// fare moves once, so the price-change notice shows; the details want a passport; paying lands on "done".

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const WAS = { amount: 165, currency: "USD" };
const NOW = { amount: 172, currency: "USD" };

export const CHECKOUT_STAND_IN: SoloCheckoutActions = {
  start: async (_trip, _leg, accept) => {
    await wait(700);
    if (!accept) return { ok: false, code: "PRICE_CHANGED", was: WAS, now: NOW };
    return { ok: true, step: "details", documents: true, share: NOW };
  },
  finish: async () => {
    await wait(900);
    return { ok: true, url: null };
  },
};
