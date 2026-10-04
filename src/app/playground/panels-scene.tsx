"use client";

import { useMemo, useState, type ReactNode } from "react";

import { CardActionsContext, Composer, Launcher, PipClose, Suggestions, ThreadLog, useComposer, type CardActions } from "@/components/agent/agent-chat";
import { PipSprite } from "@/components/agent/pip-sprite";
import { DEMO_PARTY, EntryPanel, PassportIcon } from "@/components/entry";
import { BesideProvider } from "@/components/multiplayer/beside";
import { DetailsForm } from "@/components/multiplayer/leg-booking";
import { InviteButton } from "@/components/multiplayer/invite-button";
import { BillButton } from "@/components/multiplayer/split-bill";
import { StayCard } from "@/components/multiplayer/stay-card";
import { TripPlan } from "@/components/multiplayer/trip-plan";
import { TripSplit } from "@/components/multiplayer/trip-split";
import { NAV_ICONS, NavButton } from "@/components/nav-bar";
import { PassportPicker } from "@/components/nav-bar/passport-picker";
import { Button, RoundButton, Route, Sticker, Tag, Ticket } from "@/components/paper-atlas";
import { Glyph, Timeline, TripTag, type GlyphKind } from "@/components/ticket-search";
import { CurrencySetting } from "@/components/transport/currency-selector";
import { EndTripDialog, LeaveTripDialog } from "@/components/trip-plan/leave-trip";
import { AGENT_NAME, type ThreadMessage } from "@/lib/agent/types";
import { setCurrencyPref, useCurrencyPref } from "@/lib/currency-pref";
import { useExchangeRates } from "@/lib/exchange-rates";
import type { PlanStay } from "@/lib/trip/split";

import { MEMBERS, SPLIT, SPLIT_LEGS, STAYS, THREAD } from "./fixtures";
import { CHECKOUT_SCENARIOS, StandInCheckoutCard, type CheckoutScenario } from "./checkout-card-stand-in";
import { NoParty, PartyRoom, WhenReady } from "./party-room";

// Every component that lives off the home globe, or inside a trip room, at the size it renders there. The room's own
// panels (plan, dock, booking) need a live room: run `pnpm dev:party` and open /t/partyTestRoom001 for those.

