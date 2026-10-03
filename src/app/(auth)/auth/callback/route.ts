import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { panelUrl } from "@/lib/auth/panel-url";
import { safeNext } from "@/lib/auth/next";
import { createSupabaseServer } from "@/lib/supabase/server";
import { adoptGuest } from "@/lib/trip/adopt";

// Google sign-in and confirmation-email links land here with a one-time code. Swapping it for a session sets the
// auth cookies, then you're back where you started. A failure reopens the sign-in panel there with a reason.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
  const via = searchParams.get("via") === "email" ? "email" : "google";
  const code = searchParams.get("code");
  const supabase = await createSupabaseServer();
  if (code && supabase) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // trips joined as a guest before signing in come along
      await adoptGuest(data.user.id);
      redirect(next);
    }
    console.warn("[auth] code exchange failed:", error.status, error.code);
  } else if (searchParams.has("error")) {
    // Supabase couldn't finish with the provider (e.g. a wrong Google client secret) and says why.
    console.warn("[auth] provider error:", searchParams.get("error_code"), searchParams.get("error_description"));
  }
  redirect(panelUrl(next, "signin", via));
}
