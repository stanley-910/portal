"use client";

import { shallow, useOthers, useSelf } from "@liveblocks/react";

import { memberColor, type MemberInfo } from "@/lib/liveblocks/types";

const MAX_SHOWN = 5;

/** Who is in the trip: you first, then everyone else. Re-renders only when someone joins, leaves or renames. */
export function AvatarStack() {
  const me = useSelf((self) => self.info);
  const others = useOthers((list) => list.map((o) => ({ key: o.connectionId, info: o.info })), shallowList);
  const extra = Math.max(0, others.length - MAX_SHOWN);

  return (
    <ul className="flex items-center" aria-label="People in this trip">
      {me ? <Avatar info={me} label={`${me.name} (you)`} /> : null}
      {others.slice(0, MAX_SHOWN).map((o) => (
        <Avatar key={o.key} info={o.info} label={o.info.name} />
      ))}
      {extra ? (
        <li className="type-tag -ml-(--space-2) grid size-9 place-items-center rounded-round border-(length:--line-hair) border-ink bg-paper-raised">
          +{extra}
        </li>
      ) : null}
    </ul>
  );
}

function Avatar({ info, label }: { info: MemberInfo; label: string }) {
  return (
    <li
      title={label}
      aria-label={label}
      className="type-tag -ml-(--space-2) grid size-9 place-items-center rounded-round border-2 bg-paper-raised shadow-tag first:ml-0"
      style={{ borderColor: memberColor(info.color) }}
    >
      {initials(info.name)}
    </li>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

const shallowList = (a: { key: number; info: MemberInfo }[], b: { key: number; info: MemberInfo }[]) =>
  a.length === b.length && a.every((x, i) => x.key === b[i]!.key && shallow(x.info, b[i]!.info));
