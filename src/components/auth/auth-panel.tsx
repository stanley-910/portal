"use client";

import { useSearchParams } from "next/navigation";
import { useActionState, useEffect, useId, useRef } from "react";

import { signIn, signUp, type AuthState } from "@/app/(auth)/actions";
import { Button, RoundButton } from "@/components/paper-atlas";
import { MAX_NAME } from "@/lib/guest-name";

import { AUTH_PARAM, hereWithAuth, takePendingAction, useOpenAuth, type AuthMode } from "./links";
import "./auth.css";

/** Sign in and create account, as a panel over whatever screen you're on, so the globe or trip stays put behind it.
 * Mounted once in the root layout; `?auth=signin` or `?auth=signup` opens it. */
export function AuthPanel() {
  const raw = useSearchParams().get(AUTH_PARAM);
  const mode: AuthMode | null = raw === "signin" || raw === "signup" ? raw : null;
  return mode ? <Panel mode={mode} /> : null;
}

const MODES: { value: AuthMode; label: string }[] = [
  { value: "signin", label: "Sign in" },
  { value: "signup", label: "Create account" },
];

function Panel({ mode }: { mode: AuthMode }) {
  const open = useOpenAuth();
  const titleId = useId();
  const close = () => {
    // walking away drops whatever was waiting on sign-in
    takePendingAction();
    open(null, { replace: true });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="au-layer">
      <div className="au-scrim" aria-hidden onClick={close} />
      <section className="au-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="au-head">
          <div>
            <h2 id={titleId} className="au-title">
              {mode === "signup" ? "Create an account" : "Sign in"}
            </h2>
            <p className="au-sub">Save trips and ask Pip. Friends can join without one.</p>
          </div>
          <RoundButton label="Close" onClick={close} className="au-close" />
        </header>
        <div className="au-tabs" role="tablist" aria-label="Account">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="tab"
              aria-selected={m.value === mode}
              className="au-tab"
              onClick={() => open(m.value, { replace: true })}
            >
              {m.label}
            </button>
          ))}
        </div>
        {/* keyed so switching tabs starts the form fresh */}
        <AuthForm key={mode} mode={mode} />
      </section>
    </div>
  );
}

function AuthForm({ mode }: { mode: AuthMode }) {
  const signup = mode === "signup";
  const [state, action, pending] = useActionState<AuthState, FormData>(signup ? signUp : signIn, {});
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    // a full load, so the page, its trip connection and any pending action all start as the new account
    if (state.ok) window.location.replace(hereWithAuth(null));
  }, [state.ok]);

  const message = state.error ?? state.notice;
  return (
    <form action={action} className="au-form">
      {signup ? (
        <label className="au-field">
          <span>Your name</span>
          <input ref={first} name="name" required maxLength={MAX_NAME} autoComplete="nickname" className="au-input" />
        </label>
      ) : null}
      <label className="au-field">
        <span>Email</span>
        <input ref={signup ? undefined : first} name="email" type="email" required autoComplete="email" className="au-input" />
      </label>
      <label className="au-field">
        <span>Password</span>
        <input
          name="password"
          type="password"
          required
          minLength={signup ? 8 : undefined}
          autoComplete={signup ? "new-password" : "current-password"}
          className="au-input"
        />
        {signup ? <span className="au-hint">At least 8 characters.</span> : null}
      </label>
      {message ? (
        <p role="status" className="au-message" data-kind={state.error ? "error" : "notice"}>
          {message}
        </p>
      ) : null}
      <Button type="submit" block disabled={pending || state.ok} aria-busy={pending || undefined}>
        {pending || state.ok ? (signup ? "Creating account…" : "Signing in…") : signup ? "Create account" : "Sign in"}
      </Button>
    </form>
  );
}
