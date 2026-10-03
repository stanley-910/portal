"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

/** Which form the sign-in panel shows. It opens over any screen when the URL has `?auth=<mode>`. */
export type AuthMode = "signin" | "signup";

export const AUTH_PARAM = "auth";

/** The current page with the sign-in panel open, or closed when `mode` is null. Keeps the page's other params. */
export function authHref(pathname: string, search: URLSearchParams | string, mode: AuthMode | null): string {
  const params = new URLSearchParams(search);
  // a failed round trip's reason only shows on the panel it reopened
  params.delete("auth_error");
  if (mode) params.set(AUTH_PARAM, mode);
  else params.delete(AUTH_PARAM);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** The current page with the panel open or closed. Read at call time, so callers need no Suspense boundary. */
export function hereWithAuth(mode: AuthMode | null): string {
  return authHref(window.location.pathname, window.location.search, mode);
}

/** Opens (or switches, or closes with null) the panel without leaving the page, so its state stays. */
export function useOpenAuth() {
  const router = useRouter();
  return useCallback(
    (mode: AuthMode | null, { replace = false } = {}) => {
      const href = hereWithAuth(mode);
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [router],
  );
}

/**
 * What a guest was doing when they hit sign-in, so it carries on once they're signed in. `book` on a save: once saved,
 * open the trip at its booking instead of staying on the globe.
 */
export type PendingAction = { type: "save"; input: unknown; book?: boolean } | { type: "create" } | { type: "pip"; text: string };

const PENDING_KEY = "portal:after-sign-in";

export function setPendingAction(action: PendingAction) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ version: 1, action }));
  } catch {
    // storage blocked: they redo the action after signing in
  }
}

/** Reads and clears the pending action. */
export function takePendingAction(): PendingAction | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    return readPendingAction(raw);
  } catch {
    return null;
  }
}

/** Reads the pending action without clearing it. */
export function peekPendingAction(): PendingAction | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    return readPendingAction(raw);
  } catch {
    return null;
  }
}

/** Version the envelope, and refuse unknown/malformed intents before dispatching them. Save input is validated separately. */
export function readPendingAction(raw: string | null): PendingAction | null {
  if (!raw || raw.length > 1_200_000) return null;
  try {
    const envelope = JSON.parse(raw);
    if (envelope?.version !== 1) return null;
    const action = envelope.action;
    if (action?.type === "create") return { type: "create" };
    if (action?.type === "pip" && typeof action.text === "string" && action.text.length <= 2000) return { type: "pip", text: action.text };
    if (action?.type === "save" && action.input && typeof action.input === "object") return { type: "save", input: action.input, book: action.book === true };
  } catch {}
  return null;
}
