"use client";

import { useSearchParams } from "next/navigation";
import { useActionState, useEffect, useId, useRef } from "react";

import { signIn, signInWithGoogle, signUp, type AuthState } from "@/app/(auth)/actions";
import { Button, PixelClose } from "@/components/paper-atlas";
import { MAX_NAME } from "@/lib/guest-name";

import { AUTH_PARAM, hereWithAuth, takePendingAction, useOpenAuth, type AuthMode } from "./links";
import "./auth.css";

/** Sign in and create account, as a panel over whatever screen you're on, so the globe or trip stays put behind it.
 * Mounted once in the root layout; `?auth=signin` or `?auth=signup` opens it. */
export function AuthPanel() {
  const search = useSearchParams();
  const raw = search.get(AUTH_PARAM);
  const mode: AuthMode | null = raw === "signin" || raw === "signup" ? raw : null;
  const failed = search.get("auth_error");
  const notice = failed === "google" ? ROUND_TRIP.google : failed === "email" ? ROUND_TRIP.email : undefined;
  return mode ? <Panel mode={mode} notice={notice} /> : null;
}

/** Shown when Google or a confirmation link came back without a session. */
const ROUND_TRIP = {
  google: "Google sign-in didn't finish. Try again.",
  // the link confirms the email before it gets here, so most often only the sign-in part is left
  email: "That link couldn't sign you in here. If your email is confirmed, sign in below.",
};

/** The page to come back to: this one, panel closed. Read when the form is sent. */
const withNext =
  (action: (prev: AuthState, formData: FormData) => Promise<AuthState>) => (prev: AuthState, formData: FormData) => {
    formData.set("next", hereWithAuth(null));
    return action(prev, formData);
  };

const MODES: { value: AuthMode; label: string }[] = [
  { value: "signin", label: "Sign in" },
  { value: "signup", label: "Create account" },
];

function Panel({ mode, notice }: { mode: AuthMode; notice?: string }) {
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
        <div className="au-body">
          <header className="au-head">
            <h2 id={titleId} className="au-title">
              {mode === "signup" ? "Create an account" : "Sign in"}
            </h2>
            <PixelClose onClick={close} className="au-close" />
          </header>
          <GoogleButton />
          <div className="au-or" aria-hidden>
            <span>or with email</span>
          </div>
          <div className="au-tabs pa-px-box" role="tablist" aria-label="Account">
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
          <AuthForm key={mode} mode={mode} notice={notice} />
        </div>
      </section>
    </div>
  );
}

/** Leaves for Google and comes back through /auth/callback to this page. */
function GoogleButton() {
  const [state, action, pending] = useActionState<AuthState, FormData>(withNext(signInWithGoogle), {});
  return (
    <form action={action} className="au-form">
      <Button type="submit" variant="secondary" block className="pa-px-box" disabled={pending} aria-busy={pending || undefined}>
        {pending ? "Opening Google…" : "Continue with Google"}
      </Button>
      {state.error ? (
        <p role="status" className="au-message pa-px-box" data-kind="error">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function AuthForm({ mode, notice }: { mode: AuthMode; notice?: string }) {
  const signup = mode === "signup";
  const [state, action, pending] = useActionState<AuthState, FormData>(withNext(signup ? signUp : signIn), { notice });
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
          <input ref={first} name="name" required maxLength={MAX_NAME} autoComplete="nickname" className="au-input pa-px-box" />
        </label>
      ) : null}
      <label className="au-field">
        <span>Email</span>
        <input ref={signup ? undefined : first} name="email" type="email" required autoComplete="email" className="au-input pa-px-box" />
      </label>
      <label className="au-field">
        <span>Password</span>
        <input
          name="password"
          type="password"
          required
          minLength={signup ? 8 : undefined}
          autoComplete={signup ? "new-password" : "current-password"}
          className="au-input pa-px-box"
        />
        {signup ? <span className="au-hint">At least 8 characters.</span> : null}
      </label>
      {message ? (
        <p role="status" className="au-message pa-px-box" data-kind={state.error ? "error" : "notice"}>
          {message}
        </p>
      ) : null}
      <Button type="submit" block disabled={pending || state.ok} aria-busy={pending || undefined}>
        {pending || state.ok ? (signup ? "Creating account…" : "Signing in…") : signup ? "Create account" : "Sign in"}
      </Button>
    </form>
  );
}
