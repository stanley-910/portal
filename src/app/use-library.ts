"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { GlobePin, RemoteFlight } from "@/components/trip-globe";
import type { LibraryTrip } from "@/lib/trip/library";

import { loadLibrary } from "./library-actions";
import { renameTrip } from "./t/title-actions";

export type LibraryOverlay = { flights: RemoteFlight[]; pins: GlobePin[] };
const EMPTY: LibraryOverlay = { flights: [], pins: [] };

/**
 * My Trips on the home globe: whether the sidebar is out, the person's trips (loaded on opening, and again each time,
 * with the last list shown meanwhile), the trip picked, what the library wants drawn on the globe, and renaming.
 */
export function useLibrary(account: boolean, openAtFirst = false) {
  const [open, setOpenState] = useState(account && openAtFirst);
  // `/?trips` arriving again while the globe is up opens it again
  const [asked, setAsked] = useState(openAtFirst);
  if (openAtFirst !== asked) {
    setAsked(openAtFirst);
    if (openAtFirst && account) setOpenState(true);
  }
  const [data, setData] = useState<{ userId: string; trips: LibraryTrip[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [overlay, setOverlayState] = useState<LibraryOverlay>(EMPTY);
  const loading = useRef(false);

  const load = useCallback(() => {
    if (!account || loading.current) return;
    loading.current = true;
    loadLibrary()
      .then((result) => {
        if (!result) return setError("Sign in to see your trips.");
        setError(null);
        setData(result);
      })
      .catch(() => setError("Your trips didn't load. Try again in a moment."))
      .finally(() => {
        loading.current = false;
      });
  }, [account]);

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      if (next) load();
    },
    [load],
  );

  // opened by the page's address: load it as opening it would
  useEffect(() => {
    if (account && openAtFirst) load();
  }, [account, openAtFirst, load]);

  /** Takes a trip off the list once you've left or deleted it, letting go of it if it was picked. */
  const remove = useCallback((id: string) => {
    setData((d) => (d ? { ...d, trips: d.trips.filter((t) => t.id !== id) } : d));
    setSelected((s) => (s === id ? null : s));
  }, []);

  // the list as it is now, for a rename to know the name it's replacing
  const current = useRef(data);
  useEffect(() => {
    current.current = data;
  });

  /** Names a trip for everyone in it, showing the new name at once and putting the old one back if the save fails. */
  const rename = useCallback(async (id: string, title: string) => {
    const before = current.current?.trips.find((t) => t.id === id)?.title;
    const retitle = (next: string) => setData((d) => (d ? { ...d, trips: d.trips.map((t) => (t.id === id ? { ...t, title: next } : t)) } : d));
    if (title.trim()) retitle(title.trim());
    const result = await renameTrip(id, title).catch(() => ({ ok: false, title: undefined }));
    if (result.ok && result.title) retitle(result.title);
    else if (before !== undefined) retitle(before);
    return result.ok;
  }, []);

  // the library hands over a fresh overlay whenever it redraws; an equal one changes nothing, so the globe isn't redrawn
  const setOverlay = useCallback((next: LibraryOverlay) => {
    setOverlayState((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, []);

  return { open, setOpen, trips: data?.trips ?? null, userId: data?.userId ?? null, error, selected, select: setSelected, rename, remove, overlay, setOverlay };
}