const GLYPHS: GlyphKind[] = ["flight", "train", "bus", "ferry", "hotel"];
const CHIPS = ["Where should we meet?", "Cheapest way home", "Add another stop"];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-(--space-4) border-t border-rule pt-(--space-5)">
      <div>
        <h2 className="type-title">{title}</h2>
        {note ? <p className="type-meta text-ink-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function PanelsScene({ party }: { party: boolean }) {
  const currency = useCurrencyPref();
  const rates = useExchangeRates();
  return (
    <main className="min-h-dvh w-full overflow-x-hidden bg-paper">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-(--space-6) px-(--space-4) pt-(--space-6) pb-32">
        <header>
          <h1 className="type-title">Playground · panels</h1>
          <p className="type-body text-ink-muted">Real components with made-up data. Buttons do nothing that sticks.</p>
          <p className="type-meta text-ink-muted">What’s built but not wired yet: docs/ui/to-wire.md.</p>
        </header>

        <FromMain />
        <Buttons />
        <PlanCard party={party} />
        <Tags />
        <PipPanels />

        <Section title="Entry requirements" note="Opens beside a trip card from its passport button: the home fare card and each leg of a trip plan. Try the button on the Home scene too.">
          <div className="flex flex-wrap items-start gap-(--space-5)">
            <section className="ts pa-cast">
              <EntryPanel leg={{ fromHub: "HKG", toHub: "PVG" }} riders={DEMO_PARTY} />
            </section>
            <section className="ts pa-cast">
              <EntryPanel leg={{ fromHub: "ICN", toHub: "PVG", onwardCountry: "JPN" }} riders={DEMO_PARTY} />
            </section>
            <section className="ts pa-cast">
              <EntryPanel leg={{ fromHub: "PVG", toHub: "HND" }} riders={[...DEMO_PARTY, { id: "kit", name: "Kit" }]} />
            </section>
            <section className="ts pa-cast">
              <EntryPanel leg={{ fromHub: "HKG", toHub: "SHA" }} riders={[]} />
            </section>
            <div className="flex items-center gap-(--space-2)">
              <span className="ts">
                <span className="flex items-center gap-(--space-2) p-(--space-2)">
                  <span className="en-btn">
                    <PassportIcon />
                  </span>
                  <span className="type-meta">Passport button</span>
                </span>
              </span>
            </div>
          </div>
        </Section>

        <Stays currency={currency} rates={rates} />

        <Section title="Booking details" note="The rider form in a leg's booking and the home checkout.">
          <div className="flex flex-wrap items-start gap-(--space-6)">
            {/* in the trip plan's leg card */}
            <section className="ts pa-cast tp-card tp">
              <div className="tp-leg">
                <section className="tp-book" aria-label="Booking">
                  <div className="tp-book-head">
                    <span>Separate tickets</span>
                    <span>Waiting on details · 2 days left</span>
                  </div>
                  <DetailsForm documents email="mei@example.com" passportCountry="HK" busy={false} invalid={["phone"]} onCancel={() => {}} onSubmit={() => {}} />
                </section>
              </div>
            </section>
            {/* in the home fare card, after Book */}
            <section className="ts pa-cast">
              <div className="ts-bottom pt-(--space-3)">
                <section className="tp-book" aria-label="Checkout">
                  <div className="tp-book-head">
                    <span>Checkout</span>
                    <span>$165.00</span>
                  </div>
                  <DetailsForm documents={false} email={null} passportCountry="" busy={false} invalid={[]} submitLabel="Pay" onCancel={() => {}} onSubmit={() => {}} />
                </section>
              </div>
            </section>
            {/* in the home fare card, booking alone with the in-app checkout: each step walks on to the next */}
            <SoloCheckoutDemo />
            {/* a settled leg in the trip plan: the same checkout with everyone's share */}
            <SoloCheckoutDemo group />
          </div>
        </Section>

        <Section title="Profile settings" note="Also inside the profile menu on the Home scene.">
          <div className="flex flex-wrap items-start gap-(--space-6)">
            <Passports />
            <div className="w-72">
              <CurrencySetting currency={currency} rates={rates} error={false} onChange={setCurrencyPref} />
            </div>
            <div className="w-72">
              <CurrencySetting currency={currency} rates={null} error onChange={setCurrencyPref} />
            </div>
          </div>
        </Section>

        <Dialogs />

        <Section title="Sign in" note="The auth panel opens over any page from ?auth=.">
          <div className="flex gap-(--space-3)">
            <a className="pa-btn pa-btn-secondary" href="?scene=panels&auth=signin">
              Sign in panel
            </a>
            <a className="pa-btn pa-btn-secondary" href="?scene=panels&auth=signup">
              Sign up panel
            </a>
          </div>
        </Section>
      </div>
    </main>
  );
}

function Buttons() {
  const [searching, setSearching] = useState(true);
  const [bill, setBill] = useState(false);
  return (
    <Section title="Buttons">
      <div className="flex flex-wrap items-center gap-(--space-3)">
        <Button>Save flight</Button>
        <Button variant="secondary">Book</Button>
        <Button variant="quiet">Cancel</Button>
        <Button disabled>Saved</Button>
        <Button aria-busy>Saving trip…</Button>
        <Button
          icon={
            <svg width={16} height={16} viewBox="0 0 16 16">
              {NAV_ICONS.friends}
            </svg>
          }
        >
          With icon
        </Button>
      </div>
      <div className="w-[340px]">
        <Button block>Block button</Button>
      </div>
      <div className="flex flex-wrap items-center gap-(--space-3)">
        <NavButton icon={NAV_ICONS.friends} label="Plan with friends" />
        <InviteButton />
        <span className="pn-bar static" data-compact>
          <span className="pn-controls">
            <NavButton icon={NAV_ICONS.friends} label="Plan with friends (compact)" />
          </span>
        </span>
        <BillButton open={bill} onToggle={() => setBill((b) => !b)} controls="pg-bill" />
        <RoundButton label="Close" />
        <RoundButton label="Close" variant="quiet" />
        <button type="button" className="ts-oneway">
          Keep one way
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-(--space-6) py-(--space-4)">
        <Ticket from={{ code: "HKG", city: "Hong Kong" }} to={{ code: "PVG", city: "Shanghai" }} date="Sat 10 Oct" distance="1,230 km" searching={searching} onClose={() => setSearching((s) => !s)} />
        <Ticket from={{ code: "HKG", city: "Hong Kong" }} to={{ code: "PVG", city: "Shanghai" }} date="Sat 10 Oct" distance="1,230 km" searching={false} flat />
      </div>
    </Section>
  );
}

