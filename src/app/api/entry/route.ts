// Entry requirements for one passport. Backs the planner and the agent's check_entry tool (POR-39).
// Query shape follows the transport search (core ADR-C06): flat params, countries ISO-2 or ISO-3.
//   GET /api/entry?passport=US&toCountry=CN                              entry rule for a country
//   GET /api/entry?passport=US&fromIata=ICN&toIata=PVG&onwardCountry=JP  rule for a leg, with transit if it applies
// Static data and no keys, so unlike /api/transport/search it needs no Node runtime or provider timeouts.
import { z } from "zod";

import { entry } from "@/lib/entry";

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const country = z.preprocess(blankToUndefined, z.string().trim().regex(/^[A-Za-z]{2,3}$/).optional());
const iata = z.preprocess(blankToUndefined, z.string().trim().regex(/^[A-Za-z]{3}$/).optional());

const schema = z
  .object({
    passport: z.string().trim().regex(/^[A-Za-z]{2,3}$/),
    fromIata: iata,
    toIata: iata,
    fromCountry: country,
    toCountry: country,
    onwardCountry: country,
  })
  .refine((q) => q.toIata || q.toCountry, { message: "toIata or toCountry is required", path: ["toCountry"] });

export function GET(request: Request) {
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "")))];
    return Response.json({ code: "BAD_QUERY", fields }, { status: 400 });
  }
  const { passport, fromIata, toIata, ...countries } = parsed.data;
  const leg = entry.resolveLeg({ fromHub: fromIata, toHub: toIata, ...countries }, passport);
  const { name, snapshotDate, repo } = entry.data.dataset;
  return Response.json({ ...leg, dataset: { name, snapshotDate, repo } });
}
