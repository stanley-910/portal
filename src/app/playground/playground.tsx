"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { TripGlobeHandle } from "@/components/trip-globe";

import { ACCOUNT, cannedPipReply, GUEST, PRESETS } from "./fixtures";
import { HomeScene } from "./home-scene";
import { LibraryScene } from "./library-scene";
import { PanelsScene } from "./panels-scene";
import { TripScene } from "./trip-scene";

type Scene = "home" | "trip" | "panels" | "library";
const SCENES: { id: Scene; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "trip", label: "Trip" },
  { id: "panels", label: "Panels" },
  { id: "library", label: "Library" },
];

const noop = () => () => {};

/**
 * Answers /api/pip from the page, so asking Pip here costs no model call. Every other request goes through: the fare,
 * hotel, place and rate searches are reads, and fall back to mock data without keys.
 */
function useCannedPip() {
  useEffect(() => {
    const real = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.href).pathname === "/api/pip") {
        return Promise.resolve(new Response(cannedPipReply(), { headers: { "content-type": "application/x-ndjson" } }));
      }
      return real(input, init);
    };
    return () => {
      window.fetch = real;
    };
  }, []);
}

export function Playground({ party }: { party: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const scene: Scene = SCENES.find((s) => s.id === params.get("scene"))?.id ?? "home";
  const preset = PRESETS.find((p) => p.id === params.get("trip")) ?? PRESETS[0];
  const [account, setAccount] = useState(true);
  const [compact, setCompact] = useState(false);
  const [hidden, setHidden] = useState(false);
  const globe = useRef<TripGlobeHandle>(null);
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  useCannedPip();

  const go = (next: Record<string, string>) => {
    const q = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) q.set(k, v);
    router.replace(`${pathname}?${q}`, { scroll: false });
  };

  return (
    <>
      {scene === "home" ? (
        <HomeScene key={preset.id} globe={globe} persona={account ? ACCOUNT : GUEST} compact={compact} initial={preset.stops} />
      ) : scene === "trip" ? (
        <TripScene globe={globe} party={party} compact={compact} />
      ) : scene === "library" ? (
        <LibraryScene globe={globe} persona={ACCOUNT} compact={compact} />
      ) : (
        <PanelsScene party={party} />
      )}
      <div className="pg-bar" data-anchor-avoid data-hidden={hidden || undefined}>
        {hidden ? (
          <button type="button" className="pg-chip" onClick={() => setHidden(false)} aria-label="Show playground controls">
            ⋯
          </button>
        ) : (
          <>
            <div className="pg-group" role="group" aria-label="Scene">
              {SCENES.map((s) => (
                <button key={s.id} type="button" className="pg-chip" aria-pressed={scene === s.id} onClick={() => go({ scene: s.id })}>
                  {s.label}
                </button>
              ))}
            </div>
            {scene === "home" ? (
              <>
                <div className="pg-group" role="group" aria-label="Trip">
                  {PRESETS.map((p) => (
                    <button key={p.id} type="button" className="pg-chip" aria-pressed={preset.id === p.id} onClick={() => go({ trip: p.id })}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="pg-group">
                  <button type="button" className="pg-chip" aria-pressed={account} onClick={() => setAccount((a) => !a)}>
                    {account ? "Signed in" : "Guest"}
                  </button>
                </div>
              </>
            ) : null}
            {scene !== "panels" ? (
              <div className="pg-group">
                <button type="button" className="pg-chip" aria-pressed={compact} onClick={() => setCompact((c) => !c)}>
                  Compact nav
                </button>
              </div>
            ) : null}
            <div className="pg-group">
              <button type="button" className="pg-chip" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
                {mounted && resolvedTheme === "dark" ? "Night" : "Day"}
              </button>
              <button type="button" className="pg-chip" onClick={() => setHidden(true)} aria-label="Hide playground controls">
                ✕
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
