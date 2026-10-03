import { safeNext } from "./next";

/** Why the panel reopened after a round trip that didn't finish: Google, or a confirmation email's link. */
export type AuthError = "google" | "email";

/** Where `/login?next=…` and `/signup?next=…` send you: that page, with the sign-in panel open over it. */
export function panelUrl(rawNext: unknown, mode: "signin" | "signup", error?: AuthError): string {
  const url = new URL(safeNext(rawNext), "http://local");
  url.searchParams.set("auth", mode);
  if (error) url.searchParams.set("auth_error", error);
  return `${url.pathname}${url.search}`;
}
