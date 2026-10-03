import { z } from "zod";

const route = z.object({
  id: z.string().min(1),
  from: z.string().startsWith("ferry:"),
  to: z.string().startsWith("ferry:"),
  carrier: z.string().min(1),
  departures: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1), // Sunday = 0, origin local date
  durationMin: z.number().int().positive(),
  source: z.url().startsWith("https://"),
  durationSource: z.url().startsWith("https://").optional(),
  note: z.string().min(1),
  noteSource: z.url().startsWith("https://"),
  effectiveFrom: z.iso.date().optional(),
}).refine((r) => r.from !== r.to, "same-terminal route");

export const ferrySeedSchema = z.object({
  checked: z.iso.date(),
  routes: z.array(route).min(1),
}).refine((s) => new Set(s.routes.map((r) => r.id)).size === s.routes.length, "duplicate route id");
export type FerrySeed = z.infer<typeof ferrySeedSchema>;
