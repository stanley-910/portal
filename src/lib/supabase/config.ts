export type SupabaseConfig = { url: string; key: string };

export function parseSupabaseConfig(
  url: string | undefined,
  key: string | undefined,
): SupabaseConfig | null {
  const u = url?.trim();
  const k = key?.trim();
  return u && k ? { url: u, key: k } : null;
}

// Literal `process.env.NEXT_PUBLIC_*` reads so Next inlines them into the browser bundle.
// Missing vars mean accounts are off, never a boot failure (ADR-C04).
export function supabaseConfig(): SupabaseConfig | null {
  return parseSupabaseConfig(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function supabaseConfigured(): boolean {
  return supabaseConfig() !== null;
}
