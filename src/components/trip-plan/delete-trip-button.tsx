"use client";

import { useFormStatus } from "react-dom";

import { deleteTrip } from "@/app/trips/actions";

export function DeleteTripButton({ tripId }: { tripId: string }) {
  return (
    <form
      action={deleteTrip}
      onSubmit={(event) => {
        if (!window.confirm("Delete this trip permanently? Everyone will lose access to it.")) event.preventDefault();
      }}
    >
      <input type="hidden" name="tripId" value={tripId} />
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="type-meta text-ink-muted underline underline-offset-4 disabled:opacity-50">
      {pending ? "Deleting…" : "Delete trip"}
    </button>
  );
}
