// Entry requirements over the committed snapshot. Regenerate with `pnpm entry`.
import raw from "@/data/entry-requirements.json";

import { createEntryLookup } from "./lookup";
import type { EntryData } from "./schema";

export { isBlocking, needsDocument } from "./compose";
export { hubCountry } from "./hub-countries";
export type { EntryLookup, EntryMember, LegEntry, LegEntryInput, MemberLegEntry, PassportLegEntry } from "./lookup";
export type { EntryKind, EntryLink, EntryRule } from "./schema";

// The build script validates this file against the schema, so a cast keeps zod out of the client bundle.
export const entry = createEntryLookup(raw as unknown as EntryData);
