import { safeNext } from "./next";

/** Where `/login?next=…` and `/signup?next=…` send you: that page, with the sign-in panel open over it. */
export function panelUrl(rawNext: unknown, mode: "signin" | "signup"): string {
  const url = new URL(safeNext(rawNext), "http://local");
  url.searchParams.set("auth", mode);
  return `${url.pathname}${url.search}`;
}
