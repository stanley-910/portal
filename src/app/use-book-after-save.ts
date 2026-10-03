"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { peekPendingAction, setPendingAction } from "@/components/auth/links";
import { isBookable } from "@/lib/trip/offers";

// Book on the home globe: booking needs a trip room, so it saves the trip like Save trip, then checks out its leg in
// the fare card (`SoloCheckout`), without leaving the globe. Guests sign in first; the save that resumes after
// carries Book with it.

type SavedInput = { legs?: { chosen?: string | null; offers?: { id: string; provider: string; kind: string }[] }[] };

export type BookTarget = { tripId: string; legId: string };

/** The saved trip's first leg whose pick can be bought in the app. */
export function bookingTarget(result: { id: string; legs?: string[] }, input: unknown): BookTarget | null {
  const legs = (input as SavedInput).legs ?? [];
  const i = legs.findIndex((l) => l.offers?.some((o) => o.id === l.chosen && isBookable(o)));
  const legId = i >= 0 ? result.legs?.[i] : undefined;
  return legId ? { tripId: result.id, legId } : null;
}

export function useBookAfterSave(account: boolean) {
  const wanted = useRef(false);
  const last = useRef<BookTarget | null>(null);
  const [checkout, setCheckout] = useState<BookTarget | null>(null);

  // back from signing in to Book: the save that resumes opens the checkout. Runs before the page takes the action.
  useEffect(() => {
    const pending = account ? peekPendingAction() : null;
    if (pending?.type === "save" && pending.book) wanted.current = true;
  }, [account]);

  const actions = useMemo(
    () => ({
      /** Book was pressed, after the save it started (or with the trip already saved). */
      request(alreadySaved: boolean) {
        if (alreadySaved && last.current) return setCheckout(last.current);
        wanted.current = true;
        // a guest's save waits for sign-in: mark it so it checks out once it's done
        const pending = account ? null : peekPendingAction();
        if (pending?.type === "save") setPendingAction({ ...pending, book: true });
      },
      /** A save finished. Opens the checkout when Book asked for it, and says whether it did. */
      after(result: { id: string; legs?: string[] }, input: unknown): boolean {
        last.current = bookingTarget(result, input);
        if (!wanted.current) return false;
        wanted.current = false;
        setCheckout(last.current);
        return !!last.current;
      },
      cancel() {
        wanted.current = false;
      },
      close() {
        setCheckout(null);
      },
    }),
    [account],
  );
  return { ...actions, checkout };
}
