import type { HubSearchResult } from "@/lib/transport/hub-search";
import type { HubCandidate } from "@/lib/transport/hubs/types";
import type { Offer } from "@/lib/transport/types";

const card = "rounded-ticket border border-ink/15 bg-paper-raised p-(--space-3) text-ink shadow-tag";

function OfferContent({ offer }: { offer: Offer }) {
  const first = offer.segments[0];
  const last = offer.segments.at(-1)!;
  const duration = Math.round((Date.parse(last.arrive) - Date.parse(first.depart)) / 60_000);
  return <>
    <p className="type-tag">{first.from.iata ?? first.from.name} → {last.to.iata ?? last.to.name}</p>
    <p className="type-body">
      {offer.price ? new Intl.NumberFormat("en-US", { style: "currency", currency: offer.price.currency }).format(offer.price.amount) : "Fare unavailable"}
      {" · "}{duration} min{offer.segments.length > 1 ? ` · ${offer.segments.length - 1} transfers` : ""}
    </p>
    <p className="type-meta text-ink-muted">
      {first.carrier ?? offer.mode}{" · "}{offer.provider}
      {offer.kind !== "live" ? " · Estimated" : " · Live"}
      {offer.kind === "cached" ? " · Cached fare per person" : offer.kind === "timetable" ? " · Typical timetable" : ""}
    </p>
    {offer.attribution ? <p className="type-meta text-ink-muted">{offer.attribution}</p> : null}
  </>;
}

function HubList({ label, hubs }: { label: string; hubs: HubCandidate[] }) {
  return <section>
    <h3 className="type-tag">{label}</h3>
    {hubs.length === 0 ? <p className="type-body text-ink-muted">No bundled hubs within the search radius.</p> : (
      <ul className="flex flex-col gap-(--space-2)">
        {hubs.map(({ hub, distanceKm }) => <li key={hub.id}>
          <p className="type-body">{hub.name}</p>
          <p className="type-meta text-ink-muted">{hub.mode} · {distanceKm} km straight-line access</p>
          <a className="type-meta inline-flex min-h-11 items-center underline" href={hub.source} target="_blank" rel="noreferrer">Hub source</a>
        </li>)}
      </ul>
    )}
  </section>;
}

export function TransportResults({ result }: { result: HubSearchResult }) {
  const estimates = new Set(result.estimates);
  return <div className="flex max-h-[42dvh] w-[min(84vw,560px)] shrink-0 flex-col gap-(--space-3) overflow-y-auto rounded-ticket border border-ink/15 bg-paper-raised p-(--space-3)">
    {result.errors.length > 0 ? <p className="type-body text-ink-muted" role="status">
      Some providers are unavailable. Bundled candidates remain available.
    </p> : null}
    {result.offers.map((offer) => offer.bookingUrl ? (
      <a key={offer.id} className={`${card} block min-h-11`} href={offer.bookingUrl} target="_blank" rel="noreferrer"><OfferContent offer={offer} /></a>
    ) : <article key={offer.id} className={card}><OfferContent offer={offer} /></article>)}
    {result.offers.length === 0 ? <p className="type-body text-ink-muted">No provider offers returned.</p> : null}
    {result.hubs.pairs.filter((pair) => estimates.has(pair.id)).map((pair) => <article key={pair.id} className={card}>
      <p className="type-tag">{pair.mode} · Estimated</p>
      <p className="type-body">{pair.from.hub.name} → {pair.to.hub.name}</p>
      <p className="type-meta text-ink-muted">
        {pair.estimatedDurationMin ? `About ${pair.estimatedDurationMin} min · ` : ""}
        {pair.evidence === "geographic-candidate" ? "Connection unverified" : "Bundled connection"}
        {" · "}Schedule and fare unavailable
      </p>
      <p className="type-meta text-ink-muted">{pair.accessDistanceKm} km combined straight-line access</p>
      {pair.evidence === "bundled-connection" ? <a className="type-meta inline-flex min-h-11 items-center underline" href={pair.source} target="_blank" rel="noreferrer">Connection source</a>
        : <p className="type-meta text-ink-muted">Source: bundled airport locations, geographic ranking</p>}
    </article>)}
    <details className={card} open={result.hubs.pairs.length === 0}>
      <summary className="type-tag flex min-h-11 cursor-pointer items-center">Nearby airports, stations and terminals</summary>
      <div className="grid gap-(--space-4) sm:grid-cols-2">
        <HubList label="Origin" hubs={result.hubs.from} />
        <HubList label="Destination" hubs={result.hubs.to} />
      </div>
      <p className="type-meta mt-(--space-3) text-ink-muted">Bundled coverage is incomplete. Access distances exclude roads, borders and transfer times. Geographic candidates do not confirm flight service.</p>
    </details>
    <p className="type-meta text-ink-muted">
      Hub data: OurAirports, Wikidata and {" "}
      <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors (ODbL)</a>.
    </p>
  </div>;
}
