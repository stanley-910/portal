"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

/** Which form the sign-in panel shows. It opens over any screen when the URL has `?auth=<mode>`. */
export type AuthMode = "signin" | "signup";

export const AUTH_PARAM = "auth";

/** The current page with the sign-in panel open, or closed when `mode` is null. Keeps the page's other params. */
export function authHref(pathname: string, search: URLSearchParams | string, mode: AuthMode | null): string {
  const params = new URLSearchParams(search);
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

/** What a guest was doing when they hit sign-in, so it carries on once they're signed in. */
export type PendingAction = { type: "save"; input: unknown } | { type: "create" } | { type: "pip"; text: string };

const PENDING_KEY = "portal:after-sign-in";

export function setPendingAction(action: PendingAction) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(action));
  } catch {
    // storage blocked: they redo the action after signing in
  }
}

/** Reads and clears the pending action. */
export function takePendingAction(): PendingAction | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingAction) : null;
  } catch {
    return null;
  }
}
