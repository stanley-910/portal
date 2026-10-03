// Dates people write in chat, for when Pip answers without the model.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A date written like "14 Nov", "Nov 14" or "2026-11-14", as YYYY-MM-DD; the next one from today when no year. */
export function dateIn(text: string, today = new Date()): string | null {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  const month3 = `(${MONTHS.join("|")})[a-z]*`;
  const m =
    text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${month3}\\b`, "i")) ??
    text.match(new RegExp(`\\b${month3}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i"));
  if (!m) return null;
  const [dayText, monText] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
  const month = MONTHS.indexOf(monText.toLowerCase());
  const day = Number(dayText);
  if (month < 0 || day < 1 || day > 31) return null;
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  let year = today.getUTCFullYear();
  if (Date.UTC(year, month, day) < start) year++;
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
