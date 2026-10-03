import Link from "next/link";

/** Shown at once while the trips are read, so opening My trips never sits on the page you left. */
export default function TripsLoading() {
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
        <div
          role="status"
          className="w-full max-w-2xl rounded-ticket border-(length:--line-ink) border-ink bg-paper-raised shadow-ticket"
        >
          <p className="type-body px-(--space-4) py-(--space-5) text-ink-muted">Loading your trips.</p>
        </div>
      </div>
    </main>
  );
}
