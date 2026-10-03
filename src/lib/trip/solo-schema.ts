import { z } from "zod";
import type { ProviderId } from "@/lib/transport/types";
import { MAX_OFFERS, webUrlOrNull } from "./offers";
import { sameStop } from "./stops";

const PROVIDERS = ["travelpayouts", "12go", "tdx", "korea-tago", "china-rail", "busonlineticket", "gtfs", "srt", "duffel", "vietnam-rail", "official-ferries", "rail-cache"] as const satisfies readonly ProviderId[];
const MODES = ["flight", "train", "bus", "ferry"] as const;
const MAX_SEGMENTS = 8;
/** All options together, after unknown fields are stripped. Twenty real offers are a few KB. */
const MAX_OFFERS_CHARS = 120_000;

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const text = (max: number) => z.string().trim().min(1).max(max);
const timestamp = z.string().max(40).refine((v) => Number.isFinite(Date.parse(v)), "bad time");

const stopSchema = z.object({
  lat,
  lng,
  hub: z.string().max(64).nullable(),
  code: z.string().max(16).nullable().default(null),
  name: text(120),
});

// the airport code stays: settling a saved Duffel flight matches on it
const placeSchema = z.object({ name: z.string().max(200), lat, lng, iata: z.string().max(8).optional() });

const offerSchema = z.object({
  id: text(200),
  provider: z.enum(PROVIDERS),
  mode: z.enum(MODES),
  segments: z
    .array(
      z.object({
        mode: z.enum(MODES),
        carrier: z.string().max(120).optional(),
        carrierCode: z.string().regex(/^[A-Z0-9]{2}$/).optional(),
        number: z.string().max(40).optional(),
        from: placeSchema,
        to: placeSchema,
        depart: timestamp,
        arrive: timestamp,
        durationMin: z.number().min(0).max(100_000),
      }),
    )
    .min(1)
    .max(MAX_SEGMENTS),
  transfers: z.number().int().min(0).max(20).optional(),
  price: z
    .object({ amount: z.number().min(0).max(10_000_000), currency: z.string().regex(/^[A-Z]{3}$/), asOf: z.string().max(40).optional() })
    .optional(),
  kind: z.enum(["live", "cached", "timetable", "estimated"]),
  // rooms render it as a link, so a forged `javascript:` link is refused outright
  bookingUrl: z.string().max(2000).refine((v) => webUrlOrNull(v) !== null, "bad booking link").optional(),
  attribution: z.string().max(500).optional(),
});

/** YYYY-MM-DD, UTC. */
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;

/**
 * What `/` sends to save a landed leg: its two stops (as `stopFromPoint` builds them), the depart date, the options
 * the popover showed and the one picked. Never trusted: unknown fields are stripped, sizes capped, and the date must
 * be from yesterday in UTC (a traveller west of UTC may still be on it) to a year ahead.
 */
/** One leg landed on `/`, with the options its search showed and the one picked. */
export const soloLegSchema = z
  .object({
    from: stopSchema,
    to: stopSchema,
    date: z.iso.date().refine((d) => d >= isoDay(Date.now() - DAY) && d <= isoDay(Date.now() + 400 * DAY), "date out of range"),
    offers: z.array(offerSchema).min(0).max(MAX_OFFERS),
    chosen: text(200).nullable(),
    // the hotel picked in the popover's Hotels tab: the whole group's cost per night, live or estimated
    stay: z
      .object({
        label: text(120),
        nightly: z.object({ amount: z.number().min(0).max(1_000_000), currency: z.string().regex(/^[A-Z]{3}$/) }),
        // a live hotel rate; anything unmarked is an estimate
        estimated: z.boolean().default(true),
      })
      .optional(),
  })
  .refine((v) => !sameStop(v.from, v.to), "from and to are the same place")
  .refine((v) => v.offers.length > 0 || v.stay !== undefined, "a flight or hotel must be selected")
  .refine((v) => v.chosen === null || v.offers.some((o) => o.id === v.chosen), "chosen offer is not among the options")
  .refine((v) => new Set(v.offers.map((o) => o.id)).size === v.offers.length, "duplicate offers")
  .refine((v) => JSON.stringify(v.offers).length <= MAX_OFFERS_CHARS, "options too large");

/** The most legs one save takes: eight flown, far more stops than anyone clicks in one go, and the way back home. */
export const MAX_SOLO_LEGS = 9;

/** A trip landed on `/`: its legs in order, each departing no earlier than the one before. */
export const soloSaveSchema = z
  .object({ legs: z.array(soloLegSchema).min(1).max(MAX_SOLO_LEGS) })
  .refine((v) => v.legs.every((l, i) => i === 0 || l.date >= v.legs[i - 1].date), "legs out of order");

export type SoloSaveInput = z.infer<typeof soloSaveSchema>;
