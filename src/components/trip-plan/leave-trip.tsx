"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition, type ReactNode } from "react";

import "@/components/auth/auth.css";
import { Button } from "@/components/paper-atlas";
import { endTrip, leavePreview, leaveTrip, type LeavePreview } from "@/app/t/trip-actions";

/** What leaving takes with you, and what happens to the trip after. */
function consequences(preview: LeavePreview | null) {
  const yours = "The legs you drew, your seats on other legs, your votes and your messages will be removed.";
  if (!preview) return yours;
  if (preview.last) return `${yours} You're the last one here, so the trip will be deleted.`;
  if (preview.owner) return `${yours} You own this trip, so it passes to ${preview.nextOwner}.`;
  return yours;
}

/** The room's connection, paused while a dialog acts on the trip: reconnecting goes through the auth route, which joins you. */
type Connection = { pause(): void; resume(): void };

/** Where a dialog goes once its action is done: a page, or a callback for one that stays where it is (the library). */
type Next = string | (() => void);

/**
 * Runs a trip action behind a confirm, then goes to `next`. The room's connection is paused while it runs and resumed
 * if it fails. A thrown action is logged, since the dialog only says it failed.
 */
function useTripAction(run: () => Promise<{ ok: boolean }>, next: Next, connection?: Connection) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const act = () =>
    startTransition(async () => {
      setFailed(false);
      connection?.pause();
      const result = await run().catch((error: unknown) => {
        console.error("[trip] the server action failed:", error);
        return { ok: false };
      });
      if (!result.ok) {
        connection?.resume();
        return setFailed(true);
      }
      if (typeof next === "string") router.replace(next);
      else next();
    });
  return { act, failed, pending };
}

/**
 * A confirm over the screen, styled like the sign-in panel: it sits over the screen, which shows through a paper wash.
 * Escape and the wash cancel it unless it's busy.
 */
function ConfirmPanel({ title, body, error, failed, pending, cancel, confirm, busy, onCancel, onConfirm }: {
  title: string;
  body: ReactNode;
  error: string;
  failed: boolean;
  pending: boolean;
  cancel: string;
  confirm: string;
  busy: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !pending && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, pending]);

  return (
    // marked so a press in it doesn't put the library away behind it
    <div className="au-layer" data-library-keep>
      <div className="au-scrim" aria-hidden onClick={() => !pending && onCancel()} />
      <section className="au-panel" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-body`}>
        <div className="au-body">
        <div>
          <h2 id={titleId} className="au-title">
            {title}
          </h2>
          <p id={`${titleId}-body`} className="au-sub">
            {body}
          </p>
        </div>
        {failed ? (
          <p role="alert" className="au-message pa-px-box" data-kind="error">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-(--space-2)">
          <Button variant="secondary" onClick={onCancel} disabled={pending} autoFocus>
            {cancel}
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            {pending ? busy : confirm}
          </Button>
        </div>
        </div>
      </section>
    </div>
  );
}

/**
 * Asks "Are you sure?" before leaving a trip, then leaves and goes to `next`. Inside the trip, pass the room's
 * `connection`: it is paused while leaving, since reconnecting goes through the auth route, which would join you again.
 */
export function LeaveTripDialog({ tripId, next, onClose, connection }: {
  tripId: string;
  next: Next;
  onClose: () => void;
  connection?: Connection;
}) {
  const [preview, setPreview] = useState<LeavePreview | null>(null);
  const { act, failed, pending } = useTripAction(() => leaveTrip(tripId), next, connection);

  useEffect(() => {
    let live = true;
    leavePreview(tripId).then((p) => live && setPreview(p)).catch(() => {});
    return () => {
      live = false;
    };
  }, [tripId]);

  return (
    <ConfirmPanel
      title="Are you sure you want to leave the party?"
      body={consequences(preview)}
      error="Couldn't leave the trip. Try again."
      failed={failed}
      pending={pending}
      cancel="Stay"
      confirm="Leave trip"
      busy="Leaving…"
      onCancel={onClose}
      onConfirm={act}
    />
  );
}

/** The owner ending the trip for everyone, from inside it: the room is deleted and the others are told it ended. */
export function EndTripDialog({ tripId, next, onClose, connection }: {
  tripId: string;
  next: Next;
  onClose: () => void;
  connection?: Connection;
}) {
  const { act, failed, pending } = useTripAction(() => endTrip(tripId), next, connection);
  return (
    <ConfirmPanel
      title="End the trip?"
      body="This ends the trip for everyone. The plan and messages will be deleted."
      error="Couldn't end the trip. Try again."
      failed={failed}
      pending={pending}
      cancel="Keep trip"
      confirm="End trip"
      busy="Ending…"
      onCancel={onClose}
      onConfirm={act}
    />
  );
}

/** The owner deleting a trip from the library: the same as ending it from inside, for everyone. */
export function DeleteTripDialog({ tripId, next, onClose }: { tripId: string; next: Next; onClose: () => void }) {
  const { act, failed, pending } = useTripAction(() => endTrip(tripId), next);
  return (
    <ConfirmPanel
      title="Delete this trip?"
      body="This deletes the trip for everyone, with its plan and messages."
      error="Couldn't delete the trip. Try again."
      failed={failed}
      pending={pending}
      cancel="Keep trip"
      confirm="Delete trip"
      busy="Deleting…"
      onCancel={onClose}
      onConfirm={act}
    />
  );
}
