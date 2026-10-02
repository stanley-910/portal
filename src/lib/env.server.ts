import "server-only";

import { z } from "zod";

const schema = z.object({
  TRAVELPAYOUTS_TOKEN: z.string().optional(),
  TRAVELPAYOUTS_MARKER: z.string().optional(),
  TRAVELPAYOUTS_TRS: z.string().optional(),
  TRAVELPAYOUTS_MARKET: z.string().default("us"),
  TWELVEGO_AFFILIATE_ID: z.string().optional(),
});

export const env = schema.parse({
  TRAVELPAYOUTS_TOKEN: process.env.TRAVELPAYOUTS_TOKEN,
  TRAVELPAYOUTS_MARKER: process.env.TRAVELPAYOUTS_MARKER,
  TRAVELPAYOUTS_TRS: process.env.TRAVELPAYOUTS_TRS,
  TRAVELPAYOUTS_MARKET: process.env.TRAVELPAYOUTS_MARKET,
  TWELVEGO_AFFILIATE_ID: process.env.TWELVEGO_AFFILIATE_ID,
});
