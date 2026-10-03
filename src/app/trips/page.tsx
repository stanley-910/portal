import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { MyTrips } from "@/components/trip-plan/my-trips";
import { getAccountClaims } from "@/lib/supabase/server";
import { listMyTrips, listTripMetadata, type TripSummary } from "@/lib/trip/server";

export default async function TripsPage() {
  // only accounts have trips; the verified session claims say who, without a Supabase round trip
  const account = await getAccountClaims();
  if (!account) redirect("/login?next=/trips");

  const trips = await listTripMetadata(account.id);
  return (
    <main className="min-h-dvh bg-paper px-(--space-4) py-(--space-6) text-ink">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-(--space-5)">
        <Link href="/" className="type-meta text-ink-muted underline underline-offset-4">
          Back to globe
        </Link>
        <header>
          <h1 className="type-title">My trips</h1>
          <p className="type-body text-ink-muted">Your saved solo and multiplayer trips.</p>
        </header>
        <Suspense fallback={<MyTrips trips={trips} loadingCosts />}>
          <TripsWithCosts userId={account.id} trips={trips} />
        </Suspense>
      </div>
    </main>
  );
}

async function TripsWithCosts({ userId, trips }: { userId: string; trips: TripSummary[] }) {
  return <MyTrips trips={await listMyTrips(userId, trips)} />;
}
