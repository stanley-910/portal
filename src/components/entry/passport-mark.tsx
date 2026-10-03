import { countryName, flagEmoji } from "@/lib/nationality";
import { cn } from "@/lib/utils";

/** Which passport someone is travelling on, as that country's flag. With other passports held, the tooltip says so. */
export function PassportMark({ passport, others = [], className }: { passport: string; others?: string[]; className?: string }) {
  const name = countryName(passport);
  const also = others.filter((c) => c !== passport).map(countryName);
  const title = also.length ? `${name} passport (also holds ${also.join(", ")})` : `${name} passport`;
  return (
    <span className={cn("pa-passport-flag", className)} title={title} aria-label={title} role="img">
      {flagEmoji(passport)}
    </span>
  );
}
