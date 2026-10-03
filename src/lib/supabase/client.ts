"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";

let client: SupabaseClient | null = null;

/** Browser client singleton, or null when the Supabase env vars are missing. */
export function createSupabaseBrowser(): SupabaseClient | null {
  if (client) return client;
  const config = supabaseConfig();
  if (!config) return null;
  client = createBrowserClient(config.url, config.key);
  return client;
}
