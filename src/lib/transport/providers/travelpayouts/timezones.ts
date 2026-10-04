// Each airport's clock, for writing arrivals in local time: every hub the globe offers (trip-globe/airports.ts), plus
// the city codes Travelpayouts answers with. Anything missing stays in UTC rather than guess.
const ZONES: Record<string, string[]> = {
  "Asia/Hong_Kong": ["HKG"],
  "Asia/Shanghai": ["PEK", "PKX", "BJS", "PVG", "SHA", "CAN", "CTU", "TFU", "SZX", "HGH", "XIY"],
  "Asia/Taipei": ["TPE", "TSA"],
  "Asia/Tokyo": ["HND", "NRT", "TYO", "KIX", "ITM", "OSA"],
  "Asia/Seoul": ["ICN", "GMP", "SEL", "PUS"],
  "Asia/Manila": ["MNL", "CEB"],
  "Asia/Bangkok": ["BKK", "DMK", "HKT", "CNX"],
  "Asia/Ho_Chi_Minh": ["SGN", "HAN", "DAD"],
  "Asia/Singapore": ["SIN"],
  "Asia/Kuala_Lumpur": ["KUL", "PEN", "BKI"],
  "Asia/Jakarta": ["CGK", "JKT"],
  "Asia/Makassar": ["DPS"],
  "Asia/Kolkata": ["DEL", "BOM", "BLR"],
  "Asia/Colombo": ["CMB"],
  "Asia/Kathmandu": ["KTM"],
  "Indian/Maldives": ["MLE"],
  "Asia/Dubai": ["DXB"],
  "Asia/Qatar": ["DOH"],
  "Asia/Riyadh": ["RUH"],
  "Europe/Istanbul": ["IST"],
  "Asia/Jerusalem": ["TLV"],
  "Africa/Cairo": ["CAI"],
  "Africa/Addis_Ababa": ["ADD"],
  "Africa/Nairobi": ["NBO"],
  "Africa/Johannesburg": ["JNB", "CPT"],
  "Africa/Lagos": ["LOS"],
  "Africa/Accra": ["ACC"],
  "Africa/Casablanca": ["CMN"],
  "Europe/London": ["LHR", "LON"],
  "Europe/Paris": ["CDG", "PAR"],
  "Europe/Amsterdam": ["AMS"],
  "Europe/Berlin": ["FRA", "MUC"],
  "Europe/Zurich": ["ZRH"],
  "Europe/Madrid": ["MAD", "BCN"],
  "Europe/Lisbon": ["LIS"],
  "Europe/Rome": ["FCO", "MXP", "ROM", "MIL"],
  "Europe/Athens": ["ATH"],
  "Europe/Vienna": ["VIE"],
  "Europe/Copenhagen": ["CPH"],
  "Europe/Stockholm": ["ARN"],
  "Europe/Oslo": ["OSL"],
  "Europe/Helsinki": ["HEL"],
  "Atlantic/Reykjavik": ["KEF"],
  "Europe/Dublin": ["DUB"],
  "Europe/Warsaw": ["WAW"],
  "Europe/Prague": ["PRG"],
  "Europe/Moscow": ["SVO", "MOW"],
  "Asia/Almaty": ["ALA"],
  "Asia/Tashkent": ["TAS"],
  "Asia/Vladivostok": ["VVO"],
  "America/New_York": ["JFK", "NYC", "BOS", "IAD", "WAS", "ATL", "MIA"],
  "America/Chicago": ["ORD", "CHI", "DFW"],
  "America/Denver": ["DEN"],
  "America/Los_Angeles": ["LAX", "SFO", "SEA"],
  "America/Vancouver": ["YVR"],
  "America/Toronto": ["YYZ", "YTO", "YUL"],
  "America/Mexico_City": ["MEX"],
  "America/Cancun": ["CUN"],
  "Pacific/Honolulu": ["HNL"],
  "America/Anchorage": ["ANC"],
  "America/Panama": ["PTY"],
  "America/Bogota": ["BOG"],
  "America/Guayaquil": ["UIO"],
  "America/Lima": ["LIM"],
  "America/Sao_Paulo": ["GRU", "GIG"],
  "America/Argentina/Buenos_Aires": ["EZE"],
  "America/Santiago": ["SCL"],
  "Australia/Sydney": ["SYD"],
  "Australia/Melbourne": ["MEL"],
  "Australia/Brisbane": ["BNE"],
  "Australia/Perth": ["PER"],
  "Pacific/Auckland": ["AKL"],
  "Pacific/Fiji": ["NAN"],
  "Pacific/Tahiti": ["PPT"],
};

const zoneByCode = new Map(Object.entries(ZONES).flatMap(([zone, codes]) => codes.map((c) => [c, zone] as const)));

/**
 * Countries on one clock, for airports the table doesn't list (Subang, Seletar). Countries with several zones
 * (Indonesia, Australia) aren't here: there, an unlisted airport stays in UTC.
 */
const COUNTRY_ZONES: Record<string, string> = {
  HK: "Asia/Hong_Kong", MO: "Asia/Macau", CN: "Asia/Shanghai", TW: "Asia/Taipei", JP: "Asia/Tokyo", KR: "Asia/Seoul",
  PH: "Asia/Manila", TH: "Asia/Bangkok", VN: "Asia/Ho_Chi_Minh", SG: "Asia/Singapore", MY: "Asia/Kuala_Lumpur",
  KH: "Asia/Phnom_Penh", LA: "Asia/Vientiane", MM: "Asia/Yangon", BN: "Asia/Brunei", IN: "Asia/Kolkata",
};

/** The airport or city code's time zone, else its country's when the country has one, or null when we don't know. */
export function zoneOf(code: string, country?: string | null): string | null {
  return zoneByCode.get(code.toUpperCase()) ?? (country ? COUNTRY_ZONES[country.toUpperCase()] ?? null : null);
}

/** An instant as ISO 8601 in the zone's local time, e.g. "2026-11-15T10:45:00+07:00". UTC without a zone. */
export function localIso(ms: number, zone: string | null): string {
  if (!zone) return new Date(ms).toISOString();
  const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
    .formatToParts(new Date(ms))
    .find((p) => p.type === "timeZoneName")!.value; // "GMT+07:00", or "GMT" at zero
  const offset = name === "GMT" ? "+00:00" : name.slice(3);
  const sign = offset.startsWith("-") ? -1 : 1;
  const minutes = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  return `${new Date(ms + minutes * 60_000).toISOString().slice(0, 19)}${offset}`;
}
