import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabaseConfig } from "./config";
import { parseNationalities } from "@/lib/nationality";

export type CurrentUser = { id: string; email: string; displayName: string; nationalities: string[] };

let warnedUnconfigured = false;

/** Cookie-bound server client, or null when the Supabase env vars are missing. */
export async function createSupabaseServer(): Promise<SupabaseClient | null> {
  const config = supabaseConfig();
  if (!config) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn("[supabase] NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY not set; accounts are off.");
    }
    return null;
  }
  const cookieStore = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components can't set cookies; src/proxy.ts refreshes the session instead.
        }
      },
    },
  });
}

/** The signed-in user, verified with Supabase (getUser, never getSession). */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createSupabaseServer();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    const { id, email = "" } = data.user;
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", id)
      .maybeSingle<{ display_name: string }>();
    const metaName = data.user.user_metadata?.display_name;
    const displayName =
      profile?.display_name || (typeof metaName === "string" && metaName.trim()) || email.split("@")[0] || "Traveller";
    // passports live in the user's own metadata, not the profiles table: nobody else needs to read them
    return { id, email, displayName, nationalities: parseNationalities(data.user.user_metadata?.nationalities) };
  } catch (err) {
    // Supabase unreachable (paused project, network): treat as signed out so `/` keeps working.
    console.warn("[supabase] getUser failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** The name on a user's profile, or null when they have none or Supabase can't say. Never throws. */
export async function profileName(id: string): Promise<string | null> {
  const supabase = await createSupabaseServer();
  if (!supabase) return null;
  try {
    const { data } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", id)
      .maybeSingle<{ display_name: string }>();
    return data?.display_name?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Who's signed in, from the session's verified token claims: no profile lookup, and with asymmetric signing keys no
 * network call at all. For hot paths that only need to know it's an account and what to call them, like each message
 * to Pip; the name is the account's own, not the profile's, and the passports are the ones saved on the account.
 */
export async function getAccountClaims(): Promise<{ id: string; name: string; nationalities: string[] } | null> {
  const supabase = await createSupabaseServer();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (error || !claims?.sub) return null;
    const meta = claims.user_metadata as { display_name?: unknown; nationalities?: unknown } | undefined;
    const email = typeof claims.email === "string" ? claims.email : "";
    const name = (typeof meta?.display_name === "string" && meta.display_name.trim()) || email.split("@")[0] || "Traveller";
    // saveNationalities refreshes the session, so the token's copy of the passports is current
    return { id: claims.sub, name, nationalities: parseNationalities(meta?.nationalities) };
  } catch (err) {
    console.warn("[supabase] getClaims failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
