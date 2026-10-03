import { z } from "zod";

export const SOURCE = "https://giotaugiave.dsvn.vn/";
const station = z.enum(["hanoi", "saigon"]);
export const seedSchema = z.object({
  checked: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), source: z.literal(SOURCE),
  trains: z.array(z.object({
    number: z.string().regex(/^SE\d+$/), from: station, to: station,
    departMin: z.number().int().min(0).max(1439), arriveMin: z.number().int().min(1440).max(4319),
  }).refine((t) => t.from !== t.to && t.arriveMin > t.departMin)).min(2),
});
export type Seed = z.infer<typeof seedSchema>;

function text(html: string): string {
  return html.replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
function minute(cell: string): number {
  const match = /^(\d{2}):(\d{2})(?:\s*\(ngày \+([12])\))?$/.exec(cell);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error(`Invalid DSVN timetable cell: ${cell}`);
  return Number(match[1]) * 60 + Number(match[2]) + Number(match[3] ?? 0) * 1440;
}

/** Parse only the two official endpoint rows; preserve explicit day offsets, never infer them. */
export function parseTimetable(html: string, checked: string): Seed {
  const trains: Seed["trains"] = [];
  for (const [grid, from, to, fromName, toName] of [
    [1, "hanoi", "saigon", "Hà Nội", "Sài Gòn"],
    [2, "saigon", "hanoi", "Sài Gòn", "Hà Nội"],
  ] as const) {
    const table = html.match(new RegExp(`<table\\b[^>]*id="ctl00_ContentPlaceHolderMain_GridView${grid}"[^>]*>([\\s\\S]*?)</table>`, "i"))?.[1];
    if (!table) throw new Error(`DSVN timetable grid ${grid} missing; snapshot unchanged`);
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
      [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => text(cell[1])),
    );
    const numbers = rows[0]?.slice(2);
    const start = rows.find((row) => row[0] === fromName)?.slice(2);
    const end = rows.find((row) => row[0] === toName)?.slice(2);
    if (!numbers?.length || !start || !end || numbers.length !== start.length || numbers.length !== end.length) {
      throw new Error(`DSVN grid ${grid} endpoint columns changed; snapshot unchanged`);
    }
    numbers.forEach((number, i) => trains.push({ number, from, to, departMin: minute(start[i]), arriveMin: minute(end[i]) }));
  }
  if (new Set(trains.map((train) => train.number)).size !== trains.length) throw new Error("Duplicate DSVN train numbers");
  return seedSchema.parse({ checked, source: SOURCE, trains });
}
