import type { Station } from "./schema";

// Pattern observed 2026-10-02 in Trip.com's search-box bundle (china-12306.md). Hong Kong also
// uses the "china" path. Affiliate params (Allianceid/SID) unverified → links ship untagged.
export function tripComTrainUrl(from: Station, to: Station, date: string): string {
  const qs = new URLSearchParams({
    departureStation: from.nameLocal,
    arrivalStation: to.nameLocal,
    departDate: date,
  });
  return `https://www.trip.com/trains/china/list?${qs}`;
}
