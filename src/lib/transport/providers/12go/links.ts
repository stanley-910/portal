const TWELVEGO_ORIGIN = "https://12go.asia";
const TRAVELPAYOUTS_ORIGIN = "https://c44.travelpayouts.com/click";

export function twelveGoUrl(fromSlug: string, toSlug: string): string {
  const from = encodeURIComponent(fromSlug.trim().toLowerCase());
  const to = encodeURIComponent(toSlug.trim().toLowerCase());
  return `${TWELVEGO_ORIGIN}/en/travel/${from}/${to}`;
}

export function tagged(url: string, marker = process.env.TRAVELPAYOUTS_MARKER, affiliateId = process.env.TWELVEGO_AFFILIATE_ID): string {
  if (marker) {
    const params = new URLSearchParams({
      shmarker: marker,
      promo_id: "1764",
      source_type: "customlink",
      type: "click",
      custom_url: url,
    });
    return `${TRAVELPAYOUTS_ORIGIN}?${params.toString()}`;
  }
  if (affiliateId) {
    const parsed = new URL(url);
    parsed.searchParams.set("z", affiliateId);
    return parsed.toString();
  }
  return url;
}
