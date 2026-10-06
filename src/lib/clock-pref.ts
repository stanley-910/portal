"use client";

import { useSyncExternalStore } from "react";
import type { ClockCycle } from "@/lib/clock";

// 12- or 24-hour times (lib/clock.ts). 12-hour by default; changed in the profile menu, kept in this browser.

const KEY = "portal-clock";
const listeners = new Set<() => void>();

function read(): ClockCycle {
  try {
    return localStorage.getItem(KEY) === "24" ? "24" : "12";
  } catch {
    return "12";
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

/** How to show clock times. The server and the first client render say 12-hour. */
export function useClockPref(): ClockCycle {
  return useSyncExternalStore(subscribe, read, () => "12");
}

export function setClockPref(cycle: ClockCycle) {
  try {
    localStorage.setItem(KEY, cycle);
  } catch {}
  for (const l of listeners) l();
}
