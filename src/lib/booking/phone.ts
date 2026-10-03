// Phone numbers as Duffel takes them: E.164, checked against each country's numbering plan (libphonenumber's compact
// metadata, small enough for the browser), so a number Duffel would refuse at hold time is caught as it's typed.
// Safe on the client and the server.
import { getCountryCallingCode, isSupportedCountry, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/**
 * E.164 ("+85291234567") for what someone typed, read as a number in `country` (ISO 3166-1 alpha-2) unless it starts
 * with + or 00. Null when it isn't a number that country, or the one it names, hands out.
 */
export function toE164(raw: string, country?: string | null): string | null {
  const typed = raw.trim().replace(/^00/, "+");
  const region = country && isSupportedCountry(country.toUpperCase()) ? (country.toUpperCase() as CountryCode) : undefined;
  const parsed = parsePhoneNumberFromString(typed, region);
  return parsed?.isValid() ? parsed.number : null;
}

/** The country an E.164 number belongs to, as alpha-2. */
export const phoneCountry = (e164: string | null | undefined): string | undefined => (e164 ? parsePhoneNumberFromString(e164)?.country : undefined);

/** "+852 9123 4567" for display; the input as it was when it doesn't parse. */
export const formatPhone = (e164: string) => parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;

/** "+852" for an alpha-2 code, or undefined where there's no numbering plan. */
export const dialCode = (country: string): string | undefined => (isSupportedCountry(country) ? `+${getCountryCallingCode(country)}` : undefined);
