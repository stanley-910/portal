"use client";

import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";

import { Button } from "@/components/paper-atlas";
import { renameProfile, signOut } from "@/app/(auth)/actions";
import { useOpenAuth } from "@/components/auth/links";
import { saveName } from "@/app/t/actions";
import { initials, MAX_NAME } from "@/lib/guest-name";

export interface ProfileMenuProps {
  /** Your display name: an account's, a guest's, or null before you've picked one. */
  name: string | null;
  /** The signed-in user's email. */
  email?: string | null;
  /** Signed in, rather than a guest. */
  account?: boolean;
  /** Reload the page after a rename, so a trip room reconnects with the new name on your cursor. */
  reloadOnRename?: boolean;
  /** Settings for this screen, shown under Theme. Build them from `MenuSection` and `MenuChoices`. */
  children?: ReactNode;
}

/** The disc at the end of the bar: who you are (your account, or a way to sign in), and the app's settings. */
export function ProfileMenu({ name, email = null, account = false, reloadOnRename, children }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        className="pa-round pn-profile"
        aria-label="Profile and settings"
        title={name ?? "Profile and settings"}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((visible) => !visible)}
      >
        {name ? initials(name) : <PersonGlyph />}
      </button>
      {open ? (
        <div id={panelId} className="pn-menu pn-profile-menu" role="dialog" aria-label="Profile and settings">
          <Identity name={name} email={email} account={account} reloadOnRename={reloadOnRename} />
          <ThemeSetting />
          {children}
        </div>
      ) : null}
    </div>
  );
}

function Identity({ name, email, account, reloadOnRename }: { name: string | null; email: string | null; account: boolean; reloadOnRename?: boolean }) {
  const router = useRouter();
  const openAuth = useOpenAuth();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  if (!account && !editing) {
    return (
      <div className="pn-profile-guest">
        <div className="pn-profile-who">
          {name ? <span className="pn-menu-symbol pn-profile-initials" aria-hidden>{initials(name)}</span> : null}
          <span className="pn-menu-text">
            <span>{name ?? "Guest"}</span>
            <span className="pn-menu-detail">{name ? "Guest" : "Not signed in"}</span>
          </span>
          {name ? (
            <Button variant="quiet" className="pn-profile-edit" onClick={() => setEditing(true)}>
              Rename
            </Button>
          ) : null}
        </div>
        <div className="pn-profile-row">
          <Button className="flex-1" onClick={() => openAuth("signin")}>
            Sign in
          </Button>
          <Button variant="secondary" className="flex-1" onClick={() => openAuth("signup")}>
            Create account
          </Button>
        </div>
      </div>
    );
  }
  if (!editing) {
    return (
      <div className="pn-profile-who">
        <span className="pn-menu-symbol pn-profile-initials" aria-hidden>{initials(name ?? "")}</span>
        <span className="pn-menu-text">
          <span>{name}</span>
          {email ? <span className="pn-menu-detail">{email}</span> : null}
        </span>
        <div className="pn-profile-row">
          <Button variant="quiet" className="pn-profile-edit" onClick={() => setEditing(true)}>
            Rename
          </Button>
          <form action={signOut}>
            <Button type="submit" variant="quiet" className="pn-profile-edit">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    );
  }
  return (
    <form
      className="pn-profile-form"
      action={(form) =>
        startTransition(async () => {
          await (account ? renameProfile(form) : saveName(form));
          if (reloadOnRename) window.location.reload();
          else {
            router.refresh();
            setEditing(false);
          }
        })
      }
    >
      <label htmlFor="pn-profile-name" className="type-label">
        Your name
      </label>
      <div className="pn-profile-row">
        <input
          id="pn-profile-name"
          name="name"
          required
          autoFocus
          maxLength={MAX_NAME}
          autoComplete="nickname"
          defaultValue={name ?? ""}
          className="pn-profile-input"
        />
        <Button type="submit" disabled={pending}>
          Save
        </Button>
      </div>
      <Button variant="quiet" className="pn-profile-edit" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </form>
  );
}

const THEMES = [
  { value: "light", label: "Day" },
  { value: "dark", label: "Night" },
  { value: "system", label: "Auto" },
] as const;

function ThemeSetting() {
  const { theme, setTheme } = useTheme();
  return (
    <MenuSection title="Theme">
      <MenuChoices name="theme" label="Theme" value={theme ?? "system"} options={THEMES} onChange={setTheme} />
    </MenuSection>
  );
}

/** A titled group in the profile menu. */
export function MenuSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pn-profile-section">
      <h2 className="type-caption text-ink-muted">{title}</h2>
      {children}
    </section>
  );
}

export interface MenuChoice<T extends string> {
  value: T;
  label: string;
  /** Shown as a tooltip, e.g. a currency's full name. */
  title?: string;
  disabled?: boolean;
}

/** A row of segments for picking one value. Native radios, so arrow keys move between them. */
export function MenuChoices<T extends string>({ name, label, value, options, onChange }: {
  name: string;
  label: string;
  value: string;
  options: readonly MenuChoice<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="pn-choices">
      {options.map((option) => (
        <label key={option.value} className="pn-choice" title={option.title} data-disabled={option.disabled || undefined}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            disabled={option.disabled}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

function PersonGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="5.5" r="2.6" />
      <path d="M2.8 14c.6-2.8 2.6-4.3 5.2-4.3s4.6 1.5 5.2 4.3" />
    </svg>
  );
}
