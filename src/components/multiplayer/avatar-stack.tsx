"use client";

import { shallow, useOthers, useSelf } from "@liveblocks/react";

import { PipSprite } from "@/components/agent/pip-sprite";
import { initials } from "@/lib/guest-name";
import { AGENT_ID, AGENT_NAME } from "@/lib/agent/types";
import { memberColor, type MemberInfo } from "@/lib/liveblocks/types";
import { useMemberColors, usePlanMembers } from "@/lib/trip/plan";

import { usePresentIds } from "./presence";

const MAX_SHOWN = 5;

/**
 * Who is in the trip: you first, then everyone else here, then members who are away (dashed). Re-renders only when someone joins, leaves, renames or picks a
 * colour. Colours come from the plan, so a pick shows at once; two people may share one, so each avatar carries
 * their initials and name.
 * Avatars are styled by `.pn-avatar` in nav-bar.css, sized with the navbar's other controls.
 */
export function AvatarStack() {
  const me = useSelf((self) => ({ id: self.id, info: self.info }), shallow);
  const others = useOthers((list) => list.filter((o) => o.id !== AGENT_ID).map((o) => ({ key: o.connectionId, id: o.id, info: o.info })), shallowList);
  const colors = useMemberColors();
  const members = usePlanMembers();
  const present = usePresentIds();
  const pip = useOthers((list) => list.some((o) => o.id === AGENT_ID));
  // members of the trip who aren't in the room now, after those who are, drawn away
  const away = members && present ? Object.entries(members).filter(([id]) => !present.has(id)) : [];
  const shownAway = away.slice(0, Math.max(0, MAX_SHOWN - others.length));
  const extra = Math.max(0, others.length - MAX_SHOWN) + away.length - shownAway.length;

  return (
    <ul className="flex items-center" aria-label="People in this trip">
      {me ? <Avatar info={me.info} color={colors?.[me.id]} label={`${me.info.name} (you)`} /> : null}
      {others.slice(0, MAX_SHOWN).map((o) => (
        <Avatar key={o.key} info={o.info} color={colors?.[o.id]} label={o.info.name} />
      ))}
      {shownAway.map(([id, m]) => (
        <Avatar key={id} info={m} color={m.color} label={`${m.name} (away)`} away />
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

function Avatar({ info, color, label, away = false }: { info: MemberInfo; color?: number; label: string; away?: boolean }) {
  return (
    <li
      data-away={away || undefined}
      title={label}
      aria-label={label}
      className="pn-avatar -ml-(--space-2) border-2 first:ml-0"
      style={{ borderColor: memberColor(color ?? info.color) }}
    >
      {initials(info.name)}
    </li>
  );
}

type Other = { key: number; id: string; info: MemberInfo };
const shallowList = (a: Other[], b: Other[]) => a.length === b.length && a.every((x, i) => x.key === b[i]!.key && shallow(x.info, b[i]!.info));
