import { airlineLogoUrl } from "@/lib/transport/airline-logos";

import { cn } from "@/lib/utils";

/**
 * The airline's logo on a small sticker chip (its colours are drawn for light paper, which a sticker stays at night).
 * Decorative: the carrier's name is always written beside it. Nothing when the airline has no logo.
 */
export function AirlineLogo({ code, className }: { code: string | null | undefined; className?: string }) {
  const src = airlineLogoUrl(code);
  if (!src) return null;
  // a plain img: a third-party SVG at a fixed 12 px gains nothing from next/image
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={cn("ts-logo", className)} src={src} alt="" width={12} height={12} loading="lazy" decoding="async" />;
}
