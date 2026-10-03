"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AuthState } from "./actions";

type Props = {
  mode: "login" | "signup";
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
  next: string;
  maxName: number;
};

const input = "type-body h-11 rounded-tag border-(length:--line-hair) border-ink bg-paper px-(--space-2)";

export function AuthForm({ mode, action, next, maxName }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const signup = mode === "signup";
  const carry = next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
  return (
    <main className="grid min-h-dvh place-items-center bg-paper p-(--space-5)">
      <form
        action={formAction}
        className="flex w-full max-w-sm flex-col gap-(--space-3) rounded-ticket border-(length:--line-ink) border-ink bg-paper-raised p-(--space-5) shadow-ticket"
      >
        <h1 className="type-title">{signup ? "Create an account" : "Sign in"}</h1>
        <input type="hidden" name="next" value={next} />
        {signup && (
          <div className="flex flex-col gap-(--space-1)">
            <label htmlFor="name" className="type-meta">
              Display name
            </label>
            <input id="name" name="name" required maxLength={maxName} autoComplete="nickname" className={input} />
          </div>
        )}
        <div className="flex flex-col gap-(--space-1)">
          <label htmlFor="email" className="type-meta">
            Email
          </label>
          <input id="email" name="email" type="email" required autoComplete="email" className={input} />
        </div>
        <div className="flex flex-col gap-(--space-1)">
          <label htmlFor="password" className="type-meta">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={signup ? 8 : undefined}
            autoComplete={signup ? "new-password" : "current-password"}
            className={input}
          />
        </div>
        <p role="status" aria-live="polite" className="type-body min-h-6">
          {state.error ?? state.notice}
        </p>
        <button
          type="submit"
          disabled={pending}
          className="type-stamp h-11 rounded-tag border-(length:--line-ink) border-ink bg-ink text-paper-raised"
        >
          {signup ? "Sign up" : "Sign in"}
        </button>
        <p className="type-body text-ink-muted">
          {signup ? "Already have an account? " : "New here? "}
          <Link
            href={`${signup ? "/login" : "/signup"}${carry}`}
            className="inline-flex min-h-11 items-center text-ink underline"
          >
            {signup ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </form>
    </main>
  );
}
