"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";

import "@/components/auth/auth.css";
import { Button } from "@/components/paper-atlas";
import { leavePreview, leaveTrip, type LeavePreview } from "@/app/trips/actions";

/** What leaving takes with you, and what happens to the trip after. */
function consequences(preview: LeavePreview | null) {
  const yours = "The legs you drew, your seats on other legs, your votes and your messages will be removed.";
  if (!preview) return yours;
  if (preview.last) return `${yours} You're the last one here, so the trip will be deleted.`;
  if (preview.owner) return `${yours} You own this trip, so it passes to ${preview.nextOwner}.`;
  return yours;
}

/**
 * Asks "Are you sure?" before leaving a trip, then leaves and goes to `next`. Styled like the sign-in panel: it sits
 * over the screen, which shows through a paper wash. Inside the trip, pass the room's `connection`: it is paused while
 * leaving, since reconnecting goes through the auth route, which would join you again.
 */
export function LeaveTripDialog({ tripId, next, onClose, connection }: {
  tripId: string;
  next: string;
  onClose: () => void;
  connection?: { pause(): void; resume(): void };
}) {
  const router = useRouter();
  const titleId = useId();
  const [preview, setPreview] = useState<LeavePreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    leavePreview(tripId).then((p) => live && setPreview(p)).catch(() => {});
    return () => {
      live = false;
    };
  }, [tripId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !pending && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const leave = () =>
    startTransition(async () => {
      setFailed(false);
      connection?.pause();
      const result = await leaveTrip(tripId).catch(() => ({ ok: false }));
      if (!result.ok) {
        connection?.resume();
        return setFailed(true);
      }
      router.replace(next);
    });

  return (
    <div className="au-layer">
      <div className="au-scrim" aria-hidden onClick={() => !pending && onClose()} />
      <section className="au-panel" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-body`}>
        <div>
          <h2 id={titleId} className="au-title">
            Are you sure you want to leave the party?
          </h2>
          <p id={`${titleId}-body`} className="au-sub">
            {consequences(preview)}
          </p>
        </div>
        {failed ? (
          <p role="alert" className="au-message" data-kind="error">
            Couldn&apos;t leave the trip. Try again.
          </p>
        ) : null}
        <div className="flex justify-end gap-(--space-2)">
          <Button variant="secondary" onClick={onClose} disabled={pending} autoFocus>
            Stay
          </Button>
          <Button onClick={leave} disabled={pending}>
            {pending ? "Leaving…" : "Leave trip"}
          </Button>
        </div>
      </section>
    </div>
  );
}

/** "Leave trip" in a My trips row, with its confirm dialog. */
export function LeaveTripButton({ tripId }: { tripId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="type-meta text-ink-muted underline underline-offset-4" onClick={() => setOpen(true)}>
        Leave trip
      </button>
      {open ? <LeaveTripDialog tripId={tripId} next="/trips" onClose={() => setOpen(false)} /> : null}
    </>
  );
}
