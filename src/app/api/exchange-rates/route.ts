const TARGET_CURRENCIES = ["USD", "EUR", "CNY", "HKD"] as const;
const SOURCE_CURRENCIES = ["KRW", "THB", "MYR", "SGD"] as const;
const headers = { "Cache-Control": "no-store" };

interface FrankfurterResponse {
  rates?: Record<string, number>;
}

export const runtime = "nodejs";

export async function GET() {
  try {
    const response = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,CNY,HKD,KRW,THB,MYR,SGD", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`exchange rate provider returned ${response.status}`);
    const data = (await response.json()) as FrankfurterResponse;
    const rates = Object.fromEntries(
      [...TARGET_CURRENCIES, ...SOURCE_CURRENCIES].map((currency) => {
        const rate = currency === "USD" ? 1 : data.rates?.[currency];
        if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
          throw new Error(`missing exchange rate for ${currency}`);
        }
        return [currency, rate];
      }),
    );
    return Response.json({ base: "USD", rates, fetchedAt: new Date().toISOString() }, { headers });
  } catch (error) {
    console.error("EXCHANGE_RATES_FAILED", error);
    return Response.json({ code: "EXCHANGE_RATES_UNAVAILABLE" }, { status: 503, headers });
  }
}
