import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth/next";
import { MAX_NAME } from "@/lib/auth/limits";
import { getCurrentUser } from "@/lib/supabase/server";
import { signUp } from "../actions";
import { AuthForm } from "../auth-form";

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next: raw } = await searchParams;
  const next = safeNext(Array.isArray(raw) ? raw[0] : raw);
  if (await getCurrentUser()) redirect(next);
  return <AuthForm mode="signup" action={signUp} next={next} maxName={MAX_NAME} />;
}
