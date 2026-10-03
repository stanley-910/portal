import type { ThreadCard } from "@/lib/agent/types";

export type Part = { kind: "text"; text: string; at: number } | { kind: "card"; card: ThreadCard; index: number };

/**
 * A reply's text and cards in the order Pip made them: each card sits where the text had got to when it was added.
 * Text streams in behind cards already written, so a card past the text so far waits at the end.
 */
export function inOrder(text: string, cards: ThreadCard[]): Part[] {
  const placed = cards
    .map((card, index) => ({ card, index, at: Math.min(card.at ?? Infinity, text.length) }))
    .sort((a, b) => a.at - b.at || a.index - b.index);
  const parts: Part[] = [];
  let from = 0;
  const words = (to: number) => {
    const t = text.slice(from, to).trim();
    if (t) parts.push({ kind: "text", text: t, at: from });
    from = Math.max(from, to);
  };
  for (const { card, index, at } of placed) {
    words(at);
    parts.push({ kind: "card", card, index });
  }
  words(text.length);
  return parts;
}
