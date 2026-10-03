"use client";

import { useSyncExternalStore } from "react";

import { MEMBER_COLORS, type CursorShape } from "@/components/paper-atlas/cursor";

// Your own cursor's shape and colour, kept in this browser. The shape is a personal convenience, so it stays here.
// The colour is also saved on you (`saveColor`), which is what trips use; this copy follows it, and is what the home
// globe draws with, so a pick shows there at once.

export type CursorPref = { shape: CursorShape; color: number };

const KEY = "portal-cursor";
const SHAPES: readonly CursorShape[] = ["arrow", "compass", "map"];
const DEFAULT: CursorPref = { shape: "arrow", color: 0 };
const listeners = new Set<() => void>();

let cached: { raw: string | null; pref: CursorPref } | null = null;

function read(): CursorPref {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {}
  if (cached?.raw === raw) return cached.pref;
  let pref = DEFAULT;
  try {
    const p = raw ? JSON.parse(raw) : null;
    pref = {
      shape: SHAPES.includes(p?.shape) ? p.shape : DEFAULT.shape,
      color: Number.isInteger(p?.color) && p.color >= 0 && p.color < MEMBER_COLORS.length ? p.color : DEFAULT.color,
    };
  } catch {}
  cached = { raw, pref };
  return pref;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const storage = (e: StorageEvent) => e.key === KEY && onChange();
  window.addEventListener("storage", storage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", storage);
  };
}

/** Your cursor preference. The server and the first client render use the default. */
export function useCursorPref(): CursorPref {
  return useSyncExternalStore(subscribe, read, () => DEFAULT);
}

export function setCursorPref(next: Partial<CursorPref>) {
  const pref = { ...read(), ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(pref));
  } catch {}
  for (const l of listeners) l();
}
