const TARGET_CURRENCIES = ["USD", "EUR", "CNY", "HKD"] as const;
const headers = { "Cache-Control": "no-store" };

interface FrankfurterResponse {
  rates?: Record<string, number>;
}

export const runtime = "nodejs";

export async function GET() {
  try {
    const response = await fetch("https://api.frankfurter.dev/v1/latest?base=USD", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`exchange rate provider returned ${response.status}`);
    const data = (await response.json()) as FrankfurterResponse;
    // every rate the provider has, so a fare in yen or won converts too; the picker's own currencies must be there
    const rates: Record<string, number> = { USD: 1 };
    for (const [currency, rate] of Object.entries(data.rates ?? {})) {
      if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) rates[currency] = rate;
    }
    const missing = TARGET_CURRENCIES.find((currency) => !rates[currency]);
    if (missing) throw new Error(`missing exchange rate for ${missing}`);
    return Response.json({ base: "USD", rates, fetchedAt: new Date().toISOString() }, { headers });
  } catch (error) {
    console.error("EXCHANGE_RATES_FAILED", error);
    return Response.json({ code: "EXCHANGE_RATES_UNAVAILABLE" }, { status: 503, headers });
  }
}
