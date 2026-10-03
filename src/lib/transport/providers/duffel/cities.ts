// Duffel searches a whole city in one request when given its IATA metro code (TYO is Haneda and Narita), so a
// search between two cities is one offer request whichever of their airports the trip lands on. Pure, for the
// hub search and the provider alike.

const METRO: Record<string, string> = {
  HND: "TYO", NRT: "TYO",
  KIX: "OSA", ITM: "OSA", UKB: "OSA",
  NGO: "NGO", NKM: "NGO",
  CTS: "SPK", OKD: "SPK",
  ICN: "SEL", GMP: "SEL",
  PVG: "SHA", SHA: "SHA",
  PEK: "BJS", PKX: "BJS",
  TPE: "TPE", TSA: "TPE",
  BKK: "BKK", DMK: "BKK",
  CGK: "JKT", HLP: "JKT",
  KUL: "KUL", SZB: "KUL",
};

/** The code Duffel searches for an airport: its city's when the city has several airports, else its own. */
export const duffelCity = (iata: string): string => METRO[iata] ?? iata;
