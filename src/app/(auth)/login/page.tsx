import { redirect } from "next/navigation";

import { panelUrl } from "@/lib/auth/panel-url";

/** Sign-in is a panel over the app; this address opens it over the page in `next`. */
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  redirect(panelUrl(Array.isArray(next) ? next[0] : next, "signin"));
}
