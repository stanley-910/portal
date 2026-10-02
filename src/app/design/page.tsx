import type { Metadata } from "next";

import tokens from "@/design/tokens.json";

import { ComponentGallery, ThemeSwitch } from "./gallery";

export const metadata: Metadata = { title: "Paper Atlas · Trip Globe" };

type Themed = string | { light: string; dark?: string };
const light = (v: Themed) => (typeof v === "string" ? v : v.light);
const dark = (v: Themed) => (typeof v === "string" ? v : (v.dark ?? v.light));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-(--space-4)">
      <h2 className="type-title">{title}</h2>
      {children}
    </section>
  );
}

/** Every token and component in the design system, rendered from src/design/tokens.json. */
export default function DesignPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 py-12 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="type-code">{tokens.name}</h1>
          <p className="type-body text-ink-muted">Tokens: src/design/tokens.json. Rules: DESIGN.md.</p>
        </div>
        <ThemeSwitch />
      </header>

      <Section title="Components">
        <ComponentGallery />
      </Section>

      <Section title="Colour">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tokens.color.tokens.map((t) => (
            <li key={t.name} className="flex gap-3 rounded-ticket border border-ink bg-paper-raised p-3">
              <span
                className="size-12 shrink-0 rounded-tag border border-ink"
                style={{ background: `var(--${t.name})` }}
                aria-hidden
              />
              <span className="flex min-w-0 flex-col">
                <span className="type-tag">{t.name}</span>
                <span className="type-meta text-ink-muted">
                  {light(t.value as Themed)}
                  {dark(t.value as Themed) !== light(t.value as Themed) ? ` / ${dark(t.value as Themed)}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Type">
        <ul className="flex flex-col gap-4">
          {tokens.type.groups.flatMap((g) =>
            g.styles.map((s) => (
              <li key={s.name} className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-rule pb-3">
                <span className="type-tag w-20 shrink-0">{s.name}</span>
                <span className={`type-${s.name}`}>{s.sample}</span>
                <span className="type-meta text-ink-muted">
                  {g.family} · {s.fontSize}
                </span>
              </li>
            )),
          )}
        </ul>
      </Section>

      <Section title="Shape">
        <div className="flex flex-wrap gap-6">
          {tokens.radius.tokens.map((t) => (
            <div key={t.name} className="flex flex-col items-center gap-2">
              <span
                className="size-16 border border-ink bg-paper-raised"
                style={{ borderRadius: `var(--${t.name})` }}
                aria-hidden
              />
              <span className="type-tag">{t.name}</span>
            </div>
          ))}
          {tokens.shadow.tokens.map((t) => (
            <div key={t.name} className="flex flex-col items-center gap-2">
              <span
                className="size-16 rounded-ticket border border-ink bg-paper-raised"
                style={{ boxShadow: `var(--${t.name})` }}
                aria-hidden
              />
              <span className="type-tag">{t.name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Space">
        <ul className="flex flex-col gap-2">
          {tokens.spacing.tokens.map((t) => (
            <li key={t.name} className="flex items-center gap-4">
              <span className="type-tag w-20">{t.name}</span>
              <span className="h-3 bg-ink" style={{ width: `var(--${t.name})` }} aria-hidden />
              <span className="type-meta text-ink-muted">{t.value}</span>
            </li>
          ))}
        </ul>
      </Section>
    </main>
  );
}
