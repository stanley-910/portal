import Link from "next/link";
import { redirect } from "next/navigation";

import { MyTrips } from "@/components/trip-plan/my-trips";
import { currentPerson } from "@/lib/identity";
import { listMyTrips } from "@/lib/trip/server";

export default async function TripsPage() {
  const person = await currentPerson();
  if (!person?.account) redirect("/login?next=/trips");

  const trips = await listMyTrips(person.id);
  return (
    <main className="min-h-dvh bg-paper px-(--space-4) py-(--space-6) text-ink">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-(--space-5)">
        <Link href="/" className="type-meta text-ink-muted underline underline-offset-4">
          Back to globe
        </Link>
        <header>
          <h1 className="type-display">My trips</h1>
          <p className="type-body text-ink-muted">Your saved solo and multiplayer trips.</p>
        </header>
        <MyTrips trips={trips} />
      </div>
    </main>
  );
}
