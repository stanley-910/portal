"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

import { peekPendingAction, setPendingAction } from "@/components/auth/links";
import { isBookable } from "@/lib/trip/offers";

// Book on the home globe: booking needs a trip room, so it saves the trip like Save trip, then opens it at the leg
// to settle (`/t/<id>?book=<leg>`). Guests sign in first; the save that resumes after carries the Book with it.

type SavedInput = { legs?: { chosen?: string | null; offers?: { id: string; provider: string; kind: string }[] }[] };

/** The saved trip, at its first leg whose pick can be bought in the app. */
export function bookingHref(result: { id: string; legs?: string[] }, input: unknown): string {
  const legs = (input as SavedInput).legs ?? [];
  const i = legs.findIndex((l) => l.offers?.some((o) => o.id === l.chosen && isBookable(o)));
  const legId = i >= 0 ? result.legs?.[i] : undefined;
  return legId ? `/t/${result.id}?book=${encodeURIComponent(legId)}` : `/t/${result.id}`;
}

export function useBookAfterSave(account: boolean) {
  const router = useRouter();
  const wanted = useRef(false);
  const last = useRef<string | null>(null);

  // back from signing in to Book: the save that resumes opens the trip. Runs before the page takes the action.
  useEffect(() => {
    const pending = account ? peekPendingAction() : null;
    if (pending?.type === "save" && pending.book) wanted.current = true;
  }, [account]);

  return useMemo(
    () => ({
      /** Book was pressed, after the save it started (or with the trip already saved). */
      request(alreadySaved: boolean) {
        if (alreadySaved && last.current) return router.push(last.current);
        wanted.current = true;
        // a guest's save waits for sign-in: mark it so it opens the trip once it's done
        const pending = account ? null : peekPendingAction();
        if (pending?.type === "save") setPendingAction({ ...pending, book: true });
      },
      /** A save finished. Opens the trip when Book asked for it, and says whether it did. */
      after(result: { id: string; legs?: string[] }, input: unknown): boolean {
        last.current = bookingHref(result, input);
        if (!wanted.current) return false;
        wanted.current = false;
        router.push(last.current);
        return true;
      },
      cancel() {
        wanted.current = false;
      },
    }),
    [account, router],
  );
}
