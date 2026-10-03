import "server-only";
import { z } from "zod";

// Every var optional: a missing key means NOT_CONFIGURED for that provider, never a boot failure.
// Adapter tasks append here and to .env.example; never rename.
const optional = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().optional(),
);

const schema = z.object({
  // live flight offers, bookable later; test-mode tokens only sell the fake Duffel Airways
  DUFFEL_ACCESS_TOKEN: optional,
  // travelpayouts.md, 12go.md
  TRAVELPAYOUTS_TOKEN: optional,
  TRAVELPAYOUTS_MARKER: optional,
  TRAVELPAYOUTS_TRS: optional,
  TRAVELPAYOUTS_MARKET: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().default("us"),
  ),
  // 12go.md, china-12306.md
  TWELVEGO_AFFILIATE_ID: optional,
  // taiwan-tdx.md
  TDX_CLIENT_ID: optional,
  TDX_CLIENT_SECRET: optional,
  // korea-data-go-kr.md — the Decoding key
  DATA_GO_KR_SERVICE_KEY: optional,
  // china-12306.md
  TRIPCOM_AFFILIATE_ID: optional,
  // busonlineticket.md
  BOT_REFERER_ID: optional,
  // gtfs.md
  LTA_DATAMALL_ACCOUNT_KEY: optional,
  MOBILITYDB_REFRESH_TOKEN: optional,
  TRANSITLAND_API_KEY: optional,
  DATA_GOV_MY_API_TOKEN: optional,
  // booking (docs/booking/README.md): card holds through Stripe Checkout; unset = a no-charge test checkout
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  // server-only Supabase key for traveller details and payment rows; unset = in-memory, lost on restart
  SUPABASE_SECRET_KEY: optional,
  // 32 random bytes, base64: traveller details are sealed with it before they reach Supabase
  BOOKING_ENCRYPTION_KEY: optional,
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.parse(source);
  return Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined)) as Env;
}

export const env: Env = parseEnv(process.env);
