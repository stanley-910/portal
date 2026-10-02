// Hub code → ISO-3 country for the mock hubs in src/components/trip-globe/airports.ts.
// Temporary: POR-6 replaces the mock hubs with a static dataset that should carry the country itself.
export const HUB_COUNTRY: Record<string, string> = {
  HKG: "HKG", PEK: "CHN", PKX: "CHN", PVG: "CHN", SHA: "CHN", CAN: "CHN", SZX: "CHN", CTU: "CHN", TFU: "CHN",
  TPE: "TWN", HND: "JPN", NRT: "JPN", KIX: "JPN", ICN: "KOR", GMP: "KOR", MNL: "PHL", BKK: "THA", SGN: "VNM",
  HAN: "VNM", SIN: "SGP", KUL: "MYS", CGK: "IDN", DPS: "IDN", DEL: "IND", BOM: "IND", BLR: "IND", CMB: "LKA",
  KTM: "NPL", MLE: "MDV", DXB: "ARE", DOH: "QAT", RUH: "SAU", IST: "TUR", TLV: "ISR", CAI: "EGY", ADD: "ETH",
  NBO: "KEN", JNB: "ZAF", CPT: "ZAF", LOS: "NGA", ACC: "GHA", CMN: "MAR", LHR: "GBR", CDG: "FRA", AMS: "NLD",
  FRA: "DEU", MUC: "DEU", ZRH: "CHE", MAD: "ESP", BCN: "ESP", LIS: "PRT", FCO: "ITA", MXP: "ITA", ATH: "GRC",
  VIE: "AUT", CPH: "DNK", ARN: "SWE", OSL: "NOR", HEL: "FIN", KEF: "ISL", DUB: "IRL", WAW: "POL", PRG: "CZE",
  SVO: "RUS", ALA: "KAZ", TAS: "UZB", VVO: "RUS", JFK: "USA", BOS: "USA", IAD: "USA", ATL: "USA", MIA: "USA",
  ORD: "USA", DFW: "USA", DEN: "USA", LAX: "USA", SFO: "USA", SEA: "USA", YVR: "CAN", YYZ: "CAN", YUL: "CAN",
  MEX: "MEX", CUN: "MEX", HNL: "USA", ANC: "USA", PTY: "PAN", BOG: "COL", UIO: "ECU", LIM: "PER", GRU: "BRA",
  GIG: "BRA", EZE: "ARG", SCL: "CHL", SYD: "AUS", MEL: "AUS", BNE: "AUS", PER: "AUS", AKL: "NZL", NAN: "FJI",
  PPT: "PYF",
};

export const hubCountry = (hub: string): string | undefined => HUB_COUNTRY[hub.toUpperCase()];
