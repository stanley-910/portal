"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { Button, type ButtonProps } from "@/components/paper-atlas";
import type { TripGlobeHandle } from "@/components/trip-globe";
import { cn } from "@/lib/utils";

import { ProfileMenu, type TripColor } from "./profile-menu";

// Defines <portal-logo-reveal>. It has the logo SVGs built in and does nothing on the server.
import "../../../design-system/paper-atlas/components/LogoReveal/logo-reveal.js";

// Zoom levels (0 whole globe, 1 closest) where the bar shrinks and grows back. The gap stops it flickering.
const COMPACT_IN = 0.18;
const COMPACT_OUT = 0.12;

export interface NavBarProps {
  /** The globe under the bar. The bar shrinks to the mark and icon-only controls as it zooms in. */
  globe: RefObject<TripGlobeHandle | null>;
  /** Controls on the right, before the profile menu. */
  children?: ReactNode;
  /** Your display name: an account's, a guest's, or null before you've picked one. */
  name: string | null;
  /** The signed-in user's email, shown in the profile menu. */
  email?: string | null;
  /** Signed in, rather than a guest. */
  account?: boolean;
  /** Reload after a rename, so a trip room reconnects with the new name. */
  reloadOnRename?: boolean;
  /** This screen's settings, shown in the profile menu under Theme. */
  settings?: ReactNode;
  /** Your passports, ISO-3, for the profile menu. */
  nationalities?: string[];
  /** The member colour you saved (1 to 6), or null, for the profile menu. */
  color?: number | null;
  /** Inside a trip: your colour there, for the profile menu to show and change. */
  tripColor?: TripColor;
  /** Opens My trips on this screen, from the profile menu. */
  onTrips?: () => void;
}

/** The top bar: the Portal logo on the left, controls on the right. The logo draws itself on at load. */
export function NavBar({ globe, children, name, email, account = false, reloadOnRename, settings, nationalities, color, tripColor, onTrips }: NavBarProps) {
  const compact = useCompact(globe);
  const { resolvedTheme } = useTheme();
  const logo = useRef<HTMLElement & { play(): void }>(null);

  // The reveal starts itself as soon as it mounts, which can be before anything is on screen: the dev
  // server and the globe's textures hold the first paint back by seconds. Keep it hidden and replay it
  // from the start once the globe draws its first frame.
  useEffect(() => {
    const el = logo.current;
    const lockup = el?.parentElement;
    if (!el || !lockup) return;
    let raf = 0;
    const reveal = () => {
      raf = requestAnimationFrame(() => {
        el.play();
        lockup.dataset.ready = "";
      });
    };
    const handle = globe.current;
    if (!handle) {
      reveal();
      return () => cancelAnimationFrame(raf);
    }
    const off = handle.onFrame(() => {
      off();
      reveal();
    });
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, [globe]);

  // Set after hydration, since the server can't know the theme. The reveal redraws in the new inks.
  useEffect(() => {
    if (resolvedTheme) logo.current?.setAttribute("theme", resolvedTheme === "dark" ? "night" : "day");
  }, [resolvedTheme]);

  return (
    <header className="pn-bar" data-compact={compact || undefined}>
      <Link href="/" className="pn-logo" aria-label="Portal">
        <span className="pn-lockup" aria-hidden>
          <portal-logo-reveal
            ref={logo}
            duration="0.8"
            replay-on-click="false"
          />
        </span>
      </Link>
      <div className="pn-controls">
        {children}
        <ProfileMenu
          name={name}
          email={email ?? null}
          account={account}
          reloadOnRename={reloadOnRename}
          nationalities={nationalities}
          color={color}
          tripColor={tripColor}
          onTrips={onTrips}
        >
          {settings}
        </ProfileMenu>
      </div>
    </header>
  );
}

function useCompact(globe: RefObject<TripGlobeHandle | null>) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const handle = globe.current;
    if (!handle) return;
    let current = false;
    return handle.onFrame(() => {
      const zoom = handle.zoom();
      const next = current ? zoom > COMPACT_OUT : zoom > COMPACT_IN;
      if (next !== current) setCompact((current = next));
    });
  }, [globe]);
  return compact;
}

export interface NavButtonProps extends Omit<ButtonProps, "icon" | "children"> {
  /** A 1.6px stroke glyph on a 16px grid. */
  icon: ReactNode;
  /** Shown beside the icon until the bar shrinks; always the accessible name. */
  label: string;
}

/** An action in the bar: a primary Button by default. Zoomed in, its label folds away and it rounds into a disc. */
export function NavButton({ icon, label, className, ...props }: NavButtonProps) {
  return (
    <Button
      aria-label={label}
      title={label}
      className={cn("pn-btn", className)}
      icon={
        <svg width={16} height={16} viewBox="0 0 16 16">
          {icon}
        </svg>
      }
      {...props}
    >
      <span className="pn-btn-label">{label}</span>
    </Button>
  );
}

/** Glyphs for NavButton. */
export const NAV_ICONS = {
  friends: (
    <>
      <circle cx="6" cy="5.5" r="2.4" />
      <path d="M1.8 13.5c.5-2.4 2.2-3.8 4.2-3.8s3.7 1.4 4.2 3.8" />
      <path d="M10.6 3.4a2.4 2.4 0 0 1 0 4.4M12 9.9c1.1.5 1.9 1.8 2.2 3.6" />
    </>
  ),
  link: (
    <>
      <path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.3-2.3a2.6 2.6 0 0 0-3.7-3.7l-.9.9" />
      <path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.2 9.1a2.6 2.6 0 0 0 3.7 3.7l.9-.9" />
    </>
  ),
  check: <path d="M3 8.4l3.2 3.1L13 4.6" />,
  /** My Trips: a list. */
  trips: <path d="M2.5 4h11M2.5 8h11M2.5 12h7" />,
};
