import Link from "next/link";

import { signOut } from "@/app/(auth)/actions";
import { NavButton } from "@/components/nav-bar";
import type { CurrentUser } from "@/lib/supabase/server";

const ICONS = {
  person: (
    <>
      <circle cx="8" cy="5.5" r="2.6" />
      <path d="M2.8 14c.6-2.7 2.6-4.3 5.2-4.3s4.6 1.6 5.2 4.3" />
    </>
  ),
  out: (
    <>
      <path d="M6.5 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" />
      <path d="M10.5 5l3 3-3 3M13.5 8H6.5" />
    </>
  ),
};

/** The navbar's account control: "Sign in", or the signed-in name with a Sign out button. */
export function AccountChip({ user }: { user: CurrentUser | null }) {
  if (!user) {
    // A link styled as a NavButton, so the label folds away with the bar like the other controls.
    return (
      <Link href="/login" aria-label="Sign in" title="Sign in" className="pa-btn pa-btn-secondary pn-btn">
        <span className="pa-btn-icon" aria-hidden>
          <svg width={16} height={16} viewBox="0 0 16 16">
            {ICONS.person}
          </svg>
        </span>
        <span>
          <span className="pn-btn-label">Sign in</span>
        </span>
      </Link>
    );
  }
  return (
    <form action={signOut} className="pn-account">
      <span className="pn-account-name" title={user.email}>
        {user.displayName}
      </span>
      <NavButton type="submit" variant="secondary" icon={ICONS.out} label="Sign out" />
    </form>
  );
}
