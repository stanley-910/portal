const MAX = 120;

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The auto title of a trip (ADR-P07): where legs start first, then every other stop in travel order, each name
 * once. Takes Storage as `getStorageDocument(room, "json")` returns it, and never throws on garbage.
 */
export function planTitle(json: unknown): string {
  const doc = isObj(json) ? json : {};
  const stops = isObj(doc.stops) ? doc.stops : {};
  const legs = (isObj(doc.legs) ? Object.values(doc.legs) : [])
    .filter(isObj)
    .filter((l) => typeof l.from === "string" && typeof l.to === "string")
    .sort((a, b) => {
      const da = typeof a.date === "string" ? a.date : "";
      const db = typeof b.date === "string" ? b.date : "";
      return da.localeCompare(db) || (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
    });

  const arrivals = new Set(legs.map((l) => l.to as string));
  const order: string[] = [];
  const add = (id: string) => {
    if (!order.includes(id)) order.push(id);
  };
  for (const l of legs) if (!arrivals.has(l.from as string)) add(l.from as string);
  for (const l of legs) {
    add(l.from as string);
    add(l.to as string);
  }

  const names: string[] = [];
  for (const id of order) {
    const stop = stops[id];
    const name = isObj(stop) && typeof stop.name === "string" ? stop.name.trim() : "";
    if (name && !names.includes(name)) names.push(name);
  }
  if (!names.length) return "New trip";
  const title = names.join(" → ");
  return title.length > MAX ? `${title.slice(0, MAX - 1)}…` : title;
}
