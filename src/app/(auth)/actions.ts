"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { MAX_NAME } from "@/lib/auth/limits";
import { safeNext } from "@/lib/auth/next";
import { createSupabaseServer } from "@/lib/supabase/server";

/** `ok`: signed in, so the panel reloads the page as the new account. */
export type AuthState = { error?: string; notice?: string; ok?: boolean };

const MSG = {
  wrong: "Email or password is wrong.",
  taken: "That email already has an account.",
  weak: "Use at least 8 characters.",
  generic: "Something went wrong. Try again.",
  off: "Accounts are not available right now.",
  confirm: "Check your email to confirm your account, then sign in.",
};

const credentials = z.object({ email: z.string().trim().email(), password: z.string().min(8) });
const signUpSchema = credentials.extend({ name: z.string().trim().min(1).max(MAX_NAME) });

const field = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = signUpSchema.safeParse({
    name: field(formData, "name"),
    email: field(formData, "email"),
    password: field(formData, "password"),
  });
  if (!parsed.success) {
    const paths = parsed.error.issues.map((i) => i.path[0]);
    if (paths.includes("password")) return { error: MSG.weak };
    if (paths.includes("name")) return { error: `Enter a name up to ${MAX_NAME} characters.` };
    return { error: "Enter a valid email." };
  }
  const supabase = await createSupabaseServer();
  if (!supabase) return { error: MSG.off };
  const { name, email, password } = parsed.data;
  const emailRedirectTo = (await callbackUrl(field(formData, "next"), "email")) ?? undefined;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: name }, emailRedirectTo },
  });
  if (error) {
    if (error.code === "weak_password") return { error: MSG.weak };
    if (error.code === "user_already_exists" || error.code === "email_exists") return { error: MSG.taken };
    if (error.code === "email_address_invalid") return { error: "Enter a valid email." };
    if (error.status === 429) return { error: "Too many attempts. Try again in a few minutes." };
    console.warn("[auth] signUp failed:", error.status, error.code);
    return { error: MSG.generic };
  }
  // With "Confirm email" on, an already-registered address returns an obfuscated user with no identities.
  if (data.user && data.user.identities?.length === 0) return { error: MSG.taken };
  if (!data.session) return { notice: MSG.confirm };
  return { ok: true };
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({ email: field(formData, "email"), password: field(formData, "password") });
  if (!parsed.success) return { error: MSG.wrong };
  const supabase = await createSupabaseServer();
  if (!supabase) return { error: MSG.off };
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: error.status && error.status >= 500 ? MSG.generic : MSG.wrong };
  return { ok: true };
}

/**
 * Where Google, or the link in a confirmation email, sends people back to: /auth/callback, which swaps the one-time
 * code for a session and returns them to `next`. Next has already checked that a Server Action's Origin matches the
 * host, and Supabase only redirects to URLs on its allow list.
 */
async function callbackUrl(next: unknown, via: "google" | "email"): Promise<string | null> {
  const origin = (await headers()).get("origin");
  if (!origin) return null;
  const url = new URL("/auth/callback", origin);
  url.searchParams.set("next", safeNext(next));
  url.searchParams.set("via", via);
  return url.toString();
}

/** Starts Google sign-in, the quickest way in: no password, and the email is already verified. */
export async function signInWithGoogle(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const supabase = await createSupabaseServer();
  if (!supabase) return { error: MSG.off };
  const redirectTo = await callbackUrl(field(formData, "next"), "google");
  if (!redirectTo) return { error: MSG.generic };
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
  if (error || !data.url) {
    console.warn("[auth] Google sign-in failed:", error?.status, error?.code);
    return { error: MSG.generic };
  }
  redirect(data.url);
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServer();
  await supabase?.auth.signOut();
  redirect("/");
}

const renameSchema = z.object({ name: z.string().trim().min(1).max(MAX_NAME) });

/** Changes the signed-in user's display name. RLS lets a user update only their own profile row. */
export async function renameProfile(formData: FormData): Promise<void> {
  const parsed = renameSchema.safeParse({ name: field(formData, "name") });
  if (!parsed.success) return;
  const supabase = await createSupabaseServer();
  const { data } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
  if (!supabase || !data.user) return;
  await supabase.from("profiles").update({ display_name: parsed.data.name }).eq("id", data.user.id);
}
