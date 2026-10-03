"use client";

import { shallow, useOthers, useSelf } from "@liveblocks/react";

import { PipSprite } from "@/components/agent/pip-sprite";
import { AGENT_ID, AGENT_NAME } from "@/lib/agent/types";
import { memberColor, type MemberInfo } from "@/lib/liveblocks/types";

const MAX_SHOWN = 5;

/**
 * Who is in the trip: you first, then everyone else. Re-renders only when someone joins, leaves or renames.
 * Avatars are styled by `.pn-avatar` in nav-bar.css, sized with the navbar's other controls.
 */
export function AvatarStack() {
  const me = useSelf((self) => self.info);
  const others = useOthers((list) => list.filter((o) => o.id !== AGENT_ID).map((o) => ({ key: o.connectionId, info: o.info })), shallowList);
  const pip = useOthers((list) => list.some((o) => o.id === AGENT_ID));
  const extra = Math.max(0, others.length - MAX_SHOWN);

  return (
    <ul className="flex items-center" aria-label="People in this trip">
      {me ? <Avatar info={me} label={`${me.name} (you)`} /> : null}
      {others.slice(0, MAX_SHOWN).map((o) => (
        <Avatar key={o.key} info={o.info} label={o.info.name} />
      ))}
      {pip ? (
        <li title={AGENT_NAME} aria-label={AGENT_NAME} className="pn-avatar -ml-(--space-2) border-2 border-sticker-ink bg-star-light">
          <PipSprite size={24} />
        </li>
      ) : null}
      {extra ? (
        <li className="pn-avatar -ml-(--space-2) border-(length:--line-control) border-control-border">
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
      className="pn-avatar -ml-(--space-2) border-2 first:ml-0"
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
