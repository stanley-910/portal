/** Read-only smoke check against a running app. No booking/prebook or credential output.
 * node scripts/stays-smoke.mts http://localhost:3000 2027-01-15 2027-01-18 HK
 * Last argument must be the actual guest nationality. The app server owns its optional API keys.
 */
const [base, checkIn, checkOut, guestNationality] = process.argv.slice(2);
if (!base || !/^\d{4}-\d{2}-\d{2}$/.test(checkIn ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut ?? "") || !/^[A-Z]{2}$/.test(guestNationality ?? "")) {
  throw new Error("Usage: node scripts/stays-smoke.mts BASE_URL CHECK_IN CHECK_OUT GUEST_NATIONALITY_ISO2");
}
const cities = [
  ["Hong Kong", 22.28, 114.16], ["Shanghai", 31.23, 121.47], ["Seoul", 37.57, 126.98], ["Tokyo", 35.68, 139.69],
] as const;
let liveCities = 0;
for (const [city, lat, lng] of cities) {
  const url = new URL("/api/hotels/search", base);
  url.search = new URLSearchParams({ city, lat: String(lat), lng: String(lng), checkIn, checkOut, guestNationality, occupants: "2", filter: "4" }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!response.ok) throw new Error(`${city}: HTTP ${response.status}`);
  const body = await response.json() as { hotels?: Array<{ freshness: string; source?: string; quote?: { checkIn: string; checkOut: string } }> };
  const hotels = body.hotels ?? [];
  const live = hotels.filter((hotel) => hotel.freshness === "live");
  if (live.some((hotel) => hotel.quote?.checkIn !== checkIn || hotel.quote.checkOut !== checkOut)) throw new Error(`${city}: live rate date mismatch`);
  if (live.length) liveCities++;
  console.log({ city, count: hotels.length, live: live.length, sources: [...new Set(hotels.map((hotel) => hotel.source ?? "Planning estimate"))] });
}
console.log({ liveCities, expectedCities: cities.length, note: liveCities === cities.length ? "Date-specific live rates returned; booking not exercised" : "Fallback works, but live inventory/access is not verified for every city" });
if (liveCities !== cities.length) process.exitCode = 2;
