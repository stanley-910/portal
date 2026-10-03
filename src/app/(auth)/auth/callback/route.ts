import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { safeNext } from "@/lib/auth/next";
import { createSupabaseServer } from "@/lib/supabase/server";

// Google sign-in lands here with a one-time code. Swapping it for a session sets the auth cookies.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
  const code = searchParams.get("code");
  const supabase = await createSupabaseServer();
  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) redirect(next);
    console.warn("[auth] code exchange failed:", error.status, error.code);
  }
  const login = new URLSearchParams({ error: "google" });
  if (next !== "/") login.set("next", next);
  redirect(`/login?${login}`);
}
