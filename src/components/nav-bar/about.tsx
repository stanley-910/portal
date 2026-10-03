// The data the app ships with, credited as its licences ask. Fares, timetables and hotels credit their source on each
// result instead.
const SOURCES = [
  {
    title: "Licence",
    links: [{ label: "PolyForm Noncommercial 1.0.0", href: "https://github.com/stanley-910/portal/blob/main/LICENSE.md" }],
  },
  {
    title: "Map",
    links: [{ label: "Natural Earth", href: "https://www.naturalearthdata.com/" }],
  },
  {
    title: "Hubs",
    links: [
      { label: "OurAirports", href: "https://ourairports.com/data/" },
      { label: "Wikidata", href: "https://www.wikidata.org/" },
      { label: "© OpenStreetMap contributors", href: "https://www.openstreetmap.org/copyright" },
    ],
  },
  {
    title: "Entry rules",
    links: [{ label: "Passport Index", href: "https://www.passportindex.org/" }],
  },
  {
    title: "Exchange rates",
    links: [{ label: "Frankfurter", href: "https://frankfurter.dev/" }],
  },
];

/** Who made the app and where its bundled data comes from: the profile menu's About tab. */
export function About() {
  return (
    <div className="pn-profile-about">
      <p className="type-label">Portal</p>
      <p className="type-caption text-ink-muted">The future of travel</p>
      <p className="type-caption mt-(--space-2)">Stanley Wang, Ahmet Sukru Kilic, Andrei Catalin Petre</p>
      <p className="type-caption text-ink-muted">HKU Hackathon 2026</p>
      <dl className="mt-(--space-2) grid gap-(--space-1) border-t border-line pt-(--space-2)">
        {SOURCES.map((group) => (
          <div key={group.title}>
            <dt className="type-caption text-ink-muted">{group.title}</dt>
            <dd className="type-caption m-0 flex flex-wrap gap-x-(--space-gap) gap-y-(--space-1)">
              {group.links.map((source) => (
                <a
                  key={source.href}
                  className="underline decoration-line underline-offset-2 hover:decoration-ink"
                  href={source.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {source.label}
                </a>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
