// Route-page deep link, slug rule from BOT's affiliate widget combine.js (busonlineticket.md).
// GET cannot prefill the date. `refererid` only when an affiliate id exists (ADR-B03).
export const BOT_BASE_URL = "https://www.busonlineticket.com";

export function botRouteUrl(fromSlug: string, toSlug: string, refererId?: string): string {
  const slug = (s: string) => s.trim().replace(/\s+/g, "-").toLowerCase();
  const base = `${BOT_BASE_URL}/booking/${slug(fromSlug)}-to-${slug(toSlug)}-bus-tickets`;
  return refererId ? `${base}?${new URLSearchParams({ refererid: refererId })}` : base;
}