/** UI that came in with main's booking and performance work, before it has had a style pass here. */
function FromMain() {
  return (
    <Section
      title="New from main"
      note="Came in with main's booking and performance work; not yet through the style pass. Also new: the checkout card and Reply interrupted in Pip's thread (Pip, below), Phone country in Booking details, and the sign-in panel, now a native dialog (Sign in)."
    >
      <div className="flex flex-wrap items-start gap-(--space-6)">
        <div className="grid gap-(--space-2)">
          <span className="type-meta text-ink-muted">Fare row badges</span>
          <div className="flex flex-wrap items-center gap-(--space-2)">
            <span className="ts-badge">Cheapest</span>
            <span className="ts-badge ts-badge-quiet">Estimated</span>
            <span className="ts-badge ts-badge-quiet">Bookable</span>
            <span className="ts-badge ts-badge-quiet" title="Free refund before departure">
              Refundable
            </span>
          </div>
        </div>
        <div className="grid w-72 gap-(--space-2)">
          <span className="type-meta text-ink-muted">A restored trip&apos;s stay, in the fare card</span>
          <p className="ts-empty">Stay kept: Bund hotel, 2 rooms</p>
        </div>
        <div className="grid gap-(--space-2)">
          <span className="type-meta text-ink-muted">A saved trip that couldn&apos;t be restored, over the globe</span>
          <div className="relative h-24 w-[420px] rounded-ticket border border-dashed border-rule">
            <p role="alert" className="type-body absolute bottom-(--space-3) left-1/2 w-max -translate-x-1/2 bg-paper-raised p-(--space-3)">
              Couldn&apos;t restore the trip. Please select the route again.
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}

function Tags() {
  const [folded, setFolded] = useState<string | null>(null);
  return (
    <Section title="Tags, stickers and glyphs" note="Route tags are clickable, as on the globe.">
      <div className="flex flex-wrap items-center gap-(--space-6)">
        {(
          [
            ["flight", "HKG", "PVG", "$165"],
            ["train", "Hong Kong", "Shanghai", "$92"],
            ["ferry", "Hong Kong", "Macau", "$24"],
            ["bus", "Kuala Lumpur", "Singapore", "$18"],
          ] as const
        ).map(([mode, from, to, price]) => (
          <TripTag
            key={mode}
            mode={mode}
            from={from}
            to={to}
            price={price}
            className="pa-cast"
            style={{ position: "relative", "--alt": 0.3 } as React.CSSProperties}
            aria-expanded={folded !== mode}
            onClick={() => setFolded((f) => (f === mode ? null : mode))}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-(--space-6)">
        <span className="type-meta text-ink-muted">Zoomed out, on a route shorter than the tag:</span>
        {(
          [
            ["flight", "HKG", "PVG", "$165"],
            ["train", "Hong Kong", "Shanghai", "$92"],
            ["ferry", "Hong Kong", "Macau", "$24"],
            ["bus", "Kuala Lumpur", "Singapore", "$18"],
          ] as const
        ).map(([mode, from, to, price]) => (
          <TripTag
            key={mode}
            compact
            mode={mode}
            from={from}
            to={to}
            price={price}
            className="pa-cast"
            style={{ position: "relative", "--alt": 0.3 } as React.CSSProperties}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-(--space-6)">
        <Tag>HKG</Tag>
        <Sticker shape="plane" title="Traveller" />
        <Sticker shape="star" title="Origin" />
        <Route marching />
        <Route lift={0.4} />
      </div>
      <div className="ts-glyphs flex flex-wrap items-center gap-(--space-5) text-ink">
        {GLYPHS.map((k) => (
          <Glyph key={k} kind={k} size={15} />
        ))}
        {GLYPHS.map((k) => (
          <Glyph key={`${k}-s`} kind={k} size={28} sticker />
        ))}
      </div>
      <div className="grid w-72 gap-(--space-3)">
        <Timeline legs={[{ kind: "flight", minutes: 168, label: "Flight 2h 48m" }]} />
        <Timeline
          legs={[
            { kind: "flight", minutes: 610, label: "Flight 10h 10m" },
            { kind: "wait", minutes: 105, label: "Layover 1h 45m" },
            { kind: "flight", minutes: 225, label: "Flight 3h 45m" },
          ]}
        />
        <Timeline legs={[{ kind: "train", minutes: 500, label: "Train 8h 20m" }]} />
      </div>
    </Section>
  );
}

function PipPanels() {
  const [thread, setThread] = useState<ThreadMessage[]>(THREAD);
  const [unread, setUnread] = useState(false);
  const [checkout, setCheckout] = useState<CheckoutScenario>("details");
  const [replying, setReplying] = useState(false);
  const actions = useMemo<CardActions>(
    () => ({
      // keyed by state, so picking one starts the card over at that point
      checkout: () => <StandInCheckoutCard key={checkout} scenario={checkout} />,
      retry: () => {},
      apply: async (messageId, option) => {
        await wait(400);
        setThread((t) => t.map((m) => (m.id === messageId ? { ...m, cards: m.cards.map((c) => (c.type === "meetup" ? { ...c, applied: option, changesetId: "c0" } : c)) } : m)));
      },
      undo: async (messageId, changesetId) => {
        await wait(400);
        setThread((t) => t.map((m) => (m.id === messageId ? { ...m, cards: m.cards.map((c) => ("changesetId" in c && c.changesetId === changesetId ? { ...c, undone: true } : c)) } : m)));
      },
    }),
    [checkout],
  );
  const composer = useComposer(async (text) => {
    await wait(300);
    setThread((t) => [...t, { id: crypto.randomUUID(), at: Date.now(), author: { kind: "member", id: "g_mei" }, text, state: "done", cards: [] }]);
  });
  return (
    <Section title="Pip" note="The trip room's thread with every card kind, including checkout. Apply and Undo flip their states; sending appends your message. Checkout walks its states with nothing booked.">
      <div className="flex flex-wrap items-end gap-(--space-6)">
        <div className="relative h-[640px] w-[428px]">
          <section className="pip-panel" aria-label={`Plan with ${AGENT_NAME}`}>
            <header className="pip-head">
              <PipSprite size={32} mood="talk" />
              <div className="min-w-0 flex-1">
                <p className="pip-head-name">{AGENT_NAME}</p>
                <p className="pip-head-sub">Hong Kong → Shanghai → Tokyo</p>
              </div>
              <PipClose onClick={() => {}} />
            </header>
            <CardActionsContext value={actions}>
              <ThreadLog thread={thread} me="g_mei" members={MEMBERS} activity="checking fares" footer={<Suggestions composer={composer} chips={CHIPS} />} />
            </CardActionsContext>
            <Composer composer={composer} onStop={replying ? () => setReplying(false) : undefined} />
          </section>
        </div>
        <div className="flex flex-col gap-(--space-2)">
          <div className="relative h-[200px] w-[320px] rounded-ticket border border-dashed border-rule">
            <Launcher unread={unread} onOpen={() => {}} />
          </div>
          <label className="type-meta flex items-center gap-(--space-2)">
            <input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} />
            New reply badge
          </label>
          <label className="type-meta flex items-center gap-(--space-2)">
            <input type="checkbox" checked={replying} onChange={(e) => setReplying(e.target.checked)} />
            Replying (Stop reply, home Pip)
          </label>
          <div className="grid gap-(--space-1)">
            <span className="type-meta text-ink-muted">Checkout card in the thread</span>
            <div className="flex flex-wrap gap-(--space-1)">
              {CHECKOUT_SCENARIOS.map((c) => (
                <Button key={c.id} variant={c.id === checkout ? "primary" : "secondary"} onClick={() => setCheckout(c.id)}>
                  {c.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

function Stays({ currency, rates }: { currency: ReturnType<typeof useCurrencyPref>; rates: ReturnType<typeof useExchangeRates> }) {
  const [stays, setStays] = useState<PlanStay[]>(STAYS);
  return (
    <Section title="Stays and split" note="From the trip plan. Ada leaves early, so she pays for fewer nights.">
      <div className="flex flex-wrap items-start gap-(--space-6)">
        <section className="ts pa-cast tp-card tp">
          <div className="tp-leg">
          {stays.map((s) => (
            <StayCard
              key={s.id}
              stay={s}
              members={MEMBERS}
              currency={currency}
              rates={rates}
              onChange={(patch) => setStays((list) => list.map((x) => (x.id === s.id ? { ...x, ...patch } : x)))}
              onRemove={() => {}}
            />
          ))}
          </div>
        </section>
        {/* the bill beside the plan card */}
        <section className="ts pa-cast" aria-label="Split">
          <TripSplit split={SPLIT} legs={SPLIT_LEGS} members={MEMBERS} stays={STAYS} me="g_mei" currency={currency} rates={rates} />
        </section>
      </div>
    </Section>
  );
}

function Passports() {
  const [value, setValue] = useState<string[]>(["HKG"]);
  return (
    <div className="w-72">
      <PassportPicker value={value} onChange={setValue} />
    </div>
  );
}

function Dialogs() {
  const [open, setOpen] = useState<"leave" | "end" | null>(null);
  return (
    <Section title="Leave and end trip" note="Confirm calls the real action on a made-up trip, which fails and shows the error state.">
      <div className="flex gap-(--space-3)">
        <Button variant="secondary" onClick={() => setOpen("leave")}>
          Leave trip
        </Button>
        <Button variant="secondary" onClick={() => setOpen("end")}>
          End trip
        </Button>
      </div>
      {open === "leave" ? <LeaveTripDialog tripId="playground" next="/playground?scene=panels" onClose={() => setOpen(null)} /> : null}
      {open === "end" ? <EndTripDialog tripId="playground" next="/playground?scene=panels" onClose={() => setOpen(null)} /> : null}
    </Section>
  );
}

/** The trip plan card itself, in the local party trip, with its dock beside it. */
function PlanCard({ party }: { party: boolean }) {
  const [bill, setBill] = useState(false);
  return (
    <Section title="Trip plan" note="The real card in the local party trip (pnpm dev:party). Edits land in that local room only; restarting dev:party reseeds it. On the Trip scene, a leg's route, ticket stub or pins open it here.">
      {party ? (
        <PartyRoom>
          <WhenReady>
            <div className="flex flex-wrap items-start gap-(--space-6)">
              <div className="relative">
                <BesideProvider bill={{ open: bill, set: setBill }}>
                  <TripPlan onMinimise={() => {}} />
                </BesideProvider>
              </div>
            </div>
          </WhenReady>
        </PartyRoom>
      ) : (
        <NoParty className="grid gap-(--space-1)" />
      )}
    </Section>
  );
}

/** The home fare card's in-app checkout, booking alone, at each of its steps; `group`, a settled leg in the trip plan. */
function SoloCheckoutDemo({ group = false }: { group?: boolean }) {
  const [step, setStep] = useState<CheckoutScenario>("details");
  return (
    <div className="grid gap-(--space-2)">
      <section className="ts pa-cast w-[360px]">
        <div className="ts-bottom">
          {group ? (
            <section className="tp-book" aria-label="Booking">
              <StandInCheckoutCard key={step} scenario={step} inCard />
            </section>
          ) : (
            <section className="ts-checkout" aria-label="Checkout">
              <StandInCheckoutCard key={step} scenario={step} solo />
            </section>
          )}
        </div>
      </section>
      <div className="flex flex-wrap gap-(--space-1)">
        {CHECKOUT_SCENARIOS.map((c) => (
          <Button key={c.id} variant={c.id === step ? "primary" : "secondary"} onClick={() => setStep(c.id)}>
            {c.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
