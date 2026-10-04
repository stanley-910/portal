"use client";

import { useSyncExternalStore } from "react";

// Alien mode: Pip's replies stream in as wobbling alien glyphs that translate into English just behind the stream
// (components/agent/alien-text.tsx). On by default; turned off in the profile menu, kept in this browser.

const KEY = "portal-alien";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
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

/** Whether alien mode is on. The server and the first client render say it is. */
export function useAlienPref(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}

export function setAlienPref(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {}
  for (const l of listeners) l();
}
