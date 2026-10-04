"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";

import { Button, Cursor, MEMBER_COLORS, type CursorShape } from "@/components/paper-atlas";
import { setAlienPref, useAlienPref } from "@/lib/alien-pref";
import { setCursorPref, useCursorPref } from "@/lib/cursor-pref";
import { renameProfile, signOut } from "@/app/(auth)/actions";
import { saveColor, saveNationalities } from "@/app/profile-actions";
import { About } from "./about";
import { PassportPicker } from "./passport-picker";
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
  /** The passports you hold, ISO-3. Entry requirements are worked out for these. */
  nationalities?: string[];
  /** The member colour you saved (1 to 6), or null. This browser's cursor colour follows it. */
  color?: number | null;
  /** Inside a trip: your colour there, which a pick changes for everyone at once. */
  tripColor?: TripColor;
  /** Opens My trips where it is (the library on the home globe); without it, My trips links there. */
  onTrips?: () => void;
  /** Settings for this screen, shown under Theme. Build them from `MenuSection` and `MenuChoices`. */
  children?: ReactNode;
}

/** Your colour in the trip you're in, as a design-system slot (0 to 5), and how to change it there. */
export type TripColor = { slot: number; onChange: (slot: number) => void };

const TABS = [
  { value: "profile", label: "Profile" },
  { value: "about", label: "About" },
] as const;

/** The disc at the end of the bar: who you are (your account, or a way to sign in), and the app's settings. */
export function ProfileMenu({ name, email = null, account = false, reloadOnRename, nationalities = [], color = null, tripColor, onTrips, children }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"profile" | "about">("profile");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // this browser's cursor colour follows the one saved on you, e.g. one picked on another device
  useEffect(() => {
    if (color) setCursorPref({ color: color - 1 });
  }, [color]);

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
        <div id={panelId} data-globe-obstacle className="pn-menu pn-profile-menu" role="dialog" aria-label="Profile and settings">
          <div className="pn-tabs" role="tablist" aria-label="Menu">
            {TABS.map((t) => (
              <button key={t.value} type="button" role="tab" aria-selected={t.value === tab} className="pn-tab" onClick={() => setTab(t.value)}>
                {t.label}
              </button>
            ))}
          </div>
          {tab === "about" ? (
            <About />
          ) : (
            <>
              <Identity name={name} email={email} account={account} reloadOnRename={reloadOnRename} />
              <PassportSetting saved={nationalities} />
              {!account ? null : onTrips ? (
                <button
                  type="button"
                  className="pn-profile-trips"
                  onClick={() => {
                    setOpen(false);
                    onTrips();
                  }}
                >
                  My trips
                </button>
              ) : (
                <Link className="pn-profile-trips" href="/?trips">My trips</Link>
              )}
              <CursorSetting trip={tripColor} />
              <ThemeSetting />
              <AlienSetting />
              {children}
            </>
          )}
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

/** The passports you hold. Several are fine: a dual national travels on whichever gets them in more easily. */
function PassportSetting({ saved }: { saved: string[] }) {
  const router = useRouter();
  const [list, setList] = useState(saved);
  const [, startTransition] = useTransition();
  const save = (next: string[]) => {
    setList(next);
    startTransition(async () => {
      await saveNationalities(next);
      router.refresh();
    });
  };
  return (
    <MenuSection title="Passports">
      <PassportPicker value={list} onChange={save} />
      {list.length ? null : <p className="type-meta text-ink-muted">Add yours to see what each border needs.</p>}
    </MenuSection>
  );
}

const CURSOR_SHAPES: readonly MenuChoice<CursorShape>[] = [
  { value: "arrow", label: "Arrow" },
  { value: "compass", label: "Compass" },
  { value: "map", label: "Map" },
];

/**
 * Your cursor's shape, kept in this browser, and your colour, saved on you so every trip uses it: your cursor, plane,
 * pins and routes there. In a trip the pick shows for everyone at once.
 */
function CursorSetting({ trip }: { trip?: TripColor }) {
  const router = useRouter();
  const pref = useCursorPref();
  const [, startTransition] = useTransition();
  const pick = (slot: number) => {
    setCursorPref({ color: slot });
    trip?.onChange(slot);
    startTransition(async () => {
      // the room numbers colours from 1; the design system's slots count from 0
      await saveColor(slot + 1);
      // a trip has the pick already; elsewhere, refresh what the server knows of you
      if (!trip) router.refresh();
    });
  };
  const current = trip?.slot ?? pref.color;
  return (
    <MenuSection title="Cursor">
      <MenuChoices name="cursor-shape" label="Cursor shape" value={pref.shape} options={CURSOR_SHAPES} onChange={(shape) => setCursorPref({ shape })} />
      <div role="radiogroup" aria-label="Cursor colour" className="pn-swatches">
        {MEMBER_COLORS.map((color, i) => (
          <label key={color} className="pn-swatch" title={`Colour ${i + 1}`}>
            <input type="radio" name="cursor-color" checked={current === i} onChange={() => pick(i)} aria-label={`Colour ${i + 1}`} />
            <Cursor shape={pref.shape} color={color} altitude={0} className="pn-swatch-cursor" />
          </label>
        ))}
      </div>
    </MenuSection>
  );
}

function ThemeSetting() {
  const { theme, setTheme } = useTheme();
  return (
    <MenuSection title="Theme">
      <MenuChoices name="theme" label="Theme" value={theme ?? "system"} options={THEMES} onChange={setTheme} />
    </MenuSection>
  );
}

const ALIEN: readonly MenuChoice<"on" | "off">[] = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

/** Alien mode: Pip's replies stream in as alien glyphs that translate into English just behind. */
function AlienSetting() {
  const on = useAlienPref();
  return (
    <MenuSection title="Alien mode">
      <MenuChoices name="alien" label="Alien mode" value={on ? "on" : "off"} options={ALIEN} onChange={(v) => setAlienPref(v === "on")} />
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
            aria-label={option.title ?? option.label}
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
